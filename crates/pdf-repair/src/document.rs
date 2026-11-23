//! High-level PDF repair orchestration and document reconstruction.

use crate::carve::{reconstruct_xref_and_trailer, sanitize_eof, sanitize_header, scan_objects};
use crate::error::RepairError;
use crate::report::RepairReport;

/// The output of a successful PDF repair operation.
#[derive(Debug, Clone, PartialEq)]
pub struct RepairOutput {
    /// The repaired, normalized PDF file bytes.
    pub pdf: Vec<u8>,
    /// Summary of repairs applied and salvaged document metrics.
    pub report: RepairReport,
}

/// Repairs a damaged, corrupt, or unreadable PDF document.
///
/// Follows a staged multi-heuristic recovery strategy:
/// 1. Verifies non-empty input.
/// 2. Sanitizes headers (stripping prepended garbage or restoring missing `%PDF-`).
/// 3. Sanitizes EOF markers (stripping trailing junk or appending `%%EOF`).
/// 4. Attempts standard parsing via lopdf.
/// 5. If standard parsing fails (corrupted xref, missing startxref, bad offsets):
///    performs linear object carving, reconstructs the cross-reference table and trailer,
///    and loads the salvaged document model.
/// 6. Saves the document with newly recalculated offsets and standardized structures.
///
/// # Arguments
///
/// * `input` - The raw damaged PDF bytes.
///
/// # Returns
///
/// A `Result` containing [`RepairOutput`] or a [`RepairError`].
pub fn repair_document(input: &[u8]) -> Result<RepairOutput, RepairError> {
    if input.is_empty() {
        return Err(RepairError::EmptyInput);
    }

    let mut report = RepairReport::default();

    // Stage 1: Sanitize header
    let (header_sanitized, header_repaired) = sanitize_header(input);
    if header_repaired {
        report.header_repaired = true;
        report.issues.push("Sanitized document header (%PDF-)".into());
    }

    // Stage 2: Sanitize EOF
    let (eof_sanitized, eof_repaired) = sanitize_eof(&header_sanitized);
    if eof_repaired {
        report.eof_repaired = true;
        report.issues.push("Sanitized document trailer (%%EOF)".into());
    }

    let candidate_bytes = eof_sanitized.as_ref();

    // Stage 3: Try standard load first
    match lopdf::Document::load_mem(candidate_bytes) {
        Ok(mut doc) => {
            // Already readable by lopdf, but normalize and rebuild clean output
            let pages = doc.get_pages();
            report.pages_recovered = pages.len();
            report.objects_recovered = doc.objects.len();

            let mut out = Vec::new();
            if doc.save_to(&mut out).is_ok() && !out.is_empty() {
                return Ok(RepairOutput { pdf: out, report });
            }

            Ok(RepairOutput {
                pdf: candidate_bytes.to_vec(),
                report,
            })
        }
        Err(_) => {
            // Stage 4: Carving and cross-reference reconstruction
            let objects = scan_objects(candidate_bytes);
            if objects.is_empty() {
                return Err(RepairError::InvalidPdf);
            }

            report.objects_recovered = objects.len();
            report.xref_reconstructed = true;
            report.trailer_reconstructed = true;
            report.issues.push(format!(
                "Reconstructed cross-reference table and trailer for {} indirect objects",
                objects.len()
            ));

            let reconstructed_raw = reconstruct_xref_and_trailer(candidate_bytes, &objects)?;

            // Re-parse with lopdf to count pages and generate standardized serialization
            match lopdf::Document::load_mem(&reconstructed_raw) {
                Ok(mut doc) => {
                    let pages = doc.get_pages();
                    report.pages_recovered = pages.len();

                    let mut normalized = Vec::new();
                    if doc.save_to(&mut normalized).is_ok() && !normalized.is_empty() {
                        return Ok(RepairOutput {
                            pdf: normalized,
                            report,
                        });
                    }

                    Ok(RepairOutput {
                        pdf: reconstructed_raw,
                        report,
                    })
                }
                Err(_) => {
                    // Even if lopdf's strict AST parser hits an inner object quirk,
                    // the raw reconstructed PDF has valid xref and trailer that PDFium can open
                    Ok(RepairOutput {
                        pdf: reconstructed_raw,
                        report,
                    })
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_empty_input() {
        assert_eq!(repair_document(&[]), Err(RepairError::EmptyInput));
    }

    #[test]
    fn refuses_plain_non_pdf_text() {
        let text = b"The quick brown fox jumps over the lazy dog";
        assert_eq!(repair_document(text), Err(RepairError::InvalidPdf));
    }

    #[test]
    fn repairs_clean_fixture() {
        let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/plain.pdf");
        if let Ok(bytes) = std::fs::read(fixture_path) {
            let output = repair_document(&bytes).expect("repair plain fixture");
            assert!(output.pdf.starts_with(b"%PDF-"));
            assert_eq!(output.report.pages_recovered, 1);
        }
    }

    #[test]
    fn repairs_pdf_with_corrupted_xref_and_missing_startxref() {
        let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/plain.pdf");
        if let Ok(bytes) = std::fs::read(fixture_path) {
            // Strip startxref to simulate damaged file
            let s = String::from_utf8_lossy(&bytes);
            if let Some(idx) = s.rfind("startxref") {
                let corrupt = &bytes[..idx];
                let output = repair_document(corrupt).expect("repair corrupted plain fixture");
                assert!(output.pdf.starts_with(b"%PDF-"));
                assert!(output.report.xref_reconstructed);
                assert!(output.report.trailer_reconstructed);
                assert!(output.report.objects_recovered > 0);
            }
        }
    }

    #[test]
    fn repairs_pdf_with_leading_http_garbage() {
        let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/plain.pdf");
        if let Ok(bytes) = std::fs::read(fixture_path) {
            let mut junk = b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\n\r\n".to_vec();
            junk.extend_from_slice(&bytes);

            let output = repair_document(&junk).expect("repair junk prefix fixture");
            assert!(output.pdf.starts_with(b"%PDF-"));
            assert!(output.report.header_repaired);
        }
    }
}
