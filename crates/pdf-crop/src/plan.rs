//! What to crop: the plan the browser sends, and its wire format.
//!
//! The plan crosses from JavaScript into WebAssembly as a flat array of
//! little-endian 64-bit floats (a `Float64Array`'s bytes), which needs no
//! JSON parser in the module:
//!
//! ```text
//! [ version, flags, count, (pageIndex, left, bottom, right, top) x count ]
//! ```
//!
//! - `version` is [`PLAN_VERSION`];
//! - bit 0 of `flags` asks to remove the content outside the crop area;
//! - each page entry is a 0-based page index and the crop rectangle in that
//!   page's user space (PDF points, y pointing up).

use crate::error::CropError;
use crate::geometry::Rect;

/// The wire format version this module reads.
pub const PLAN_VERSION: f64 = 1.0;
/// Flag bit: delete what lies outside the crop area instead of only hiding it.
pub const FLAG_REMOVE_OUTSIDE: u32 = 1;
/// Numbers per page entry in the wire format.
const ENTRY_LEN: usize = 5;
/// Numbers before the first page entry.
const HEADER_LEN: usize = 3;
/// Largest coordinate accepted, in points (well beyond PDF's 14,400 limit).
pub const MAX_COORDINATE: f64 = 1_000_000.0;
/// Most pages one plan may name.
pub const MAX_PAGES: usize = 100_000;

/// The crop for one page.
#[derive(Debug, Clone, PartialEq)]
pub struct PageCrop {
    /// 0-based page index.
    pub page_index: u32,
    /// The area to keep, in the page's user space.
    pub rect: Rect,
}

/// Everything the crop needs to know.
#[derive(Debug, Clone, PartialEq)]
pub struct CropPlan {
    /// Delete the content outside the crop area (otherwise only hide it).
    pub remove_outside: bool,
    /// One entry per page to crop, in ascending page order, no repeats.
    pub pages: Vec<PageCrop>,
}

impl CropPlan {
    /// Read and validate a plan from its wire format (see the module docs).
    ///
    /// Every number is checked before use: the bytes come from another
    /// thread and could be anything. Pages are returned sorted by index.
    ///
    /// # Errors
    ///
    /// [`CropError::InvalidPlan`] when the bytes are not a whole number of
    /// floats, the header or a page entry is malformed, a page repeats, or
    /// a rectangle is not finite, too large or has no area.
    pub fn decode(bytes: &[u8]) -> Result<CropPlan, CropError> {
        let invalid = |why: &str| CropError::InvalidPlan(why.to_string());
        if !bytes.len().is_multiple_of(8) {
            return Err(invalid("the plan is not a list of numbers"));
        }
        let numbers: Vec<f64> = bytes
            .chunks_exact(8)
            .map(|chunk| {
                let mut word = [0u8; 8];
                word.copy_from_slice(chunk);
                f64::from_le_bytes(word)
            })
            .collect();
        let [version, flags, count, entries @ ..] = numbers.as_slice() else {
            return Err(invalid("the plan is too short"));
        };
        if *version != PLAN_VERSION {
            return Err(invalid("unsupported plan version"));
        }
        let flags = whole_number(*flags, u32::MAX as f64).ok_or_else(|| invalid("bad flags"))?;
        let count = whole_number(*count, MAX_PAGES as f64)
            .ok_or_else(|| invalid("bad page count"))? as usize;
        if count == 0 {
            return Err(invalid("no pages to crop"));
        }
        if numbers.len() != HEADER_LEN + count * ENTRY_LEN {
            return Err(invalid("the page count does not match the entries"));
        }
        let mut pages = entries
            .chunks_exact(ENTRY_LEN)
            .map(decode_entry)
            .collect::<Result<Vec<_>, _>>()?;
        pages.sort_by_key(|p| p.page_index);
        if pages.windows(2).any(|w| w[0].page_index == w[1].page_index) {
            return Err(invalid("a page is listed twice"));
        }
        Ok(CropPlan {
            remove_outside: (flags as u32) & FLAG_REMOVE_OUTSIDE != 0,
            pages,
        })
    }

    /// Write the plan in its wire format (the inverse of [`decode`]).
    ///
    /// [`decode`]: CropPlan::decode
    pub fn encode(&self) -> Vec<u8> {
        let flags = if self.remove_outside {
            FLAG_REMOVE_OUTSIDE
        } else {
            0
        };
        let mut numbers = vec![PLAN_VERSION, flags as f64, self.pages.len() as f64];
        for page in &self.pages {
            numbers.push(page.page_index as f64);
            numbers.extend(page.rect.to_array());
        }
        numbers.iter().flat_map(|n| n.to_le_bytes()).collect()
    }
}

