//! Document-level PDF compression pipeline orchestration.
//!
//! Follows Single Responsibility Principle (SRP) by coordinating structural
//! sanitization, stream deduplication, image optimization, level-9 Flate
//! stream recompression, unreferenced object pruning, and non-expansion guarantees.

use std::io::Read;

use flate2::read::ZlibDecoder;
use lopdf::{Document, Object, ObjectId};

use crate::dedup::deduplicate_streams;
use crate::error::CompressError;
use crate::image::{compress_flate_level9, optimize_images};
use crate::plan::CompressPlan;
use crate::report::CompressReport;

/// Output of a successful PDF compression run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressOutput {
    /// Compressed PDF bytes (guaranteed never larger than the input bytes).
    pub pdf: Vec<u8>,
    /// Detailed compression metrics and safeguard telemetry.
    pub report: CompressReport,
}

/// Strips non-essential per-page bloat (`/Thumb` thumbnail previews and `/PieceInfo`
/// private editor metadata) without affecting rendered page appearance.
fn strip_page_metadata_bloat(doc: &mut Document) {
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        if let Ok(dict) = doc.get_dictionary_mut(page_id) {
            dict.remove(b"Thumb");
            dict.remove(b"PieceInfo");
        }
    }
}

/// Recompresses all `/FlateDecode` streams (without `/DecodeParms` that alter raw stream semantics
/// or already-optimal payloads) at zlib compression level 9, keeping the new bytes only when
/// strictly smaller than the existing stream content.
fn recompress_flate_streams(doc: &mut Document) -> usize {
    let mut recompressed = 0usize;
    let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();

    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) else {
            continue;
        };

        let is_flate = match stream.dict.get(b"Filter") {
            Ok(Object::Name(name)) => name == b"FlateDecode",
            Ok(Object::Array(arr)) if arr.len() == 1 => {
                matches!(&arr[0], Object::Name(name) if name == b"FlateDecode")
            }
            _ => false,
        };
        if !is_flate {
            continue;
        }

        // Skip internal container streams managed by lopdf
        if let Ok(obj_type) = stream.dict.get(b"Type").and_then(Object::as_name) {
            if obj_type == b"ObjStm" || obj_type == b"XRef" {
                continue;
            }
        }

        let mut decoder = ZlibDecoder::new(&stream.content[..]);
        let mut decoded = Vec::new();
        if decoder.read_to_end(&mut decoded).is_err() {
            continue;
        }

        let Some(level9) = compress_flate_level9(&decoded) else {
            continue;
        };

        if level9.len() < stream.content.len() {
            // Assign raw zlib-9 payload directly so `/Filter /FlateDecode` and `/DecodeParms` stay intact.
            let len = i64::try_from(level9.len()).unwrap_or(0);
            stream.content = level9;
            stream.dict.set("Length", Object::Integer(len));
            recompressed += 1;
        }
    }

    recompressed
}

