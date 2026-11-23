//! Image downsampling, grayscale conversion, hashing, and baseline DCT JPEG encoding.
//!
//! Follows Single Responsibility Principle (SRP) by isolating pixel-level image
//! transformations and ITU-T T.81 baseline sequential JPEG encoding in a pure
//! Rust module with zero external image crate dependencies.

use crate::error::CompressError;

/// FNV-1a 64-bit offset basis (`0xcbf29ce484222325`).
const FNV1A_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
/// FNV-1a 64-bit prime (`0x100000001b3`).
const FNV1A_PRIME: u64 = 0x0100_0000_01b3;

/// Computes a deterministic 64-bit FNV-1a hash over arbitrary byte slices.
///
/// Used to match raw PDF image stream identities between TypeScript (PDFium)
/// and Rust (`lopdf`) across the WebAssembly FFI boundary without transferring
/// duplicate raw image payloads.
///
/// # Arguments
///
/// * `data` - Input byte slice.
///
/// # Returns
///
/// Unsigned 64-bit FNV-1a hash digest.
pub fn fnv1a_hash64(data: &[u8]) -> u64 {
    let mut hash = FNV1A_OFFSET_BASIS;
    for &byte in data {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV1A_PRIME);
    }
    hash
}

/// Downsamples an RGBA pixel buffer to `dst_w x dst_h` using area (box) averaging.
///
/// Unlike nearest-neighbor sampling, area averaging integrates every source pixel
/// whose footprint overlaps each destination pixel. This avoids moiré and stair-step
/// aliasing when shrinking high-resolution scanned pages or photos.
///
/// # Arguments
///
/// * `rgba` - Source RGBA pixels (`src_w * src_h * 4` bytes).
/// * `src_w` - Source width in pixels (> 0).
/// * `src_h` - Source height in pixels (> 0).
/// * `dst_w` - Destination width in pixels (> 0).
/// * `dst_h` - Destination height in pixels (> 0).
///
/// # Returns
///
/// Downsampled RGBA byte buffer of length `dst_w * dst_h * 4`.
///
/// # Errors
///
/// Returns [`CompressError::InvalidImage`] if dimensions are zero or buffer length mismatches.
pub fn downsample_rgba(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, CompressError> {
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return Err(CompressError::InvalidImage);
    }
    let expected = (src_w as usize)
        .checked_mul(src_h as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or(CompressError::InvalidImage)?;
    if rgba.len() != expected {
        return Err(CompressError::InvalidImage);
    }

    if src_w == dst_w && src_h == dst_h {
        return Ok(rgba.to_vec());
    }

    let out_len = (dst_w as usize)
        .checked_mul(dst_h as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or(CompressError::InvalidImage)?;
    let mut out = vec![0u8; out_len];

    let scale_x = f64::from(src_w) / f64::from(dst_w);
    let scale_y = f64::from(src_h) / f64::from(dst_h);

    for dy in 0..dst_h {
        let sy_start = ((f64::from(dy) * scale_y).floor() as u32).min(src_h - 1);
        let sy_end = (((f64::from(dy + 1) * scale_y).ceil() as u32).max(sy_start + 1)).min(src_h);

        for dx in 0..dst_w {
            let sx_start = ((f64::from(dx) * scale_x).floor() as u32).min(src_w - 1);
            let sx_end =
                (((f64::from(dx + 1) * scale_x).ceil() as u32).max(sx_start + 1)).min(src_w);

            let mut sum_r: u64 = 0;
            let mut sum_g: u64 = 0;
            let mut sum_b: u64 = 0;
            let mut sum_a: u64 = 0;
            let mut count: u64 = 0;

            for sy in sy_start..sy_end {
                let row_offset = (sy as usize) * (src_w as usize) * 4;
                for sx in sx_start..sx_end {
                    let idx = row_offset + (sx as usize) * 4;
                    sum_r += u64::from(rgba[idx]);
                    sum_g += u64::from(rgba[idx + 1]);
                    sum_b += u64::from(rgba[idx + 2]);
                    sum_a += u64::from(rgba[idx + 3]);
                    count += 1;
                }
            }

            let out_idx = ((dy as usize) * (dst_w as usize) + (dx as usize)) * 4;
            let half = count / 2;
            out[out_idx] = ((sum_r + half) / count) as u8;
            out[out_idx + 1] = ((sum_g + half) / count) as u8;
            out[out_idx + 2] = ((sum_b + half) / count) as u8;
            out[out_idx + 3] = ((sum_a + half) / count) as u8;
        }
    }

    Ok(out)
}

/// Converts RGBA pixels to 1-byte-per-pixel ITU-R BT.601 grayscale luminance.
///
/// Uses fixed-point integer arithmetic (`0.299 R + 0.587 G + 0.114 B`),
/// approximated as `(77 * R + 150 * G + 29 * B + 128) >> 8`.
///
/// # Arguments
///
/// * `rgba` - Input RGBA buffer (length must be a multiple of 4).
///
/// # Returns
///
/// Grayscale byte vector of length `rgba.len() / 4`.
pub fn rgba_to_grayscale_bytes(rgba: &[u8]) -> Vec<u8> {
    let pixel_count = rgba.len() / 4;
    let mut gray = Vec::with_capacity(pixel_count);
    for chunk in rgba.chunks_exact(4) {
        let r = u32::from(chunk[0]);
        let g = u32::from(chunk[1]);
        let b = u32::from(chunk[2]);
        let y = (77 * r + 150 * g + 29 * b + 128) >> 8;
        gray.push(y.min(255) as u8);
    }
    gray
}

/// Standard ITU-T T.81 Annex K luminance quantization table (50% baseline).
const STD_LUMINANCE_QUANT: [u8; 64] = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
];

/// Standard ITU-T T.81 Annex K chrominance quantization table (50% baseline).
const STD_CHROMINANCE_QUANT: [u8; 64] = [
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
];

/// Zig-zag scan order mapping linear index `0..64` to 8x8 row-major index.
const ZIGZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
];

