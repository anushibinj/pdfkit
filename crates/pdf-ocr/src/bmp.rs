//! DPI-aware Windows V3 BMP encoder and optional scan contrast enhancer.
//!
//! Why BMP instead of PNG?
//! 1. Encoding an uncompressed 24-bit BMP in Rust WASM takes < 2 ms per 300 DPI page
//!    (no zlib deflate overhead before Leptonica decodes it again).
//! 2. Windows `BITMAPINFOHEADER` stores exact horizontal and vertical pixel density
//!    (`biXPelsPerMeter`, `biYPelsPerMeter`), so Tesseract's `TessPDFRenderer` knows
//!    the physical page dimensions cleanly without guessing DPI.

use crate::error::OcrError;

/// Conversion factor from dots-per-inch (DPI) to pixels-per-meter (`1 / 0.0254`).
const PIXELS_PER_METER_PER_DPI: f64 = 39.370_078_740_157_48;
/// Size of `BITMAPFILEHEADER` in bytes.
const FILE_HEADER_BYTES: usize = 14;
/// Size of Windows V3 `BITMAPINFOHEADER` in bytes.
const INFO_HEADER_BYTES: usize = 40;

/// Preprocesses an RGBA image buffer (optional percentile contrast stretch for
/// faded or gray-background scans) and encodes it as a 24-bit bottom-up BMP
/// with embedded physical DPI metadata.
///
/// # Arguments
///
/// * `rgba` - Input pixels in row-major top-to-bottom `R, G, B, A` order.
/// * `width` - Image width in pixels (must be > 0).
/// * `height` - Image height in pixels (must be > 0).
/// * `dpi_x` - Horizontal resolution in DPI (clamped to >= 72).
/// * `dpi_y` - Vertical resolution in DPI (clamped to >= 72).
/// * `enhance` - When `true`, applies luminance percentile stretching + soft white point.
///
/// # Returns
///
/// Complete 24-bit BMP file bytes.
///
/// # Errors
///
/// Returns [`OcrError::InvalidDimensions`] when `width == 0`, `height == 0`,
/// or `rgba.len() != width * height * 4`.
pub fn preprocess_and_encode_bmp(
    rgba: &[u8],
    width: u32,
    height: u32,
    dpi_x: u32,
    dpi_y: u32,
    enhance: bool,
) -> Result<Vec<u8>, OcrError> {
    if width == 0 || height == 0 {
        return Err(OcrError::InvalidDimensions);
    }

    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or(OcrError::InvalidDimensions)?;
    let expected_len = pixel_count
        .checked_mul(4)
        .ok_or(OcrError::InvalidDimensions)?;
    if rgba.len() != expected_len {
        return Err(OcrError::InvalidDimensions);
    }

    // Compute percentile bounds when enhancement is enabled so faded scans gain
    // crisp dark ink and clean white paper background without hard binary clipping.
    let (low_luma, high_luma) = if enhance {
        compute_percentile_bounds(rgba, pixel_count)
    } else {
        (0, 255)
    };
    let apply_stretch = enhance && high_luma > low_luma.saturating_add(8);

    // BMP scanlines must be padded to a multiple of 4 bytes.
    // 24-bit BGR uses 3 bytes per pixel; `(width * 3 + 3) & !3` rounds up to 4 bytes.
    let raw_row_bytes = (width as usize) * 3;
    let padded_row_bytes = (raw_row_bytes + 3) & !3;
    let pixel_data_bytes = padded_row_bytes
        .checked_mul(height as usize)
        .ok_or(OcrError::InvalidDimensions)?;
    let total_bytes = FILE_HEADER_BYTES + INFO_HEADER_BYTES + pixel_data_bytes;

    let mut out = vec![0u8; total_bytes];

    // 1. BITMAPFILEHEADER (14 bytes)
    out[0] = b'B';
    out[1] = b'M';
    out[2..6].copy_from_slice(&(total_bytes as u32).to_le_bytes());
    // Bytes 6..10: reserved (0)
    let pixel_offset = (FILE_HEADER_BYTES + INFO_HEADER_BYTES) as u32;
    out[10..14].copy_from_slice(&pixel_offset.to_le_bytes());

    // 2. BITMAPINFOHEADER (40 bytes)
    let x_ppm = ((dpi_x.max(72) as f64) * PIXELS_PER_METER_PER_DPI).round() as i32;
    let y_ppm = ((dpi_y.max(72) as f64) * PIXELS_PER_METER_PER_DPI).round() as i32;

    out[14..18].copy_from_slice(&(INFO_HEADER_BYTES as u32).to_le_bytes());
    out[18..22].copy_from_slice(&(width as i32).to_le_bytes());
    // Positive height => bottom-up scanlines (most universally accepted by Leptonica).
    out[22..26].copy_from_slice(&(height as i32).to_le_bytes());
    out[26..28].copy_from_slice(&1u16.to_le_bytes()); // biPlanes
    out[28..30].copy_from_slice(&24u16.to_le_bytes()); // biBitCount
    // Compression = BI_RGB (0) at bytes 30..34
    out[34..38].copy_from_slice(&(pixel_data_bytes as u32).to_le_bytes());
    out[38..42].copy_from_slice(&x_ppm.to_le_bytes());
    out[42..46].copy_from_slice(&y_ppm.to_le_bytes());

    // 3. Pixel rows (bottom-up: BMP row 0 corresponds to top-down row `height - 1`).
    let w = width as usize;
    let h = height as usize;
    for bmp_row in 0..h {
        let src_y = h - 1 - bmp_row;
        let src_row_start = src_y * w * 4;
        let dst_row_start = FILE_HEADER_BYTES + INFO_HEADER_BYTES + bmp_row * padded_row_bytes;

        for x in 0..w {
            let si = src_row_start + x * 4;
            let di = dst_row_start + x * 3;
            let (r, g, b) = composite_and_enhance(
                rgba[si],
                rgba[si + 1],
                rgba[si + 2],
                rgba[si + 3],
                apply_stretch,
                low_luma,
                high_luma,
            );
            // BMP 24-bit stores channels in B, G, R order.
            out[di] = b;
            out[di + 1] = g;
            out[di + 2] = r;
        }
    }

    Ok(out)
}

