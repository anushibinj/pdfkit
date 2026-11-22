//! Rectangles and affine transforms in PDF user space.
//!
//! PDF writes points as row vectors and transforms as 3x3 matrices whose
//! last column is fixed to (0, 0, 1), stored as the six numbers
//! `[a b c d e f]`:
//!
//! ```text
//!             | a b 0 |
//! [x' y' 1] = [x y 1] | c d 0 |   so   x' = a*x + c*y + e
//!             | e f 1 |                y' = b*x + d*y + f
//! ```
//!
//! With row vectors, "apply `m` first, then `n`" is the product `m × n`
//! (the left matrix acts first). That is exactly how the `cm` operator
//! works: `m cm` makes the new CTM `m × CTM`.

/// An axis-aligned rectangle in user space, always normalised so that
/// `left <= right` and `bottom <= top`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    /// Smallest x.
    pub left: f64,
    /// Smallest y.
    pub bottom: f64,
    /// Largest x.
    pub right: f64,
    /// Largest y.
    pub top: f64,
}

/// Where something lies relative to the crop area.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    /// Entirely within the crop area (edges included).
    Inside,
    /// Shares no area with the crop area: nothing of it can be seen.
    Outside,
    /// Partly inside and partly outside.
    Crossing,
}

impl Rect {
    /// Build a rectangle from two opposite corners, in any order.
    ///
    /// PDF allows boxes such as `[612 792 0 0]` (corners swapped), which mean
    /// the same as `[0 0 612 792]`; normalising here means no other code has
    /// to care.
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Rect {
        Rect {
            left: min_nan(x0, x1),
            bottom: min_nan(y0, y1),
            right: max_nan(x0, x1),
            top: max_nan(y0, y1),
        }
    }

    /// The smallest rectangle containing every point, or `None` for no
    /// points.
    pub fn from_points(points: impl IntoIterator<Item = (f64, f64)>) -> Option<Rect> {
        let mut points = points.into_iter();
        let (x, y) = points.next()?;
        let mut rect = Rect::new(x, y, x, y);
        for (x, y) in points {
            rect = rect.including(x, y);
        }
        Some(rect)
    }

    /// This rectangle grown just enough to contain the point `(x, y)`.
    pub fn including(&self, x: f64, y: f64) -> Rect {
        Rect {
            left: min_nan(self.left, x),
            bottom: min_nan(self.bottom, y),
            right: max_nan(self.right, x),
            top: max_nan(self.top, y),
        }
    }

    /// The smallest rectangle containing both rectangles.
    pub fn union(&self, other: &Rect) -> Rect {
        Rect {
            left: min_nan(self.left, other.left),
            bottom: min_nan(self.bottom, other.bottom),
            right: max_nan(self.right, other.right),
            top: max_nan(self.top, other.top),
        }
    }

    /// Width (never negative).
    pub fn width(&self) -> f64 {
        self.right - self.left
    }

    /// Height (never negative).
    pub fn height(&self) -> f64 {
        self.top - self.bottom
    }

    /// True when every coordinate is a finite number.
    pub fn is_finite(&self) -> bool {
        self.left.is_finite()
            && self.bottom.is_finite()
            && self.right.is_finite()
            && self.top.is_finite()
    }

