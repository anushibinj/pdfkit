//! Wire-format plan decoder and validator for `pdf-redact`.
//!
//! The sanitization plan crosses from JavaScript to WebAssembly as a compact
//! little-endian binary buffer so no JSON parser dependency is needed inside
//! the WASM binary:
//!
//! ```text
//! [ version: u32 ]
//! [ flags: u32 ]              bit 0 = clean_metadata
//!                             bit 1 = clean_attachments
//!                             bit 2 = clean_javascript
//!                             bit 3 = clean_hidden_layers
//!                             bit 4 = clean_bookmarks
//! [ replacement_len: u32 ] [ replacement_utf8: [u8; replacement_len] ]
//! [ term_count: u32 ]      followed by term_count x (len: u32, utf8_bytes)
//! [ box_count: u32 ]       followed by box_count x (page_index: u32, left: f64, bottom: f64, right: f64, top: f64)
//! ```

use crate::error::RedactError;

/// Current binary plan ABI version.
pub const PLAN_VERSION: u32 = 1;

/// Flag bit enabling metadata (Info + XMP + Thumb + PieceInfo + StructTree leaks) cleanup.
pub const FLAG_CLEAN_METADATA: u32 = 1 << 0;
/// Flag bit enabling embedded attachment cleanup.
pub const FLAG_CLEAN_ATTACHMENTS: u32 = 1 << 1;
/// Flag bit enabling JavaScript action cleanup.
pub const FLAG_CLEAN_JAVASCRIPT: u32 = 1 << 2;
/// Flag bit enabling hidden layer (OCG) cleanup.
pub const FLAG_CLEAN_HIDDEN_LAYERS: u32 = 1 << 3;
/// Flag bit enabling bookmark title scrubbing.
pub const FLAG_CLEAN_BOOKMARKS: u32 = 1 << 4;

/// Maximum number of terms accepted in a single plan to prevent unbounded allocations.
const MAX_TERMS: usize = 50_000;
/// Maximum number of boxes accepted in a single plan.
const MAX_BOXES: usize = 50_000;
/// Maximum byte length of a single string field.
const MAX_STRING_BYTES: usize = 1_048_576;

/// One redaction rectangle on a page in PDF user-space coordinates (points).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageRedactionBox {
    /// Zero-based page index.
    pub page_index: u32,
    pub left: f64,
    pub bottom: f64,
    pub right: f64,
    pub top: f64,
}

impl PageRedactionBox {
    /// Returns `true` when `other` intersects or touches this redaction box.
    pub fn overlaps(&self, left: f64, bottom: f64, right: f64, top: f64) -> bool {
        let (l1, r1) = if self.left <= self.right {
            (self.left, self.right)
        } else {
            (self.right, self.left)
        };
        let (b1, t1) = if self.bottom <= self.top {
            (self.bottom, self.top)
        } else {
            (self.top, self.bottom)
        };
        let (l2, r2) = if left <= right {
            (left, right)
        } else {
            (right, left)
        };
        let (b2, t2) = if bottom <= top {
            (bottom, top)
        } else {
            (top, bottom)
        };
        r1 >= l2 && r2 >= l1 && t1 >= b2 && t2 >= b1
    }
}

/// Validated sanitization plan decoded from the worker payload.
#[derive(Debug, Clone, PartialEq)]
pub struct SanitizePlan {
    pub clean_metadata: bool,
    pub clean_attachments: bool,
    pub clean_javascript: bool,
    pub clean_hidden_layers: bool,
    pub clean_bookmarks: bool,
    pub replacement_label: String,
    pub terms: Vec<String>,
    pub boxes: Vec<PageRedactionBox>,
}

