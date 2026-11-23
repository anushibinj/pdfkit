//! Gzip decompression helper for self-hosted Tesseract `.traineddata.gz` files.
//!
//! Follows Single Responsibility Principle (SRP) by handling gunzip detection
//! and decoding cleanly in WebAssembly without requiring JS-side `zlibjs`.

use std::io::Read;

use flate2::read::GzDecoder;

use crate::error::OcrError;

/// Decompresses a gzip-encoded byte slice, or returns a clone of raw bytes when
/// the gzip magic header (`0x1f 0x8b`) is not present.
///
/// # Arguments
///
/// * `bytes` - Raw or gzip-compressed byte slice.
///
/// # Returns
///
/// Decompressed payload bytes.
///
/// # Errors
///
/// Returns [`OcrError::EmptyInput`] when `bytes` is empty, or
/// [`OcrError::InvalidGzip`] when the gzip stream is malformed or truncated.
pub fn decompress_gzip_or_raw(bytes: &[u8]) -> Result<Vec<u8>, OcrError> {
    if bytes.is_empty() {
        return Err(OcrError::EmptyInput);
    }

    // Standard RFC 1952 gzip streams begin with ID1 = 0x1f and ID2 = 0x8b.
    // Some static servers transparently decompress `.gz` responses if configured
    // with Content-Encoding: gzip; in that case pass the raw `.traineddata` through.
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut decoder = GzDecoder::new(bytes);
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|_| OcrError::InvalidGzip)?;
        if out.is_empty() {
            return Err(OcrError::InvalidGzip);
        }
        Ok(out)
    } else {
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::write::GzEncoder;
    use flate2::Compression;

    use super::*;

    #[test]
    fn decompresses_valid_gzip_stream() {
        let payload = b"Tesseract traineddata sample payload 12345";
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(payload).unwrap();
        let compressed = encoder.finish().unwrap();

        let decoded = decompress_gzip_or_raw(&compressed).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn passes_through_raw_non_gzip_bytes() {
        let raw = b"raw-uncompressed-traineddata";
        let out = decompress_gzip_or_raw(raw).unwrap();
        assert_eq!(out, raw);
    }

    #[test]
    fn rejects_empty_and_corrupt_gzip() {
        assert_eq!(decompress_gzip_or_raw(&[]), Err(OcrError::EmptyInput));
        let corrupt = [0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff];
        assert_eq!(decompress_gzip_or_raw(&corrupt), Err(OcrError::InvalidGzip));
    }
}