/// Computes the 1st and 95th luminance percentiles across `rgba` for contrast normalization.
///
/// Using the 1st percentile as black point prevents isolated dust specks from collapsing
/// contrast, while the 95th percentile lifts dingy gray paper backgrounds toward pure white.
fn compute_percentile_bounds(rgba: &[u8], pixel_count: usize) -> (u8, u8) {
    let mut hist = [0usize; 256];
    for chunk in rgba.chunks_exact(4) {
        let (r, g, b) = alpha_composite_white(chunk[0], chunk[1], chunk[2], chunk[3]);
        let luma = rec601_luma(r, g, b);
        hist[luma as usize] += 1;
    }

    let low_target = pixel_count / 100; // 1st percentile
    let high_target = (pixel_count * 95) / 100; // 95th percentile

    let mut cumulative = 0usize;
    let mut low = 0u8;
    let mut high = 255u8;
    let mut found_low = false;

    for (val, &count) in hist.iter().enumerate() {
        cumulative += count;
        if !found_low && cumulative >= low_target {
            low = val as u8;
            found_low = true;
        }
        if cumulative >= high_target {
            high = val as u8;
            break;
        }
    }

    (low, high)
}

/// Alpha-composites an RGBA pixel onto an opaque white background.
#[inline]
fn alpha_composite_white(r: u8, g: u8, b: u8, a: u8) -> (u8, u8, u8) {
    if a == 255 {
        return (r, g, b);
    }
    if a == 0 {
        return (255, 255, 255);
    }
    let alpha = a as u16;
    let inv = 255 - alpha;
    (
        ((r as u16 * alpha + 255 * inv) / 255) as u8,
        ((g as u16 * alpha + 255 * inv) / 255) as u8,
        ((b as u16 * alpha + 255 * inv) / 255) as u8,
    )
}

/// Computes ITU-R BT.601 integer luminance.
#[inline]
fn rec601_luma(r: u8, g: u8, b: u8) -> u8 {
    ((77 * (r as u32) + 150 * (g as u32) + 29 * (b as u32)) >> 8) as u8
}

