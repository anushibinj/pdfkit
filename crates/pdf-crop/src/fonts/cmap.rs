//! Embedded CMaps of composite (Type 0) fonts: how a string's bytes split
//! into character codes, and which glyph (CID) each code selects.

use std::collections::HashMap;

use crate::content::lexer::{tokenize, TokenKind};

/// Longest character code PDF allows, in bytes.
const MAX_CODE_LEN: usize = 4;
/// Most CID mappings read from one CMap (a defence against huge inputs).
const MAX_MAPPINGS: usize = 200_000;

/// One `begincodespacerange` entry: codes of `len` bytes whose every byte
/// lies between the matching bytes of `low` and `high`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CodespaceRange {
    len: usize,
    low: [u8; MAX_CODE_LEN],
    high: [u8; MAX_CODE_LEN],
}

impl CodespaceRange {
    /// Whether the first `len` bytes of `bytes` form a code in this range.
    fn matches(&self, bytes: &[u8]) -> bool {
        bytes.len() >= self.len
            && (0..self.len).all(|i| self.low[i] <= bytes[i] && bytes[i] <= self.high[i])
    }
}

/// One `begincidrange` entry: codes `low..=high` of `len` bytes map to
/// consecutive CIDs from `first_cid`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CidRange {
    len: usize,
    low: u32,
    high: u32,
    first_cid: u32,
}

/// A parsed CMap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CMap {
    codespace: Vec<CodespaceRange>,
    ranges: Vec<CidRange>,
    /// `begincidchar` entries by (length, code); the first entry wins.
    chars: HashMap<(usize, u32), u32>,
}

impl CMap {
    /// The CMap the predefined `Identity-H` name stands for: two-byte codes,
    /// each code is its own CID.
    pub fn identity() -> CMap {
        CMap {
            codespace: vec![CodespaceRange {
                len: 2,
                low: [0, 0, 0, 0],
                high: [0xFF, 0xFF, 0, 0],
            }],
            ranges: vec![CidRange {
                len: 2,
                low: 0,
                high: 0xFFFF,
                first_cid: 0,
            }],
            chars: HashMap::new(),
        }
    }

    /// Parse an embedded CMap stream.
    ///
    /// Reads `begincodespacerange`, `begincidrange` and `begincidchar`
    /// sections. Returns `None` when the CMap cannot be used to measure
    /// text:
    /// - it writes vertically (`/WMode 1`): glyphs then advance downwards,
    ///   which this module does not model;
    /// - it builds on another CMap (`usecmap`) other than `Identity-H`,
    ///   whose ranges are not in the file;
    /// - it has no code space ranges (its own or inherited), or cannot be
    ///   tokenised.
    pub fn parse(src: &[u8]) -> Option<CMap> {
        CMap::parse_with_base(src, false)
    }

    /// [`CMap::parse`] for a CMap whose stream dictionary names
    /// `Identity-H` as `/UseCMap` (when `identity_base` is true).
    ///
    /// The base is merged after parsing, behind the CMap's own entries:
    /// lookups take the first matching range, so a base merged first would
    /// shadow every range of the CMap itself.
    pub fn parse_with_base(src: &[u8], identity_base: bool) -> Option<CMap> {
        let tokens = tokenize(src).ok()?;
        let kinds: Vec<&TokenKind> = tokens.iter().map(|t| &t.kind).collect();
        let mut cmap = CMap {
            codespace: Vec::new(),
            ranges: Vec::new(),
            chars: HashMap::new(),
        };
        let mut uses_identity = identity_base;
        let mut i = 0;
        while i < kinds.len() {
            match kinds[i] {
                TokenKind::Name(n) if n == b"WMode" => {
                    if matches!(kinds.get(i + 1), Some(TokenKind::Number(v)) if *v != 0.0) {
                        return None;
                    }
                }
                TokenKind::Keyword(k) if k == b"usecmap" => {
                    match i.checked_sub(1).and_then(|j| kinds.get(j)) {
                        Some(TokenKind::Name(n)) if n == b"Identity-H" => uses_identity = true,
                        _ => return None,
                    }
                }
                TokenKind::Keyword(k) if k == b"begincodespacerange" => {
                    i = cmap.read_section(&kinds, i + 1, b"endcodespacerange", 2, |cmap, e| {
                        cmap.add_codespace(e[0], e[1])
                    })?;
                }
                TokenKind::Keyword(k) if k == b"begincidrange" => {
                    i = cmap.read_section(&kinds, i + 1, b"endcidrange", 3, |cmap, e| {
                        cmap.add_cid_range(e[0], e[1], e[2])
                    })?;
                }
                TokenKind::Keyword(k) if k == b"begincidchar" => {
                    i = cmap.read_section(&kinds, i + 1, b"endcidchar", 2, |cmap, e| {
                        cmap.add_cid_char(e[0], e[1])
                    })?;
                }
                _ => {}
            }
            i += 1;
        }
        if uses_identity {
            cmap = cmap.with_identity_base();
        }
        (!cmap.codespace.is_empty()).then_some(cmap)
    }