/// Standard Annex K DC luminance Huffman bit counts (lengths 1..=16).
const DC_LUMA_BITS: [u8; 16] = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/// Standard Annex K DC chrominance Huffman bit counts and values.
const DC_CHROMA_BITS: [u8; 16] = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/// Standard Annex K AC luminance Huffman bit counts and values.
const AC_LUMA_BITS: [u8; 16] = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS: [u8; 162] = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
];

/// Standard Annex K AC chrominance Huffman bit counts and values.
const AC_CHROMA_BITS: [u8; 16] = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS: [u8; 162] = [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
];

/// Precomputed Huffman lookup table mapping byte symbol `0..=255` to `(code, bit_length)`.
struct HuffmanTable {
    codes: [u16; 256],
    lengths: [u8; 256],
}

impl HuffmanTable {
    /// Builds canonical JPEG Huffman codes from Annex K `(bits, vals)` specification.
    fn from_spec(bits: &[u8; 16], vals: &[u8]) -> Self {
        let mut codes = [0u16; 256];
        let mut lengths = [0u8; 256];

        let mut code: u32 = 0;
        let mut val_idx = 0usize;

        for (len_minus_1, &count) in bits.iter().enumerate() {
            let bit_len = (len_minus_1 + 1) as u8;
            for _ in 0..count {
                let sym = vals[val_idx] as usize;
                codes[sym] = code as u16;
                lengths[sym] = bit_len;
                code += 1;
                val_idx += 1;
            }
            code <<= 1;
        }

        Self { codes, lengths }
    }
}

/// Bitstream writer performing JPEG byte stuffing (`0xFF` -> `0xFF 0x00`).
struct JpegBitWriter<'a> {
    out: &'a mut Vec<u8>,
    bit_buf: u32,
    bit_count: u8,
}

impl<'a> JpegBitWriter<'a> {
    fn new(out: &'a mut Vec<u8>) -> Self {
        Self {
            out,
            bit_buf: 0,
            bit_count: 0,
        }
    }

    /// Writes the lowest `len` bits of `bits` MSB-first into the output stream.
    fn write_bits(&mut self, bits: u16, len: u8) {
        if len == 0 {
            return;
        }
        let masked = u32::from(bits) & ((1u32 << len) - 1);
        self.bit_buf = (self.bit_buf << len) | masked;
        self.bit_count += len;

        while self.bit_count >= 8 {
            self.bit_count -= 8;
            let byte = ((self.bit_buf >> self.bit_count) & 0xff) as u8;
            self.out.push(byte);
            // JPEG entropy coding requires a 0x00 stuffed byte after any literal 0xFF
            // so decoders never confuse entropy data with a restart/EOI marker.
            if byte == 0xff {
                self.out.push(0x00);
            }
        }
    }

