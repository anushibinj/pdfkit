//! Deciding what in a content stream lies outside the crop area, and how
//! to delete it.
//!
//! [`clip_content`] walks a content stream operator by operator, tracking
//! the graphics state the way a PDF reader does (the current transformation
//! matrix, line width, text state and text matrices), and records an
//! [`Edit`] for each thing that cannot be seen inside the crop area:
//!
//! | Content                     | Outside            | Crossing the edge        |
//! |-----------------------------|--------------------|--------------------------|
//! | glyphs of text              | deleted per glyph  | kept                     |
//! | painted paths               | deleted            | kept                     |
//! | images (XObject and inline) | deleted            | kept whole (reported)    |
//! | form XObjects               | deleted            | trimmed copy (recursive) |
//!
//! It never deletes anything it cannot place with certainty. When an
//! operator that changes the state cannot be understood, it stops editing
//! for the rest of the stream ("lost track") rather than guess.
//!
//! Resources (fonts, images, forms) are reached through the
//! [`ContentContext`] trait, so this module does not depend on how the PDF
//! is stored.

pub mod path;
pub mod text;

use std::rc::Rc;

use crate::content::lexer::LexError;
use crate::content::operations::{parse_operations, Operand, Operation};
use crate::content::rewrite::Edit;
use crate::fonts::FontMetrics;
use crate::geometry::{Matrix, Placement, Rect};
use crate::report::CropReport;
pub use path::StrokeStyle;
use path::{is_construction, is_painting, PathTracker};
use text::{split_show, ShowElement, ShowOutcome, TextParams};

/// Deepest `q` nesting followed; deeper streams lose track.
const MAX_STATE_DEPTH: usize = 4096;

/// What the context knows about a font resource.
#[derive(Debug, Clone)]
pub enum FontLookup {
    /// Widths and bounding box are known.
    Measured(Rc<FontMetrics>),
    /// The font exists but cannot be measured (unsupported type or
    /// encoding, missing widths), or does not exist.
    Unmeasurable,
}

/// The parts of an `ExtGState` resource that move or size content.
#[derive(Debug, Clone, Default)]
pub struct ExtGState {
    /// `/LW`.
    pub line_width: Option<f64>,
    /// `/ML`.
    pub miter_limit: Option<f64>,
    /// `/Font [font size]`.
    pub font: Option<(FontLookup, f64)>,
}

/// What an XObject resource is.
#[derive(Debug, Clone, PartialEq)]
pub enum XObject {
    /// An image: it fills the unit square of its CTM.
    Image,
    /// A form: content clipped to `bbox`, drawn through `matrix`.
    Form { bbox: Rect, matrix: Matrix },
    /// Anything else (e.g. PostScript XObjects): left alone.
    Other,
}

/// Access to the resources of the content stream being clipped.
pub trait ContentContext {
    /// The font resource `name`.
    fn font(&mut self, name: &[u8]) -> FontLookup;
    /// The graphics state resource `name`, if it exists.
    fn ext_gstate(&mut self, name: &[u8]) -> Option<ExtGState>;
    /// The XObject resource `name`, if it exists.
    fn xobject(&mut self, name: &[u8]) -> Option<XObject>;
    /// Make a trimmed copy of the form `name`, drawn with `ctm` (the form's
    /// own matrix included) and inheriting `stroke`, and return the resource name to draw instead.
    /// `None` keeps the original (nothing to trim, or it cannot be read).
    /// Counts go into `report`.
    fn trim_form(
        &mut self,
        name: &[u8],
        ctm: &Matrix,
        stroke: &StrokeStyle,
        report: &mut CropReport,
    ) -> Option<Vec<u8>>;
}

/// The edits for one content stream.
#[derive(Debug, Default)]
pub struct ClipResult {
    pub edits: Vec<Edit>,
    /// What was removed and kept. Only valid together with `edits`: if
    /// the edits are not applied, the removal counts are wrong.
    pub report: CropReport,
}