    /// The overlap of two rectangles, or `None` when they share no area
    /// (touching edges do not count: a zero-width sliver shows nothing).
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let rect = Rect {
            left: self.left.max(other.left),
            bottom: self.bottom.max(other.bottom),
            right: self.right.min(other.right),
            top: self.top.min(other.top),
        };
        (rect.left < rect.right && rect.bottom < rect.top).then_some(rect)
    }

    /// This rectangle grown by `margin` on every side.
    pub fn expand(&self, margin: f64) -> Rect {
        Rect::new(
            self.left - margin,
            self.bottom - margin,
            self.right + margin,
            self.top + margin,
        )
    }

    /// The bounding box of this rectangle after transforming it.
    ///
    /// A rotated or skewed rectangle is no longer axis-aligned, so all four
    /// corners are transformed and the box around them is returned. That
    /// box contains every point of the transformed rectangle (an affine
    /// map sends the rectangle to a parallelogram whose corners are the
    /// transformed corners), which is what "could anything be visible?"
    /// questions need.
    pub fn transform(&self, m: &Matrix) -> Rect {
        let corners = [
            m.apply(self.left, self.bottom),
            m.apply(self.right, self.bottom),
            m.apply(self.right, self.top),
            m.apply(self.left, self.top),
        ];
        // Four points are always present, so the fallback is unreachable.
        Rect::from_points(corners).unwrap_or(*self)
    }

    /// Classify this rectangle against the crop area.
    ///
    /// - `Outside` when the two share no area at all, including when they
    ///   only touch along an edge: nothing of this rectangle can show.
    /// - `Inside` when this rectangle lies within `crop`, edges included.
    /// - `Crossing` otherwise.
    ///
    /// A rectangle with a non-finite coordinate is reported as `Crossing`:
    /// it cannot be placed, so it must neither be removed nor be assumed
    /// to be fully visible.
    pub fn placement_in(&self, crop: &Rect) -> Placement {
        if !self.is_finite() {
            return Placement::Crossing;
        }
        if self.right <= crop.left
            || self.left >= crop.right
            || self.top <= crop.bottom
            || self.bottom >= crop.top
        {
            return Placement::Outside;
        }
        if self.left >= crop.left
            && self.right <= crop.right
            && self.bottom >= crop.bottom
            && self.top <= crop.top
        {
            return Placement::Inside;
        }
        Placement::Crossing
    }

    /// The rectangle as a PDF array `[left bottom right top]`.
    pub fn to_array(&self) -> [f64; 4] {
        [self.left, self.bottom, self.right, self.top]
    }
}