    /// Pads remaining bits with `1`s to the next byte boundary per JPEG spec.
    fn flush(&mut self) {
        if self.bit_count > 0 {
            let pad = 8 - self.bit_count;
            let ones = (1u16 << pad) - 1;
            self.write_bits(ones, pad);
        }
    }
}

/// Scales a standard quantization table by quality `1..=100` using IJG scaling.
fn scale_quant_table(base: &[u8; 64], quality: u8) -> [u8; 64] {
    let q = quality.clamp(1, 100) as i32;
    let scale = if q < 50 { 5000 / q } else { 200 - q * 2 };

    let mut scaled = [0u8; 64];
    for i in 0..64 {
        let val = ((i32::from(base[i]) * scale + 50) / 100).clamp(1, 255);
        scaled[i] = val as u8;
    }
    scaled
}

/// Computes the 2D Forward Discrete Cosine Transform (FDCT) on an 8x8 level-shifted block
/// (`[-128, 127]`) and quantizes coefficients into zig-zag order.
fn fdct_and_quantize(block: &[f32; 64], quant_zz: &[u8; 64]) -> [i16; 64] {
    // Precomputed cos((2x + 1) * u * pi / 16) * alpha(u) / 2 matrix
    const C: [[f32; 8]; 8] = [
        [0.35355338, 0.35355338, 0.35355338, 0.35355338, 0.35355338, 0.35355338, 0.35355338, 0.35355338],
        [0.49039263, 0.4157348, 0.27778512, 0.09754516, -0.09754516, -0.27778512, -0.4157348, -0.49039263],
        [0.46193975, 0.19134171, -0.19134171, -0.46193975, -0.46193975, -0.19134171, 0.19134171, 0.46193975],
        [0.4157348, -0.09754516, -0.49039263, -0.27778512, 0.27778512, 0.49039263, 0.09754516, -0.4157348],
        [0.35355338, -0.35355338, -0.35355338, 0.35355338, 0.35355338, -0.35355338, -0.35355338, 0.35355338],
        [0.27778512, -0.49039263, 0.09754516, 0.4157348, -0.4157348, -0.09754516, 0.49039263, -0.27778512],
        [0.19134171, -0.46193975, 0.46193975, -0.19134171, -0.19134171, 0.46193975, -0.46193975, 0.19134171],
        [0.09754516, -0.27778512, 0.4157348, -0.49039263, 0.49039263, -0.4157348, 0.27778512, -0.09754516],
    ];

    // Separable 1D row pass
    let mut tmp = [0.0f32; 64];
    for r in 0..8 {
        let row = &block[r * 8..(r + 1) * 8];
        for u in 0..8 {
            let mut sum = 0.0f32;
            for x in 0..8 {
                sum += row[x] * C[u][x];
            }
            tmp[r * 8 + u] = sum;
        }
    }

    // Separable 1D column pass -> row-major frequency coefficients
    let mut dct = [0.0f32; 64];
    for v in 0..8 {
        for u in 0..8 {
            let mut sum = 0.0f32;
            for y in 0..8 {
                sum += tmp[y * 8 + u] * C[v][y];
            }
            dct[v * 8 + u] = sum;
        }
    }

    // Zig-zag scan and quantize
    let mut quantized = [0i16; 64];
    for zz in 0..64 {
        let coeff = dct[ZIGZAG[zz]];
        let q = f32::from(quant_zz[zz]);
        quantized[zz] = (coeff / q).round() as i16;
    }
    quantized
}

/// Returns `(category, magnitude_bits)` for a signed JPEG coefficient difference or AC value.
#[inline]
fn encode_category(val: i16) -> (u8, u16) {
    if val == 0 {
        return (0, 0);
    }
    let abs_val = val.unsigned_abs();
    let cat = (16 - abs_val.leading_zeros()) as u8;
    let bits = if val > 0 {
        abs_val
    } else {
        // Negative values use 1's-complement within `cat` bits
        ((1u16 << cat) - 1) - abs_val
    };
    (cat, bits)
}