/// Work out the edits that delete what lies outside `crop` from a content
/// stream drawn with `ctm` and initial `stroke`.
///
/// # Errors
///
/// [`LexError`] when the stream cannot be parsed; it must then be kept as
/// it is.
pub fn clip_content(
    content: &[u8],
    crop: &Rect,
    ctm: Matrix,
    stroke: StrokeStyle,
    ctx: &mut dyn ContentContext,
) -> Result<ClipResult, LexError> {
    let operations = parse_operations(content)?;
    let mut clipper = Clipper::new(content, *crop, ctm, stroke, ctx);
    for op in &operations {
        clipper.operation(op);
    }
    if clipper.lost {
        clipper.result.report.streams_partly_analysed += 1;
    }
    Ok(clipper.result)
}

/// The graphics state parameters the crop needs (saved by `q`).
#[derive(Debug, Clone)]
struct GraphicsState {
    ctm: Matrix,
    stroke: StrokeStyle,
    font: FontLookup,
    text: TextParams,
    /// `TL`: leading, for `T*`, `'` and `"`.
    leading: f64,
}

/// The text object state (reset by `BT`, not saved by `q`).
///
/// Two facts are tracked separately because they recover differently:
/// - `line_known`: whether `Tlm` is right. `Td`, `TD` and `T*` move it
///   relative to itself, so once a line move could not be read it stays
///   unknown until `BT` or a readable `Tm` sets it absolutely.
/// - `position_known`: whether `Tm` is right. A show whose length could
///   not be measured leaves `Tm` unknown, but the next line move starts
///   again from `Tlm`, so it recovers then (if `Tlm` is known).
#[derive(Debug, Clone)]
struct TextObject {
    /// `Tm`: where the next glyph goes.
    matrix: Matrix,
    /// `Tlm`: the start of the current line.
    line_matrix: Matrix,
    line_known: bool,
    position_known: bool,
    /// Drift (see `ShowOutcome::Measured::drift`) piled up since the last
    /// line move: later show operations on the same line continue from
    /// where the earlier ones ended, so they move by all of it.
    line_drift: f64,
}

impl TextObject {
    /// The state at `BT`: both matrices the identity.
    fn new() -> TextObject {
        TextObject {
            matrix: Matrix::IDENTITY,
            line_matrix: Matrix::IDENTITY,
            line_known: true,
            position_known: true,
            line_drift: 0.0,
        }
    }

    /// Start a line at `line_matrix` (after `Td`, `TD`, `Tm`, `T*`). The
    /// position is as reliable as the line matrix it came from.
    fn start_line(&mut self, line_matrix: Matrix) {
        self.line_matrix = line_matrix;
        self.matrix = line_matrix;
        self.position_known = self.line_known;
        self.line_drift = 0.0;
    }

    /// A line move could not be read: neither matrix can be trusted.
    fn lose_line(&mut self) {
        self.line_known = false;
        self.position_known = false;
    }
}

/// The walker's state for one stream.
struct Clipper<'c> {
    /// The content stream (to copy operand bytes verbatim).
    src: &'c [u8],
    crop: Rect,
    ctx: &'c mut dyn ContentContext,
    gs: GraphicsState,
    saved: Vec<GraphicsState>,
    text: TextObject,
    path: PathTracker,
    /// A state change could not be followed: no more edits in this stream.
    lost: bool,
    result: ClipResult,
}

