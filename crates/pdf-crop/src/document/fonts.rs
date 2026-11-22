//! Reading font metrics from PDF font dictionaries.
//!
//! Everything here answers one question: can every glyph of this font be
//! placed exactly as a reader places it? When the answer is not certain the
//! font is reported as unmeasurable, and text in it is kept as it is.

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};

use super::boxes::{number, read_rect};
use super::streams::decode_strict;
use crate::fonts::cmap::CMap;
use crate::fonts::standard::{self, BaseEncoding, Differences};
use crate::fonts::FontMetrics;
use crate::geometry::{Matrix, Rect};

/// Most CID widths read from one `/W` array.
const MAX_CID_WIDTHS: usize = 70_000;
/// Default width of CIDs missing from `/W` (ISO 32000-1, table 117).
const DEFAULT_CID_WIDTH: f64 = 1000.0;

/// Metrics of a font dictionary, or `None` when they cannot be known
/// exactly.
pub fn load_font(doc: &Document, font: &Dictionary) -> Option<FontMetrics> {
    match font.get(b"Subtype").ok()?.as_name().ok()? {
        b"Type1" | b"MMType1" | b"TrueType" => load_simple(doc, font),
        b"Type3" => load_type3(doc, font),
        b"Type0" => load_type0(doc, font),
        _ => None,
    }
}

/// A dictionary entry, through a reference if needed.
fn get<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a Object> {
    doc.dereference(dict.get(key).ok()?).ok().map(|(_, o)| o)
}

/// A dictionary entry that is a dictionary.
fn get_dict<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a Dictionary> {
    get(doc, dict, key)?.as_dict().ok()
}

/// A simple font (Type 1, TrueType).
///
/// With `/Widths`, codes `FirstChar ..= FirstChar + n - 1` get those widths
/// and every other code is unknown (readers then take the width from the
/// font program, which the crop does not read). Without `/Widths`, only the
/// 14 standard fonts can be measured, from their built-in metrics and the
/// font's encoding.
fn load_simple(doc: &Document, font: &Dictionary) -> Option<FontMetrics> {
    let descriptor = get_dict(doc, font, b"FontDescriptor");
    let bbox = descriptor
        .and_then(|d| get(doc, d, b"FontBBox"))
        .and_then(|o| read_rect(doc, o));
    if let Some(widths) = read_widths(doc, font) {
        return Some(FontMetrics::simple(
            widths,
            0.001,
            bbox.map(|b| scale(&b, 0.001)),
        ));
    }
    let base_font = get(doc, font, b"BaseFont")?.as_name().ok()?;
    let data = standard::find(base_font)?;
    let (base, differences) = read_encoding(doc, font)?;
    let widths = standard::widths_for(data, base, &differences).map(|w| w.map(f64::from));
    let [l, b, r, t] = data.bbox.map(f64::from);
    let bbox = bbox.unwrap_or(Rect::new(l, b, r, t));
    Some(FontMetrics::simple(
        widths,
        0.001,
        Some(scale(&bbox, 0.001)),
    ))
}

/// A Type 3 font: glyphs are content streams in "glyph space", mapped to
/// text space by `/FontMatrix`. Widths are in glyph space. Only font
/// matrices without rotation or skew are supported (then the advance is
/// simply `width * a`).
fn load_type3(doc: &Document, font: &Dictionary) -> Option<FontMetrics> {
    let Object::Array(items) = get(doc, font, b"FontMatrix")? else {
        return None;
    };
    let values: Vec<f64> = items
        .iter()
        .map(|o| number(doc, o))
        .collect::<Option<_>>()?;
    let matrix = Matrix::from_slice(&values)?;
    if matrix.b != 0.0 || matrix.c != 0.0 || matrix.a == 0.0 || !matrix.is_finite() {
        return None;
    }
    let widths = read_widths(doc, font)?;
    let bbox = get(doc, font, b"FontBBox")
        .and_then(|o| read_rect(doc, o))
        .map(|b| b.transform(&matrix));
    Some(FontMetrics::simple(widths, matrix.a, bbox))
}

