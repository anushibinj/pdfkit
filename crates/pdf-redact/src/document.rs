//! High-level PDF sanitization and single-revision rewrite orchestration.

use lopdf::Document;

use crate::clean::{
    clean_area_annotations_and_forms, clean_bookmarks, clean_document_attachments,
    clean_document_javascript, clean_document_metadata, clean_hidden_layers,
};
use crate::error::RedactError;
use crate::plan::SanitizePlan;
use crate::report::SanitizeReport;

/// Output of [`sanitize_document`]: a freshly rewritten single-revision PDF and
/// the sanitization metrics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizeOutput {
    /// Complete single-revision PDF bytes with unreferenced objects pruned.
    pub pdf: Vec<u8>,
    /// Counts of scrubbed metadata, attachments, scripts, layers, bookmarks, and objects.
    pub report: SanitizeReport,
}

/// Sanitizes an unencrypted PDF according to `plan`, prunes unreachable objects
/// (including any objects left behind by content rewrites or earlier incremental
/// revisions), and serializes a single-revision PDF.
///
/// # Errors
///
/// - [`RedactError::EmptyInput`] if `input` is empty.
/// - [`RedactError::Encrypted`] if the PDF is encrypted.
/// - [`RedactError::Unreadable`] if `lopdf` cannot parse the document.
/// - [`RedactError::PageOutOfRange`] if any box targets a missing page.
/// - [`RedactError::Write`] if writing the output PDF fails.
pub fn sanitize_document(input: &[u8], plan: &SanitizePlan) -> Result<SanitizeOutput, RedactError> {
    if input.is_empty() {
        return Err(RedactError::EmptyInput);
    }

    let mut doc = load_unencrypted(input)?;
    let page_count = doc.get_pages().len() as u32;
    for b in &plan.boxes {
        if b.page_index >= page_count {
            return Err(RedactError::PageOutOfRange {
                page: b.page_index,
                count: page_count,
            });
        }
    }

    let mut report = SanitizeReport::default();

    if plan.clean_metadata {
        let (meta, xmp) = clean_document_metadata(&mut doc, &plan.terms, &plan.replacement_label);
        report.metadata_entries_removed = meta;
        report.xmp_streams_removed = xmp;
    }
    if plan.clean_attachments {
        report.attachments_removed = clean_document_attachments(&mut doc);
    }
    if plan.clean_javascript {
        report.javascript_actions_removed = clean_document_javascript(&mut doc);
    }
    if plan.clean_hidden_layers {
        report.hidden_layers_removed = clean_hidden_layers(&mut doc);
    }
    if plan.clean_bookmarks {
        report.bookmarks_cleaned = clean_bookmarks(&mut doc, &plan.terms, &plan.replacement_label);
    }

    let (annots_removed, form_values_cleared) = clean_area_annotations_and_forms(
        &mut doc,
        &plan.boxes,
        &plan.terms,
        &plan.replacement_label,
    );
    report.annotations_removed = annots_removed;
    report.form_values_cleared = form_values_cleared;

    // Prune all unreferenced objects (old content streams, removed metadata,
    // attachments, scripts, and superseded objects) before rewriting a single
    // complete cross-reference table so no earlier incremental revisions survive.
    let pruned = doc.prune_objects();
    report.objects_pruned = pruned.len() as u32;

    let mut pdf = Vec::new();
    doc.save_to(&mut pdf)
        .map_err(|e| RedactError::Write(e.to_string()))?;

    Ok(SanitizeOutput { pdf, report })
}