impl<'c> Clipper<'c> {
    /// A walker starting with the given CTM, stroke style and PDF's initial state.
    fn new(
        src: &'c [u8],
        crop: Rect,
        ctm: Matrix,
        stroke: StrokeStyle,
        ctx: &'c mut dyn ContentContext,
    ) -> Clipper<'c> {
        Clipper {
            src,
            crop,
            ctx,
            gs: GraphicsState {
                ctm,
                stroke,
                font: FontLookup::Unmeasurable,
                text: TextParams::default(),
                leading: 0.0,
            },
            saved: Vec::new(),
            text: TextObject::new(),
            path: PathTracker::default(),
            lost: false,
            result: ClipResult::default(),
        }
    }

    /// Process one operation.
    fn operation(&mut self, op: &Operation) {
        if self.lost {
            return;
        }
        let name = op.operator.as_slice();
        if is_construction(name) {
            self.path.construct(
                op.span.start,
                name,
                op.numbers(op.operands.len()),
                &self.gs.ctm,
            );
            return;
        }
        if name == b"W" || name == b"W*" {
            if self.path.is_open() {
                self.path.clip();
            }
            return;
        }
        if is_painting(name) {
            if let Some(range) =
                self.path
                    .finish(name, op.span.end, &self.gs.stroke, &self.gs.ctm, &self.crop)
            {
                self.result.edits.push(Edit::remove(range));
                self.result.report.paths_removed += 1;
            }
            return;
        }
        // Any other operator inside path construction is malformed but
        // tolerated by readers: that path is then never deleted.
        self.path.interrupt();
        match name {
            b"q" => self.save(),
            b"Q" => self.restore(),
            b"cm" => self.concat(op),
            b"w" => self.gs.stroke.line_width = number_or_infinite(op),
            b"M" => self.gs.stroke.miter_limit = number_or_infinite(op),
            b"gs" => self.ext_gstate(op),
            b"BT" => self.text = TextObject::new(),
            b"Tf" => self.set_font(op),
            b"Tc" => self.gs.text.char_spacing = number_or_nan(op),
            b"Tw" => self.gs.text.word_spacing = number_or_nan(op),
            b"Tz" => self.gs.text.h_scale = number_or_nan(op) / 100.0,
            b"TL" => self.gs.leading = number_or_nan(op),
            b"Ts" => self.gs.text.rise = number_or_nan(op),
            b"Tr" => self.set_render_mode(op),
            b"Td" => self.move_line(op, false),
            b"TD" => self.move_line(op, true),
            b"Tm" => self.set_text_matrix(op),
            b"T*" => self.next_line(),
            b"Tj" | b"TJ" | b"'" | b"\"" => self.show(op),
            b"Do" => self.draw_xobject(op),
            b"BI" => self.draw_inline_image(op),
            _ => {}
        }
    }

    /// `q`: save the graphics state.
    fn save(&mut self) {
        if self.saved.len() >= MAX_STATE_DEPTH {
            self.lost = true;
            return;
        }
        self.saved.push(self.gs.clone());
    }

    /// `Q`: restore it (an unmatched `Q` is ignored, as readers do).
    fn restore(&mut self) {
        if let Some(gs) = self.saved.pop() {
            self.gs = gs;
        }
    }

    /// `cm`: the new CTM is `m × CTM`.
    fn concat(&mut self, op: &Operation) {
        match op.numbers(6).as_deref().and_then(Matrix::from_slice) {
            Some(m) => self.gs.ctm = m.then(&self.gs.ctm),
            None => self.lost = true,
        }
    }

    /// `gs`: apply the parts of an ExtGState that matter here.
    fn ext_gstate(&mut self, op: &Operation) {
        let Some(name) = op.operands.first().and_then(Operand::as_name) else {
            return;
        };
        let Some(state) = self.ctx.ext_gstate(name) else {
            return;
        };
        if let Some(width) = state.line_width {
            self.gs.stroke.line_width = width;
        }
        if let Some(limit) = state.miter_limit {
            self.gs.stroke.miter_limit = limit;
        }
        if let Some((font, size)) = state.font {
            self.gs.font = font;
            self.gs.text.size = size;
        }
    }

    /// `Tf`: select a font and size.
    fn set_font(&mut self, op: &Operation) {
        match (
            op.operands.first().and_then(Operand::as_name),
            op.operands.get(1).and_then(Operand::as_number),
        ) {
            (Some(name), Some(size)) if op.operands.len() == 2 => {
                self.gs.font = self.ctx.font(name);
                self.gs.text.size = size;
            }
            _ => self.gs.font = FontLookup::Unmeasurable,
        }
    }

    /// `Td` / `TD`: start a new line offset from the current one.
    fn move_line(&mut self, op: &Operation, sets_leading: bool) {
        match op.numbers(2).as_deref() {
            Some(&[tx, ty]) => {
                if sets_leading {
                    self.gs.leading = -ty;
                }
                self.text
                    .start_line(Matrix::translate(tx, ty).then(&self.text.line_matrix));
            }
            _ => self.text.lose_line(),
        }
    }

    /// `Tm`: set the text and line matrices.
    fn set_text_matrix(&mut self, op: &Operation) {
        match op.numbers(6).as_deref().and_then(Matrix::from_slice) {
            Some(m) => {
                self.text.line_known = true;
                self.text.start_line(m);
            }
            None => self.text.lose_line(),
        }
    }

    /// `T*`: move to the next line, `TL` below. (An unreadable `TL` is NaN,
    /// which makes every later glyph position NaN: such glyphs are never
    /// deleted.)
    fn next_line(&mut self) {
        self.text
            .start_line(Matrix::translate(0.0, -self.gs.leading).then(&self.text.line_matrix));
    }

    /// `Tr`: set text rendering mode (0..=7).
    fn set_render_mode(&mut self, op: &Operation) {
        match op.numbers(1).as_deref() {
            Some(&[mode]) if (0.0..=7.0).contains(&mode) && mode.fract() == 0.0 => {
                self.gs.text.render_mode = mode as u8;
            }
            _ => {
                // Unknown or unreadable rendering mode: prevent deleting glyphs.
                self.gs.text.render_mode = 0xFF;
            }
        }
    }

    /// `Tj`, `TJ`, `'` and `"`: show text, deleting glyphs outside.
    ///
    /// `'` and `"` first move to the next line (and `"` sets word and
    /// character spacing), so their replacement repeats those steps before
    /// the `TJ`: `T* [...] TJ` and `aw Tw ac Tc T* [...] TJ`, with `aw` and
    /// `ac` copied byte for byte from the stream.
    fn show(&mut self, op: &Operation) {
        let name = op.operator.as_slice();
        let (prefix, shown): (Vec<u8>, &Operand) = match (name, op.operands.as_slice()) {
            (b"Tj" | b"TJ", [shown]) => (Vec::new(), shown),
            (b"'", [shown]) => (b"T* ".to_vec(), shown),
            (b"\"", [Operand::Number(aw), Operand::Number(ac), shown]) => {
                self.gs.text.word_spacing = *aw;
                self.gs.text.char_spacing = *ac;
                let mut prefix = self.src[op.operand_spans[0].clone()].to_vec();
                prefix.extend_from_slice(b" Tw ");
                prefix.extend_from_slice(&self.src[op.operand_spans[1].clone()]);
                prefix.extend_from_slice(b" Tc T* ");
                (prefix, shown)
            }
            _ => {
                // Malformed: what a reader makes of it is unknown.
                if name == b"\"" {
                    self.gs.text.word_spacing = f64::NAN;
                    self.gs.text.char_spacing = f64::NAN;
                }
                self.result.report.text_kept_unmeasured += 1;
                self.text.position_known = false;
                return;
            }
        };
        if name == b"'" || name == b"\"" {
            self.next_line();
        }
        let elements: Option<Vec<ShowElement>> = match (name, shown) {
            (b"TJ", Operand::Array(items)) => items
                .iter()
                .map(|item| match item {
                    Operand::String(s) => Some(ShowElement::Text(s)),
                    Operand::Number(n) => Some(ShowElement::Adjust(*n)),
                    _ => None,
                })
                .collect(),
            (b"Tj" | b"'" | b"\"", Operand::String(s)) => Some(vec![ShowElement::Text(s)]),
            _ => None,
        };
        let outcome = match (&elements, &self.gs.font, self.text.position_known) {
            (Some(elements), FontLookup::Measured(font), true) => split_show(
                elements,
                font,
                &self.gs.text,
                &self.gs.stroke,
                &self.text.matrix,
                &self.gs.ctm,
                &self.crop,
            ),
            _ => ShowOutcome::Unmeasured,
        };
        match outcome {
            ShowOutcome::Unmeasured => {
                self.result.report.text_kept_unmeasured += 1;
                self.text.position_known = false;
            }
            ShowOutcome::Measured {
                advance,
                removed,
                drift,
                replacement,
            } => {
                self.text.matrix = Matrix::translate(advance, 0.0).then(&self.text.matrix);
                self.text.line_drift += drift;
                let shift = &mut self.result.report.max_text_shift;
                *shift = shift.max(self.text.line_drift);
                if let Some(array) = replacement {
                    let mut bytes = prefix;
                    bytes.extend_from_slice(&array);
                    bytes.extend_from_slice(b" TJ");
                    self.result
                        .edits
                        .push(Edit::replace(op.span.clone(), bytes));
                    self.result.report.glyphs_removed += removed;
                }
            }
        }
    }

    /// `Do`: draw an image or form XObject.
    fn draw_xobject(&mut self, op: &Operation) {
        let Some(name) = op.operands.first().and_then(Operand::as_name) else {
            return;
        };
        match self.ctx.xobject(name) {
            Some(XObject::Image) => self.place_image(op),
            Some(XObject::Form { bbox, matrix }) => {
                let form_ctm = matrix.then(&self.gs.ctm);
                match bbox.transform(&form_ctm).placement_in(&self.crop) {
                    Placement::Outside => {
                        self.result.edits.push(Edit::remove(op.span.clone()));
                        self.result.report.forms_removed += 1;
                    }
                    Placement::Crossing => {
                        let name = name.to_vec();
                        if let Some(new_name) =
                            self.ctx
                                .trim_form(&name, &form_ctm, &self.gs.stroke, &mut self.result.report)
                        {
                            self.result.edits.push(Edit::replace(
                                op.operand_spans[0].clone(),
                                name_token(&new_name),
                            ));
                            self.result.report.forms_trimmed += 1;
                        }
                    }
                    Placement::Inside => {}
                }
            }
            Some(XObject::Other) | None => {}
        }
    }

    /// `BI ... EI`: an inline image, placed like an image XObject.
    fn draw_inline_image(&mut self, op: &Operation) {
        self.place_image(op);
    }

    /// Delete an image (filling the unit square of the CTM) that lies
    /// outside; count one that crosses the edge.
    fn place_image(&mut self, op: &Operation) {
        let unit_square = Rect::new(0.0, 0.0, 1.0, 1.0);
        match unit_square.transform(&self.gs.ctm).placement_in(&self.crop) {
            Placement::Outside => {
                self.result.edits.push(Edit::remove(op.span.clone()));
                self.result.report.images_removed += 1;
            }
            Placement::Crossing => self.result.report.images_kept_crossing += 1,
            Placement::Inside => {}
        }
    }
}

