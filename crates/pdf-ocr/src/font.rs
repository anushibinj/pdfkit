//! Minimal glyphless TrueType font builder and UTF-16BE ToUnicode CMap generator.
//!
//! Used by [`crate::text_layer`] when constructing an invisible Unicode text layer
//! (`3 Tr`) directly from word bounding boxes. Providing a valid `/FontFile2` SFNT
//! binary + `/ToUnicode` CMap ensures every PDF reader (PDFium, Acrobat, Chrome,
//! Preview) searches, selects, and copies multi-script Unicode text including
//! Indic scripts (Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, etc.).

use std::collections::BTreeMap;

/// Builds a minimal valid TrueType font program (`cmap`, `glyf`, `head`, `hhea`,
/// `hmtx`, `loca`, `maxp`, `name`, `post`) with `unitsPerEm = 1000`, invisible
/// empty glyph contours, and uniform advance width `500`.
///
/// # Returns
///
/// Complete OpenType/TrueType binary suitable for embedding in `/FontFile2`.
pub fn build_glyphless_ttf() -> Vec<u8> {
    // 9 required TrueType tables sorted alphabetically by 4-byte tag.
    let mut tables: BTreeMap<[u8; 4], Vec<u8>> = BTreeMap::new();

    // `cmap`: Format 4 minimal segment mapping U+0000..U+FFFF -> glyph 1 (or 0).
    let cmap = {
        let mut t = Vec::new();
        t.extend_from_slice(&0u16.to_be_bytes()); // version
        t.extend_from_slice(&1u16.to_be_bytes()); // numTables
        t.extend_from_slice(&3u16.to_be_bytes()); // platformID: Windows
        t.extend_from_slice(&1u16.to_be_bytes()); // encodingID: Unicode BMP
        t.extend_from_slice(&12u32.to_be_bytes()); // subtable offset
        // Format 4 subtable: 2 segments (U+0020..U+007E, U+FFFF)
        t.extend_from_slice(&4u16.to_be_bytes()); // format
        t.extend_from_slice(&32u16.to_be_bytes()); // length
        t.extend_from_slice(&0u16.to_be_bytes()); // language
        t.extend_from_slice(&4u16.to_be_bytes()); // segCountX2 (2 * 2)
        t.extend_from_slice(&4u16.to_be_bytes()); // searchRange
        t.extend_from_slice(&1u16.to_be_bytes()); // entrySelector
        t.extend_from_slice(&0u16.to_be_bytes()); // rangeShift
        t.extend_from_slice(&0x007eu16.to_be_bytes()); // endCode[0]
        t.extend_from_slice(&0xffffu16.to_be_bytes()); // endCode[1]
        t.extend_from_slice(&0u16.to_be_bytes()); // reservedPad
        t.extend_from_slice(&0x0020u16.to_be_bytes()); // startCode[0]
        t.extend_from_slice(&0xffffu16.to_be_bytes()); // startCode[1]
        t.extend_from_slice(&(-31i16).to_be_bytes()); // idDelta[0]
        t.extend_from_slice(&1i16.to_be_bytes()); // idDelta[1]
        t.extend_from_slice(&0u16.to_be_bytes()); // idRangeOffset[0]
        t.extend_from_slice(&0u16.to_be_bytes()); // idRangeOffset[1]
        t
    };
    tables.insert(*b"cmap", cmap);

    // `glyf`: 2 empty glyphs (glyph 0 = .notdef, glyph 1 = invisible glyph).
    // Empty glyphs have 0 bytes in `glyf`; `loca` offsets are all 0.
    tables.insert(*b"glyf", vec![0, 0, 0, 0]);

    // `head` (54 bytes); checkSumAdjustment at bytes 8..12 is filled after assembly.
    let head = {
        let mut t = vec![0u8; 54];
        t[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes()); // majorVersion=1, minor=0
        t[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes()); // fontRevision 1.0
        t[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes()); // magicNumber
        t[16..18].copy_from_slice(&0x000Bu16.to_be_bytes()); // flags
        t[18..20].copy_from_slice(&1000u16.to_be_bytes()); // unitsPerEm = 1000
        t[36..38].copy_from_slice(&0i16.to_be_bytes()); // xMin
        t[38..40].copy_from_slice(&0i16.to_be_bytes()); // yMin
        t[40..42].copy_from_slice(&500i16.to_be_bytes()); // xMax
        t[42..44].copy_from_slice(&800i16.to_be_bytes()); // yMax
        t[46..48].copy_from_slice(&8u16.to_be_bytes()); // lowestRecPPEM
        t[48..50].copy_from_slice(&2i16.to_be_bytes()); // fontDirectionHint
        t[50..52].copy_from_slice(&0i16.to_be_bytes()); // indexToLocFormat = short (16-bit)
        t
    };
    tables.insert(*b"head", head);

    // `hhea` (36 bytes)
    let hhea = {
        let mut t = vec![0u8; 36];
        t[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes()); // version 1.0
        t[4..6].copy_from_slice(&800i16.to_be_bytes()); // ascender
        t[6..8].copy_from_slice(&(-200i16).to_be_bytes()); // descender
        t[10..12].copy_from_slice(&500u16.to_be_bytes()); // advanceWidthMax
        t[34..36].copy_from_slice(&2u16.to_be_bytes()); // numberOfHMetrics = 2
        t
    };
    tables.insert(*b"hhea", hhea);

    // `hmtx`: 2 metrics (advanceWidth=500, lsb=0)
    let hmtx = {
        let mut t = Vec::with_capacity(8);
        t.extend_from_slice(&500u16.to_be_bytes());
        t.extend_from_slice(&0i16.to_be_bytes());
        t.extend_from_slice(&500u16.to_be_bytes());
        t.extend_from_slice(&0i16.to_be_bytes());
        t
    };
    tables.insert(*b"hmtx", hmtx);

    // `loca`: short format (numGlyphs + 1 = 3 entries of u16, all 0)
    tables.insert(*b"loca", vec![0u8; 6]);

    // `maxp` (32 bytes, version 1.0)
    let maxp = {
        let mut t = vec![0u8; 32];
        t[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        t[4..6].copy_from_slice(&2u16.to_be_bytes()); // numGlyphs = 2
        t
    };
    tables.insert(*b"maxp", maxp);

    // `name`: empty minimal table (6 bytes)
    tables.insert(*b"name", vec![0u8; 6]);

    // `post`: version 3.0 (no glyph names, 32 bytes)
    let post = {
        let mut t = vec![0u8; 32];
        t[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
        t
    };
    tables.insert(*b"post", post);

    assemble_sfnt(tables)
}

/// Assembles an SFNT container from sorted tables, computing table checksums,
/// 4-byte alignment padding, and the `head.checkSumAdjustment` value.
fn assemble_sfnt(tables: BTreeMap<[u8; 4], Vec<u8>>) -> Vec<u8> {
    let num_tables = tables.len() as u16;
    let max_pow2 = num_tables.next_power_of_two() / if num_tables.is_power_of_two() { 1 } else { 2 };
    let search_range = max_pow2 * 16;
    let entry_selector = max_pow2.trailing_zeros() as u16;
    let range_shift = num_tables * 16 - search_range;

    let header_size = 12 + (tables.len() * 16);
    let mut font = vec![0u8; header_size];

    // SFNT offset table
    font[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    font[4..6].copy_from_slice(&num_tables.to_be_bytes());
    font[6..8].copy_from_slice(&search_range.to_be_bytes());
    font[8..10].copy_from_slice(&entry_selector.to_be_bytes());
    font[10..12].copy_from_slice(&range_shift.to_be_bytes());

    let mut head_offset = 0usize;
    let mut record_offset = 12usize;

    for (tag, data) in tables {
        let offset = font.len();
        if &tag == b"head" {
            head_offset = offset;
        }
        let length = data.len() as u32;
        font.extend_from_slice(&data);
        // Every SFNT table body must be padded with zeros to a 4-byte boundary.
        while font.len() % 4 != 0 {
            font.push(0);
        }
        let checksum = sfnt_checksum(&font[offset..]);

        font[record_offset..record_offset + 4].copy_from_slice(&tag);
        font[record_offset + 4..record_offset + 8].copy_from_slice(&checksum.to_be_bytes());
        font[record_offset + 8..record_offset + 12].copy_from_slice(&(offset as u32).to_be_bytes());
        font[record_offset + 12..record_offset + 16].copy_from_slice(&length.to_be_bytes());
        record_offset += 16;
    }

    // Write `head.checkSumAdjustment = 0xB1B0AFBA - sum_of_entire_font_u32`.
    let total_checksum = sfnt_checksum(&font);
    let adjustment = 0xB1B0_AFBAu32.wrapping_sub(total_checksum);
    font[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());

    font
}

/// Computes the OpenType 32-bit big-endian table checksum.
fn sfnt_checksum(slice: &[u8]) -> u32 {
    let mut sum = 0u32;
    let mut i = 0usize;
    while i < slice.len() {
        let mut word = [0u8; 4];
        for j in 0..4 {
            if i + j < slice.len() {
                word[j] = slice[i + j];
            }
        }
        sum = sum.wrapping_add(u32::from_be_bytes(word));
        i += 4;
    }
    sum
}

/// Builds an Adobe `/ToUnicode` CMap stream mapping 2-byte CIDs to UTF-16BE
/// Unicode sequences (handling both BMP characters and non-BMP surrogate pairs).
///
/// # Arguments
///
/// * `cid_to_text` - Pairs of `(cid, unicode_text)` sorted or in order of assignment.
///
/// # Returns
///
/// UTF-8 encoded PostScript CMap stream bytes.
pub fn build_tounicode_cmap(cid_to_text: &[(u16, String)]) -> Vec<u8> {
    let mut out = String::new();
    out.push_str("/CIDInit /ProcSet findresource begin\n");
    out.push_str("12 dict begin\n");
    out.push_str("begincmap\n");
    out.push_str("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n");
    out.push_str("/CMapName /Adobe-Identity-UCS def\n");
    out.push_str("/CMapType 2 def\n");
    out.push_str("1 begincodespacerange\n");
    out.push_str("<0000> <FFFF>\n");
    out.push_str("endcodespacerange\n");

    // PDF spec section 9.10.3 restricts each `beginbfchar` block to <= 100 entries.
    for chunk in cid_to_text.chunks(100) {
        out.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (cid, text) in chunk {
            let hex_utf16 = encode_utf16be_hex(text);
            out.push_str(&format!("<{:04X}> <{}>\n", cid, hex_utf16));
        }
        out.push_str("endbfchar\n");
    }

    out.push_str("endcmap\n");
    out.push_str("CMapName currentdict /CMap defineresource pop\n");
    out.push_str("end\n");
    out.push_str("end\n");
    out.into_bytes()
}

/// Encodes a UTF-8 string into uppercase UTF-16BE hexadecimal digits (without spaces).
fn encode_utf16be_hex(text: &str) -> String {
    let mut hex = String::with_capacity(text.len() * 4);
    let mut buf = [0u16; 2];
    for ch in text.chars() {
        for unit in ch.encode_utf16(&mut buf) {
            hex.push_str(&format!("{:04X}", *unit));
        }
    }
    if hex.is_empty() {
        hex.push_str("0020");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyphless_ttf_has_valid_sfnt_header_and_tables() {
        let ttf = build_glyphless_ttf();
        assert_eq!(&ttf[0..4], &[0x00, 0x01, 0x00, 0x00]);
        let num_tables = u16::from_be_bytes([ttf[4], ttf[5]]);
        assert_eq!(num_tables, 9);
        // Entire font checksum must equal 0xB1B0AFBA when checkSumAdjustment is applied.
        assert_eq!(sfnt_checksum(&ttf), 0xB1B0_AFBA);
    }

    #[test]
    fn tounicode_cmap_encodes_ascii_devanagari_and_surrogate_pairs() {
        let entries = vec![
            (1u16, "Hello".to_string()),
            (2u16, "नमस्ते".to_string()),
            (3u16, "😀".to_string()),
        ];
        let cmap = String::from_utf8(build_tounicode_cmap(&entries)).unwrap();
        assert!(cmap.contains("3 beginbfchar"));
        assert!(cmap.contains("<0001> <00480065006C006C006F>"));
        // न (0928) म (092E) स (0938) ् (094D) त (0924) े (0947)
        assert!(cmap.contains("<0002> <0928092E0938094D09240947>"));
        // U+1F600 -> D83D DE00
        assert!(cmap.contains("<0003> <D83DDE00>"));
    }

    #[test]
    fn tounicode_cmap_chunks_more_than_100_entries() {
        let entries: Vec<(u16, String)> = (1u16..=105)
            .map(|i| (i, format!("W{}", i)))
            .collect();
        let cmap = String::from_utf8(build_tounicode_cmap(&entries)).unwrap();
        assert!(cmap.contains("100 beginbfchar"));
        assert!(cmap.contains("5 beginbfchar"));
    }
}