/// Encodes one quantized 8x8 block using DC DPCM and AC run-length Huffman coding.
fn encode_block(
    writer: &mut JpegBitWriter<'_>,
    coeffs: &[i16; 64],
    prev_dc: &mut i16,
    dc_table: &HuffmanTable,
    ac_table: &HuffmanTable,
) {
    // Encode DC difference
    let diff = coeffs[0] - *prev_dc;
    *prev_dc = coeffs[0];
    let (dc_cat, dc_bits) = encode_category(diff);
    let dc_sym = dc_cat as usize;
    writer.write_bits(dc_table.codes[dc_sym], dc_table.lengths[dc_sym]);
    if dc_cat > 0 {
        writer.write_bits(dc_bits, dc_cat);
    }

    // Encode AC coefficients in zig-zag order 1..64
    let mut last_nonzero = 63usize;
    while last_nonzero > 0 && coeffs[last_nonzero] == 0 {
        last_nonzero -= 1;
    }

    if last_nonzero == 0 {
        // EOB (End of Block = 0x00)
        writer.write_bits(ac_table.codes[0x00], ac_table.lengths[0x00]);
        return;
    }

    let mut idx = 1usize;
    while idx <= last_nonzero {
        let mut zero_run = 0usize;
        while idx <= last_nonzero && coeffs[idx] == 0 {
            zero_run += 1;
            idx += 1;
        }
        // Emit ZRL (0xF0 = 16 consecutive zeros) as needed
        while zero_run >= 16 {
            writer.write_bits(ac_table.codes[0xf0], ac_table.lengths[0xf0]);
            zero_run -= 16;
        }
        let (ac_cat, ac_bits) = encode_category(coeffs[idx]);
        let sym = ((zero_run as u8) << 4) | ac_cat;
        writer.write_bits(ac_table.codes[sym as usize], ac_table.lengths[sym as usize]);
        writer.write_bits(ac_bits, ac_cat);
        idx += 1;
    }

    if last_nonzero < 63 {
        // Trailing zeros end with EOB
        writer.write_bits(ac_table.codes[0x00], ac_table.lengths[0x00]);
    }
}

/// Writes a JPEG `DQT` (Define Quantization Table) marker segment.
fn write_dqt(out: &mut Vec<u8>, table_id: u8, table_zz: &[u8; 64]) {
    out.extend_from_slice(&[0xff, 0xdb, 0x00, 67, table_id]);
    out.extend_from_slice(table_zz);
}

/// Writes a JPEG `DHT` (Define Huffman Table) marker segment.
fn write_dht(out: &mut Vec<u8>, class_and_id: u8, bits: &[u8; 16], vals: &[u8]) {
    let len = 2 + 1 + 16 + vals.len();
    out.extend_from_slice(&[0xff, 0xc4]);
    out.extend_from_slice(&(len as u16).to_be_bytes());
    out.push(class_and_id);
    out.extend_from_slice(bits);
    out.extend_from_slice(vals);
}

