//! Error types returned by the `pdf-redact` sanitization engine.

use std::fmt;

/// Every failure mode that [`crate::sanitize_pdf`] can produce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedactError {
    /// Input PDF byte slice was empty.
    EmptyInput,
    /// Input PDF is encrypted; decrypt it before running object-graph sanitization.
    Encrypted,
    /// Input PDF could not be parsed as a valid PDF document.
    Unreadable(String),
    /// The binary sanitization plan was malformed or unsupported.
    InvalidPlan(String),
    /// A redaction box targeted a page index outside the document.
    PageOutOfRange { page: u32, count: u32 },
    /// Serializing the sanitized PDF failed.
    Write(String),
}

impl RedactError {
    /// Stable machine-readable error code for the TypeScript worker bridge.
    pub fn code(&self) -> &'static str {
        match self {
            RedactError::EmptyInput => "empty-input",
            RedactError::Encrypted => "encrypted",
            RedactError::Unreadable(_) => "unreadable",
            RedactError::InvalidPlan(_) => "invalid-plan",
            RedactError::PageOutOfRange { .. } => "page-out-of-range",
            RedactError::Write(_) => "write-failed",
        }
    }
}

impl fmt::Display for RedactError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RedactError::EmptyInput => write!(f, "The PDF file is empty."),
            RedactError::Encrypted => {
                write!(f, "The PDF is encrypted and cannot be sanitized directly.")
            }
            RedactError::Unreadable(why) => write!(f, "Could not read this PDF: {why}"),
            RedactError::InvalidPlan(why) => write!(f, "Invalid sanitization plan: {why}"),
            RedactError::PageOutOfRange { page, count } => {
                write!(
                    f,
                    "Page {} is out of range (the document has {count} pages).",
                    page + 1
                )
            }
            RedactError::Write(why) => write!(f, "Could not write the sanitized PDF: {why}"),
        }
    }
}

impl std::error::Error for RedactError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_messages_cover_all_variants() {
        let cases = [
            (RedactError::EmptyInput, "empty-input", "empty"),
            (RedactError::Encrypted, "encrypted", "encrypted"),
            (
                RedactError::Unreadable("bad xref".into()),
                "unreadable",
                "bad xref",
            ),
            (
                RedactError::InvalidPlan("bad version".into()),
                "invalid-plan",
                "bad version",
            ),
            (
                RedactError::PageOutOfRange { page: 2, count: 2 },
                "page-out-of-range",
                "Page 3",
            ),
            (RedactError::Write("disk".into()), "write-failed", "disk"),
        ];
        for (err, code, snippet) in cases {
            assert_eq!(err.code(), code);
            assert!(err.to_string().contains(snippet));
        }
    }
}