/// Applies white-background compositing and optional luminance contrast stretching.
#[inline]
fn composite_and_enhance(
    r: u8,
    g: u8,
    b: u8,
    a: u8,
    apply_stretch: bool,
    low_luma: u8,
    high_luma: u8,
) -> (u8, u8, u8) {
    let (cr, cg, cb) = alpha_composite_white(r, g, b, a);
    if !apply_stretch {
        return (cr, cg, cb);
    }

    let luma = rec601_luma(cr, cg, cb);
    if luma <= low_luma {
        return (0, 0, 0);
    }
    if luma >= high_luma {
        return (255, 255, 255);
    }
    let span = (high_luma - low_luma) as u32;
    let stretched = (((luma - low_luma) as u32) * 255 / span).min(255) as u8;
    // Output clean grayscale-stretched pixel so color paper tint does not interfere with OCR.
    (stretched, stretched, stretched)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_valid_bmp_with_padding_and_dpi() {
        // 3x2 image: raw row = 9 bytes -> padded to 12 bytes (3 bytes padding per row)
        #[rustfmt::skip]
        let rgba = [
            // Top row (y = 0): Red, Green, Blue
            255, 0, 0, 255,   0, 255, 0, 255,   0, 0, 255, 255,
            // Bottom row (y = 1): Black, White, Transparent (becomes White)
            0, 0, 0, 255,     255, 255, 255, 255,  10, 20, 30, 0,
        ];

        let bmp = preprocess_and_encode_bmp(&rgba, 3, 2, 300, 300, false).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        // 14 + 40 + (12 * 2) = 78 bytes
        assert_eq!(bmp.len(), 78);

        let width = i32::from_le_bytes(bmp[18..22].try_into().unwrap());
        let height = i32::from_le_bytes(bmp[22..26].try_into().unwrap());
        let bpp = u16::from_le_bytes(bmp[28..30].try_into().unwrap());
        let x_ppm = i32::from_le_bytes(bmp[38..42].try_into().unwrap());
        assert_eq!(width, 3);
        assert_eq!(height, 2);
        assert_eq!(bpp, 24);
        assert_eq!(x_ppm, 11811); // round(300 * 39.37007874)

        // Bottom-up row 0 (src y = 1): Black (0,0,0), White (255,255,255), White (255,255,255)
        assert_eq!(&bmp[54..63], &[0, 0, 0, 255, 255, 255, 255, 255, 255]);
        // Bottom-up row 1 (src y = 0): Red (BGR: 0,0,255), Green (0,255,0), Blue (255,0,0)
        assert_eq!(&bmp[66..75], &[0, 0, 255, 0, 255, 0, 255, 0, 0]);
    }

    #[test]
    fn enhances_low_contrast_scan_to_full_range() {
        // 100 pixels: 10 dark-ish gray ink (90), 90 light gray paper (180)
        let mut rgba = Vec::with_capacity(100 * 4);
        for i in 0..100 {
            let v = if i < 10 { 90 } else { 180 };
            rgba.extend_from_slice(&[v, v, v, 255]);
        }

        let bmp = preprocess_and_encode_bmp(&rgba, 10, 10, 300, 300, true).unwrap();
        // Bottom row (src y=9) is paper -> stretched to 255
        assert_eq!(&bmp[54..57], &[255, 255, 255]);
        // Top row (src y=0, row index 9 in bottom-up BMP) has ink -> stretched to 0
        let padded_row = (10 * 3 + 3) & !3; // 32
        let top_row_off = 54 + 9 * padded_row;
        assert_eq!(&bmp[top_row_off..top_row_off + 3], &[0, 0, 0]);
    }

    #[test]
    fn rejects_invalid_dimensions_or_length() {
        assert_eq!(
            preprocess_and_encode_bmp(&[], 0, 10, 300, 300, false),
            Err(OcrError::InvalidDimensions)
        );
        assert_eq!(
            preprocess_and_encode_bmp(&[0; 12], 2, 2, 300, 300, false),
            Err(OcrError::InvalidDimensions)
        );
    }
}
