//! Metrics reported by `pdf-redact` after sanitizing a document.

/// Counts of document-wide objects scrubbed and pruned by `pdf-redact`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SanitizeReport {
    /// Entries removed from `/Info`, `/PieceInfo`, page `/Thumb`, and `/StructTreeRoot`.
    pub metadata_entries_removed: u32,
    /// XMP `/Metadata` streams removed from catalog or pages.
    pub xmp_streams_removed: u32,
    /// Embedded file attachments removed from `/Names`, `/AF`, or annotations.
    pub attachments_removed: u32,
    /// JavaScript entries/actions removed from `/Names`, `/OpenAction`, or `/AA`.
    pub javascript_actions_removed: u32,
    /// Optional content groups (hidden layers) removed from `/OCProperties`.
    pub hidden_layers_removed: u32,
    /// Bookmark outline nodes whose title contained a redacted term and was scrubbed.
    pub bookmarks_cleaned: u32,
    /// Overlapping annotations removed from page `/Annots` arrays.
    pub annotations_removed: u32,
    /// Form field values (`/V` / `/DV`) cleared because they overlapped a box or held a redacted term.
    pub form_values_cleared: u32,
    /// Unreachable PDF indirect objects pruned before saving a single-revision PDF.
    pub objects_pruned: u32,
}

impl SanitizeReport {
    /// Serializes the report to a camelCase JSON object string without needing `serde`.
    pub fn to_json(&self) -> String {
        let fields = [
            ("metadataEntriesRemoved", self.metadata_entries_removed),
            ("xmpStreamsRemoved", self.xmp_streams_removed),
            ("attachmentsRemoved", self.attachments_removed),
            ("javascriptActionsRemoved", self.javascript_actions_removed),
            ("hiddenLayersRemoved", self.hidden_layers_removed),
            ("bookmarksCleaned", self.bookmarks_cleaned),
            ("annotationsRemoved", self.annotations_removed),
            ("formValuesCleared", self.form_values_cleared),
            ("objectsPruned", self.objects_pruned),
        ];
        let body: Vec<String> = fields.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
        format!("{{{}}}", body.join(","))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_json_includes_every_counter() {
        let report = SanitizeReport {
            metadata_entries_removed: 3,
            xmp_streams_removed: 1,
            attachments_removed: 2,
            javascript_actions_removed: 1,
            hidden_layers_removed: 4,
            bookmarks_cleaned: 2,
            annotations_removed: 5,
            form_values_cleared: 1,
            objects_pruned: 17,
        };
        let json = report.to_json();
        assert_eq!(
            json,
            "{\"metadataEntriesRemoved\":3,\"xmpStreamsRemoved\":1,\"attachmentsRemoved\":2,\"javascriptActionsRemoved\":1,\"hiddenLayersRemoved\":4,\"bookmarksCleaned\":2,\"annotationsRemoved\":5,\"formValuesCleared\":1,\"objectsPruned\":17}"
        );
    }
}
