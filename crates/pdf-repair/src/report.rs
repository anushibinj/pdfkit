//! Structured report of repairs performed on a damaged PDF document.

/// Details of modifications and recoveries made to a damaged PDF file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RepairReport {
    /// Whether leading garbage bytes were stripped or a missing `%PDF-` header was reconstructed.
    pub header_repaired: bool,
    /// Whether trailing junk was removed or a missing `%%EOF` marker was reconstructed.
    pub eof_repaired: bool,
    /// Whether the cross-reference table was reconstructed from linear object scanning.
    pub xref_reconstructed: bool,
    /// Whether the trailer dictionary was reconstructed or synthesized.
    pub trailer_reconstructed: bool,
    /// Total number of distinct indirect PDF objects identified and salvaged.
    pub objects_recovered: usize,
    /// Total number of stream objects whose length or delimiters were corrected.
    pub streams_repaired: usize,
    /// Total number of valid pages found and salvaged in the document tree.
    pub pages_recovered: usize,
    /// Human-readable list of specific diagnostic issues addressed during repair.
    pub issues: Vec<String>,
}

impl RepairReport {
    /// Serializes the repair report into a standard JSON string.
    ///
    /// # Returns
    ///
    /// A JSON string containing all repair metrics and diagnostic notes.
    pub fn to_json(&self) -> String {
        let issues_json: Vec<String> = self.issues.iter().map(|s| escape_json(s)).collect();
        format!(
            "{{\"headerRepaired\":{},\"eofRepaired\":{},\"xrefReconstructed\":{},\"trailerReconstructed\":{},\"objectsRecovered\":{},\"streamsRepaired\":{},\"pagesRecovered\":{},\"issues\":[{}]}}",
            self.header_repaired,
            self.eof_repaired,
            self.xref_reconstructed,
            self.trailer_reconstructed,
            self.objects_recovered,
            self.streams_repaired,
            self.pages_recovered,
            issues_json.join(",")
        )
    }
}

/// Helper to format a string as an escaped JSON string literal.
///
/// # Arguments
///
/// * `s` - The unescaped string slice.
///
/// # Returns
///
/// A JSON-escaped string literal wrapped in double quotes.
fn escape_json(s: &str) -> String {
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
    fn serializes_empty_report_to_valid_json() {
        let report = RepairReport::default();
        let json = report.to_json();
        assert!(json.contains("\"headerRepaired\":false"));
        assert!(json.contains("\"objectsRecovered\":0"));
        assert!(json.contains("\"issues\":[]"));
    }

    #[test]
    fn serializes_populated_report_with_escaped_strings() {
        let report = RepairReport {
            header_repaired: true,
            eof_repaired: true,
            xref_reconstructed: true,
            trailer_reconstructed: true,
            objects_recovered: 24,
            streams_repaired: 2,
            pages_recovered: 3,
            issues: vec!["Fixed \"xref\" table\nnew line".to_string()],
        };
        let json = report.to_json();
        assert!(json.contains("\"headerRepaired\":true"));
        assert!(json.contains("\"objectsRecovered\":24"));
        assert!(json.contains("\"pagesRecovered\":3"));
        assert!(json.contains("Fixed \\\"xref\\\" table\\nnew line"));
    }
}
