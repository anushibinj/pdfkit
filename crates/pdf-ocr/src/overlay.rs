//! Overlay PDF `/MediaBox` normalizer for `qpdf --overlay` alignment.
//!
//! Why this is needed:
//! `qpdf --overlay` centers an overlay page inside the target page's box and
//! only scales it *down* if it is larger. If Tesseract's `TessPDFRenderer`
//! produces a page whose `/MediaBox` differs slightly (e.g., due to integer
//! pixel-to-point rounding or effective-DPI clamping on huge pages), wrapping the
//! overlay's content stream with `q sx 0 0 sy 0 0 cm ... Q` and setting its
//! `/MediaBox` to `[0, 0, target_width_pt, target_height_pt]` guarantees 1:1
//! coordinate alignment with the original PDF page.

use std::io::Write;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::{dictionary, Document, Object, Stream};

use crate::error::OcrError;

/// Normalizes a 1-page overlay PDF's `/MediaBox` (and `/CropBox` if present) to
/// `[0, 0, target_width_pt, target_height_pt]`, wrapping its content stream in a
/// uniform affine scale matrix when the source dimensions differ.
///
/// # Arguments
///
/// * `pdf_bytes` - Raw bytes of a 1-page unencrypted overlay PDF.
/// * `target_width_pt` - Target displayed width in PDF points (`> 0`).
/// * `target_height_pt` - Target displayed height in PDF points (`> 0`).
///
/// # Returns
///
/// Serialized PDF bytes ready to overlay onto the target PDF page.
///
/// # Errors
///
/// Returns [`OcrError::EmptyInput`], [`OcrError::InvalidConfig`],
/// [`OcrError::Encrypted`], or [`OcrError::InvalidPdf`].
pub fn normalize_overlay_pdf(
    pdf_bytes: &[u8],
    target_width_pt: f64,
    target_height_pt: f64,
) -> Result<Vec<u8>, OcrError> {
    if pdf_bytes.is_empty() {
        return Err(OcrError::EmptyInput);
    }
    if !target_width_pt.is_finite()
        || !target_height_pt.is_finite()
        || target_width_pt <= 0.0
        || target_height_pt <= 0.0
    {
        return Err(OcrError::InvalidConfig);
    }

    let mut doc = Document::load_mem(pdf_bytes).map_err(|_| OcrError::InvalidPdf)?;
    if doc.is_encrypted() {
        return Err(OcrError::Encrypted);
    }

    let Some(&page_id) = doc.get_pages().get(&1) else {
        return Err(OcrError::InvalidPdf);
    };

    let (src_x0, src_y0, src_w, src_h) = read_page_box(&doc, page_id)?;

    let sx = target_width_pt / src_w;
    let sy = target_height_pt / src_h;
    let needs_transform = src_x0.abs() > 1e-4
        || src_y0.abs() > 1e-4
        || (sx - 1.0).abs() > 1e-4
        || (sy - 1.0).abs() > 1e-4;

    if needs_transform {
        let existing = doc.get_page_content(page_id);
        // Translate source origin to (0, 0) and scale to target page size.
        let prefix = format!(
            "q {:.6} 0 0 {:.6} {:.6} {:.6} cm\n",
            sx,
            sy,
            -src_x0 * sx,
            -src_y0 * sy
        );
        let mut wrapped = Vec::with_capacity(prefix.len() + existing.len() + 4);
        wrapped.extend_from_slice(prefix.as_bytes());
        wrapped.extend_from_slice(&existing);
        wrapped.extend_from_slice(b"\nQ\n");

        let compressed = compress_zlib(&wrapped);
        let stream_id = doc.add_object(Stream::new(
            dictionary! {
                "Filter" => "FlateDecode",
                "Length" => compressed.len() as i64,
            },
            compressed,
        ));
        if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
            page_dict.set("Contents", stream_id);
        }
    }

    let target_box = vec![
        Object::Real(0.0),
        Object::Real(0.0),
        Object::Real(target_width_pt as f32),
        Object::Real(target_height_pt as f32),
    ];
    if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
        page_dict.set("MediaBox", target_box.clone());
        if page_dict.has(b"CropBox") {
            page_dict.set("CropBox", target_box);
        }
    }

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|_| OcrError::InvalidPdf)?;
    Ok(out)
}

/// Reads `[x0, y0, width, height]` from a page's `/MediaBox` (falling back to parent `/Pages` if inherited).
fn read_page_box(doc: &Document, page_id: lopdf::ObjectId) -> Result<(f64, f64, f64, f64), OcrError> {
    let media_box = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"MediaBox").ok())
        .and_then(|o| o.as_array().ok());

    let Some(arr) = media_box else {
        return Err(OcrError::InvalidPdf);
    };
    if arr.len() != 4 {
        return Err(OcrError::InvalidPdf);
    }

    let x0 = as_f64(&arr[0]).ok_or(OcrError::InvalidPdf)?;
    let y0 = as_f64(&arr[1]).ok_or(OcrError::InvalidPdf)?;
    let x1 = as_f64(&arr[2]).ok_or(OcrError::InvalidPdf)?;
    let y1 = as_f64(&arr[3]).ok_or(OcrError::InvalidPdf)?;
    let w = x1 - x0;
    let h = y1 - y0;
    if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
        return Err(OcrError::InvalidPdf);
    }
    Ok((x0, y0, w, h))
}

/// Extracts a numeric PDF object (`Integer` or `Real`) as `f64`.
fn as_f64(obj: &Object) -> Option<f64> {
    match obj {
        Object::Integer(n) => Some(*n as f64),
        Object::Real(f) => Some(*f as f64),
        _ => None,
    }
}

/// Compresses `raw` bytes using standard zlib Flate compression.
fn compress_zlib(raw: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    let _ = encoder.write_all(raw);
    encoder.finish().unwrap_or_else(|_| raw.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text_layer::{build_text_layer_pdf, OcrWord};

    #[test]
    fn normalizes_mediabox_and_wraps_scale_transform() {
        let source_pdf = build_text_layer_pdf(
            306.0,
            396.0,
            1275,
            1650,
            &[OcrWord {
                text: "Test".to_string(),
                x0: 10.0,
                y0: 10.0,
                x1: 100.0,
                y1: 50.0,
            }],
        )
        .unwrap();

        let normalized = normalize_overlay_pdf(&source_pdf, 612.0, 792.0).unwrap();
        let doc = Document::load_mem(&normalized).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let (_, _, w, h) = read_page_box(&doc, page_id).unwrap();
        assert!((w - 612.0).abs() < 0.01);
        assert!((h - 792.0).abs() < 0.01);

        let content = String::from_utf8_lossy(&doc.get_page_content(page_id)).to_string();
        assert!(content.starts_with("q 2.000000 0 0 2.000000"));
        assert!(content.trim_end().ends_with("Q"));
    }

    #[test]
    fn rejects_empty_and_invalid_dimensions() {
        assert_eq!(normalize_overlay_pdf(&[], 612.0, 792.0), Err(OcrError::EmptyInput));
        assert_eq!(
            normalize_overlay_pdf(b"%PDF-1.4", -10.0, 792.0),
            Err(OcrError::InvalidConfig)
        );
    }
}