/// The single number operand of `op`, or infinity (an unknown line width
/// or miter limit makes every stroke "reach" everywhere, so it is kept).
fn number_or_infinite(op: &Operation) -> f64 {
    op.numbers(1).map_or(f64::INFINITY, |n| n[0])
}

/// The single number operand of `op`, or NaN (an unknown spacing makes
/// every later glyph position unknown, so nothing more is deleted).
fn number_or_nan(op: &Operation) -> f64 {
    op.numbers(1).map_or(f64::NAN, |n| n[0])
}

/// A name as a content-stream token: `/` and the name, with bytes outside
/// the regular printable range written as `#xx`.
pub fn name_token(name: &[u8]) -> Vec<u8> {
    let mut out = vec![b'/'];
    for &b in name {
        let plain =
            (b'!'..=b'~').contains(&b) && !crate::content::lexer::is_delimiter(b) && b != b'#';
        if plain {
            out.push(b);
        } else {
            out.extend(format!("#{b:02X}").bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::rewrite::apply_edits;
    use std::collections::HashMap;

    /// Resources for tests: fonts F1 (every glyph 0.5 em) and F2
    /// (unmeasurable), image Im1, form Fm1 (a 100 x 100 box), state GS1.
    #[derive(Default)]
    struct FakeContext {
        trimmed: Vec<(Vec<u8>, Matrix, StrokeStyle)>,
        states: HashMap<Vec<u8>, ExtGState>,
    }

    impl ContentContext for FakeContext {
        fn font(&mut self, name: &[u8]) -> FontLookup {
            match name {
                b"F1" => FontLookup::Measured(Rc::new(FontMetrics::simple(
                    [Some(500.0); 256],
                    0.001,
                    None,
                ))),
                b"F3" => FontLookup::Measured(Rc::new(FontMetrics::simple(
                    [Some(500.5); 256],
                    0.001,
                    None,
                ))),
                _ => FontLookup::Unmeasurable,
            }
        }
        fn ext_gstate(&mut self, name: &[u8]) -> Option<ExtGState> {
            self.states.get(name).cloned()
        }
        fn xobject(&mut self, name: &[u8]) -> Option<XObject> {
            match name {
                b"Im1" => Some(XObject::Image),
                b"Fm1" => Some(XObject::Form {
                    bbox: Rect::new(0.0, 0.0, 100.0, 100.0),
                    matrix: Matrix::IDENTITY,
                }),
                b"PS1" => Some(XObject::Other),
                _ => None,
            }
        }
        fn trim_form(
            &mut self,
            name: &[u8],
            ctm: &Matrix,
            stroke: &StrokeStyle,
            report: &mut CropReport,
        ) -> Option<Vec<u8>> {
            self.trimmed.push((name.to_vec(), *ctm, *stroke));
            report.glyphs_removed += 1;
            Some(b"Fm1 copy".to_vec())
        }
    }

    /// The crop used by every test: x 100..300, y 100..300.
    fn crop() -> Rect {
        Rect::new(100.0, 100.0, 300.0, 300.0)
    }

    fn run(src: &[u8]) -> (Vec<u8>, CropReport) {
        run_with(src, &mut FakeContext::default())
    }

    fn run_with(src: &[u8], ctx: &mut FakeContext) -> (Vec<u8>, CropReport) {
        let result =
            clip_content(src, &crop(), Matrix::IDENTITY, StrokeStyle::default(), ctx).unwrap();
        (apply_edits(src, result.edits).unwrap(), result.report)
    }

    fn squash(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn deletes_glyphs_outside_and_keeps_the_rest_in_place() {
        // 20 pt glyphs are 10 pt wide; the text starts at x = 60.
        let (out, report) = run(b"BT /F1 20 Tf 60 200 Td (abcdefgh) Tj ET");
        assert_eq!(
            squash(&out),
            "BT /F1 20 Tf 60 200 Td [-1500 <6465666768>] TJ ET"
        );
        assert_eq!(report.glyphs_removed, 3);
    }

    #[test]
    fn keeps_text_in_unmeasurable_fonts_and_counts_it() {
        let (out, report) = run(b"BT /F2 20 Tf 0 0 Td (abc) Tj ET");
        assert_eq!(squash(&out), "BT /F2 20 Tf 0 0 Td (abc) Tj ET");
        assert_eq!(report.text_kept_unmeasured, 1);
    }

    #[test]
    fn position_is_unknown_after_unmeasured_text_until_the_next_line_move() {
        let src = b"BT /F2 20 Tf 0 200 Td (x) Tj /F1 20 Tf (abc) Tj 0 0 Td (abc) Tj ET";
        let (out, report) = run(src);
        assert_eq!(report.text_kept_unmeasured, 2);
        assert!(squash(&out).ends_with("0 0 Td [-1500] TJ ET"));
    }

    #[test]
    fn an_unreadable_line_move_poisons_later_relative_moves() {
        // "1 Td" is malformed; the following Td is relative to an unknown
        // line, so nothing on it may be deleted. Tm sets it again.
        let src = b"BT /F1 20 Tf 1 Td 0 200 Td (abc) Tj T* (abc) Tj 1 0 0 1 0 200 Tm (abc) Tj ET";
        let (_, report) = run(src);
        assert_eq!(report.text_kept_unmeasured, 2);
        assert_eq!(report.glyphs_removed, 3);
    }

    #[test]
    fn t_star_recovers_after_unmeasured_text() {
        let src = b"BT /F2 20 Tf 12 TL 0 212 Td (x) Tj /F1 20 Tf T* (abc) Tj ET";
        let (_, report) = run(src);
        assert_eq!(report.glyphs_removed, 3);
    }

    #[test]
    fn drift_is_reported_per_line() {
        // Widths 500.5: each deleted glyph may drift 0.0005 em in readers
        // that truncate widths; 3 glyphs at 20 pt = 0.03 pt, twice on the
        // same line (two Tj), then reset by Td.
        let mut ctx = FakeContext::default();
        let src = b"BT /F3 20 Tf 0 200 Td (abc) Tj (abc) Tj 0 10 Td (abc) Tj ET";
        let result =
            clip_content(src, &crop(), Matrix::IDENTITY, StrokeStyle::default(), &mut ctx).unwrap();
        assert!((result.report.max_text_shift - 0.06).abs() < 1e-9);
    }

    #[test]
    fn tm_tz_tc_tw_ts_and_tl_are_followed() {
        let src = b"BT /F1 10 Tf 200 Tz 1 Tc 2 Tw 3 Ts 12 TL 1 0 0 1 0 200 Tm T* (a) Tj ET";
        let (out, report) = run(src);
        assert_eq!(report.glyphs_removed, 1);
        // n = -(500 + 1000 * 1 / 10) = -600
        assert!(squash(&out).contains("[-600] TJ"));
    }

    #[test]
    fn quote_operators_keep_their_line_move_and_spacing() {
        let (out, _) = run(b"BT /F1 20 Tf 12 TL 0 212 Td (ab) ' ET");
        assert!(squash(&out).contains("T* [-1000] TJ"));
        let (out, _) = run(b"BT /F1 20 Tf 12 TL 0 212 Td 1.5 0 (ab) \" ET");
        assert!(squash(&out).contains("1.5 Tw 0 Tc T* [-1000] TJ"));
    }

    #[test]
    fn malformed_show_operators_are_kept() {
        let (out, report) = run(b"BT /F1 20 Tf 0 0 Td 1 Tj (a) (b) \" ET");
        assert_eq!(squash(&out), "BT /F1 20 Tf 0 0 Td 1 Tj (a) (b) \" ET");
        assert_eq!(report.text_kept_unmeasured, 2);
    }

    #[test]
    fn graphics_state_is_saved_and_restored() {
        // Inside q/Q the CTM moves text into the crop; after Q it is outside.
        let src =
            b"q 1 0 0 1 150 0 cm BT /F1 20 Tf 0 200 Td (a) Tj ET Q BT /F1 20 Tf 0 200 Td (a) Tj ET";
        let (_, report) = run(src);
        assert_eq!(report.glyphs_removed, 1);
        // An unmatched Q is ignored.
        let (_, report) = run(b"Q Q BT /F1 20 Tf 0 200 Td (a) Tj ET");
        assert_eq!(report.glyphs_removed, 1);
    }

    #[test]
    fn unreadable_cm_stops_all_editing() {
        let (out, report) = run(b"1 0 0 cm 0 0 10 10 re f");
        assert_eq!(squash(&out), "1 0 0 cm 0 0 10 10 re f");
        assert_eq!(report.streams_partly_analysed, 1);
    }

    #[test]
    fn deletes_paths_outside_and_keeps_clips() {
        let (out, report) = run(b"0 0 10 10 re f 150 150 10 10 re f 0 0 10 10 re W n");
        assert_eq!(squash(&out), "150 150 10 10 re f 0 0 10 10 re W n");
        assert_eq!(report.paths_removed, 1);
    }

    #[test]
    fn line_width_and_ext_gstate_widen_strokes() {
        // The line ends 8 pt left of the crop: a 2 pt stroke (reach 11)
        // crosses, a 1 pt stroke with miter limit 1 (reach 1.5) does not.
        let (_, report) = run(b"2 w 0 150 m 92 150 l S");
        assert_eq!(report.paths_removed, 0);
        let mut ctx = FakeContext::default();
        ctx.states.insert(
            b"GS1".to_vec(),
            ExtGState {
                line_width: Some(1.0),
                miter_limit: Some(1.0),
                font: None,
            },
        );
        let (_, report) = run_with(b"/GS1 gs 0 150 m 92 150 l S", &mut ctx);
        assert_eq!(report.paths_removed, 1);
        let (_, report) = run(b"/Nope gs 1 0 w 0 150 m 92 150 l S");
        assert_eq!(report.paths_removed, 0);
    }

    #[test]
    fn ext_gstate_can_set_the_font() {
        let mut ctx = FakeContext::default();
        let f1 = ctx.font(b"F1");
        ctx.states.insert(
            b"GS1".to_vec(),
            ExtGState {
                font: Some((f1, 20.0)),
                ..ExtGState::default()
            },
        );
        let (_, report) = run_with(b"BT /GS1 gs 0 200 Td (a) Tj ET", &mut ctx);
        assert_eq!(report.glyphs_removed, 1);
    }

    #[test]
    fn an_interrupted_path_is_never_deleted() {
        let (out, report) = run(b"0 0 m 1 0 0 rg 10 10 l f");
        assert_eq!(report.paths_removed, 0);
        assert_eq!(squash(&out), "0 0 m 1 0 0 rg 10 10 l f");
    }

    #[test]
    fn images_outside_are_deleted_and_crossing_ones_counted() {
        let src = b"q 50 0 0 50 0 0 cm /Im1 Do Q q 50 0 0 50 80 150 cm /Im1 Do Q q 50 0 0 50 150 150 cm /Im1 Do Q";
        let (out, report) = run(src);
        assert_eq!(report.images_removed, 1);
        assert_eq!(report.images_kept_crossing, 1);
        assert!(!squash(&out).contains("0 0 cm /Im1 Do"));
    }

    #[test]
    fn inline_images_outside_are_deleted() {
        let (out, report) = run(b"q 10 0 0 10 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI Q");
        assert_eq!(squash(&out), "q 10 0 0 10 0 0 cm Q");
        assert_eq!(report.images_removed, 1);
    }

    #[test]
    fn forms_are_deleted_kept_or_trimmed() {
        let mut ctx = FakeContext::default();
        // Outside, crossing, inside (the box at the identity would only
        // touch the crop's edge, which counts as outside).
        let src = b"q 1 0 0 1 -200 0 cm /Fm1 Do Q q 1 0 0 1 50 50 cm /Fm1 Do Q \
                    q 1 0 0 1 150 150 cm /Fm1 Do Q /PS1 Do /Missing Do";
        let (out, report) = run_with(src, &mut ctx);
        assert_eq!(
            squash(&out),
            "q 1 0 0 1 -200 0 cm Q q 1 0 0 1 50 50 cm /Fm1#20copy Do Q \
             q 1 0 0 1 150 150 cm /Fm1 Do Q /PS1 Do /Missing Do"
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        );
        assert_eq!(report.forms_removed, 1);
        assert_eq!(report.forms_trimmed, 1);
        // The trimmed form's own counts are merged in.
        assert_eq!(report.glyphs_removed, 1);
        assert_eq!(
            ctx.trimmed,
            vec![(
                b"Fm1".to_vec(),
                Matrix::translate(50.0, 50.0),
                StrokeStyle::default()
            )]
        );
    }

    #[test]
    fn forms_inherit_caller_stroke_style() {
        // When the caller sets a line width of 20 before drawing a form,
        // the form trimmer must inherit that stroke style.
        let mut ctx = FakeContext::default();
        let src = b"20 w q 1 0 0 1 50 50 cm /Fm1 Do Q";
        let (_, report) = run_with(src, &mut ctx);
        assert_eq!(report.forms_trimmed, 1);
        assert_eq!(ctx.trimmed.len(), 1);
        assert_eq!(ctx.trimmed[0].2.line_width, 20.0);
    }

    #[test]
    fn text_rendering_mode_tr_is_tracked() {
        // Mode 1 strokes text; with a wide stroke, text outside the crop box reaches into it
        // and is kept.
        let src = b"20 w BT /F1 20 Tf 1 Tr 80 200 Td (a) Tj ET";
        let (_, report) = run(src);
        assert_eq!(report.glyphs_removed, 0);

        // Mode 0 fills text; without stroke widening, glyph at 80 is outside crop [100..300]
        // and is removed.
        let src_fill = b"20 w BT /F1 20 Tf 0 Tr 80 200 Td (a) Tj ET";
        let (_, report_fill) = run(src_fill);
        assert_eq!(report_fill.glyphs_removed, 1);

        // Mode 4 adds text to clipping path; clipping text is never removed even outside.
        let src_clip = b"BT /F1 20 Tf 4 Tr 0 0 Td (a) Tj ET";
        let (_, report_clip) = run(src_clip);
        assert_eq!(report_clip.glyphs_removed, 0);
    }

    #[test]
    fn unparseable_streams_are_an_error() {
        assert!(clip_content(
            b"(unterminated",
            &crop(),
            Matrix::IDENTITY,
            StrokeStyle::default(),
            &mut FakeContext::default()
        )
        .is_err());
    }

    #[test]
    fn very_deep_q_nesting_stops_editing() {
        let mut src = b"q ".repeat(MAX_STATE_DEPTH + 1);
        src.extend_from_slice(b"0 0 10 10 re f");
        let (_, report) = run(&src);
        assert_eq!(report.paths_removed, 0);
        assert_eq!(report.streams_partly_analysed, 1);
    }

    #[test]
    fn number_or_infinite_and_nan() {
        let ops = parse_operations(b"2 w /x w").unwrap();
        assert_eq!(number_or_infinite(&ops[0]), 2.0);
        assert!(number_or_infinite(&ops[1]).is_infinite());
        assert_eq!(number_or_nan(&ops[0]), 2.0);
        assert!(number_or_nan(&ops[1]).is_nan());
    }

    #[test]
    fn name_token_escapes_special_bytes() {
        assert_eq!(name_token(b"Fm1"), b"/Fm1");
        assert_eq!(name_token(b"a b/#"), b"/a#20b#2F#23");
    }
}
