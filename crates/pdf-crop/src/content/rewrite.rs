//! Applies byte-range replacements to a content stream.

use std::ops::Range;

/// Replace `range` of the source with `replacement` (empty to delete).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub range: Range<usize>,
    pub replacement: Vec<u8>,
}

impl Edit {
    /// Delete a range.
    pub fn remove(range: Range<usize>) -> Edit {
        Edit {
            range,
            replacement: Vec::new(),
        }
    }

    /// Replace a range.
    pub fn replace(range: Range<usize>, replacement: Vec<u8>) -> Edit {
        Edit { range, replacement }
    }
}

/// Edits that cannot be applied together.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlappingEdits;

/// Build the edited stream: every byte outside the edited ranges is copied
/// unchanged, in order.
///
/// Each replacement is written with a space on both sides. Spans cover
/// tokens exactly, so without that padding deleting `S` from `Q S q`'s
/// neighbourhood in a stream written without spaces (`Q<path S>q`) could
/// glue the neighbours into one unknown word, `Qq`. White space between
/// tokens never changes their meaning, so the padding is always safe.
///
/// # Errors
///
/// [`OverlappingEdits`] when two ranges overlap or a range lies outside the
/// source: that is a bug in the caller, and writing anything would be wrong.
pub fn apply_edits(source: &[u8], mut edits: Vec<Edit>) -> Result<Vec<u8>, OverlappingEdits> {
    edits.sort_by_key(|e| (e.range.start, e.range.end));
    let mut out = Vec::with_capacity(source.len());
    let mut cursor = 0;
    for edit in &edits {
        if edit.range.start < cursor
            || edit.range.end > source.len()
            || edit.range.start > edit.range.end
        {
            return Err(OverlappingEdits);
        }
        out.extend_from_slice(&source[cursor..edit.range.start]);
        out.push(b' ');
        out.extend_from_slice(&edit.replacement);
        out.push(b' ');
        cursor = edit.range.end;
    }
    out.extend_from_slice(&source[cursor..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remove_and_replace_constructors() {
        assert_eq!(
            Edit::remove(1..3),
            Edit {
                range: 1..3,
                replacement: vec![]
            }
        );
        assert_eq!(Edit::replace(0..1, b"x".to_vec()).replacement, b"x");
    }

    #[test]
    fn apply_edits_copies_everything_else_verbatim() {
        let src = b"q 0 0 m 9 9 l S Q (keep) Tj";
        let out = apply_edits(src, vec![Edit::remove(2..15)]).unwrap();
        // The original spaces on either side, plus the two padding spaces.
        assert_eq!(out, b"q    Q (keep) Tj");
    }

    #[test]
    fn apply_edits_pads_so_neighbours_never_merge() {
        let out = apply_edits(b"Q0 0 m 1 1 l Sq", vec![Edit::remove(1..14)]).unwrap();
        assert_eq!(out, b"Q  q");
    }

    #[test]
    fn apply_edits_handles_unsorted_edits() {
        let out = apply_edits(
            b"abcdef",
            vec![
                Edit::replace(4..5, b"E".to_vec()),
                Edit::replace(0..1, b"A".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(out, b" A bcd E f");
    }

    #[test]
    fn apply_edits_rejects_overlaps_and_out_of_range() {
        assert_eq!(
            apply_edits(b"abcdef", vec![Edit::remove(0..3), Edit::remove(2..4)]),
            Err(OverlappingEdits)
        );
        assert_eq!(
            apply_edits(b"abc", vec![Edit::remove(2..9)]),
            Err(OverlappingEdits)
        );
    }

    #[test]
    fn apply_edits_without_edits_returns_source() {
        assert_eq!(apply_edits(b"q Q", vec![]).unwrap(), b"q Q");
    }
}