    /// Read the entries of one section, `width` tokens each, until `end`.
    /// Returns the index of the `end` keyword.
    fn read_section(
        &mut self,
        kinds: &[&TokenKind],
        mut i: usize,
        end: &[u8],
        width: usize,
        mut add: impl FnMut(&mut CMap, &[&TokenKind]) -> Option<()>,
    ) -> Option<usize> {
        loop {
            match kinds.get(i)? {
                TokenKind::Keyword(k) if k == end => return Some(i),
                _ => {
                    let entry = kinds.get(i..i + width)?;
                    add(self, entry)?;
                    if self.ranges.len() + self.chars.len() > MAX_MAPPINGS {
                        return None;
                    }
                    i += width;
                }
            }
        }
    }

    /// Add a code space range from two hex strings of equal length.
    fn add_codespace(&mut self, low: &TokenKind, high: &TokenKind) -> Option<()> {
        let (TokenKind::String(low), TokenKind::String(high)) = (low, high) else {
            return None;
        };
        if low.len() != high.len() || low.is_empty() || low.len() > MAX_CODE_LEN {
            return None;
        }
        let mut range = CodespaceRange {
            len: low.len(),
            low: [0; 4],
            high: [0; 4],
        };
        range.low[..low.len()].copy_from_slice(low);
        range.high[..high.len()].copy_from_slice(high);
        self.codespace.push(range);
        Some(())
    }

    /// Add a `<low> <high> cid` mapping.
    fn add_cid_range(&mut self, low: &TokenKind, high: &TokenKind, cid: &TokenKind) -> Option<()> {
        let (TokenKind::String(low), TokenKind::String(high), TokenKind::Number(cid)) =
            (low, high, cid)
        else {
            return None;
        };
        if low.len() != high.len() {
            return None;
        }
        self.ranges.push(CidRange {
            len: low.len(),
            low: code_value(low)?,
            high: code_value(high)?,
            first_cid: cid_value(*cid)?,
        });
        Some(())
    }

    /// Add a `<code> cid` mapping (the first mapping for a code wins).
    fn add_cid_char(&mut self, code: &TokenKind, cid: &TokenKind) -> Option<()> {
        let (TokenKind::String(code), TokenKind::Number(cid)) = (code, cid) else {
            return None;
        };
        let key = (code.len(), code_value(code)?);
        let cid = cid_value(*cid)?;
        self.chars.entry(key).or_insert(cid);
        Some(())
    }

    /// This CMap built on `Identity-H` (its `/UseCMap`): Identity-H's
    /// two-byte code space and code = CID mapping are added behind this
    /// CMap's own entries, which keep priority.
    pub fn with_identity_base(mut self) -> CMap {
        let identity = CMap::identity();
        self.codespace.extend(identity.codespace);
        self.ranges.extend(identity.ranges);
        self
    }

    /// The next character code at the start of `bytes`: its length in bytes
    /// and its value.
    ///
    /// Follows ISO 32000-1, 9.7.6.2: take one byte and check it against the
    /// one-byte code space ranges; if none matches, take two bytes and check
    /// the two-byte ranges; and so on up to four. `None` when no range
    /// matches: the bytes are not valid for this CMap, and how readers
    /// recover from that differs, so the text cannot be measured.
    pub fn next_code(&self, bytes: &[u8]) -> Option<(usize, u32)> {
        (1..=MAX_CODE_LEN.min(bytes.len())).find_map(|len| {
            self.codespace
                .iter()
                .any(|r| r.len == len && r.matches(bytes))
                .then(|| (len, code_value(&bytes[..len]).unwrap_or(0)))
        })
    }

