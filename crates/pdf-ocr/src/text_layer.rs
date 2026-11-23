//! Invisible Unicode PDF text-layer builder from word bounding boxes.
//!
//! Used as a fallback (and standalone builder) when constructing a 1-page
//! text-only overlay PDF from Tesseract TSV word boxes. Uses PDF text rendering
//! mode `3 Tr` (neither fill nor stroke) with an embedded glyphless TrueType
//! font and `/ToUnicode` CMap so Indic scripts (Devanagari, Tamil, Bengali,
//! Telugu, etc.) and Latin words are searchable and copyable at exact positions.

use std::collections::BTreeMap;
use std::io::Write;

use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};

use crate::error::OcrError;
use crate::font::{build_glyphless_ttf, build_tounicode_cmap};

/// One recognized word and its pixel bounding box in top-down image coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct OcrWord {
    /// Recognized UTF-8 text of the word.
    pub text: String,
    /// Left pixel coordinate (`0 <= x0 < x1`).
    pub x0: f64,
    /// Top pixel coordinate (`0 <= y0 < y1`).
    pub y0: f64,
    /// Right pixel coordinate.
    pub x1: f64,
    /// Bottom pixel coordinate.
    pub y1: f64,
}

/// Parses Tesseract TSV output (`level page_num block_num par_num line_num word_num left top width height conf text`)
/// into a vector of [`OcrWord`] entries, skipping non-word rows and empty tokens.
///
/// # Arguments
///
/// * `tsv` - Raw UTF-8 TSV string emitted by `TessBaseAPI::GetTSVText`.
///
/// # Returns
///
/// Parsed words with non-empty text and positive bounding boxes.
pub fn parse_words_tsv(tsv: &str) -> Vec<OcrWord> {
    let mut words = Vec::new();
    for line in tsv.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 12 {
            continue;
        }
        // Level 5 rows represent individual words in Tesseract TSV.
        if cols[0].trim() != "5" {
            continue;
        }
        let text = cols[11..].join("\t");
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(left) = cols[6].trim().parse::<f64>() else {
            continue;
        };
        let Ok(top) = cols[7].trim().parse::<f64>() else {
            continue;
        };
        let Ok(width) = cols[8].trim().parse::<f64>() else {
            continue;
        };
        let Ok(height) = cols[9].trim().parse::<f64>() else {
            continue;
        };
        if width <= 0.0 || height <= 0.0 {
            continue;
        }
        words.push(OcrWord {
            text: trimmed.to_string(),
            x0: left,
            y0: top,
            x1: left + width,
            y1: top + height,
        });
    }
    words
}

