//! Sanitizes PDF object graphs for true redaction: strips metadata, XMP,
//! embedded attachments, JavaScript actions, hidden layers, matching bookmark
//! titles, and overlapping annotations/form values, prunes unreachable objects,
//! and writes a single-revision PDF without earlier incremental updates.

pub mod clean;
pub mod document;
pub mod error;
pub mod ffi;
pub mod plan;
pub mod report;

pub use document::{sanitize_document, SanitizeOutput};
pub use error::RedactError;
pub use plan::{PageRedactionBox, SanitizePlan};
pub use report::SanitizeReport;

/// Sanitizes `input` according to `plan`.
///
/// # Errors
///
/// See [`RedactError`].
pub fn sanitize_pdf(input: &[u8], plan: &SanitizePlan) -> Result<SanitizeOutput, RedactError> {
    document::sanitize_document(input, plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_pdf_handles_plain_fixture() {
        let input = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/plain.pdf"
        ))
        .unwrap();
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
        let out = sanitize_pdf(&input, &plan).unwrap();
        assert!(out.pdf.starts_with(b"%PDF-"));
    }
}
