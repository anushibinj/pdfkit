//! Removing the glyphs of one text-showing operation that lie outside the
//! crop area, without moving any glyph that stays.
//!
//! PDF places glyphs one after another: after each glyph the pen moves
//! right by (ISO 32000-1, 9.4.4)
//!
//! ```text
//! tx = (w0 * Tfs + Tc + Tw) * Th
//! ```
//!
//! where `w0` is the glyph's width, `Tfs` the font size, `Tc` the character
//! spacing, `Tw` the word spacing (only for the single-byte code 32) and
//! `Th` the horizontal scaling. A number `n` in a `TJ` array moves the pen
//! by `-n / 1000 * Tfs * Th` instead of showing a glyph.
//!
//! So a glyph can be deleted without disturbing the others by putting, in
//! its place, a `TJ` number that moves the pen exactly as far as the glyph
//! did:
//!
//! ```text
//! -n / 1000 * Tfs * Th = (w0 * Tfs + Tc + Tw) * Th
//!                    n = -(1000 * w0 + 1000 * (Tc + Tw) / Tfs)
//! ```
//!
//! `Th` cancels out; `Tfs` must not be 0. The operation is then rewritten
//! as a `TJ` array of the kept glyphs' original bytes (as hex strings) and
//! these numbers.

use crate::fonts::FontMetrics;
use crate::geometry::{Matrix, Placement, Rect};

/// One element of a text-showing operation.
#[derive(Debug, Clone, PartialEq)]
pub enum ShowElement<'a> {
    /// A string of character codes.
    Text(&'a [u8]),
    /// A `TJ` number: a pen move in thousandths of text space.
    Adjust(f64),
}

use super::path::StrokeStyle;

/// The text state parameters that position glyphs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextParams {
    /// `Tfs`: font size.
    pub size: f64,
    /// `Tc`: character spacing.
    pub char_spacing: f64,
    /// `Tw`: word spacing.
    pub word_spacing: f64,
    /// `Th`: horizontal scaling as a factor (`Tz` / 100).
    pub h_scale: f64,
    /// `Ts`: text rise.
    pub rise: f64,
    /// `Tr`: text rendering mode (0..=7).
    ///
    /// - 0: Fill text
    /// - 1: Stroke text
    /// - 2: Fill, then stroke text
    /// - 3: Neither fill nor stroke text (invisible)
    /// - 4: Fill text and add to path for clipping
    /// - 5: Stroke text and add to path for clipping
    /// - 6: Fill, then stroke text and add to path for clipping
    /// - 7: Add text to path for clipping
    pub render_mode: u8,
}

impl Default for TextParams {
    fn default() -> Self {
        TextParams {
            size: 0.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            h_scale: 1.0,
            rise: 0.0,
            render_mode: 0,
        }
    }
}

/// What [`split_show`] decided for one operation.
#[derive(Debug, Clone, PartialEq)]
pub enum ShowOutcome {
    /// The glyphs could not all be measured (or a deletion could not be
    /// written). Nothing is changed and the pen position afterwards is
    /// unknown.
    Unmeasured,
    /// Every glyph was placed.
    Measured {
        /// How far the pen moved, in text space (to update `Tm`).
        advance: f64,
        /// How many glyphs are to be deleted.
        removed: u32,
        /// In page space: how far, at most, the glyphs after a deleted one
        /// can move in readers that keep widths only to whole thousandths
        /// of an em (see `Glyph::rounding`). 0 when nothing is deleted.
        drift: f64,
        /// The new `[...]` array for a `TJ` operator, when glyphs were
        /// deleted; `None` when the operation stays as it is.
        replacement: Option<Vec<u8>>,
    },
}

