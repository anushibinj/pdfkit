//! Font metrics: where each glyph of a string sits and how big it can be.
//!
//! The crop never draws glyphs. It only needs, for every character code in
//! a string, how far the pen moves (the advance width) and a box that
//! surely contains the glyph's ink. This module holds that knowledge in a
//! form independent of how it was read from the PDF (see
//! `document::fonts` for that), so it can be tested on its own.

pub mod cmap;
pub mod standard;
#[rustfmt::skip]
mod standard_data;

use std::collections::HashMap;
use std::ops::Range;

use crate::geometry::Rect;
use cmap::CMap;

/// How a string's bytes split into codes, and how codes find their widths.
#[derive(Debug, Clone, PartialEq)]
enum Encoding {
    /// Simple fonts: one byte per code; widths by code.
    SingleByte { widths: Box<[Option<f64>; 256]> },
    /// Composite fonts: codes from the CMap; widths by CID.
    Composite {
        cmap: CMap,
        widths: HashMap<u32, f64>,
        default_width: f64,
    },
}

/// One glyph of a string.
#[derive(Debug, Clone, PartialEq)]
pub struct Glyph {
    /// The bytes of its character code within the string.
    pub bytes: Range<usize>,
    /// Advance width in text space units per unit of font size (w0).
    pub advance: f64,
    /// Whether word spacing (`Tw`) applies: the single-byte code 32.
    pub is_word_space: bool,
    /// How far (text space per unit of font size) a reader that keeps
    /// widths only to whole thousandths of an em may advance differently
    /// than the standard says. PDFium does: it truncates a `/W` width of
    /// 611.8 to 611. Deleting this glyph moves the following ones by at
    /// most this much in such readers (and not at all in exact ones).
    pub rounding: f64,
}

/// Everything the crop needs to know about one font.
#[derive(Debug, Clone, PartialEq)]
pub struct FontMetrics {
    encoding: Encoding,
    /// Width units to text space: 1/1000, or a Type 3 font's matrix scale.
    unit: f64,
    /// The font bounding box in text space per unit of font size, if the
    /// font declares a usable one.
    bbox: Option<Rect>,
}

/// The box assumed for every glyph on top of the font bounding box, in
/// text space per unit of font size: a quarter em beyond the advance on
/// either side, from 0.35 em below the baseline to 1.1 em above it.
///
/// Font bounding boxes are sometimes missing or wrong (too small). Taking
/// the union with this box means such a font can only make the crop keep
/// more, never remove a glyph whose ink reaches into the crop area.
const SAFETY_LEFT: f64 = -0.25;
const SAFETY_RIGHT: f64 = 0.25;
const SAFETY_BOTTOM: f64 = -0.35;
const SAFETY_TOP: f64 = 1.1;

impl FontMetrics {
    /// A simple font (Type 1, TrueType, Type 3): one byte per code.
    ///
    /// - `widths`: advance by code in width units; `None` = unknown.
    /// - `unit`: width units to text space (1/1000, or Type 3's scale).
    /// - `bbox`: FontBBox in text space per unit of font size, if declared.
    pub fn simple(widths: [Option<f64>; 256], unit: f64, bbox: Option<Rect>) -> FontMetrics {
        FontMetrics {
            encoding: Encoding::SingleByte {
                widths: Box::new(widths),
            },
            unit,
            bbox: usable_bbox(bbox),
        }
    }

    /// A composite (Type 0) font.
    ///
    /// - `cmap`: splits strings into codes and maps codes to CIDs.
    /// - `widths`: advance by CID in 1/1000 em (from `/W`).
    /// - `default_width`: advance of CIDs not in `widths` (`/DW`).
    /// - `bbox`: FontBBox in text space per unit of font size, if declared.
    pub fn composite(
        cmap: CMap,
        widths: HashMap<u32, f64>,
        default_width: f64,
        bbox: Option<Rect>,
    ) -> FontMetrics {
        FontMetrics {
            encoding: Encoding::Composite {
                cmap,
                widths,
                default_width,
            },
            unit: 0.001,
            bbox: usable_bbox(bbox),
        }
    }

    /// Split a string into glyphs with their advances.
    ///
    /// `None` when any code's width is unknown or the bytes do not form
    /// whole codes: then nothing after that point can be placed, and the
    /// caller must keep the text as it is.
    pub fn glyphs(&self, bytes: &[u8]) -> Option<Vec<Glyph>> {
        match &self.encoding {
            Encoding::SingleByte { widths } => bytes
                .iter()
                .enumerate()
                .map(|(i, &code)| {
                    let width = widths[code as usize]?;
                    Some(Glyph {
                        bytes: i..i + 1,
                        advance: width * self.unit,
                        is_word_space: code == b' ',
                        rounding: self.rounding(width),
                    })
                })
                .collect(),
            Encoding::Composite {
                cmap,
                widths,
                default_width,
            } => {
                let mut glyphs = Vec::new();
                let mut at = 0;
                while at < bytes.len() {
                    let (len, code) = cmap.next_code(&bytes[at..])?;
                    let cid = cmap.cid(len, code);
                    let width = widths.get(&cid).copied().unwrap_or(*default_width);
                    glyphs.push(Glyph {
                        bytes: at..at + len,
                        advance: width * self.unit,
                        is_word_space: len == 1 && code == u32::from(b' '),
                        rounding: self.rounding(width),
                    });
                    at += len;
                }
                Some(glyphs)
            }
        }
    }

    /// The [`Glyph::rounding`] of a width given in this font's units.
    ///
    /// For fonts measured in thousandths of an em, the fractional part of
    /// the width (what truncation drops). Type 3 fonts use their own units,
    /// and readers convert them in their own ways; a full thousandth of an
    /// em bounds the error of any reader that keeps thousandths.
    fn rounding(&self, width: f64) -> f64 {
        if self.unit == 0.001 {
            width.fract().abs() * self.unit
        } else {
            0.001
        }
    }