    /// The CID of a code: from `cidchar` first, then the first matching
    /// `cidrange`, else 0 (`.notdef`), as the standard prescribes.
    pub fn cid(&self, len: usize, code: u32) -> u32 {
        if let Some(cid) = self.chars.get(&(len, code)) {
            return *cid;
        }
        self.ranges
            .iter()
            .find(|r| r.len == len && r.low <= code && code <= r.high)
            .map_or(0, |r| r.first_cid + (code - r.low))
    }
}

/// A big-endian code value (1 to 4 bytes).
fn code_value(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || bytes.len() > MAX_CODE_LEN {
        return None;
    }
    Some(bytes.iter().fold(0u32, |acc, b| acc << 8 | u32::from(*b)))
}

/// A CID: a whole number in 0..=65535 (larger CIDs do not exist in PDF).
fn cid_value(value: f64) -> Option<u32> {
    (value.fract() == 0.0 && (0.0..=65535.0).contains(&value)).then_some(value as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIFT_JIS_LIKE: &[u8] = b"/CIDInit /ProcSet findresource begin
        12 dict begin begincmap
        /WMode 0 def
        2 begincodespacerange <00> <80> <8140> <9FFC> endcodespacerange
        2 begincidrange <20> <7E> 1 <8140> <817E> 633 endcidrange
        1 begincidchar <41> 500 endcidchar
        endcmap";

    #[test]
    fn identity_is_two_bytes_cid_equals_code() {
        let cmap = CMap::identity();
        assert_eq!(cmap.next_code(&[0x12, 0x34, 0x56]), Some((2, 0x1234)));
        assert_eq!(cmap.next_code(&[0x12]), None);
        assert_eq!(cmap.cid(2, 0x1234), 0x1234);
    }

    #[test]
    fn parse_reads_mixed_length_code_spaces() {
        let cmap = CMap::parse(SHIFT_JIS_LIKE).unwrap();
        assert_eq!(cmap.next_code(b"A\x81\x40"), Some((1, 0x41)));
        assert_eq!(cmap.next_code(b"\x81\x40"), Some((2, 0x8140)));
        assert_eq!(cmap.next_code(b"\xFF\xFF"), None);
    }

    #[test]
    fn cid_prefers_cidchar_then_ranges_then_notdef() {
        let cmap = CMap::parse(SHIFT_JIS_LIKE).unwrap();
        assert_eq!(cmap.cid(1, 0x41), 500); // cidchar wins over the range
        assert_eq!(cmap.cid(1, 0x42), 1 + (0x42 - 0x20));
        assert_eq!(cmap.cid(2, 0x8141), 634);
        assert_eq!(cmap.cid(2, 0x9000), 0);
    }

    #[test]
    fn parse_rejects_vertical_and_unknown_base_cmaps() {
        assert!(
            CMap::parse(b"/WMode 1 def 1 begincodespacerange <00> <FF> endcodespacerange")
                .is_none()
        );
        assert!(CMap::parse(
            b"/UniJIS-UCS2-H usecmap 1 begincodespacerange <00> <FF> endcodespacerange"
        )
        .is_none());
        assert!(CMap::parse(b"begincmap endcmap").is_none());
        assert!(CMap::parse(b"1 begincodespacerange <00> endcodespacerange").is_none());
        assert!(CMap::parse(b"(unterminated").is_none());
    }

    #[test]
    fn parse_accepts_identity_as_base() {
        let cmap = CMap::parse(b"/Identity-H usecmap 1 begincidchar <0005> 9 endcidchar").unwrap();
        assert_eq!(cmap.next_code(&[0, 5]), Some((2, 5)));
        assert_eq!(cmap.cid(2, 5), 9);
        assert_eq!(cmap.cid(2, 6), 6);
    }

    #[test]
    fn own_ranges_win_over_the_identity_base() {
        // usecmap comes first in the stream, but the CMap's own range must
        // still take priority over Identity's catch-all range.
        let cmap =
            CMap::parse(b"/Identity-H usecmap 1 begincidrange <0000> <0005> 100 endcidrange")
                .unwrap();
        assert_eq!(cmap.cid(2, 3), 103);
        assert_eq!(cmap.cid(2, 0x10), 0x10);
    }

    #[test]
    fn parse_with_base_supplies_the_code_space() {
        assert!(CMap::parse(b"1 begincidchar <0001> 5 endcidchar").is_none());
        let cmap = CMap::parse_with_base(b"1 begincidchar <0001> 5 endcidchar", true).unwrap();
        assert_eq!(cmap.cid(2, 1), 5);
    }

    #[test]
    fn with_identity_base_keeps_own_mappings_first() {
        let own = CMap::parse(b"1 begincodespacerange <0000> <00FF> endcodespacerange 1 begincidchar <0001> 77 endcidchar").unwrap();
        let cmap = own.with_identity_base();
        assert_eq!(cmap.cid(2, 1), 77);
        assert_eq!(cmap.next_code(&[0x12, 0x34]), Some((2, 0x1234)));
        assert_eq!(cmap.cid(2, 0x1234), 0x1234);
    }

    #[test]
    fn codespace_range_checks_each_byte() {
        let r = CodespaceRange {
            len: 2,
            low: [0x81, 0x40, 0, 0],
            high: [0x9F, 0xFC, 0, 0],
        };
        assert!(r.matches(&[0x81, 0x40]));
        assert!(!r.matches(&[0x81, 0x30]));
        assert!(!r.matches(&[0x81]));
    }

    #[test]
    fn add_entries_validate_their_operands() {
        let mut cmap = CMap {
            codespace: vec![],
            ranges: vec![],
            chars: HashMap::new(),
        };
        let s = |b: &[u8]| TokenKind::String(b.to_vec());
        assert!(cmap.add_codespace(&s(b"\x00"), &s(b"\xFF\xFF")).is_none());
        assert!(cmap.add_codespace(&s(b""), &s(b"")).is_none());
        assert!(cmap.add_codespace(&s(b"\x00"), &s(b"\xFF")).is_some());
        assert!(cmap
            .add_cid_range(&s(b"\x00"), &s(b"\x00\x01"), &TokenKind::Number(1.0))
            .is_none());
        assert!(cmap
            .add_cid_range(&s(b"\x00"), &s(b"\x01"), &TokenKind::Number(-1.0))
            .is_none());
        assert!(cmap
            .add_cid_char(&s(b"\x00"), &TokenKind::Number(1.5))
            .is_none());
        assert!(cmap
            .add_cid_char(&s(b"\x00"), &TokenKind::Number(7.0))
            .is_some());
        assert!(cmap
            .add_cid_char(&s(b"\x00"), &TokenKind::Number(8.0))
            .is_some());
        assert_eq!(cmap.cid(1, 0), 7);
    }

    #[test]
    fn read_section_stops_at_end_keyword_and_rejects_truncation() {
        let mut cmap = CMap {
            codespace: vec![],
            ranges: vec![],
            chars: HashMap::new(),
        };
        let tokens = tokenize(b"<00> <FF> endcodespacerange").unwrap();
        let kinds: Vec<&TokenKind> = tokens.iter().map(|t| &t.kind).collect();
        let end = cmap.read_section(&kinds, 0, b"endcodespacerange", 2, |c, e| {
            c.add_codespace(e[0], e[1])
        });
        assert_eq!(end, Some(2));
        let tokens = tokenize(b"<00> <FF> <00>").unwrap();
        let kinds: Vec<&TokenKind> = tokens.iter().map(|t| &t.kind).collect();
        let end = cmap.read_section(&kinds, 0, b"endcodespacerange", 2, |c, e| {
            c.add_codespace(e[0], e[1])
        });
        assert_eq!(end, None);
    }

    #[test]
    fn code_value_is_big_endian() {
        assert_eq!(code_value(&[0x12, 0x34]), Some(0x1234));
        assert_eq!(code_value(&[]), None);
        assert_eq!(code_value(&[1, 2, 3, 4, 5]), None);
    }

    #[test]
    fn cid_value_accepts_whole_numbers_in_range() {
        assert_eq!(cid_value(42.0), Some(42));
        assert_eq!(cid_value(65536.0), None);
        assert_eq!(cid_value(1.5), None);
    }
}
