//! Error types for the `pdf-compress` WebAssembly library.
//!
//! Follows Single Responsibility Principle (SRP) by isolating domain error
//! definitions, stable FFI error codes, and human-readable formatting.

use std::fmt;

/// Errors that can arise when parsing, configuring, or compressing a PDF document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompressError {
    /// The input PDF byte buffer was empty.
    EmptyInput,
    /// The input bytes could not be parsed as a valid PDF document.
    InvalidPdf,
    /// The PDF is encrypted and must be decrypted before structural compression.
    Encrypted,
    /// The binary compression plan buffer was malformed or had an unsupported version.
    InvalidConfig,
    /// An image buffer or dimension passed for encoding or downsampling was invalid.
    InvalidImage,
}

impl CompressError {
    /// Returns a stable machine-readable error code for the FFI JSON error envelope.
    ///
    /// # Returns
    ///
    /// A kebab-case static string identifying the error category.
    pub fn code(&self) -> &'static str {
        match self {
            CompressError::EmptyInput => "empty-input",
            CompressError::InvalidPdf => "invalid-pdf",
            CompressError::Encrypted => "encrypted",
            CompressError::InvalidConfig => "invalid-config",
            CompressError::InvalidImage => "invalid-image",
        }
    }
}

impl fmt::Display for CompressError {
    /// Formats a human-readable description of the compression error.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompressError::EmptyInput => write!(f, "The PDF file is empty (0 bytes)."),
            CompressError::InvalidPdf => {
                write!(f, "The file could not be parsed as a valid PDF document.")
            }
            CompressError::Encrypted => {
                write!(f, "Encrypted PDFs must be decrypted before compression.")
            }
            CompressError::InvalidConfig => {
                write!(f, "The compression configuration buffer is invalid or unsupported.")
            }
            CompressError::InvalidImage => {
                write!(f, "The image buffer or dimensions are invalid.")
            }
        }
    }
}

impl std::error::Error for CompressError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_match_expected_identifiers() {
        assert_eq!(CompressError::EmptyInput.code(), "empty-input");
        assert_eq!(CompressError::InvalidPdf.code(), "invalid-pdf");
        assert_eq!(CompressError::Encrypted.code(), "encrypted");
        assert_eq!(CompressError::InvalidConfig.code(), "invalid-config");
        assert_eq!(CompressError::InvalidImage.code(), "invalid-image");
    }

    #[test]
    fn display_messages_are_descriptive() {
        assert!(CompressError::EmptyInput.to_string().contains("empty"));
        assert!(CompressError::InvalidPdf.to_string().contains("valid PDF"));
        assert!(CompressError::Encrypted.to_string().contains("decrypted"));
        assert!(CompressError::InvalidConfig.to_string().contains("configuration"));
        assert!(CompressError::InvalidImage.to_string().contains("image"));
    }
}
