//! The 14 standard fonts' built-in metrics and the standard encodings.

use super::standard_data::{
    StandardFontData, MAC_ROMAN_ENCODING, STANDARD_ENCODING, STANDARD_FONTS, WIN_ANSI_ENCODING,
};

/// `/Differences` entries: (code, glyph name) pairs that override a base
/// encoding.
pub type Differences = Vec<(u8, Vec<u8>)>;

/// A named single-byte encoding a simple font can start from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseEncoding {
    /// The font's own (for the standard Latin fonts: StandardEncoding).
    Builtin,
    Standard,
    WinAnsi,
    MacRoman,
}

impl BaseEncoding {
    /// The encoding called `name` in a PDF (`/WinAnsiEncoding`, ...).
    /// `MacExpertEncoding` is not supported (no standard font has expert
    /// glyphs), so it returns `None` like any unknown name.
    pub fn from_pdf_name(name: &[u8]) -> Option<BaseEncoding> {
        match name {
            b"StandardEncoding" => Some(BaseEncoding::Standard),
            b"WinAnsiEncoding" => Some(BaseEncoding::WinAnsi),
            b"MacRomanEncoding" => Some(BaseEncoding::MacRoman),
            _ => None,
        }
    }
}

/// The standard font a `/BaseFont` names, if any.
///
/// A subset tag (six capital letters and `+`, as in `ABCDEF+Helvetica`)
/// is ignored. Only the 14 exact PostScript names are recognised: guessing
/// metrics for look-alikes (`Arial`) could be wrong, and wrong widths would
/// misplace every following glyph.
pub fn find(base_font: &[u8]) -> Option<&'static StandardFontData> {
    let name = strip_subset_tag(base_font);
    STANDARD_FONTS.iter().find(|f| f.name.as_bytes() == name)
}

/// `name` without a leading subset tag (`ABCDEF+`).
pub fn strip_subset_tag(name: &[u8]) -> &[u8] {
    let tagged = name.len() > 7 && name[6] == b'+' && name[..6].iter().all(u8::is_ascii_uppercase);
    if tagged {
        &name[7..]
    } else {
        name
    }
}

/// A glyph's advance width (1/1000 em) in a standard font, by glyph name.
pub fn width_by_name(font: &StandardFontData, glyph: &[u8]) -> Option<u16> {
    font.widths
        .binary_search_by(|(name, _)| name.as_bytes().cmp(glyph))
        .ok()
        .map(|i| font.widths[i].1)
}