/// A composite (Type 0) font: codes come from its CMap, widths per CID from
/// its descendant font's `/W` and `/DW`.
fn load_type0(doc: &Document, font: &Dictionary) -> Option<FontMetrics> {
    let cmap = match get(doc, font, b"Encoding")? {
        Object::Name(name) if name == b"Identity-H" => CMap::identity(),
        Object::Stream(stream) => {
            let base = get(doc, &stream.dict, b"UseCMap");
            let vertical =
                get(doc, &stream.dict, b"WMode").and_then(|o| number(doc, o)) == Some(1.0);
            if vertical || base.is_some_and(|b| b.as_name().ok() != Some(b"Identity-H")) {
                return None;
            }
            CMap::parse_with_base(&decode_strict(doc, stream)?, base.is_some())?
        }
        _ => return None,
    };
    let Object::Array(descendants) = get(doc, font, b"DescendantFonts")? else {
        return None;
    };
    let descendant = doc
        .dereference(descendants.first()?)
        .ok()?
        .1
        .as_dict()
        .ok()?;
    let default_width = match get(doc, descendant, b"DW") {
        Some(o) => number(doc, o)?,
        None => DEFAULT_CID_WIDTH,
    };
    let widths = match get(doc, descendant, b"W") {
        Some(Object::Array(items)) => read_cid_widths(doc, items)?,
        Some(_) => return None,
        None => HashMap::new(),
    };
    let bbox = get_dict(doc, descendant, b"FontDescriptor")
        .and_then(|d| get(doc, d, b"FontBBox"))
        .and_then(|o| read_rect(doc, o))
        .map(|b| scale(&b, 0.001));
    Some(FontMetrics::composite(cmap, widths, default_width, bbox))
}

/// `/Widths` with `/FirstChar` as 256 optional widths, or `None` when the
/// font has no usable `/Widths`.
fn read_widths(doc: &Document, font: &Dictionary) -> Option<[Option<f64>; 256]> {
    let Object::Array(items) = get(doc, font, b"Widths")? else {
        return None;
    };
    let first = number(doc, get(doc, font, b"FirstChar")?)?;
    if first.fract() != 0.0 || !(0.0..256.0).contains(&first) {
        return None;
    }
    let mut widths = [None; 256];
    for (i, item) in items.iter().enumerate() {
        let code = first as usize + i;
        if code > 255 {
            break;
        }
        widths[code] = number(doc, item).filter(|w| w.is_finite());
    }
    Some(widths)
}

/// The base encoding and `/Differences` of a simple font, or `None` when
/// the encoding is a name this module does not know.
fn read_encoding(doc: &Document, font: &Dictionary) -> Option<(BaseEncoding, Differences)> {
    match get(doc, font, b"Encoding") {
        None => Some((BaseEncoding::Builtin, Vec::new())),
        Some(Object::Name(name)) => Some((BaseEncoding::from_pdf_name(name)?, Vec::new())),
        Some(Object::Dictionary(dict)) => {
            let base = match get(doc, dict, b"BaseEncoding") {
                None => BaseEncoding::Builtin,
                Some(o) => BaseEncoding::from_pdf_name(o.as_name().ok()?)?,
            };
            let differences = match get(doc, dict, b"Differences") {
                Some(Object::Array(items)) => read_differences(doc, items)?,
                Some(_) => return None,
                None => Vec::new(),
            };
            Some((base, differences))
        }
        Some(_) => None,
    }
}

