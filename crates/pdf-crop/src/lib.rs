//! Crops PDF pages, optionally removing everything outside the crop area.
//!
//! A plain crop only sets each page's `CropBox`: viewers hide what lies
//! outside it, but it stays in the file and anyone can bring it back.
//! "Remove what's outside" deletes it: glyph by glyph for text, whole paths,
//! images, form XObjects (trimmed copies where they cross the edge) and
//! annotations, and shrinks the `MediaBox` so no box reset can reveal
//! anything. Everything inside the crop area is kept byte for byte.
//!
//! The crate is built for WebAssembly (see `ffi`), and is also an ordinary
//! Rust library ([`crop_pdf`]) so it can be tested natively.

pub mod clip;
pub mod content;
pub mod document;
pub mod error;
pub mod ffi;
pub mod fonts;
pub mod geometry;
pub mod plan;
pub mod report;
#[cfg(test)]
mod test_support;

pub use document::CropOutput;
pub use error::CropError;
pub use plan::{CropPlan, PageCrop};
pub use report::CropReport;

/// Crop a PDF according to a plan.
///
/// # Errors
///
/// See [`CropError`].
pub fn crop_pdf(input: &[u8], plan: &CropPlan) -> Result<CropOutput, CropError> {
    document::crop_document(input, plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Rect;

    #[test]
    fn crop_pdf_runs_the_document_crop() {
        let input = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/plain.pdf"
        ))
        .unwrap();
        let plan = CropPlan {
            remove_outside: false,
            pages: vec![PageCrop {
                page_index: 0,
                rect: Rect::new(0.0, 0.0, 100.0, 100.0),
            }],
        };
        let output = crop_pdf(&input, &plan).unwrap();
        assert!(output.pdf.starts_with(b"%PDF-"));
        assert_eq!(output.report.pages_cropped, 1);
    }
}