/// The smaller of two numbers, or NaN if either is NaN.
///
/// `f64::min` returns the other argument when one is NaN, which would let a
/// NaN coordinate (e.g. from `inf * 0` on a hostile file) vanish and make
/// an unplaceable object look placeable. Propagating NaN keeps it visible
/// to [`Rect::is_finite`].
pub fn min_nan(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

/// The larger of two numbers, or NaN if either is NaN (see [`min_nan`]).
pub fn max_nan(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// A 2D affine transform in PDF order `[a b c d e f]` (see the module docs).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    /// The transform that changes nothing.
    pub const IDENTITY: Matrix = Matrix::new(1.0, 0.0, 0.0, 1.0, 0.0, 0.0);

    /// A matrix from its six PDF numbers.
    pub const fn new(a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) -> Matrix {
        Matrix { a, b, c, d, e, f }
    }

    /// A pure move by `(tx, ty)`.
    pub const fn translate(tx: f64, ty: f64) -> Matrix {
        Matrix::new(1.0, 0.0, 0.0, 1.0, tx, ty)
    }

    /// A matrix from a slice of exactly six numbers, or `None`.
    pub fn from_slice(values: &[f64]) -> Option<Matrix> {
        match values {
            [a, b, c, d, e, f] => Some(Matrix::new(*a, *b, *c, *d, *e, *f)),
            _ => None,
        }
    }

    /// Apply `self` first, then `outer`: the row-vector product
    /// `self × outer`.
    ///
    /// Multiplying the 3x3 forms out (the fixed last column drops out):
    ///
    /// ```text
    /// a = a1*a2 + b1*c2         b = a1*b2 + b1*d2
    /// c = c1*a2 + d1*c2         d = c1*b2 + d1*d2
    /// e = e1*a2 + f1*c2 + e2    f = e1*b2 + f1*d2 + f2
    /// ```
    pub fn then(&self, outer: &Matrix) -> Matrix {
        let (m, n) = (self, outer);
        Matrix::new(
            m.a * n.a + m.b * n.c,
            m.a * n.b + m.b * n.d,
            m.c * n.a + m.d * n.c,
            m.c * n.b + m.d * n.d,
            m.e * n.a + m.f * n.c + n.e,
            m.e * n.b + m.f * n.d + n.f,
        )
    }

    /// Transform a point.
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }

    /// True when all six numbers are finite.
    pub fn is_finite(&self) -> bool {
        [self.a, self.b, self.c, self.d, self.e, self.f]
            .iter()
            .all(|v| v.is_finite())
    }

    /// The longest distance a unit step along either axis can become, an
    /// upper bound for how much the transform stretches a line width.
    pub fn max_scale(&self) -> f64 {
        self.a.hypot(self.b).max(self.c.hypot(self.d))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop() -> Rect {
        Rect::new(100.0, 100.0, 300.0, 200.0)
    }

    #[test]
    fn new_normalises_swapped_corners() {
        assert_eq!(
            Rect::new(612.0, 792.0, 0.0, 0.0),
            Rect::new(0.0, 0.0, 612.0, 792.0)
        );
    }

    #[test]
    fn from_points_bounds_all_points() {
        let r = Rect::from_points([(5.0, 1.0), (-2.0, 7.0), (3.0, -4.0)]).unwrap();
        assert_eq!(r, Rect::new(-2.0, -4.0, 5.0, 7.0));
        assert!(Rect::from_points(std::iter::empty()).is_none());
    }

    #[test]
    fn including_grows_only_as_needed() {
        let r = Rect::new(0.0, 0.0, 10.0, 10.0);
        assert_eq!(r.including(5.0, 5.0), r);
        assert_eq!(r.including(-1.0, 12.0), Rect::new(-1.0, 0.0, 10.0, 12.0));
    }

    #[test]
    fn union_covers_both() {
        let a = Rect::new(0.0, 0.0, 1.0, 1.0);
        let b = Rect::new(2.0, -1.0, 3.0, 0.5);
        assert_eq!(a.union(&b), Rect::new(0.0, -1.0, 3.0, 1.0));
    }

    #[test]
    fn width_and_height() {
        let r = Rect::new(1.0, 2.0, 4.0, 8.0);
        assert_eq!((r.width(), r.height()), (3.0, 6.0));
    }

    #[test]
    fn is_finite_rejects_nan_and_infinity() {
        assert!(crop().is_finite());
        assert!(!Rect::new(f64::NAN, 0.0, 1.0, 1.0).is_finite());
        assert!(!Rect::new(0.0, 0.0, f64::INFINITY, 1.0).is_finite());
    }

    #[test]
    fn intersect_returns_overlap_or_none() {
        let overlap = crop().intersect(&Rect::new(250.0, 150.0, 400.0, 400.0));
        assert_eq!(overlap, Some(Rect::new(250.0, 150.0, 300.0, 200.0)));
        // Touching along an edge is not an overlap.
        assert_eq!(
            crop().intersect(&Rect::new(300.0, 100.0, 400.0, 200.0)),
            None
        );
        assert_eq!(crop().intersect(&Rect::new(0.0, 0.0, 10.0, 10.0)), None);
    }

    #[test]
    fn expand_grows_every_side() {
        assert_eq!(
            Rect::new(0.0, 0.0, 10.0, 10.0).expand(2.0),
            Rect::new(-2.0, -2.0, 12.0, 12.0)
        );
    }

    #[test]
    fn transform_bounds_a_rotated_rectangle() {
        // 90 degrees counter-clockwise: (x, y) -> (-y, x).
        let rotate = Matrix::new(0.0, 1.0, -1.0, 0.0, 0.0, 0.0);
        let r = Rect::new(0.0, 0.0, 10.0, 20.0).transform(&rotate);
        assert_eq!(r, Rect::new(-20.0, 0.0, 0.0, 10.0));
    }

    #[test]
    fn placement_classifies_inside_outside_and_crossing() {
        let c = crop();
        assert_eq!(
            Rect::new(150.0, 120.0, 160.0, 130.0).placement_in(&c),
            Placement::Inside
        );
        assert_eq!(c.placement_in(&c), Placement::Inside);
        assert_eq!(
            Rect::new(0.0, 0.0, 50.0, 50.0).placement_in(&c),
            Placement::Outside
        );
        // Touching the edge from outside shows nothing.
        assert_eq!(
            Rect::new(0.0, 100.0, 100.0, 200.0).placement_in(&c),
            Placement::Outside
        );
        assert_eq!(
            Rect::new(90.0, 150.0, 110.0, 160.0).placement_in(&c),
            Placement::Crossing
        );
        assert_eq!(
            Rect::new(f64::NAN, 0.0, 1.0, 1.0).placement_in(&c),
            Placement::Crossing
        );
    }

    #[test]
    fn to_array_is_left_bottom_right_top() {
        assert_eq!(crop().to_array(), [100.0, 100.0, 300.0, 200.0]);
    }

    #[test]
    fn min_and_max_nan_propagate_nan() {
        assert_eq!(min_nan(1.0, 2.0), 1.0);
        assert_eq!(max_nan(1.0, 2.0), 2.0);
        assert!(min_nan(f64::NAN, 2.0).is_nan());
        assert!(max_nan(1.0, f64::NAN).is_nan());
    }

    #[test]
    fn nan_survives_rect_operations() {
        assert!(!Rect::new(f64::NAN, 0.0, 1.0, 1.0).is_finite());
        assert!(!crop().including(f64::NAN, 0.0).is_finite());
        assert!(!crop()
            .union(&Rect::new(0.0, f64::NAN, 1.0, 1.0))
            .is_finite());
        let poisoned = Matrix::new(f64::INFINITY, 0.0, 0.0, 1.0, 0.0, 0.0);
        // inf * 0 = NaN for the corner at x = 0.
        assert!(!Rect::new(0.0, 0.0, 1.0, 1.0)
            .transform(&poisoned)
            .is_finite());
    }

    #[test]
    fn translate_moves_points() {
        assert_eq!(Matrix::translate(3.0, -2.0).apply(1.0, 1.0), (4.0, -1.0));
    }

    #[test]
    fn from_slice_needs_six_numbers() {
        assert_eq!(
            Matrix::from_slice(&[1.0, 0.0, 0.0, 1.0, 5.0, 6.0]),
            Some(Matrix::translate(5.0, 6.0))
        );
        assert_eq!(Matrix::from_slice(&[1.0, 2.0]), None);
    }

    #[test]
    fn then_applies_self_first() {
        // Scale by 2, then move by (10, 0): (1, 1) -> (2, 2) -> (12, 2).
        let scale = Matrix::new(2.0, 0.0, 0.0, 2.0, 0.0, 0.0);
        let m = scale.then(&Matrix::translate(10.0, 0.0));
        assert_eq!(m.apply(1.0, 1.0), (12.0, 2.0));
        // The other order moves first: (1, 1) -> (11, 1) -> (22, 2).
        let m = Matrix::translate(10.0, 0.0).then(&scale);
        assert_eq!(m.apply(1.0, 1.0), (22.0, 2.0));
    }

    #[test]
    fn identity_changes_nothing() {
        let m = Matrix::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0);
        assert_eq!(m.then(&Matrix::IDENTITY), m);
        assert_eq!(Matrix::IDENTITY.then(&m), m);
    }

    #[test]
    fn apply_uses_pdf_order() {
        let m = Matrix::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0);
        // x' = 1*1 + 3*1 + 5, y' = 2*1 + 4*1 + 6
        assert_eq!(m.apply(1.0, 1.0), (9.0, 12.0));
    }

    #[test]
    fn is_finite_checks_all_numbers() {
        assert!(Matrix::IDENTITY.is_finite());
        assert!(!Matrix::new(1.0, 0.0, 0.0, f64::NAN, 0.0, 0.0).is_finite());
    }

    #[test]
    fn max_scale_is_longest_axis() {
        assert_eq!(Matrix::new(3.0, 4.0, 0.0, 2.0, 9.0, 9.0).max_scale(), 5.0);
    }
}
