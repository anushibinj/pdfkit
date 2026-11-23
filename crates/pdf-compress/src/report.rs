//! Telemetry and JSON serialization for PDF compression outcomes.
//!
//! Follows Single Responsibility Principle (SRP) by keeping metrics tracking and
//! JSON formatting decoupled from PDF stream manipulation.

/// Detailed breakdown of optimizations applied while compressing a PDF document.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CompressReport {
    /// Input PDF size in bytes.
    pub original_bytes: usize,
    /// Resulting PDF size in bytes after compression.
    pub compressed_bytes: usize,
    /// Total number of Image XObjects inspected across the document.
    pub images_inspected: usize,
    /// Number of opaque images re-encoded as smaller baseline JPEG streams.
    pub images_reencoded: usize,
    /// Number of images downsampled to fit the target DPI.
    pub images_downsampled: usize,
    /// Number of duplicate streams collapsed into a single shared object.
    pub images_deduplicated: usize,
    /// Number of images kept as original bytes because re-encoding did not shrink them.
    pub images_skipped_larger: usize,
    /// Number of `/FlateDecode` streams shrunk via level-9 zlib recompression.
    pub flate_streams_recompressed: usize,
    /// Number of unreferenced objects pruned from the document.
    pub objects_removed: usize,
    /// Number of images with soft masks or mask streams whose transparency was preserved.
    pub transparency_preserved: usize,
    /// Human-readable notes describing compression behaviour and safeguards applied.
    pub notes: Vec<String>,
}

impl CompressReport {
    /// Serializes the compression report into a JSON object string.
    ///
    /// # Returns
    ///
    /// A JSON-formatted representation using camelCase keys matching TypeScript contracts.
    pub fn to_json(&self) -> String {
        let notes_json: Vec<String> = self.notes.iter().map(|s| escape_json(s)).collect();
        format!(
            "{{\"originalBytes\":{},\"compressedBytes\":{},\"imagesInspected\":{},\"imagesReencoded\":{},\"imagesDownsampled\":{},\"imagesDeduplicated\":{},\"imagesSkippedLarger\":{},\"flateStreamsRecompressed\":{},\"objectsRemoved\":{},\"transparencyPreserved\":{},\"notes\":[{}]}}",
            self.original_bytes,
            self.compressed_bytes,
            self.images_inspected,
            self.images_reencoded,
            self.images_downsampled,
            self.images_deduplicated,
            self.images_skipped_larger,
            self.flate_streams_recompressed,
            self.objects_removed,
            self.transparency_preserved,
            notes_json.join(",")
        )
    }
}

/// Formats a string as a JSON-escaped string literal wrapped in double quotes.
///
/// # Arguments
///
/// * `s` - Raw UTF-8 string slice to escape.
///
/// # Returns
///
/// Escaped JSON string literal.
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
    fn serializes_default_report() {
        let report = CompressReport::default();
        let json = report.to_json();
        assert!(json.contains("\"originalBytes\":0"));
        assert!(json.contains("\"compressedBytes\":0"));
        assert!(json.contains("\"imagesReencoded\":0"));
        assert!(json.contains("\"notes\":[]"));
    }

    #[test]
    fn serializes_populated_report_with_escaped_notes() {
        let report = CompressReport {
            original_bytes: 1000,
            compressed_bytes: 400,
            images_inspected: 4,
            images_reencoded: 2,
            images_downsampled: 1,
            images_deduplicated: 1,
            images_skipped_larger: 1,
            flate_streams_recompressed: 3,
            objects_removed: 5,
            transparency_preserved: 1,
            notes: vec!["Kept \"logo\"\nwith alpha".to_string()],
        };
        let json = report.to_json();
        assert!(json.contains("\"originalBytes\":1000"));
        assert!(json.contains("\"compressedBytes\":400"));
        assert!(json.contains("\"transparencyPreserved\":1"));
        assert!(json.contains("Kept \\\"logo\\\"\\nwith alpha"));
    }
}
