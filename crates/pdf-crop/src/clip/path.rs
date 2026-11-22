//! Following path construction to decide whether a painted path can be
//! seen at all.
//!
//! A path is built by construction operators (`m l c v y h re`) and ends
//! with one painting operator (`S s f F f* B B* b b* n`), optionally just
//! after a clipping operator (`W W*`). The whole run, construction to
//! painting, can be deleted without any other effect when:
//! - the path is painted (not `n`) and does not clip (no `W`): a clip
//!   changes what later content shows, wherever the clip itself lies;
//! - every point (curve control points included: a Bézier curve lies within
//!   the hull of its control points) is known;
//! - the bounding box, widened by how far a stroke can reach, lies entirely
//!   outside the crop area.

use std::ops::Range;

use crate::geometry::{Matrix, Placement, Rect};

/// Operators that build a path.
pub fn is_construction(op: &[u8]) -> bool {
    matches!(op, b"m" | b"l" | b"c" | b"v" | b"y" | b"h" | b"re")
}

/// Operators that end a path by painting it (or, `n`, by discarding it).
pub fn is_painting(op: &[u8]) -> bool {
    matches!(
        op,
        b"S" | b"s" | b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*" | b"n"
    )
}

/// Painting operators that stroke the outline.
fn strokes(op: &[u8]) -> bool {
    matches!(op, b"S" | b"s" | b"B" | b"B*" | b"b" | b"b*")
}

/// The stroke style in effect when a path is painted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StrokeStyle {
    /// Line width in user space (`w`); infinite when unknown.
    pub line_width: f64,
    /// Miter limit (`M`); infinite when unknown.
    pub miter_limit: f64,
}

impl StrokeStyle {
    /// How far, in page space, a stroke can reach beyond the path itself.
    ///
    /// Half the line width, scaled by the CTM, times the miter limit (a
    /// miter join can stick out up to `miterLimit * width / 2` from its
    /// corner), plus one point of slack. A line width of 0 means "thinnest
    /// visible line", counted as one point. Unknown values are infinite,
    /// which makes the path "crossing" and keeps it.
    pub fn reach(&self, ctm: &Matrix) -> f64 {
        let width = (self.line_width.max(0.0) * ctm.max_scale()).max(1.0);
        width * self.miter_limit.max(1.0) / 2.0 + 1.0
    }
}

/// The path being built.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PathTracker {
    /// Where the first construction operator starts, while a path is open.
    start: Option<usize>,
    /// Bounding box of every point so far, in page space.
    bbox: Option<Rect>,
    /// A `W` or `W*` was seen.
    clips: bool,
    /// An operand could not be read: the path's extent is unknown.
    unknown: bool,
}

impl PathTracker {
    /// Record one construction operator.
    ///
    /// - `span_start`: where the operation starts in the stream.
    /// - `op`, `operands`: the operator and its numbers (`None` when an
    ///   operand is not a number).
    /// - `ctm`: transforms the points to page space.
    pub fn construct(
        &mut self,
        span_start: usize,
        op: &[u8],
        operands: Option<Vec<f64>>,
        ctm: &Matrix,
    ) {
        self.start.get_or_insert(span_start);
        let Some(values) = operands else {
            self.unknown = true;
            return;
        };
        let points: Vec<(f64, f64)> = match (op, values.as_slice()) {
            (b"m" | b"l", [x, y]) => vec![(*x, *y)],
            (b"c", [x1, y1, x2, y2, x3, y3]) => vec![(*x1, *y1), (*x2, *y2), (*x3, *y3)],
            (b"v" | b"y", [x1, y1, x2, y2]) => vec![(*x1, *y1), (*x2, *y2)],
            (b"re", [x, y, w, h]) => vec![(*x, *y), (x + w, *y), (x + w, y + h), (*x, y + h)],
            (b"h", []) => vec![],
            _ => {
                self.unknown = true;
                return;
            }
        };
        for (x, y) in points {
            let (px, py) = ctm.apply(x, y);
            self.bbox = Some(match self.bbox {
                Some(b) => b.including(px, py),
                None => Rect::new(px, py, px, py),
            });
        }
    }

    /// Record `W` or `W*`.
    pub fn clip(&mut self) {
        self.clips = true;
    }

    /// Whether a path is being built.
    pub fn is_open(&self) -> bool {
        self.start.is_some()
    }

    /// Finish the path with painting operator `op`, whose operation ends at
    /// `span_end`. Returns the byte range to delete when the painted path
    /// cannot be seen (see the module docs); the tracker is reset either
    /// way.
    pub fn finish(
        &mut self,
        op: &[u8],
        span_end: usize,
        style: &StrokeStyle,
        ctm: &Matrix,
        crop: &Rect,
    ) -> Option<Range<usize>> {
        let path = std::mem::take(self);
        let start = path.start?;
        if path.unknown || path.clips || op == b"n" {
            return None;
        }
        let mut bbox = path.bbox?;
        if strokes(op) {
            bbox = bbox.expand(style.reach(ctm));
        }
        (bbox.placement_in(crop) == Placement::Outside).then_some(start..span_end)
    }