/// Decide which glyphs of a text-showing operation to delete.
///
/// For every glyph, its box (see [`FontMetrics::glyph_box`]) is scaled by
/// the font size, horizontal scaling and rise, moved to the glyph's pen
/// position, and transformed by the text matrix and the CTM into page
/// space. When stroked (`Tr` 1, 2, 5, 6), the box is expanded in page space
/// by how far the stroke can reach ([`StrokeStyle::reach`]).
///
/// A glyph is deleted only when that box lies entirely [`Placement::Outside`]
/// the crop area, and the text rendering mode does not add to the clipping
/// path (`Tr` 4..=7). Glyphs inside or crossing the edge, or used for clipping,
/// stay so nothing that can be seen or that affects later painting disappears.
///
/// - `tm`: the text matrix before the operation.
/// - `ctm`: the current transformation matrix.
pub fn split_show(
    elements: &[ShowElement],
    font: &FontMetrics,
    params: &TextParams,
    stroke: &StrokeStyle,
    tm: &Matrix,
    ctm: &Matrix,
    crop: &Rect,
) -> ShowOutcome {
    let to_page = tm.then(ctm);
    let TextParams {
        size,
        char_spacing,
        word_spacing,
        h_scale,
        rise,
        render_mode,
    } = *params;
    // Clipping modes (4..=7): deleting any glyph would alter clipping for subsequent
    // operators in the content stream, so clipping text is never removed.
    let clips = matches!(render_mode, 4..=7);
    // Stroked modes (1, 2, 5, 6): outline is expanded by half the line width (times miter limit).
    let strokes = matches!(render_mode, 1 | 2 | 5 | 6);
    let stroke_reach = if strokes { stroke.reach(ctm) } else { 0.0 };

    let mut x = 0.0;
    let mut removed = 0;
    let mut rounding = 0.0;
    let mut out = TjBuilder::default();
    for element in elements {
        match element {
            ShowElement::Adjust(n) => {
                x += -n / 1000.0 * size * h_scale;
                out.number(*n);
            }
            ShowElement::Text(bytes) => {
                let Some(glyphs) = font.glyphs(bytes) else {
                    return ShowOutcome::Unmeasured;
                };
                for glyph in glyphs {
                    let spacing = char_spacing
                        + if glyph.is_word_space {
                            word_spacing
                        } else {
                            0.0
                        };
                    let unit = font.glyph_box(glyph.advance);
                    let in_text_space = Rect::new(
                        x + unit.left * size * h_scale,
                        unit.bottom * size + rise,
                        x + unit.right * size * h_scale,
                        unit.top * size + rise,
                    );
                    let in_page = in_text_space.transform(&to_page);
                    // Stroke-expanded bounds ensure visible stroke reaching into crop area is kept.
                    let effective_box = if strokes {
                        in_page.expand(stroke_reach)
                    } else {
                        in_page
                    };
                    let placement = effective_box.placement_in(crop);
                    if placement == Placement::Outside && !clips {
                        let n = -(1000.0 * glyph.advance + 1000.0 * spacing / size);
                        if size == 0.0 || h_scale == 0.0 || !n.is_finite() {
                            return ShowOutcome::Unmeasured;
                        }
                        out.number(n);
                        removed += 1;
                        rounding += glyph.rounding;
                    } else {
                        out.text(&bytes[glyph.bytes.clone()]);
                    }
                    x += (glyph.advance * size + spacing) * h_scale;
                }
            }
        }
    }
    if !x.is_finite() {
        return ShowOutcome::Unmeasured;
    }
    ShowOutcome::Measured {
        advance: x,
        removed,
        // Only deleted glyphs drift; a deleted glyph had a finite box, so
        // the matrices are finite here (no 0 * infinity).
        drift: if removed == 0 {
            0.0
        } else {
            rounding * (size * h_scale).abs() * to_page.max_scale()
        },
        replacement: (removed > 0).then(|| out.finish()),
    }
}

/// Builds a `TJ` array, merging neighbouring strings and numbers.
#[derive(Default)]
struct TjBuilder {
    items: Vec<TjItem>,
}

enum TjItem {
    Text(Vec<u8>),
    Number(f64),
}

impl TjBuilder {
    /// Append glyph bytes (joined to a preceding string).
    fn text(&mut self, bytes: &[u8]) {
        match self.items.last_mut() {
            Some(TjItem::Text(t)) => t.extend_from_slice(bytes),
            _ => self.items.push(TjItem::Text(bytes.to_vec())),
        }
    }

    /// Append a pen move (added to a preceding number).
    fn number(&mut self, n: f64) {
        match self.items.last_mut() {
            Some(TjItem::Number(m)) => *m += n,
            _ => self.items.push(TjItem::Number(n)),
        }
    }

    /// The array, e.g. `[<4142> -250 <43>]`. Strings are written as hex so
    /// no byte ever needs escaping.
    fn finish(self) -> Vec<u8> {
        let parts: Vec<String> = self
            .items
            .iter()
            .map(|item| match item {
                TjItem::Text(bytes) => format!("<{}>", hex(bytes)),
                TjItem::Number(n) => format_number(*n),
            })
            .collect();
        format!("[{}]", parts.join(" ")).into_bytes()
    }
}