/// Encodes an RGBA pixel buffer into a baseline sequential DCT JPEG byte stream.
///
/// Produces standard JFIF-compatible baseline JPEG (`SOF0`) in either 1-component
/// grayscale (`grayscale = true`, `/DeviceGray` in PDF) or 3-component YCbCr
/// (`grayscale = false`, `/DeviceRGB` in PDF).
///
/// # Arguments
///
/// * `rgba` - Source RGBA pixels (`width * height * 4` bytes).
/// * `width` - Image width in pixels (> 0, <= 65535).
/// * `height` - Image height in pixels (> 0, <= 65535).
/// * `quality` - JPEG quality `[1, 100]`.
/// * `grayscale` - When true, emits a 1-channel grayscale JPEG.
///
/// # Returns
///
/// Valid JPEG file bytes beginning with `0xFF 0xD8` and ending with `0xFF 0xD9`.
///
/// # Errors
///
/// Returns [`CompressError::InvalidImage`] if dimensions are out of range or buffer length mismatches.
pub fn encode_jpeg_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    grayscale: bool,
) -> Result<Vec<u8>, CompressError> {
    if width == 0 || height == 0 || width > 65535 || height > 65535 {
        return Err(CompressError::InvalidImage);
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or(CompressError::InvalidImage)?;
    if rgba.len() != expected {
        return Err(CompressError::InvalidImage);
    }

    let luma_table_row = scale_quant_table(&STD_LUMINANCE_QUANT, quality);
    let chroma_table_row = scale_quant_table(&STD_CHROMINANCE_QUANT, quality);

    // Reorder quantization tables to zig-zag order as required by JPEG DQT & quantized coeffs
    let mut luma_zz = [0u8; 64];
    let mut chroma_zz = [0u8; 64];
    for zz in 0..64 {
        luma_zz[zz] = luma_table_row[ZIGZAG[zz]];
        chroma_zz[zz] = chroma_table_row[ZIGZAG[zz]];
    }

    let dc_luma = HuffmanTable::from_spec(&DC_LUMA_BITS, &DC_LUMA_VALS);
    let ac_luma = HuffmanTable::from_spec(&AC_LUMA_BITS, &AC_LUMA_VALS);
    let dc_chroma = HuffmanTable::from_spec(&DC_CHROMA_BITS, &DC_CHROMA_VALS);
    let ac_chroma = HuffmanTable::from_spec(&AC_CHROMA_BITS, &AC_CHROMA_VALS);

    let mut out = Vec::with_capacity((width as usize * height as usize) / 2 + 1024);

    // SOI + APP0 (JFIF 1.01)
    out.extend_from_slice(&[
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00,
    ]);

    // DQT
    write_dqt(&mut out, 0, &luma_zz);
    if !grayscale {
        write_dqt(&mut out, 1, &chroma_zz);
    }

    // SOF0 (Baseline DCT)
    let components: u8 = if grayscale { 1 } else { 3 };
    let sof_len: u16 = 8 + 3 * u16::from(components);
    out.extend_from_slice(&[0xff, 0xc0]);
    out.extend_from_slice(&sof_len.to_be_bytes());
    out.push(8); // 8-bit sample precision
    out.extend_from_slice(&(height as u16).to_be_bytes());
    out.extend_from_slice(&(width as u16).to_be_bytes());
    out.push(components);
    if grayscale {
        out.extend_from_slice(&[1, 0x11, 0]);
    } else {
        out.extend_from_slice(&[1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
    }

    // DHT
    write_dht(&mut out, 0x00, &DC_LUMA_BITS, &DC_LUMA_VALS);
    write_dht(&mut out, 0x10, &AC_LUMA_BITS, &AC_LUMA_VALS);
    if !grayscale {
        write_dht(&mut out, 0x01, &DC_CHROMA_BITS, &DC_CHROMA_VALS);
        write_dht(&mut out, 0x11, &AC_CHROMA_BITS, &AC_CHROMA_VALS);
    }

    // SOS
    let sos_len: u16 = 6 + 2 * u16::from(components);
    out.extend_from_slice(&[0xff, 0xda]);
    out.extend_from_slice(&sos_len.to_be_bytes());
    out.push(components);
    if grayscale {
        out.extend_from_slice(&[1, 0x00]);
    } else {
        out.extend_from_slice(&[1, 0x00, 2, 0x11, 3, 0x11]);
    }
    out.extend_from_slice(&[0x00, 0x3f, 0x00]); // Ss=0, Se=63, Ah/Al=0

    // Entropy-coded MCU stream (8x8 MCUs, 1x1 sampling)
    let mcu_w = width.div_ceil(8);
    let mcu_h = height.div_ceil(8);

    let mut prev_dc_y = 0i16;
    let mut prev_dc_cb = 0i16;
    let mut prev_dc_cr = 0i16;
    let mut writer = JpegBitWriter::new(&mut out);

    for my in 0..mcu_h {
        let base_y = my * 8;
        for mx in 0..mcu_w {
            let base_x = mx * 8;
            let mut y_block = [0.0f32; 64];
            let mut cb_block = [0.0f32; 64];
            let mut cr_block = [0.0f32; 64];

            for dy in 0..8 {
                let py = (base_y + dy).min(height - 1);
                let row_off = (py as usize) * (width as usize) * 4;
                for dx in 0..8 {
                    let px = (base_x + dx).min(width - 1);
                    let idx = row_off + (px as usize) * 4;
                    let r = f32::from(rgba[idx]);
                    let g = f32::from(rgba[idx + 1]);
                    let b = f32::from(rgba[idx + 2]);
                    let cell = (dy * 8 + dx) as usize;

                    // ITU-R BT.601 level-shifted by -128 for JPEG DCT
                    y_block[cell] = 0.299 * r + 0.587 * g + 0.114 * b - 128.0;
                    if !grayscale {
                        cb_block[cell] = -0.168_736 * r - 0.331_264 * g + 0.5 * b;
                        cr_block[cell] = 0.5 * r - 0.418_688 * g - 0.081_312 * b;
                    }
                }
            }

            let y_q = fdct_and_quantize(&y_block, &luma_zz);
            encode_block(&mut writer, &y_q, &mut prev_dc_y, &dc_luma, &ac_luma);

            if !grayscale {
                let cb_q = fdct_and_quantize(&cb_block, &chroma_zz);
                encode_block(&mut writer, &cb_q, &mut prev_dc_cb, &dc_chroma, &ac_chroma);

                let cr_q = fdct_and_quantize(&cr_block, &chroma_zz);
                encode_block(&mut writer, &cr_q, &mut prev_dc_cr, &dc_chroma, &ac_chroma);
            }
        }
    }

    writer.flush();
    out.extend_from_slice(&[0xff, 0xd9]); // EOI
    Ok(out)
}

/// Downsamples an RGBA buffer if needed and encodes it as baseline JPEG.
///
/// # Arguments
///
/// * `rgba` - Source RGBA pixels.
/// * `src_w` - Source width in pixels.
/// * `src_h` - Source height in pixels.
/// * `dst_w` - Target width in pixels.
/// * `dst_h` - Target height in pixels.
/// * `quality` - JPEG quality `[1, 100]`.
/// * `grayscale` - When true, produces a 1-channel grayscale JPEG.
///
/// # Returns
///
/// Baseline JPEG byte stream.
pub fn process_and_encode_jpeg(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    quality: u8,
    grayscale: bool,
) -> Result<Vec<u8>, CompressError> {
    if src_w == dst_w && src_h == dst_h {
        encode_jpeg_rgba(rgba, src_w, src_h, quality, grayscale)
    } else {
        let resized = downsample_rgba(rgba, src_w, src_h, dst_w, dst_h)?;
        encode_jpeg_rgba(&resized, dst_w, dst_h, quality, grayscale)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_rgba(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                out.push(((x * 7 + y * 3) % 256) as u8);
                out.push(((x * 3 + y * 11) % 256) as u8);
                out.push(((x * 13 + y * 5) % 256) as u8);
                out.push(255);
            }
        }
        out
    }

    #[test]
    fn fnv1a_hash64_matches_known_vectors() {
        assert_eq!(fnv1a_hash64(b""), 0xcbf2_9ce4_8422_2325);
        assert_ne!(fnv1a_hash64(b"abc"), fnv1a_hash64(b"abd"));
        assert_eq!(fnv1a_hash64(b"hello"), 0xa430_d846_80aa_bd0b);
    }

    #[test]
    fn downsample_rgba_averages_2x2_blocks() {
        // 2x2 image -> 1x1 average
        let src = [
            100, 0, 0, 255, //
            200, 0, 0, 255, //
            100, 0, 0, 255, //
            200, 0, 0, 255, //
        ];
        let dst = downsample_rgba(&src, 2, 2, 1, 1).expect("downsample 2x2->1x1");
        assert_eq!(dst, vec![150, 0, 0, 255]);
    }

    #[test]
    fn rgba_to_grayscale_bytes_computes_bt601_luminance() {
        let rgba = [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255];
        let gray = rgba_to_grayscale_bytes(&rgba);
        assert_eq!(gray[0], 255);
        assert_eq!(gray[1], 0);
        // Pure red ~= 0.299 * 255 ~= 77
        assert!((75..=78).contains(&gray[2]));
    }

    #[test]
    fn encode_jpeg_produces_valid_markers_and_quality_scaling() {
        let rgba = sample_rgba(64, 48);
        let q90 = encode_jpeg_rgba(&rgba, 64, 48, 90, false).expect("encode q90");
        let q40 = encode_jpeg_rgba(&rgba, 64, 48, 40, false).expect("encode q40");
        let gray = encode_jpeg_rgba(&rgba, 64, 48, 75, true).expect("encode grayscale");

        for jpg in [&q90, &q40, &gray] {
            assert_eq!(&jpg[0..2], &[0xff, 0xd8]); // SOI
            assert_eq!(&jpg[jpg.len() - 2..], &[0xff, 0xd9]); // EOI
        }

        // Higher quality produces a larger file on textured content
        assert!(q40.len() < q90.len());
        // Grayscale SOF0 has 1 component (0x01 after height/width)
        let sof_pos = gray
            .windows(2)
            .position(|w| w == [0xff, 0xc0])
            .expect("SOF0 marker");
        assert_eq!(gray[sof_pos + 9], 1);
    }

    #[test]
    fn rejects_invalid_image_dimensions() {
        assert_eq!(
            encode_jpeg_rgba(&[], 0, 10, 75, false),
            Err(CompressError::InvalidImage)
        );
        assert_eq!(
            downsample_rgba(&[0, 0, 0, 0], 2, 2, 1, 1),
            Err(CompressError::InvalidImage)
        );
    }
}
