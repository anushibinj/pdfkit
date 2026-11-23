//! What a crop changed, and what it had to leave alone.

/// Counts gathered while cropping. Everything the crop could not safely
/// remove is counted here so the UI can say so instead of implying the
/// file is clean.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CropReport {
    /// Pages whose boxes were changed.
    pub pages_cropped: u32,
    /// Characters (glyphs) deleted from text outside the crop area.
    pub glyphs_removed: u32,
    /// Lines and shapes deleted.
    pub paths_removed: u32,
    /// Pictures deleted.
    pub images_removed: u32,
    /// Reusable content groups (form XObjects) deleted.
    pub forms_removed: u32,
    /// Form XObjects crossing the edge that were replaced by a trimmed copy.
    pub forms_trimmed: u32,
    /// Annotations (comments, links, ...) deleted.
    pub annotations_removed: u32,
    /// Pictures crossing the edge, kept whole: the part outside is hidden,
    /// not deleted.
    pub images_kept_crossing: u32,
    /// Text shown in a font this module cannot measure, kept unchanged.
    pub text_kept_unmeasured: u32,
    /// Form fields outside the crop area, kept so the form stays valid.
    pub form_fields_kept: u32,
    /// Content streams that could not be read and were kept unchanged.
    pub streams_not_analysed: u32,
    /// Content streams whose later part could not be followed and was kept
    /// unchanged.
    pub streams_partly_analysed: u32,
    /// The furthest, in points, that kept text can move in readers that
    /// round glyph widths to whole thousandths of an em (PDFium, and so
    /// Chrome's viewer), because glyphs before it on its line were
    /// deleted. Readers that follow the standard's exact widths show it
    /// exactly where it was. 0 when no glyph was deleted.
    pub max_text_shift: f64,
}

impl CropReport {
    /// Add another report's counts to this one.
    pub fn merge(&mut self, other: &CropReport) {
        self.pages_cropped += other.pages_cropped;
        self.glyphs_removed += other.glyphs_removed;
        self.paths_removed += other.paths_removed;
        self.images_removed += other.images_removed;
        self.forms_removed += other.forms_removed;
        self.forms_trimmed += other.forms_trimmed;
        self.annotations_removed += other.annotations_removed;
        self.images_kept_crossing += other.images_kept_crossing;
        self.text_kept_unmeasured += other.text_kept_unmeasured;
        self.form_fields_kept += other.form_fields_kept;
        self.streams_not_analysed += other.streams_not_analysed;
        self.streams_partly_analysed += other.streams_partly_analysed;
        self.max_text_shift = self.max_text_shift.max(other.max_text_shift);
    }

    /// The report as a JSON object with camelCase keys.
    ///
    /// Written by hand (numbers only, no strings to escape) to keep a JSON
    /// library out of the WebAssembly module. `maxTextShift` is written
    /// with at most 4 decimals; it is always finite (see
    /// `clip::text::split_show`), and would be written as 0 otherwise so
    /// the JSON stays valid.
    pub fn to_json(&self) -> String {
        let fields = [
            ("pagesCropped", self.pages_cropped),
            ("glyphsRemoved", self.glyphs_removed),
            ("pathsRemoved", self.paths_removed),
            ("imagesRemoved", self.images_removed),
            ("formsRemoved", self.forms_removed),
            ("formsTrimmed", self.forms_trimmed),
            ("annotationsRemoved", self.annotations_removed),
            ("imagesKeptCrossing", self.images_kept_crossing),
            ("textKeptUnmeasured", self.text_kept_unmeasured),
            ("formFieldsKept", self.form_fields_kept),
            ("streamsNotAnalysed", self.streams_not_analysed),
            ("streamsPartlyAnalysed", self.streams_partly_analysed),
        ];
        let mut body: Vec<String> = fields
            .iter()
            .map(|(key, value)| format!("\"{key}\":{value}"))
            .collect();
        let shift = if self.max_text_shift.is_finite() {
            self.max_text_shift
        } else {
            0.0
        };
        body.push(format!(
            "\"maxTextShift\":{}",
            crate::clip::text::format_number(shift)
        ));
        format!("{{{}}}", body.join(","))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_adds_every_counter() {
        let one = CropReport {
            pages_cropped: 1,
            glyphs_removed: 2,
            paths_removed: 3,
            images_removed: 4,
            forms_removed: 5,
            forms_trimmed: 6,
            annotations_removed: 7,
            images_kept_crossing: 8,
            text_kept_unmeasured: 9,
            form_fields_kept: 10,
            streams_not_analysed: 11,
            streams_partly_analysed: 12,
            max_text_shift: 0.25,
        };
        let mut total = one.clone();
        total.merge(&CropReport {
            max_text_shift: 0.5,
            ..one.clone()
        });
        assert_eq!(total.to_json(), "{\"pagesCropped\":2,\"glyphsRemoved\":4,\"pathsRemoved\":6,\"imagesRemoved\":8,\"formsRemoved\":10,\"formsTrimmed\":12,\"annotationsRemoved\":14,\"imagesKeptCrossing\":16,\"textKeptUnmeasured\":18,\"formFieldsKept\":20,\"streamsNotAnalysed\":22,\"streamsPartlyAnalysed\":24,\"maxTextShift\":0.5}");
    }

    #[test]
    fn to_json_lists_every_counter() {
        let report = CropReport {
            pages_cropped: 2,
            glyphs_removed: 7,
            images_kept_crossing: 1,
            ..CropReport::default()
        };
        let json = report.to_json();
        assert!(json.starts_with("{\"pagesCropped\":2,\"glyphsRemoved\":7,"));
        assert!(json.contains("\"imagesKeptCrossing\":1"));
        assert!(json.ends_with("\"streamsPartlyAnalysed\":0,\"maxTextShift\":0}"));
        assert_eq!(json.matches(':').count(), 13);
        let nan = CropReport {
            max_text_shift: f64::NAN,
            ..CropReport::default()
        };
        assert!(nan.to_json().ends_with("\"maxTextShift\":0}"));
    }
}