/// Upper-case hex digits of `bytes`.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// A number as PDF writes it: no exponent, at most 4 decimals, no
/// trailing zeros, and never `-0`.
///
/// Four decimals of a thousandth of the font size is far below anything a
/// screen or printer can show, so rounding never visibly moves a glyph.
pub fn format_number(n: f64) -> String {
    let text = format!("{n:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    match text {
        "-0" | "" => "0".to_string(),
        t => t.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every glyph 500 units wide (0.5 em), no bounding box.
    fn font() -> FontMetrics {
        FontMetrics::simple([Some(500.0); 256], 0.001, None)
    }

    fn params(size: f64) -> TextParams {
        TextParams {
            size,
            ..TextParams::default()
        }
    }

    /// The crop starts at x = 100; glyphs are 10 pt wide at size 20, plus
    /// a 5 pt safety margin on either side.
    fn crop() -> Rect {
        Rect::new(100.0, 0.0, 1000.0, 1000.0)
    }

    fn at(x: f64) -> Matrix {
        Matrix::translate(x, 500.0)
    }

    #[test]
    fn keeps_operations_entirely_inside() {
        let outcome = split_show(
            &[ShowElement::Text(b"abc")],
            &font(),
            &params(20.0),
            &StrokeStyle::default(),
            &at(200.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        assert_eq!(
            outcome,
            ShowOutcome::Measured {
                advance: 30.0,
                removed: 0,
                drift: 0.0,
                replacement: None
            }
        );
    }

    #[test]
    fn deletes_leading_glyphs_outside_and_keeps_positions() {
        // Glyphs at x = 60, 70, 80, 90, 100, 110 (each 10 wide). With the
        // safety margin, a glyph at 80 reaches 95 (outside), the one at 90
        // reaches 105 (crossing).
        let outcome = split_show(
            &[ShowElement::Text(b"abcdef")],
            &font(),
            &params(20.0),
            &StrokeStyle::default(),
            &at(60.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        let ShowOutcome::Measured {
            advance,
            removed,
            replacement,
            ..
        } = outcome
        else {
            panic!()
        };
        assert_eq!((advance, removed), (60.0, 3));
        assert_eq!(replacement.unwrap(), b"[-1500 <646566>]");
    }

    #[test]
    fn deletes_trailing_glyphs_and_keeps_tj_numbers() {
        let crop = Rect::new(0.0, 0.0, 85.0, 1000.0);
        let elements = [
            ShowElement::Text(b"ab"),
            ShowElement::Adjust(-500.0),
            ShowElement::Text(b"cd"),
        ];
        // a at 60, b at 70, move 10 -> c at 90, d at 100.
        let outcome = split_show(
            &elements,
            &font(),
            &params(20.0),
            &StrokeStyle::default(),
            &at(60.0),
            &Matrix::IDENTITY,
            &crop,
        );
        let ShowOutcome::Measured {
            removed,
            replacement,
            ..
        } = outcome
        else {
            panic!()
        };
        assert_eq!(removed, 2);
        assert_eq!(replacement.unwrap(), b"[<6162> -1500]");
    }

    #[test]
    fn spacing_is_folded_into_the_replacement_number() {
        let p = TextParams {
            char_spacing: 2.0,
            word_spacing: 4.0,
            ..params(20.0)
        };
        // " " at x = 0 (well outside): advance 10 + 2 + 4 = 16.
        let outcome = split_show(
            &[ShowElement::Text(b" a")],
            &font(),
            &p,
            &StrokeStyle::default(),
            &at(0.0),
            &Matrix::IDENTITY,
            &Rect::new(15.0, 0.0, 1000.0, 1000.0),
        );
        let ShowOutcome::Measured {
            advance,
            replacement,
            ..
        } = outcome
        else {
            panic!()
        };
        assert_eq!(advance, 16.0 + 12.0);
        // n = -(1000 * 0.5 + 1000 * 6 / 20) = -800, and -(-800)/1000*20 = 16.
        assert_eq!(replacement.unwrap(), b"[-800 <61>]");
    }

    #[test]
    fn horizontal_scaling_and_ctm_are_applied() {
        let p = TextParams {
            h_scale: 2.0,
            ..params(10.0)
        };
        // Each glyph moves 0.5 * 10 * 2 = 10; the CTM moves everything by +50.
        let outcome = split_show(
            &[ShowElement::Text(b"ab")],
            &font(),
            &p,
            &StrokeStyle::default(),
            &Matrix::translate(0.0, 500.0),
            &Matrix::translate(50.0, 0.0),
            &crop(),
        );
        let ShowOutcome::Measured {
            advance, removed, ..
        } = outcome
        else {
            panic!()
        };
        assert_eq!((advance, removed), (20.0, 2));
    }

    #[test]
    fn rise_moves_glyph_boxes_vertically() {
        let p = TextParams {
            rise: 600.0,
            ..params(10.0)
        };
        let crop = Rect::new(0.0, 0.0, 1000.0, 1000.0);
        let outcome = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p,
            &StrokeStyle::default(),
            &at(500.0),
            &Matrix::IDENTITY,
            &crop,
        );
        assert!(matches!(outcome, ShowOutcome::Measured { removed: 1, .. }));
    }

    #[test]
    fn drift_sums_the_rounding_of_deleted_glyphs_in_page_space() {
        let font = FontMetrics::simple([Some(500.25); 256], 0.001, None);
        // Two glyphs deleted at size 20, the CTM doubles: 2 * 0.00025 * 20 * 2.
        let ctm = Matrix::new(2.0, 0.0, 0.0, 2.0, 0.0, 0.0);
        let outcome = split_show(
            &[ShowElement::Text(b"ab")],
            &font,
            &params(20.0),
            &StrokeStyle::default(),
            &at(0.0),
            &ctm,
            &crop(),
        );
        let ShowOutcome::Measured { removed, drift, .. } = outcome else {
            panic!()
        };
        assert_eq!(removed, 2);
        assert!((drift - 0.02).abs() < 1e-12);
        let kept = split_show(
            &[ShowElement::Text(b"ab")],
            &font,
            &params(20.0),
            &StrokeStyle::default(),
            &at(500.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        assert!(matches!(kept, ShowOutcome::Measured { drift, .. } if drift == 0.0));
    }

    #[test]
    fn stroked_text_is_widened_by_stroke_line_width() {
        // Glyph at x = 80 with size 20 reaches 95 without stroke (outside crop starting at 100).
        // With stroke style line_width 20 (reach = 20 * 10 / 2 + 1 = 101, or min 10 pt reach),
        // the stroked glyph reaches into crop and must be kept.
        let stroke = StrokeStyle {
            line_width: 20.0,
            miter_limit: 1.0,
        };
        let p_fill = TextParams {
            render_mode: 0,
            ..params(20.0)
        };
        let outcome_fill = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p_fill,
            &stroke,
            &at(80.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        // Fill only: glyph at 80 is outside crop [100..1000] and deleted.
        assert_eq!(
            outcome_fill,
            ShowOutcome::Measured {
                advance: 10.0,
                removed: 1,
                drift: 0.0,
                replacement: Some(b"[-500]".to_vec()),
            }
        );

        let p_stroke = TextParams {
            render_mode: 1, // Stroke text
            ..params(20.0)
        };
        let outcome_stroke = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p_stroke,
            &stroke,
            &at(80.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        // Stroke widens glyph bounds, reaching crop at 100: glyph is kept.
        assert_eq!(
            outcome_stroke,
            ShowOutcome::Measured {
                advance: 10.0,
                removed: 0,
                drift: 0.0,
                replacement: None,
            }
        );
    }

    #[test]
    fn clipping_text_is_never_deleted() {
        // Modes 4..=7 add text to clipping path; deleting glyphs would alter clipping.
        let p_clip = TextParams {
            render_mode: 4,
            ..params(20.0)
        };
        let outcome = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p_clip,
            &StrokeStyle::default(),
            &at(0.0), // Far outside crop
            &Matrix::IDENTITY,
            &crop(),
        );
        assert_eq!(
            outcome,
            ShowOutcome::Measured {
                advance: 10.0,
                removed: 0,
                drift: 0.0,
                replacement: None,
            }
        );
    }

    #[test]
    fn unmeasurable_text_changes_nothing() {
        let mut widths = [Some(500.0); 256];
        widths[b'?' as usize] = None;
        let font = FontMetrics::simple(widths, 0.001, None);
        let outcome = split_show(
            &[ShowElement::Text(b"a?")],
            &font,
            &params(20.0),
            &StrokeStyle::default(),
            &at(0.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        assert_eq!(outcome, ShowOutcome::Unmeasured);
    }

    #[test]
    fn zero_font_size_cannot_be_rewritten() {
        let p = TextParams {
            char_spacing: 5.0,
            ..params(0.0)
        };
        let outcome = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p,
            &StrokeStyle::default(),
            &at(0.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        assert_eq!(outcome, ShowOutcome::Unmeasured);
    }

    #[test]
    fn non_finite_positions_are_unmeasured() {
        let p = TextParams {
            char_spacing: f64::NAN,
            ..params(20.0)
        };
        let outcome = split_show(
            &[ShowElement::Text(b"a")],
            &font(),
            &p,
            &StrokeStyle::default(),
            &at(500.0),
            &Matrix::IDENTITY,
            &crop(),
        );
        assert_eq!(outcome, ShowOutcome::Unmeasured);
    }

    #[test]
    fn tj_builder_merges_neighbours() {
        let mut b = TjBuilder::default();
        b.text(b"A");
        b.text(b"B");
        b.number(-100.0);
        b.number(-50.5);
        b.text(b"(");
        assert_eq!(b.finish(), b"[<4142> -150.5 <28>]");
    }

    #[test]
    fn hex_is_upper_case_pairs() {
        assert_eq!(hex(&[0x00, 0xAB, 0x10]), "00AB10");
    }

    #[test]
    fn format_number_is_plain_pdf() {
        assert_eq!(format_number(-1500.0), "-1500");
        assert_eq!(format_number(12.34567), "12.3457");
        assert_eq!(format_number(-0.00001), "0");
        assert_eq!(format_number(0.5), "0.5");
        assert_eq!(format_number(1e20), "100000000000000000000");
    }
}