    /// A box, in text space per unit of font size with the glyph origin at
    /// (0, 0), that contains the ink of any glyph with this advance.
    ///
    /// It is the union of the font bounding box (if usable), the advance
    /// itself, and the safety box (see [`SAFETY_LEFT`] and friends).
    pub fn glyph_box(&self, advance: f64) -> Rect {
        let safety = Rect::new(
            SAFETY_LEFT.min(advance + SAFETY_LEFT),
            SAFETY_BOTTOM,
            SAFETY_RIGHT.max(advance + SAFETY_RIGHT),
            SAFETY_TOP,
        );
        match &self.bbox {
            Some(bbox) => safety.union(bbox),
            None => safety,
        }
    }
}

/// The FontBBox, or `None` when it has no area (a common placeholder is
/// `[0 0 0 0]`) or is not finite.
fn usable_bbox(bbox: Option<Rect>) -> Option<Rect> {
    bbox.filter(|b| b.is_finite() && b.width() > 0.0 && b.height() > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn widths_all(value: f64) -> [Option<f64>; 256] {
        [Some(value); 256]
    }

    #[test]
    fn simple_fonts_read_one_byte_per_glyph() {
        let mut widths = widths_all(500.0);
        widths[b'W' as usize] = Some(944.0);
        let font = FontMetrics::simple(widths, 0.001, None);
        let glyphs = font.glyphs(b"W x").unwrap();
        assert_eq!(glyphs.len(), 3);
        assert_eq!(glyphs[0].bytes, 0..1);
        assert!((glyphs[0].advance - 0.944).abs() < 1e-12);
        assert!(!glyphs[0].is_word_space);
        assert_eq!(glyphs[0].rounding, 0.0);
        assert!(glyphs[1].is_word_space);
        assert_eq!(glyphs[2].bytes, 2..3);
    }

    #[test]
    fn simple_fonts_give_up_on_unknown_widths() {
        let mut widths = widths_all(500.0);
        widths[b'?' as usize] = None;
        let font = FontMetrics::simple(widths, 0.001, None);
        assert!(font.glyphs(b"a?b").is_none());
        assert_eq!(font.glyphs(b"").unwrap(), vec![]);
    }

    #[test]
    fn rounding_is_the_dropped_fraction_or_a_thousandth() {
        let font = FontMetrics::simple([Some(611.8164); 256], 0.001, None);
        assert!((font.glyphs(b"o").unwrap()[0].rounding - 0.0008164).abs() < 1e-9);
        let type3 = FontMetrics::simple([Some(10.0); 256], 0.05, None);
        assert_eq!(type3.glyphs(b"a").unwrap()[0].rounding, 0.001);
        assert_eq!(font.rounding(-2.25), 0.00025);
    }

    #[test]
    fn type3_units_scale_widths() {
        let font = FontMetrics::simple(widths_all(10.0), 0.05, None);
        assert_eq!(font.glyphs(b"a").unwrap()[0].advance, 0.5);
    }

    #[test]
    fn composite_fonts_use_cmap_codes_and_cid_widths() {
        let widths = HashMap::from([(0x41, 600.0)]);
        let font = FontMetrics::composite(CMap::identity(), widths, 1000.0, None);
        let glyphs = font.glyphs(&[0x00, 0x41, 0x00, 0x20]).unwrap();
        assert_eq!(
            glyphs[0],
            Glyph {
                bytes: 0..2,
                advance: 0.6,
                is_word_space: false,
                rounding: 0.0
            }
        );
        // Two-byte code 32 is not a word space.
        assert_eq!(
            glyphs[1],
            Glyph {
                bytes: 2..4,
                advance: 1.0,
                is_word_space: false,
                rounding: 0.0
            }
        );
        assert!(font.glyphs(&[0x00]).is_none());
    }

    #[test]
    fn composite_single_byte_space_takes_word_spacing() {
        let cmap = CMap::parse(b"1 begincodespacerange <00> <FF> endcodespacerange").unwrap();
        let font = FontMetrics::composite(cmap, HashMap::new(), 500.0, None);
        assert!(font.glyphs(b" ").unwrap()[0].is_word_space);
    }

    #[test]
    fn glyph_box_is_safety_box_without_bbox() {
        let font = FontMetrics::simple(widths_all(500.0), 0.001, None);
        assert_eq!(font.glyph_box(0.5), Rect::new(-0.25, -0.35, 0.75, 1.1));
    }

    #[test]
    fn glyph_box_includes_a_large_font_bbox() {
        let bbox = Some(Rect::new(-0.5, -0.4, 2.0, 1.5));
        let font = FontMetrics::simple(widths_all(500.0), 0.001, bbox);
        assert_eq!(font.glyph_box(0.5), Rect::new(-0.5, -0.4, 2.0, 1.5));
    }

    #[test]
    fn glyph_box_handles_negative_advances() {
        let font = FontMetrics::simple(widths_all(0.0), 0.001, None);
        let b = font.glyph_box(-1.0);
        assert_eq!((b.left, b.right), (-1.25, 0.25));
    }

    #[test]
    fn usable_bbox_drops_placeholders() {
        assert_eq!(usable_bbox(Some(Rect::new(0.0, 0.0, 0.0, 0.0))), None);
        assert_eq!(usable_bbox(None), None);
        assert_eq!(usable_bbox(Some(Rect::new(0.0, f64::NAN, 1.0, 1.0))), None);
        let b = Rect::new(0.0, -0.2, 1.0, 0.8);
        assert_eq!(usable_bbox(Some(b)), Some(b));
    }
}