/// Builds a 1-page searchable text-only PDF (`3 Tr`) with `/MediaBox [0, 0, target_width_pt, target_height_pt]`
/// from recognized [`OcrWord`] boxes.
///
/// # Arguments
///
/// * `target_width_pt` - Target page width in PDF points (`> 0`).
/// * `target_height_pt` - Target page height in PDF points (`> 0`).
/// * `image_width_px` - Source image width in pixels (`> 0`).
/// * `image_height_px` - Source image height in pixels (`> 0`).
/// * `words` - Recognized words with pixel bounding boxes.
///
/// # Returns
///
/// Serialized 1-page PDF bytes ready for `qpdf --overlay`.
///
/// # Errors
///
/// Returns [`OcrError::InvalidConfig`] when target dimensions or pixel dimensions are non-positive.
pub fn build_text_layer_pdf(
    target_width_pt: f64,
    target_height_pt: f64,
    image_width_px: u32,
    image_height_px: u32,
    words: &[OcrWord],
) -> Result<Vec<u8>, OcrError> {
    if !target_width_pt.is_finite()
        || !target_height_pt.is_finite()
        || target_width_pt <= 0.0
        || target_height_pt <= 0.0
        || image_width_px == 0
        || image_height_px == 0
    {
        return Err(OcrError::InvalidConfig);
    }

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    // Assign a distinct 2-byte CID (1..=N) per unique word+trailing-space token.
    // Mapping each word (with trailing space except last or per-word CID) ensures
    // multi-codepoint Indic clusters copy cleanly without glyph decomposition loss.
    let mut cid_map: BTreeMap<String, u16> = BTreeMap::new();
    let mut cid_entries: Vec<(u16, String)> = Vec::new();
    let mut next_cid: u16 = 1;

    let scale_x = target_width_pt / (image_width_px as f64);
    let scale_y = target_height_pt / (image_height_px as f64);

    let mut content = String::new();
    content.push_str("BT\n");
    content.push_str("3 Tr\n"); // Invisible text rendering mode

    for (idx, word) in words.iter().enumerate() {
        if word.text.trim().is_empty() {
            continue;
        }
        // Include a trailing space inside the CID's ToUnicode mapping for every word
        // except the last so PDF viewers insert natural word separators on copy/search.
        let mapped_text = if idx + 1 < words.len() {
            format!("{} ", word.text)
        } else {
            word.text.clone()
        };
        let cid = if let Some(&existing) = cid_map.get(&mapped_text) {
            existing
        } else {
            if next_cid == u16::MAX {
                break;
            }
            let assigned = next_cid;
            next_cid += 1;
            cid_map.insert(mapped_text.clone(), assigned);
            cid_entries.push((assigned, mapped_text));
            assigned
        };

        let box_left_pt = word.x0 * scale_x;
        let box_width_pt = ((word.x1 - word.x0) * scale_x).max(1.0);
        let box_height_pt = ((word.y1 - word.y0) * scale_y).max(1.0);
        // PDF user-space Y increases upward from the bottom edge of the page.
        let box_bottom_pt = target_height_pt - word.y1 * scale_y;

        // Our glyphless TrueType font gives every CID an advance width of 500/1000 = 0.5 em.
        // Using font size `box_height_pt` and horizontal scaling `Tz` = (box_width_pt / (0.5 * box_height_pt)) * 100
        // makes the single CID span the exact pixel width & height of the recognized word.
        let base_advance_pt = 0.5 * box_height_pt;
        let tz = ((box_width_pt / base_advance_pt) * 100.0).clamp(1.0, 10_000.0);

        content.push_str(&format!("/F1 {:.2} Tf\n", box_height_pt));
        content.push_str(&format!("{:.2} Tz\n", tz));
        content.push_str(&format!("1 0 0 1 {:.2} {:.2} Tm\n", box_left_pt, box_bottom_pt));
        content.push_str(&format!("<{:04X}> Tj\n", cid));
    }

    content.push_str("ET\n");

    let content_bytes = compress_zlib(content.as_bytes());
    let content_stream = Stream::new(
        dictionary! {
            "Filter" => "FlateDecode",
            "Length" => content_bytes.len() as i64,
        },
        content_bytes,
    );
    let content_id = doc.add_object(content_stream);

    // Embed glyphless TrueType font + ToUnicode CMap when words exist.
    let font_id = embed_type0_glyphless_font(&mut doc, &cid_entries);

    let resources_dict = dictionary! {
        "Font" => dictionary! {
            "F1" => font_id,
        },
    };

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![
            0.into(),
            0.into(),
            Object::Real(target_width_pt as f32),
            Object::Real(target_height_pt as f32),
        ],
        "Resources" => resources_dict,
        "Contents" => content_id,
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|_| OcrError::InvalidPdf)?;
    Ok(out)
}

