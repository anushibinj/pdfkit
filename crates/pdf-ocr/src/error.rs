//! Error types for the `pdf-ocr` WebAssembly library.
//!
//! Follows Single Responsibility Principle (SRP) by isolating domain error
//! variants, stable kebab-case FFI error codes, and user-friendly messages.

use std::fmt;

/// Errors returned by `pdf-ocr` operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OcrError {
    /// The input buffer was empty.
    EmptyInput,
    /// Image dimensions or RGBA buffer byte length did not match expectations.
    InvalidDimensions,
    /// A gzip-compressed buffer (e.g., `.traineddata.gz`) was corrupt or truncated.
    InvalidGzip,
    /// The PDF bytes could not be parsed by `lopdf` or lacked a target page.
    InvalidPdf,
    /// The PDF is encrypted and must be unlocked via `qpdf` first.
    Encrypted,
    /// Numeric or textual configuration parameters were invalid.
    InvalidConfig,
}

impl OcrError {
    /// Returns a stable machine-readable kebab-case error code for the FFI envelope.
    ///
    /// # Returns
    ///
    /// Static error identifier string.
    pub fn code(&self) -> &'static str {
        match self {
            OcrError::EmptyInput => "empty-input",
            OcrError::InvalidDimensions => "invalid-dimensions",
            OcrError::InvalidGzip => "invalid-gzip",
            OcrError::InvalidPdf => "invalid-pdf",
            OcrError::Encrypted => "encrypted",
            OcrError::InvalidConfig => "invalid-config",
        }
    }
}

impl fmt::Display for OcrError {
    /// Formats a human-readable diagnostic message for the error variant.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OcrError::EmptyInput => write!(f, "The input buffer is empty (0 bytes)."),
            OcrError::InvalidDimensions => {
                write!(f, "The image dimensions or RGBA buffer length are invalid.")
            }
            OcrError::InvalidGzip => {
                write!(f, "The gzip-compressed language data could not be decompressed.")
            }
            OcrError::InvalidPdf => {
                write!(f, "The PDF data could not be parsed or contains no pages.")
            }
            OcrError::Encrypted => {
                write!(f, "Encrypted PDFs must be decrypted before OCR processing.")
            }
            OcrError::InvalidConfig => {
                write!(f, "The OCR target dimensions or text-layer parameters are invalid.")
            }
        }
    }
}

impl std::error::Error for OcrError {}

/// Escapes a string literal for safe embedding in an FFI JSON error envelope.
///
/// # Arguments
///
/// * `s` - Unescaped UTF-8 message string.
///
/// # Returns
///
/// Double-quoted JSON string literal.
pub fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_match_expected_identifiers() {
        assert_eq!(OcrError::EmptyInput.code(), "empty-input");
        assert_eq!(OcrError::InvalidDimensions.code(), "invalid-dimensions");
        assert_eq!(OcrError::InvalidGzip.code(), "invalid-gzip");
        assert_eq!(OcrError::InvalidPdf.code(), "invalid-pdf");
        assert_eq!(OcrError::Encrypted.code(), "encrypted");
        assert_eq!(OcrError::InvalidConfig.code(), "invalid-config");
    }

    #[test]
    fn display_messages_are_clear() {
        assert!(OcrError::EmptyInput.to_string().contains("empty"));
        assert!(OcrError::InvalidDimensions.to_string().contains("dimensions"));
        assert!(OcrError::InvalidGzip.to_string().contains("gzip"));
        assert!(OcrError::InvalidPdf.to_string().contains("PDF"));
        assert!(OcrError::Encrypted.to_string().contains("Encrypted"));
        assert!(OcrError::InvalidConfig.to_string().contains("invalid"));
    }

    #[test]
    fn escape_json_escapes_control_and_quotes() {
        assert_eq!(escape_json("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"");
    }
}