/// Advance widths (1/1000 em) for all 256 codes of a simple font that uses
/// a standard font's built-in metrics.
///
/// Each code is turned into a glyph name (through `differences` first,
/// then the base encoding) and the name looked up in the font's metrics.
/// A code with no glyph name, or a name the font lacks, gets `None`: its
/// width is unknown.
///
/// - `base`: the encoding the font dictionary names (or `Builtin`).
/// - `differences`: `/Differences` entries as (code, glyph name).
pub fn widths_for(
    font: &StandardFontData,
    base: BaseEncoding,
    differences: &Differences,
) -> [Option<u16>; 256] {
    let table: &[&str; 256] = match base {
        BaseEncoding::Builtin => font.builtin,
        BaseEncoding::Standard => &STANDARD_ENCODING,
        BaseEncoding::WinAnsi => &WIN_ANSI_ENCODING,
        BaseEncoding::MacRoman => &MAC_ROMAN_ENCODING,
    };
    let mut names: [&[u8]; 256] = [b""; 256];
    for (code, name) in table.iter().enumerate() {
        names[code] = name.as_bytes();
    }
    for (code, name) in differences {
        names[*code as usize] = name;
    }
    let mut widths = [None; 256];
    for (code, name) in names.iter().enumerate() {
        if !name.is_empty() {
            widths[code] = width_by_name(font, name);
        }
    }
    widths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn helvetica() -> &'static StandardFontData {
        find(b"Helvetica").unwrap()
    }

    #[test]
    fn from_pdf_name_knows_the_standard_encodings() {
        assert_eq!(
            BaseEncoding::from_pdf_name(b"WinAnsiEncoding"),
            Some(BaseEncoding::WinAnsi)
        );
        assert_eq!(
            BaseEncoding::from_pdf_name(b"StandardEncoding"),
            Some(BaseEncoding::Standard)
        );
        assert_eq!(
            BaseEncoding::from_pdf_name(b"MacRomanEncoding"),
            Some(BaseEncoding::MacRoman)
        );
        assert_eq!(BaseEncoding::from_pdf_name(b"MacExpertEncoding"), None);
    }

    #[test]
    fn find_matches_exact_names_and_ignores_subset_tags() {
        assert_eq!(find(b"Times-Bold").unwrap().name, "Times-Bold");
        assert_eq!(find(b"ABCDEF+Courier").unwrap().name, "Courier");
        assert!(find(b"Arial").is_none());
        assert!(find(b"helvetica").is_none());
    }

    #[test]
    fn strip_subset_tag_needs_six_capitals_and_plus() {
        assert_eq!(strip_subset_tag(b"ABCDEF+Foo"), b"Foo");
        assert_eq!(strip_subset_tag(b"ABCDe+Foo"), b"ABCDe+Foo");
        assert_eq!(strip_subset_tag(b"Foo"), b"Foo");
        assert_eq!(strip_subset_tag(b"ABCDEF+"), b"ABCDEF+");
    }

    #[test]
    fn width_by_name_reads_afm_widths() {
        assert_eq!(width_by_name(helvetica(), b"A"), Some(667));
        assert_eq!(width_by_name(helvetica(), b"space"), Some(278));
        assert_eq!(width_by_name(helvetica(), b"Euro"), Some(556));
        assert_eq!(width_by_name(helvetica(), b"nosuchglyph"), None);
        assert_eq!(width_by_name(find(b"Courier").unwrap(), b"W"), Some(600));
    }

    #[test]
    fn widths_for_win_ansi_follows_the_spec_table() {
        let w = widths_for(helvetica(), BaseEncoding::WinAnsi, &vec![]);
        assert_eq!(w[b'A' as usize], Some(667));
        assert_eq!(w[0x80], Some(556)); // Euro
        assert_eq!(w[0x9F], Some(667)); // Ydieresis (not ydieresis = 500)
        assert_eq!(w[0x81], Some(350)); // unused codes show a bullet
        assert_eq!(w[0x00], None);
    }

    #[test]
    fn widths_for_builtin_uses_standard_encoding_for_latin_fonts() {
        let w = widths_for(helvetica(), BaseEncoding::Builtin, &vec![]);
        assert_eq!(w[0xAE], Some(500)); // "fi" in StandardEncoding
        assert_eq!(w[0x80], None); // undefined in StandardEncoding
    }

    #[test]
    fn widths_for_symbolic_fonts_use_their_own_encoding() {
        let symbol = find(b"Symbol").unwrap();
        let w = widths_for(symbol, BaseEncoding::Builtin, &vec![]);
        assert_eq!(w[b'a' as usize], width_by_name(symbol, b"alpha"));
        let dingbats = find(b"ZapfDingbats").unwrap();
        let w = widths_for(dingbats, BaseEncoding::Builtin, &vec![]);
        assert_eq!(w[0x21], width_by_name(dingbats, b"a1"));
    }

    #[test]
    fn widths_for_applies_differences_over_the_base() {
        let w = widths_for(
            helvetica(),
            BaseEncoding::WinAnsi,
            &vec![(b'A', b"W".to_vec()), (1, b"bogus".to_vec())],
        );
        assert_eq!(w[b'A' as usize], Some(944)); // W
        assert_eq!(w[1], None);
        assert_eq!(w[b'B' as usize], Some(667));
    }

    #[test]
    fn widths_for_mac_roman() {
        let w = widths_for(helvetica(), BaseEncoding::MacRoman, &vec![]);
        assert_eq!(w[0xDB], Some(556)); // currency in MacRoman
    }
}