/// `/Differences`: a code, then glyph names for consecutive codes, repeated.
fn read_differences(doc: &Document, items: &[Object]) -> Option<Differences> {
    let mut out = Vec::new();
    let mut code: Option<usize> = None;
    for item in items {
        match doc.dereference(item).ok()?.1 {
            Object::Integer(c) if (0..256).contains(c) => code = Some(*c as usize),
            Object::Name(name) => {
                let c = code?;
                if c < 256 {
                    out.push((c as u8, name.clone()));
                }
                code = Some(c + 1);
            }
            _ => return None,
        }
    }
    Some(out)
}

/// A `/W` array: `c [w1 w2 ...]` gives widths to consecutive CIDs from `c`;
/// `c_first c_last w` gives one width to a range. The first entry for a CID
/// wins, as in readers.
fn read_cid_widths(doc: &Document, items: &[Object]) -> Option<HashMap<u32, f64>> {
    let mut widths = HashMap::new();
    let values: Vec<&Object> = items
        .iter()
        .map(|o| doc.dereference(o).ok().map(|(_, v)| v))
        .collect::<Option<_>>()?;
    let mut i = 0;
    let mut budget = MAX_CID_WIDTHS;
    let cid = |o: &Object| {
        number(doc, o)
            .filter(|v| v.fract() == 0.0 && (0.0..=65535.0).contains(v))
            .map(|v| v as u32)
    };
    while i < values.len() {
        let first = cid(values[i])?;
        match values.get(i + 1)? {
            Object::Array(list) => {
                for (k, w) in list.iter().enumerate() {
                    budget = budget.checked_sub(1)?;
                    widths.entry(first + k as u32).or_insert(number(doc, w)?);
                }
                i += 2;
            }
            last => {
                let last = cid(last)?;
                let width = number(doc, values.get(i + 2)?)?;
                for c in first..=last {
                    budget = budget.checked_sub(1)?;
                    widths.entry(c).or_insert(width);
                }
                i += 3;
            }
        }
    }
    Some(widths)
}

