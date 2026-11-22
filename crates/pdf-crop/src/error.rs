//! Why a crop could not be produced.

use std::fmt;

/// A crop that failed as a whole. Problems limited to one piece of content
/// (a font that cannot be measured, a stream that cannot be read) are not
/// errors: that content is kept unchanged and counted in the report.
#[derive(Debug, Clone, PartialEq)]
pub enum CropError {
    /// The plan is malformed (it crossed a thread boundary, so it is
    /// checked like any untrusted input).
    InvalidPlan(String),
    /// The PDF is encrypted. Saving would drop its protection, so it is
    /// refused instead; remove the protection first.
    Encrypted,
    /// The file could not be read as a PDF.
    Unreadable(String),
    /// The plan names a page the document does not have (0-based index).
    PageOutOfRange { page: u32, count: u32 },
    /// The crop area does not overlap the page's visible area (0-based).
    EmptyCrop { page: u32 },
    /// The page has no usable MediaBox (0-based index).
    MissingMediaBox { page: u32 },
    /// Writing the result failed.
    Write(String),
}

impl CropError {
    /// A stable, machine-readable code for the UI.
    pub fn code(&self) -> &'static str {
        match self {
            CropError::InvalidPlan(_) => "invalid-plan",
            CropError::Encrypted => "encrypted",
            CropError::Unreadable(_) => "unreadable",
            CropError::PageOutOfRange { .. } => "page-out-of-range",
            CropError::EmptyCrop { .. } => "empty-crop",
            CropError::MissingMediaBox { .. } => "missing-media-box",
            CropError::Write(_) => "write-failed",
        }
    }
}

impl fmt::Display for CropError {
    /// A sentence for people; page numbers are shown 1-based.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CropError::InvalidPlan(why) => write!(f, "The crop settings are invalid: {why}"),
            CropError::Encrypted => write!(
                f,
                "This PDF is encrypted. Remove its protection first, then crop it."
            ),
            CropError::Unreadable(why) => {
                write!(f, "This file could not be read as a PDF ({why}).")
            }
            CropError::PageOutOfRange { page, count } => write!(
                f,
                "The document has {count} pages; there is no page {}.",
                page + 1
            ),
            CropError::EmptyCrop { page } => {
                write!(f, "The crop area does not overlap page {}.", page + 1)
            }
            CropError::MissingMediaBox { page } => {
                write!(f, "Page {} has no valid page size (MediaBox).", page + 1)
            }
            CropError::Write(why) => write!(f, "The cropped PDF could not be written ({why})."),
        }
    }
}

impl std::error::Error for CropError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable() {
        assert_eq!(CropError::Encrypted.code(), "encrypted");
        assert_eq!(CropError::InvalidPlan("x".into()).code(), "invalid-plan");
        assert_eq!(CropError::Unreadable("x".into()).code(), "unreadable");
        assert_eq!(
            CropError::PageOutOfRange { page: 1, count: 1 }.code(),
            "page-out-of-range"
        );
        assert_eq!(CropError::EmptyCrop { page: 0 }.code(), "empty-crop");
        assert_eq!(
            CropError::MissingMediaBox { page: 0 }.code(),
            "missing-media-box"
        );
        assert_eq!(CropError::Write("x".into()).code(), "write-failed");
    }

    #[test]
    fn messages_number_pages_from_one() {
        assert_eq!(
            CropError::EmptyCrop { page: 2 }.to_string(),
            "The crop area does not overlap page 3."
        );
        assert_eq!(
            CropError::PageOutOfRange { page: 4, count: 2 }.to_string(),
            "The document has 2 pages; there is no page 5."
        );
    }
}