impl SanitizePlan {
    /// Decodes and validates a binary [`SanitizePlan`] buffer.
    ///
    /// # Errors
    ///
    /// Returns [`RedactError::InvalidPlan`] when the buffer is truncated, has
    /// trailing bytes, uses an unsupported version, or contains invalid UTF-8
    /// or non-finite box coordinates.
    pub fn decode(bytes: &[u8]) -> Result<Self, RedactError> {
        let mut cursor = Cursor::new(bytes);
        let version = cursor.read_u32()?;
        if version != PLAN_VERSION {
            return Err(RedactError::InvalidPlan(format!(
                "unsupported plan version {version}"
            )));
        }
        let flags = cursor.read_u32()?;
        let replacement_label = cursor.read_string()?;

        let term_count = cursor.read_u32()? as usize;
        if term_count > MAX_TERMS {
            return Err(RedactError::InvalidPlan("too many terms".into()));
        }
        let mut terms = Vec::with_capacity(term_count);
        for _ in 0..term_count {
            let term = cursor.read_string()?;
            if !term.is_empty() {
                terms.push(term);
            }
        }

        let box_count = cursor.read_u32()? as usize;
        if box_count > MAX_BOXES {
            return Err(RedactError::InvalidPlan("too many boxes".into()));
        }
        let mut boxes = Vec::with_capacity(box_count);
        for _ in 0..box_count {
            let page_index = cursor.read_u32()?;
            let left = cursor.read_f64()?;
            let bottom = cursor.read_f64()?;
            let right = cursor.read_f64()?;
            let top = cursor.read_f64()?;
            if ![left, bottom, right, top].iter().all(|v| v.is_finite()) {
                return Err(RedactError::InvalidPlan(
                    "redaction box coordinate is not finite".into(),
                ));
            }
            boxes.push(PageRedactionBox {
                page_index,
                left: left.min(right),
                bottom: bottom.min(top),
                right: left.max(right),
                top: bottom.max(top),
            });
        }

        if cursor.remaining() != 0 {
            return Err(RedactError::InvalidPlan(
                "unexpected trailing bytes in plan".into(),
            ));
        }

        Ok(SanitizePlan {
            clean_metadata: flags & FLAG_CLEAN_METADATA != 0,
            clean_attachments: flags & FLAG_CLEAN_ATTACHMENTS != 0,
            clean_javascript: flags & FLAG_CLEAN_JAVASCRIPT != 0,
            clean_hidden_layers: flags & FLAG_CLEAN_HIDDEN_LAYERS != 0,
            clean_bookmarks: flags & FLAG_CLEAN_BOOKMARKS != 0,
            replacement_label: if replacement_label.is_empty() {
                "[REDACTED]".to_string()
            } else {
                replacement_label
            },
            terms,
            boxes,
        })
    }

    /// Encodes this plan into the binary wire format (inverse of [`Self::decode`]).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut flags = 0u32;
        if self.clean_metadata {
            flags |= FLAG_CLEAN_METADATA;
        }
        if self.clean_attachments {
            flags |= FLAG_CLEAN_ATTACHMENTS;
        }
        if self.clean_javascript {
            flags |= FLAG_CLEAN_JAVASCRIPT;
        }
        if self.clean_hidden_layers {
            flags |= FLAG_CLEAN_HIDDEN_LAYERS;
        }
        if self.clean_bookmarks {
            flags |= FLAG_CLEAN_BOOKMARKS;
        }
        out.extend_from_slice(&PLAN_VERSION.to_le_bytes());
        out.extend_from_slice(&flags.to_le_bytes());
        write_str(&mut out, &self.replacement_label);
        out.extend_from_slice(&(self.terms.len() as u32).to_le_bytes());
        for term in &self.terms {
            write_str(&mut out, term);
        }
        out.extend_from_slice(&(self.boxes.len() as u32).to_le_bytes());
        for b in &self.boxes {
            out.extend_from_slice(&b.page_index.to_le_bytes());
            out.extend_from_slice(&b.left.to_le_bytes());
            out.extend_from_slice(&b.bottom.to_le_bytes());
            out.extend_from_slice(&b.right.to_le_bytes());
            out.extend_from_slice(&b.top.to_le_bytes());
        }
        out
    }
}

