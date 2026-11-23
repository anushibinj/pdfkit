//! Error types produced when attempting to repair damaged PDF files.

use std::fmt;

/// Errors that can occur during the PDF repair process.
#[derive(Debug, PartialEq, Eq)]
pub enum RepairError {
    /// The input buffer is empty.
    EmptyInput,
    /// The input does not contain a recognizable PDF structure even after scanning.
    InvalidPdf,
    /// The file is encrypted with a password and cannot be repaired without credentials.
    Encrypted,
    /// The structural damage is beyond recovery (no objects or pages could be salvaged).
    Unrecoverable(String),
}

impl RepairError {
    /// Returns a machine-readable error code string for JSON transmission.
    ///
    /// # Returns
    ///
    /// A static string slice representing the error category.
    pub fn code(&self) -> &'static str {
        match self {
            Self::EmptyInput => "empty-input",
            Self::InvalidPdf => "invalid-pdf",
            Self::Encrypted => "encrypted",
            Self::Unrecoverable(_) => "unrecoverable",
        }
    }
}

impl fmt::Display for RepairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyInput => write!(f, "The supplied PDF file is empty."),
            Self::InvalidPdf => write!(f, "This file does not contain a valid PDF structure."),
            Self::Encrypted => write!(f, "This PDF is encrypted and cannot be repaired without unlocking."),
            Self::Unrecoverable(detail) => write!(f, "Could not repair this PDF: {detail}"),
        }
    }
}

impl std::error::Error for RepairError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_are_distinct_and_correct() {
        assert_eq!(RepairError::EmptyInput.code(), "empty-input");
        assert_eq!(RepairError::InvalidPdf.code(), "invalid-pdf");
        assert_eq!(RepairError::Encrypted.code(), "encrypted");
        assert_eq!(RepairError::Unrecoverable("failed".into()).code(), "unrecoverable");
    }

    #[test]
    fn display_messages_are_user_friendly() {
        assert_eq!(RepairError::EmptyInput.to_string(), "The supplied PDF file is empty.");
        assert_eq!(RepairError::InvalidPdf.to_string(), "This file does not contain a valid PDF structure.");
        assert_eq!(RepairError::Encrypted.to_string(), "This PDF is encrypted and cannot be repaired without unlocking.");
        assert!(RepairError::Unrecoverable("missing trailer".into()).to_string().contains("missing trailer"));
    }
}