/// Embeds a Type0 (`/Identity-H`) CIDFontType2 font with an invisible TrueType program
/// and `/ToUnicode` CMap into `doc`, returning the `/Font` dictionary object ID.
fn embed_type0_glyphless_font(doc: &mut Document, cid_entries: &[(u16, String)]) -> ObjectId {
    let ttf_raw = build_glyphless_ttf();
    let ttf_compressed = compress_zlib(&ttf_raw);
    let font_file_id = doc.add_object(Stream::new(
        dictionary! {
            "Filter" => "FlateDecode",
            "Length1" => ttf_raw.len() as i64,
            "Length" => ttf_compressed.len() as i64,
        },
        ttf_compressed,
    ));

    let descriptor_id = doc.add_object(dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => "GlyphLessFont",
        "Flags" => 4, // Symbolic
        "FontBBox" => vec![0.into(), 0.into(), 500.into(), 800.into()],
        "ItalicAngle" => 0,
        "Ascent" => 800,
        "Descent" => -200,
        "CapHeight" => 800,
        "StemV" => 80,
        "FontFile2" => font_file_id,
    });

    let cid_font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "CIDFontType2",
        "BaseFont" => "GlyphLessFont",
        "CIDSystemInfo" => dictionary! {
            "Registry" => Object::string_literal("Adobe"),
            "Ordering" => Object::string_literal("Identity"),
            "Supplement" => 0,
        },
        "FontDescriptor" => descriptor_id,
        "DW" => 500,
    });

    let cmap_raw = build_tounicode_cmap(cid_entries);
    let cmap_compressed = compress_zlib(&cmap_raw);
    let tounicode_id = doc.add_object(Stream::new(
        dictionary! {
            "Filter" => "FlateDecode",
            "Length" => cmap_compressed.len() as i64,
        },
        cmap_compressed,
    ));

    doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type0",
        "BaseFont" => "GlyphLessFont",
        "Encoding" => "Identity-H",
        "DescendantFonts" => vec![cid_font_id.into()],
        "ToUnicode" => tounicode_id,
    })
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

    #[test]
    fn parses_tsv_level5_words_only() {
        let tsv = "\
level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
1\t1\t0\t0\t0\t0\t0\t0\t1000\t1000\t-1\t
4\t1\t1\t1\t1\t0\t100\t200\t300\t40\t-1\t
5\t1\t1\t1\t1\t1\t100\t200\t120\t36\t95.5\tHello
5\t1\t1\t1\t1\t2\t240\t200\t150\t38\t91.0\tभारत
5\t1\t1\t1\t1\t3\t400\t200\t0\t38\t50.0\tIgnoredZeroW
";
        let words = parse_words_tsv(tsv);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hello");
        assert_eq!(words[0].x0, 100.0);
        assert_eq!(words[0].x1, 220.0);
        assert_eq!(words[1].text, "भारत");
        assert_eq!(words[1].y1, 238.0);
    }

    #[test]
    fn builds_valid_single_page_pdf_with_tounicode() {
        let words = vec![
            OcrWord {
                text: "Invoice".to_string(),
                x0: 100.0,
                y0: 100.0,
                x1: 300.0,
                y1: 150.0,
            },
            OcrWord {
                text: "नमस्ते".to_string(),
                x0: 100.0,
                y0: 200.0,
                x1: 280.0,
                y1: 250.0,
            },
        ];

        let pdf_bytes = build_text_layer_pdf(612.0, 792.0, 2550, 3300, &words).unwrap();
        let doc = Document::load_mem(&pdf_bytes).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        let page_id = *doc.get_pages().get(&1).unwrap();
        let content = doc.get_page_content(page_id);
        let content_str = String::from_utf8_lossy(&content);
        assert!(content_str.contains("3 Tr"));
        assert!(content_str.contains("<0001> Tj"));
        assert!(content_str.contains("<0002> Tj"));
    }

    #[test]
    fn rejects_invalid_target_or_image_dimensions() {
        assert_eq!(
            build_text_layer_pdf(0.0, 792.0, 100, 100, &[]),
            Err(OcrError::InvalidConfig)
        );
        assert_eq!(
            build_text_layer_pdf(612.0, 792.0, 0, 100, &[]),
            Err(OcrError::InvalidConfig)
        );
    }
}