fn write_str(out: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], RedactError> {
        if self.remaining() < n {
            return Err(RedactError::InvalidPlan(
                "unexpected end of plan buffer".into(),
            ));
        }
        let slice = &self.bytes[self.offset..self.offset + n];
        self.offset += n;
        Ok(slice)
    }

    fn read_u32(&mut self) -> Result<u32, RedactError> {
        let mut buf = [0u8; 4];
        buf.copy_from_slice(self.take(4)?);
        Ok(u32::from_le_bytes(buf))
    }

    fn read_f64(&mut self) -> Result<f64, RedactError> {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(self.take(8)?);
        Ok(f64::from_le_bytes(buf))
    }

    fn read_string(&mut self) -> Result<String, RedactError> {
        let len = self.read_u32()? as usize;
        if len > MAX_STRING_BYTES {
            return Err(RedactError::InvalidPlan("string field too large".into()));
        }
        let raw = self.take(len)?;
        std::str::from_utf8(raw)
            .map(ToString::to_string)
            .map_err(|_| RedactError::InvalidPlan("invalid UTF-8 string in plan".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan() -> SanitizePlan {
        SanitizePlan {
            clean_metadata: true,
            clean_attachments: true,
            clean_javascript: false,
            clean_hidden_layers: true,
            clean_bookmarks: true,
            replacement_label: "REDACTED".into(),
            terms: vec!["alice@example.com".into(), "4111-1111".into()],
            boxes: vec![PageRedactionBox {
                page_index: 0,
                left: 10.0,
                bottom: 20.0,
                right: 110.0,
                top: 40.0,
            }],
        }
    }

    #[test]
    fn encode_and_decode_round_trip() {
        let plan = sample_plan();
        let bytes = plan.encode();
        assert_eq!(SanitizePlan::decode(&bytes), Ok(plan));
    }

    #[test]
    fn decode_defaults_empty_label_and_normalises_box() {
        let mut plan = sample_plan();
        plan.replacement_label = String::new();
        plan.boxes[0] = PageRedactionBox {
            page_index: 1,
            left: 100.0,
            bottom: 50.0,
            right: 20.0,
            top: 10.0,
        };
        let decoded = SanitizePlan::decode(&plan.encode()).unwrap();
        assert_eq!(decoded.replacement_label, "[REDACTED]");
        assert_eq!(
            decoded.boxes[0],
            PageRedactionBox {
                page_index: 1,
                left: 20.0,
                bottom: 10.0,
                right: 100.0,
                top: 50.0,
            }
        );
    }

    #[test]
    fn decode_rejects_bad_version_nan_and_trailing_bytes() {
        assert!(matches!(
            SanitizePlan::decode(&[]),
            Err(RedactError::InvalidPlan(_))
        ));

        let mut bad_ver = sample_plan().encode();
        bad_ver[0] = 99;
        assert!(matches!(
            SanitizePlan::decode(&bad_ver),
            Err(RedactError::InvalidPlan(_))
        ));

        let mut trailing = sample_plan().encode();
        trailing.push(0);
        assert!(matches!(
            SanitizePlan::decode(&trailing),
            Err(RedactError::InvalidPlan(_))
        ));

        let mut nan_plan = sample_plan();
        nan_plan.boxes[0].left = f64::NAN;
        assert!(matches!(
            SanitizePlan::decode(&nan_plan.encode()),
            Err(RedactError::InvalidPlan(_))
        ));
    }

    #[test]
    fn page_redaction_box_overlaps_checks_intersection() {
        let b = PageRedactionBox {
            page_index: 0,
            left: 10.0,
            bottom: 20.0,
            right: 50.0,
            top: 60.0,
        };
        assert!(b.overlaps(40.0, 50.0, 70.0, 80.0));
        assert!(b.overlaps(50.0, 20.0, 60.0, 30.0));
        assert!(!b.overlaps(51.0, 20.0, 80.0, 60.0));
        assert!(!b.overlaps(10.0, 61.0, 50.0, 80.0));
    }
}