/// A rectangle with every coordinate multiplied by `factor`.
fn scale(rect: &Rect, factor: f64) -> Rect {
    Rect::new(
        rect.left * factor,
        rect.bottom * factor,
        rect.right * factor,
        rect.top * factor,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    fn advances(font: &FontMetrics, bytes: &[u8]) -> Option<Vec<f64>> {
        font.glyphs(bytes)
            .map(|g| g.iter().map(|g| (g.advance * 1e6).round() / 1e6).collect())
    }

    fn doc() -> Document {
        Document::with_version("1.7")
    }

    #[test]
    fn simple_font_with_widths() {
        let font = dictionary! {
            "Subtype" => "TrueType", "FirstChar" => 65,
            "Widths" => vec![Object::Integer(600), Object::Real(250.5)],
        };
        let metrics = load_font(&doc(), &font).unwrap();
        assert_eq!(advances(&metrics, b"AB"), Some(vec![0.6, 0.2505]));
        // Codes outside /Widths are unknown (readers use the font program).
        assert_eq!(advances(&metrics, b"C"), None);
    }

    #[test]
    fn standard_font_without_widths_uses_built_in_metrics() {
        let metrics = load_font(&doc(), &crate::test_support::helvetica()).unwrap();
        assert_eq!(advances(&metrics, b"A "), Some(vec![0.667, 0.278]));
        let builtin = dictionary! { "Subtype" => "Type1", "BaseFont" => "Times-Roman" };
        assert!(load_font(&doc(), &builtin).is_some());
    }

    #[test]
    fn differences_override_the_base_encoding() {
        let font = dictionary! {
            "Subtype" => "Type1", "BaseFont" => "Helvetica",
            "Encoding" => dictionary! {
                "BaseEncoding" => "WinAnsiEncoding",
                "Differences" => vec![Object::Integer(65), Object::Name(b"W".to_vec()), Object::Name(b"space".to_vec())],
            },
        };
        let metrics = load_font(&doc(), &font).unwrap();
        assert_eq!(advances(&metrics, b"ABC"), Some(vec![0.944, 0.278, 0.722]));
    }

    #[test]
    fn unknown_fonts_and_encodings_are_unmeasurable() {
        let d = doc();
        assert!(load_font(
            &d,
            &dictionary! { "Subtype" => "TrueType", "BaseFont" => "Arial" }
        )
        .is_none());
        assert!(load_font(&d, &dictionary! { "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "MacExpertEncoding" }).is_none());
        assert!(load_font(
            &d,
            &dictionary! { "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => 5 }
        )
        .is_none());
        assert!(load_font(&d, &dictionary! { "Subtype" => "CIDFontType2" }).is_none());
        assert!(load_font(&d, &dictionary! {}).is_none());
    }

    #[test]
    fn type3_fonts_scale_by_their_matrix() {
        let font = dictionary! {
            "Subtype" => "Type3",
            "FontMatrix" => vec![Object::Real(0.01), 0.into(), 0.into(), Object::Real(0.01), 0.into(), 0.into()],
            "FirstChar" => 97, "Widths" => vec![Object::Integer(50)],
            "FontBBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
        };
        let metrics = load_font(&doc(), &font).unwrap();
        assert_eq!(advances(&metrics, b"a"), Some(vec![0.5]));
        let skewed = dictionary! {
            "Subtype" => "Type3",
            "FontMatrix" => vec![Object::Real(0.01), Object::Real(0.01), 0.into(), Object::Real(0.01), 0.into(), 0.into()],
            "FirstChar" => 97, "Widths" => vec![Object::Integer(50)],
        };
        assert!(load_font(&doc(), &skewed).is_none());
    }

    #[test]
    fn type0_identity_with_w_and_dw() {
        let font = dictionary! {
            "Subtype" => "Type0", "Encoding" => "Identity-H",
            "DescendantFonts" => vec![Object::Dictionary(dictionary! {
                "DW" => 900,
                "W" => vec![
                    1.into(), Object::Array(vec![500.into(), 600.into()]),
                    10.into(), 12.into(), 700.into(),
                ],
            })],
        };
        let metrics = load_font(&doc(), &font).unwrap();
        assert_eq!(
            advances(&metrics, &[0, 1, 0, 2, 0, 11, 0, 99]),
            Some(vec![0.5, 0.6, 0.7, 0.9])
        );
    }

    #[test]
    fn type0_with_embedded_cmap() {
        let mut d = doc();
        let cmap = d.add_object(Stream::new(
            dictionary! {},
            b"1 begincodespacerange <00> <FF> endcodespacerange 1 begincidrange <41> <5A> 1 endcidrange".to_vec(),
        ));
        let font = dictionary! {
            "Subtype" => "Type0", "Encoding" => cmap,
            "DescendantFonts" => vec![Object::Dictionary(dictionary! { "W" => vec![1.into(), Object::Array(vec![300.into()])] })],
        };
        let metrics = load_font(&d, &font).unwrap();
        assert_eq!(advances(&metrics, b"AB"), Some(vec![0.3, 1.0]));
    }

    #[test]
    fn type0_refuses_vertical_and_unknown_cmaps_but_builds_on_identity() {
        let mut d = doc();
        let descendants = vec![Object::Dictionary(dictionary! {})];
        let vertical = dictionary! { "Subtype" => "Type0", "Encoding" => "Identity-V", "DescendantFonts" => descendants.clone() };
        assert!(load_font(&d, &vertical).is_none());
        let wmode = d.add_object(Stream::new(
            dictionary! { "WMode" => 1 },
            b"1 begincodespacerange <00> <FF> endcodespacerange".to_vec(),
        ));
        let font = dictionary! { "Subtype" => "Type0", "Encoding" => wmode, "DescendantFonts" => descendants.clone() };
        assert!(load_font(&d, &font).is_none());
        let based = d.add_object(Stream::new(
            dictionary! { "UseCMap" => "UniGB-UCS2-H" },
            b"1 begincodespacerange <00> <FF> endcodespacerange".to_vec(),
        ));
        let font = dictionary! { "Subtype" => "Type0", "Encoding" => based, "DescendantFonts" => descendants.clone() };
        assert!(load_font(&d, &font).is_none());
        let identity_based = d.add_object(Stream::new(
            dictionary! { "UseCMap" => "Identity-H" },
            b"1 begincidchar <0001> 5 endcidchar".to_vec(),
        ));
        let font = dictionary! { "Subtype" => "Type0", "Encoding" => identity_based, "DescendantFonts" => descendants };
        // No code space of its own, but Identity-H's applies.
        let metrics = load_font(&d, &font).unwrap();
        assert_eq!(advances(&metrics, &[0, 1]), Some(vec![1.0]));
    }

    #[test]
    fn get_and_get_dict_follow_references() {
        let mut d = doc();
        let inner = d.add_object(dictionary! { "X" => 1 });
        let outer = dictionary! { "D" => inner, "N" => 3 };
        assert!(get_dict(&d, &outer, b"D").is_some());
        assert!(get_dict(&d, &outer, b"N").is_none());
        assert_eq!(get(&d, &outer, b"N"), Some(&Object::Integer(3)));
        assert_eq!(get(&d, &outer, b"Missing"), None);
    }

    #[test]
    fn read_widths_validates_first_char() {
        let d = doc();
        assert!(read_widths(
            &d,
            &dictionary! { "FirstChar" => -1, "Widths" => vec![1.into()] }
        )
        .is_none());
        assert!(read_widths(&d, &dictionary! { "FirstChar" => 0 }).is_none());
        let w = read_widths(
            &d,
            &dictionary! { "FirstChar" => 255, "Widths" => vec![1.into(), 2.into()] },
        )
        .unwrap();
        assert_eq!((w[255], w[0]), (Some(1.0), None));
    }

    #[test]
    fn read_encoding_handles_every_form() {
        let d = doc();
        assert_eq!(
            read_encoding(&d, &dictionary! {}),
            Some((BaseEncoding::Builtin, vec![]))
        );
        assert_eq!(
            read_encoding(&d, &dictionary! { "Encoding" => "MacRomanEncoding" }),
            Some((BaseEncoding::MacRoman, vec![]))
        );
        assert_eq!(
            read_encoding(
                &d,
                &dictionary! { "Encoding" => dictionary! { "Differences" => 1 } }
            ),
            None
        );
    }

    #[test]
    fn read_differences_needs_a_code_first() {
        let d = doc();
        assert!(read_differences(&d, &[Object::Name(b"A".to_vec())]).is_none());
        assert!(read_differences(&d, &[Object::Real(1.0)]).is_none());
        assert_eq!(
            read_differences(
                &d,
                &[
                    255.into(),
                    Object::Name(b"a".to_vec()),
                    Object::Name(b"b".to_vec())
                ]
            ),
            Some(vec![(255, b"a".to_vec())])
        );
    }

    #[test]
    fn read_cid_widths_enforces_its_budget() {
        let d = doc();
        let huge = [
            0.into(),
            65535.into(),
            500.into(),
            0.into(),
            65535.into(),
            500.into(),
        ];
        assert!(read_cid_widths(&d, &huge).is_none());
        assert!(read_cid_widths(&d, &[1.into()]).is_none());
        assert!(read_cid_widths(&d, &[Object::Real(1.5), Object::Array(vec![])]).is_none());
        let first_wins = read_cid_widths(
            &d,
            &[
                5.into(),
                5.into(),
                100.into(),
                5.into(),
                Object::Array(vec![200.into()]),
            ],
        )
        .unwrap();
        assert_eq!(first_wins[&5], 100.0);
    }

    #[test]
    fn scale_multiplies_every_side() {
        assert_eq!(
            scale(&Rect::new(0.0, -200.0, 1000.0, 800.0), 0.001),
            Rect::new(0.0, -0.2, 1.0, 0.8)
        );
    }
}