/// Read one page entry: index, then the rectangle.
fn decode_entry(entry: &[f64]) -> Result<PageCrop, CropError> {
    let invalid = |why: &str| CropError::InvalidPlan(why.to_string());
    let page_index =
        whole_number(entry[0], u32::MAX as f64).ok_or_else(|| invalid("bad page index"))? as u32;
    let coords = &entry[1..ENTRY_LEN];
    if coords
        .iter()
        .any(|c| !c.is_finite() || c.abs() > MAX_COORDINATE)
    {
        return Err(invalid("a crop rectangle has an unusable coordinate"));
    }
    let rect = Rect::new(coords[0], coords[1], coords[2], coords[3]);
    if rect.width() <= 0.0 || rect.height() <= 0.0 {
        return Err(invalid("a crop rectangle has no area"));
    }
    Ok(PageCrop { page_index, rect })
}

/// `value` as a whole number in `0..=max`, or `None`.
fn whole_number(value: f64, max: f64) -> Option<f64> {
    (value.is_finite() && value >= 0.0 && value <= max && value.fract() == 0.0).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(numbers: &[f64]) -> Vec<u8> {
        numbers.iter().flat_map(|n| n.to_le_bytes()).collect()
    }

    fn plan() -> CropPlan {
        CropPlan {
            remove_outside: true,
            pages: vec![
                PageCrop {
                    page_index: 0,
                    rect: Rect::new(10.0, 20.0, 300.0, 400.0),
                },
                PageCrop {
                    page_index: 3,
                    rect: Rect::new(0.0, 0.0, 50.0, 60.0),
                },
            ],
        }
    }

    #[test]
    fn encode_and_decode_round_trip() {
        assert_eq!(CropPlan::decode(&plan().encode()), Ok(plan()));
        let hidden = CropPlan {
            remove_outside: false,
            ..plan()
        };
        assert_eq!(CropPlan::decode(&hidden.encode()), Ok(hidden));
    }

    #[test]
    fn decode_sorts_pages_and_normalises_rects() {
        let plan = CropPlan::decode(&bytes(&[
            1.0, 0.0, 2.0, 5.0, 100.0, 100.0, 0.0, 0.0, 1.0, 0.0, 0.0, 10.0, 10.0,
        ]))
        .unwrap();
        assert_eq!(plan.pages[0].page_index, 1);
        assert_eq!(plan.pages[1].rect, Rect::new(0.0, 0.0, 100.0, 100.0));
    }

    #[test]
    fn decode_rejects_malformed_plans() {
        let cases: &[&[f64]] = &[
            &[],
            &[2.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0],
            &[1.0, -1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0],
            &[1.0, 0.0, 0.0],
            &[1.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0, 1.0],
            &[1.0, 0.0, 1.0, 0.5, 0.0, 0.0, 1.0, 1.0],
            &[1.0, 0.0, 1.0, 0.0, 0.0, 0.0, f64::NAN, 1.0],
            &[1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2e6, 1.0],
            &[1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            &[
                1.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0,
            ],
        ];
        for case in cases {
            assert!(
                matches!(
                    CropPlan::decode(&bytes(case)),
                    Err(CropError::InvalidPlan(_))
                ),
                "{case:?} should be rejected"
            );
        }
        assert!(CropPlan::decode(&[1, 2, 3]).is_err());
    }

    #[test]
    fn decode_entry_reads_index_and_rect() {
        let entry = decode_entry(&[2.0, 5.0, 6.0, 1.0, 2.0]).unwrap();
        assert_eq!(entry.page_index, 2);
        assert_eq!(entry.rect, Rect::new(1.0, 2.0, 5.0, 6.0));
        assert!(decode_entry(&[-1.0, 0.0, 0.0, 1.0, 1.0]).is_err());
    }

    #[test]
    fn whole_number_accepts_only_integers_in_range() {
        assert_eq!(whole_number(3.0, 10.0), Some(3.0));
        assert_eq!(whole_number(3.5, 10.0), None);
        assert_eq!(whole_number(-1.0, 10.0), None);
        assert_eq!(whole_number(11.0, 10.0), None);
        assert_eq!(whole_number(f64::INFINITY, f64::MAX), None);
    }
}