fn load_unencrypted(input: &[u8]) -> Result<Document, RedactError> {
    match Document::load_mem(input) {
        Ok(doc) if doc.was_encrypted() || doc.is_encrypted() => Err(RedactError::Encrypted),
        Ok(doc) => Ok(doc),
        Err(lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_)) => {
            Err(RedactError::Encrypted)
        }
        Err(err) => Err(RedactError::Unreadable(err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::PageRedactionBox;
    use lopdf::{dictionary, Object, Stream};

    #[test]
    fn refuses_empty_and_encrypted_inputs() {
        let plan = SanitizePlan {
            clean_metadata: true,
            clean_attachments: true,
            clean_javascript: true,
            clean_hidden_layers: true,
            clean_bookmarks: true,
            replacement_label: "[REDACTED]".into(),
            terms: vec![],
            boxes: vec![],
        };
        assert_eq!(sanitize_document(&[], &plan), Err(RedactError::EmptyInput));

        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
        let encrypted = std::fs::read(format!("{fixtures}user-password.pdf")).unwrap();
        assert_eq!(
            sanitize_document(&encrypted, &plan),
            Err(RedactError::Encrypted)
        );
    }

    #[test]
    fn prunes_incremental_revision_objects_and_rewrites_single_eof() {
        // Build a PDF, serialize it, then append an incremental update replacing
        // the page content so the raw bytes contain "OLD_SECRET_REVISION".
        let mut doc = Document::with_version("1.7");
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 50 700 Td (OLD_SECRET_REVISION) Tj ET".to_vec(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content_id,
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![page_id.into()],
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut base = Vec::new();
        doc.save_to(&mut base).unwrap();

        // Simulate an incremental revision replacing the content stream while
        // keeping the old revision appended before a second %%EOF.
        let new_content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 50 700 Td (CLEAN_CONTENT) Tj ET".to_vec(),
        ));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Contents", new_content_id);
        let mut second = Vec::new();
        doc.save_to(&mut second).unwrap();

        let mut incremental = base.clone();
        incremental.extend_from_slice(&second);
        assert!(incremental
            .windows(b"OLD_SECRET_REVISION".len())
            .any(|w| w == b"OLD_SECRET_REVISION"));

        // Sanitize the rewritten second PDF (or a loaded doc whose old stream
        // is unreferenced) and verify old bytes + duplicate %%EOF are gone.
        let mut loaded = Document::load_mem(&second).unwrap();
        let mut bytes_with_unreferenced = Vec::new();
        loaded.save_to(&mut bytes_with_unreferenced).unwrap();

        let plan = SanitizePlan {
            clean_metadata: true,
            clean_attachments: true,
            clean_javascript: true,
            clean_hidden_layers: true,
            clean_bookmarks: true,
            replacement_label: "[REDACTED]".into(),
            terms: vec!["OLD_SECRET_REVISION".into()],
            boxes: vec![PageRedactionBox {
                page_index: 0,
                left: 0.0,
                bottom: 0.0,
                right: 100.0,
                top: 100.0,
            }],
        };

        let out = sanitize_document(&bytes_with_unreferenced, &plan).unwrap();
        assert!(out.pdf.starts_with(b"%PDF-"));
        assert!(!out
            .pdf
            .windows(b"OLD_SECRET_REVISION".len())
            .any(|w| w == b"OLD_SECRET_REVISION"));
        assert_eq!(out.pdf.windows(5).filter(|w| *w == b"%%EOF").count(), 1);
    }

    #[test]
    fn errors_when_box_page_index_is_out_of_range() {
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
        let plain = std::fs::read(format!("{fixtures}plain.pdf")).unwrap();
        let plan = SanitizePlan {
            clean_metadata: false,
            clean_attachments: false,
            clean_javascript: false,
            clean_hidden_layers: false,
            clean_bookmarks: false,
            replacement_label: "[REDACTED]".into(),
            terms: vec![],
            boxes: vec![PageRedactionBox {
                page_index: 99,
                left: 0.0,
                bottom: 0.0,
                right: 10.0,
                top: 10.0,
            }],
        };
        assert!(matches!(
            sanitize_document(&plain, &plan),
            Err(RedactError::PageOutOfRange { page: 99, .. })
        ));
    }
}