    /// Another operator came in while a path was being built (malformed,
    /// but readers tolerate it and keep building the same path). The open
    /// path is marked as unknown, so it is never deleted, and stays open so
    /// that its later construction operators and its painting operator
    /// still belong to it. Without a path open this does nothing.
    pub fn interrupt(&mut self) {
        if self.is_open() {
            self.unknown = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STYLE: StrokeStyle = StrokeStyle {
        line_width: 1.0,
        miter_limit: 10.0,
    };

    fn crop() -> Rect {
        Rect::new(100.0, 100.0, 200.0, 200.0)
    }

    fn tracker_with(points: &[(&[u8], &[f64])]) -> PathTracker {
        let mut t = PathTracker::default();
        for (i, (op, nums)) in points.iter().enumerate() {
            t.construct(i * 10, op, Some(nums.to_vec()), &Matrix::IDENTITY);
        }
        t
    }

    #[test]
    fn operator_families() {
        assert!(is_construction(b"re") && is_construction(b"h"));
        assert!(!is_construction(b"S"));
        assert!(is_painting(b"f*") && is_painting(b"n"));
        assert!(!is_painting(b"W"));
        assert!(strokes(b"b*") && !strokes(b"f"));
    }

    #[test]
    fn reach_scales_with_width_ctm_and_miter_limit() {
        let scale2 = Matrix::new(2.0, 0.0, 0.0, 2.0, 0.0, 0.0);
        assert_eq!(STYLE.reach(&scale2), 2.0 * 10.0 / 2.0 + 1.0);
        let hairline = StrokeStyle {
            line_width: 0.0,
            miter_limit: 1.0,
        };
        assert_eq!(hairline.reach(&Matrix::IDENTITY), 1.5);
        let unknown = StrokeStyle {
            line_width: f64::INFINITY,
            ..STYLE
        };
        assert!(unknown.reach(&Matrix::IDENTITY).is_infinite());
    }

    #[test]
    fn filled_path_outside_is_deleted() {
        let mut t = tracker_with(&[(b"re", &[0.0, 0.0, 50.0, 50.0])]);
        assert!(t.is_open());
        assert_eq!(
            t.finish(b"f", 99, &STYLE, &Matrix::IDENTITY, &crop()),
            Some(0..99)
        );
        assert!(!t.is_open());
    }

    #[test]
    fn path_crossing_or_inside_is_kept() {
        let mut t = tracker_with(&[(b"m", &[50.0, 150.0]), (b"l", &[150.0, 150.0])]);
        assert_eq!(t.finish(b"S", 30, &STYLE, &Matrix::IDENTITY, &crop()), None);
        let mut t = tracker_with(&[(b"re", &[120.0, 120.0, 10.0, 10.0])]);
        assert_eq!(t.finish(b"f", 30, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn stroke_reach_can_make_a_path_cross() {
        // Filled, the rectangle ends at x = 95, outside; stroked with
        // width 1 and miter limit 10 it reaches 6 further, into the crop.
        let mut t = tracker_with(&[(b"re", &[0.0, 120.0, 95.0, 10.0])]);
        assert_eq!(
            t.clone()
                .finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()),
            Some(0..9)
        );
        assert_eq!(t.finish(b"S", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn curve_control_points_count() {
        // The end points are outside, a control point is inside: the curve
        // may bulge into the crop, so it is kept.
        let mut t = tracker_with(&[
            (b"m", &[0.0, 0.0]),
            (b"c", &[150.0, 150.0, 0.0, 0.0, 10.0, 0.0]),
        ]);
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn v_and_y_curves_are_tracked() {
        let mut t = tracker_with(&[
            (b"m", &[0.0, 0.0]),
            (b"v", &[10.0, 10.0, 20.0, 0.0]),
            (b"y", &[30.0, 10.0, 40.0, 0.0]),
            (b"h", &[]),
        ]);
        assert_eq!(
            t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()),
            Some(0..9)
        );
    }

    #[test]
    fn clipping_paths_and_n_are_kept() {
        let mut t = tracker_with(&[(b"re", &[0.0, 0.0, 10.0, 10.0])]);
        t.clip();
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
        let mut t = tracker_with(&[(b"re", &[0.0, 0.0, 10.0, 10.0])]);
        assert_eq!(t.finish(b"n", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn unreadable_operands_keep_the_path() {
        let mut t = PathTracker::default();
        t.construct(0, b"m", None, &Matrix::IDENTITY);
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
        let mut t = PathTracker::default();
        t.construct(0, b"l", Some(vec![1.0]), &Matrix::IDENTITY);
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn points_are_transformed_by_the_ctm() {
        let mut t = PathTracker::default();
        t.construct(
            0,
            b"re",
            Some(vec![0.0, 0.0, 10.0, 10.0]),
            &Matrix::translate(150.0, 150.0),
        );
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn finish_without_a_path_does_nothing() {
        let mut t = PathTracker::default();
        assert_eq!(t.finish(b"f", 9, &STYLE, &Matrix::IDENTITY, &crop()), None);
    }

    #[test]
    fn interrupt_keeps_the_path_open_but_never_deleted() {
        let mut t = tracker_with(&[(b"re", &[0.0, 0.0, 10.0, 10.0])]);
        t.interrupt();
        assert!(t.is_open());
        t.construct(50, b"l", Some(vec![5.0, 5.0]), &Matrix::IDENTITY);
        assert_eq!(t.finish(b"f", 60, &STYLE, &Matrix::IDENTITY, &crop()), None);
        assert!(!t.is_open());
        let mut idle = PathTracker::default();
        idle.interrupt();
        assert!(!idle.is_open());
    }
}