/// Compresses a PDF document according to the provided [`CompressPlan`].
///
/// Pipeline stages:
/// 1. Validates non-empty input and parses with `lopdf::Document::load_mem`.
/// 2. Refuses encrypted PDFs (must be unlocked with qpdf first so encryption is never dropped).
/// 3. Removes non-visual page bloat (`/Thumb`, `/PieceInfo`).
/// 4. Deduplicates identical stream objects (`deduplicate_streams`).
/// 5. Optimizes Image XObjects (`optimize_images`), preserving transparency and never expanding images.
/// 6. Recompresses `/FlateDecode` streams at zlib level 9 when strictly smaller.
/// 7. Prunes unreferenced objects (`prune_objects`).
/// 8. Serializes the final PDF; if the output is larger than or equal to `input`, returns `input`
///    unchanged so compression never increases file size.
///
/// # Arguments
///
/// * `input` - Raw PDF file bytes.
/// * `plan` - Parsed [`CompressPlan`].
///
/// # Returns
///
/// [`CompressOutput`] containing the resulting PDF bytes and [`CompressReport`].
///
/// # Errors
///
/// Returns [`CompressError::EmptyInput`], [`CompressError::InvalidPdf`], or [`CompressError::Encrypted`].
pub fn compress_document(input: &[u8], plan: &CompressPlan) -> Result<CompressOutput, CompressError> {
    if input.is_empty() {
        return Err(CompressError::EmptyInput);
    }

    let mut doc = Document::load_mem(input).map_err(|_| CompressError::InvalidPdf)?;
    if doc.is_encrypted() {
        return Err(CompressError::Encrypted);
    }

    let mut report = CompressReport {
        original_bytes: input.len(),
        ..CompressReport::default()
    };

    strip_page_metadata_bloat(&mut doc);
    report.images_deduplicated = deduplicate_streams(&mut doc);
    optimize_images(&mut doc, plan, &mut report);
    report.flate_streams_recompressed = recompress_flate_streams(&mut doc);

    let pruned = doc.prune_objects();
    report.objects_removed = pruned.len();

    let mut out = Vec::with_capacity(input.len());
    if doc.save_to(&mut out).is_err() || out.is_empty() {
        return Err(CompressError::InvalidPdf);
    }

    // Non-expansion guarantee: never emit a file larger than the original input.
    if out.len() >= input.len() {
        report.compressed_bytes = input.len();
        report.notes.push(
            "Document is already compact; kept original file bytes to avoid size increase.".into(),
        );
        return Ok(CompressOutput {
            pdf: input.to_vec(),
            report,
        });
    }

    report.compressed_bytes = out.len();
    Ok(CompressOutput { pdf: out, report })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::compress_flate_level9;
    use lopdf::{dictionary, Stream};

    #[test]
    fn rejects_empty_and_invalid_inputs() {
        let plan = CompressPlan::default();
        assert_eq!(compress_document(&[], &plan), Err(CompressError::EmptyInput));
        assert_eq!(
            compress_document(b"not a pdf", &plan),
            Err(CompressError::InvalidPdf)
        );
    }

    #[test]
    fn text_only_fixture_never_gets_bigger() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/plain.pdf");
        if let Ok(bytes) = std::fs::read(path) {
            let output = compress_document(&bytes, &CompressPlan::default()).expect("compress plain");
            assert!(output.pdf.len() <= bytes.len());
            assert_eq!(output.report.original_bytes, bytes.len());
            assert_eq!(output.report.compressed_bytes, output.pdf.len());
        }
    }

    #[test]
    fn compresses_photo_heavy_flate_pdf_by_more_than_50_percent() {
        // Build a synthetic PDF containing a 256x256 noisy RGB Flate image (~180 KB)
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut raw_rgb = Vec::with_capacity(256 * 256 * 3);
        for y in 0..256u32 {
            for x in 0..256u32 {
                raw_rgb.push(((x * 3 + y * 5) % 256) as u8);
                raw_rgb.push(((x * 7 + y * 2) % 256) as u8);
                raw_rgb.push(((x * 11 + y * 13) % 256) as u8);
            }
        }
        let flate = compress_flate_level9(&raw_rgb).unwrap();
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 256,
                "Height" => 256,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "FlateDecode",
            },
            flate,
        ));
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"q 72 0 0 72 0 0 cm /Im1 Do Q".to_vec(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 200.into()],
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => img_id } },
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

        let mut input = Vec::new();
        doc.save_to(&mut input).unwrap();

        let plan = CompressPlan {
            lossless: false,
            target_dpi: 150,
            quality: 75,
            grayscale: false,
            replacements: vec![],
        };
        let output = compress_document(&input, &plan).expect("compress photo-heavy pdf");
        assert!(output.report.images_reencoded >= 1);
        assert!(
            output.pdf.len() * 2 < input.len(),
            "Expected > 50% reduction: {} -> {}",
            input.len(),
            output.pdf.len()
        );

        // Verify the saved PDF still parses cleanly and keeps `/Filter /DCTDecode` on the image.
        let reloaded = Document::load_mem(&output.pdf).expect("reload compressed pdf");
        let has_dct = reloaded.objects.values().any(|obj| {
            matches!(
                obj,
                Object::Stream(s)
                    if matches!(s.dict.get(b"Filter").and_then(Object::as_name), Ok(b"DCTDecode"))
            )
        });
        assert!(has_dct, "Expected re-encoded image to keep /Filter /DCTDecode");
    }

    #[test]
    fn preserves_flate_filter_after_level9_recompression() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let raw_text = b"BT /F1 12 Tf 72 720 Td (Hello World! ) Tj ET\n".repeat(40);
        // Level-1 (suboptimal) zlib compression so level-9 strictly shrinks it
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut encoder, &raw_text).unwrap();
        let fast_flate = encoder.finish().unwrap();

        let content_id = doc.add_object(Stream::new(
            dictionary! { "Filter" => "FlateDecode" },
            fast_flate,
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 200.into()],
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
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);

        let mut input = Vec::new();
        doc.save_to(&mut input).unwrap();

        let output = compress_document(&input, &CompressPlan::default()).expect("lossless flate9");
        assert!(output.report.flate_streams_recompressed >= 1);
        let reloaded = Document::load_mem(&output.pdf).expect("reload lossless pdf");
        let has_flate = reloaded.objects.values().any(|obj| {
            matches!(
                obj,
                Object::Stream(s)
                    if matches!(s.dict.get(b"Filter").and_then(Object::as_name), Ok(b"FlateDecode"))
            )
        });
        assert!(has_flate, "Expected Flate stream to keep /Filter /FlateDecode");
    }

    #[test]
    fn preserves_transparent_smask_images() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let smask_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 32,
                "Height" => 32,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            vec![128u8; 32 * 32],
        ));
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 32,
                "Height" => 32,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "SMask" => smask_id,
            },
            vec![200u8; 32 * 32 * 3],
        ));
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"q 32 0 0 32 0 0 cm /Im1 Do Q".to_vec(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
            "Resources" => dictionary! { "XObject" => dictionary! { "Im1" => img_id } },
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

        let mut input = Vec::new();
        doc.save_to(&mut input).unwrap();

        let plan = CompressPlan {
            lossless: false,
            target_dpi: 150,
            quality: 75,
            grayscale: false,
            replacements: vec![],
        };
        let output = compress_document(&input, &plan).expect("compress masked pdf");
        assert_eq!(output.report.transparency_preserved, 2);
        assert_eq!(output.report.images_reencoded, 0);
    }
}
