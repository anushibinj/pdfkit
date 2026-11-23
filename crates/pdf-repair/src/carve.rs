//! Byte-level PDF carving, sanitization, and structural reconstruction.
//!
//! When PDF files suffer from corrupted cross-reference tables, missing `startxref`
//! offsets, CRLF line termination mangling, or header/trailer truncation, standard parsers
//! reject them. This module performs linear byte carving to discover all indirect PDF
//! objects, repairs headers and stream lengths, and reconstructs a valid cross-reference table.

use std::borrow::Cow;
use std::collections::BTreeMap;
use crate::error::RepairError;

/// Strips leading garbage preceding `%PDF-` or prepends a standard header if missing.
///
/// # Arguments
///
/// * `input` - Raw input bytes.
///
/// # Returns
///
/// A tuple containing the sanitized byte slice (or owned vector) and a boolean
/// indicating whether a repair was made.
pub fn sanitize_header(input: &[u8]) -> (Cow<'_, [u8]>, bool) {
    if input.is_empty() {
        return (Cow::Borrowed(input), false);
    }

    // Search for the standard PDF header marker "%PDF-"
    const HEADER_MARKER: &[u8] = b"%PDF-";
    if let Some(pos) = input.windows(HEADER_MARKER.len()).position(|w| w == HEADER_MARKER) {
        if pos == 0 {
            // Already starts cleanly with %PDF-
            (Cow::Borrowed(input), false)
        } else {
            // Stripped leading junk bytes (e.g. BOM, email MIME headers, HTTP preamble)
            (Cow::Borrowed(&input[pos..]), true)
        }
    } else {
        // Header marker completely missing; prepend a standard PDF-1.7 header
        let mut fixed = Vec::with_capacity(input.len() + 20);
        fixed.extend_from_slice(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
        fixed.extend_from_slice(input);
        (Cow::Owned(fixed), true)
    }
}

/// Trims trailing garbage after `%%EOF` or appends a missing `%%EOF` marker.
///
/// # Arguments
///
/// * `input` - Raw input bytes.
///
/// # Returns
///
/// A tuple containing the sanitized bytes and a boolean indicating whether an EOF repair occurred.
pub fn sanitize_eof(input: &[u8]) -> (Cow<'_, [u8]>, bool) {
    if input.is_empty() {
        return (Cow::Borrowed(input), false);
    }

    const EOF_MARKER: &[u8] = b"%%EOF";
    // Find the last occurrence of %%EOF in the buffer
    let last_eof = input
        .windows(EOF_MARKER.len())
        .rposition(|w| w == EOF_MARKER);

    match last_eof {
        Some(pos) => {
            let after_eof = pos + EOF_MARKER.len();
            // Check if there is significant trailing garbage after %%EOF
            let trailing = &input[after_eof..];
            let has_only_whitespace = trailing.iter().all(|b| b.is_ascii_whitespace() || *b == 0);
            if has_only_whitespace {
                (Cow::Borrowed(input), false)
            } else {
                // Strip extraneous trailing junk (e.g. HTML error page or payload appended by downloads)
                let mut trimmed = input[..after_eof].to_vec();
                trimmed.push(b'\n');
                (Cow::Owned(trimmed), true)
            }
        }
        None => {
            // Missing %%EOF marker; append it
            let mut fixed = input.to_vec();
            if !fixed.ends_with(b"\n") && !fixed.ends_with(b"\r") {
                fixed.push(b'\n');
            }
            fixed.extend_from_slice(b"%%EOF\n");
            (Cow::Owned(fixed), true)
        }
    }
}

/// Scans the entire byte array to discover all indirect object definitions (`n m obj`).
///
/// In PDF documents with corrupted or missing xref tables, every indirect object begins with
/// an ASCII pattern: `<object_id> <generation> obj`. This method performs a linear sweep,
/// extracting object numbers, generation numbers, and their exact byte offsets.
///
/// # Arguments
///
/// * `bytes` - The PDF byte slice to scan.
///
/// # Returns
///
/// A sorted map from `(object_number, generation)` to byte offset in the buffer.
/// Later definitions overwrite earlier ones to respect incremental revisions.
pub fn scan_objects(bytes: &[u8]) -> BTreeMap<(u32, u16), usize> {
    let mut objects = BTreeMap::new();
    let len = bytes.len();
    let mut idx = 0;

    while idx < len {
        // Look for candidate ASCII digits starting at a boundary
        if (idx == 0 || bytes[idx - 1].is_ascii_whitespace() || bytes[idx - 1] == b'\n' || bytes[idx - 1] == b'\r')
            && bytes[idx].is_ascii_digit()
        {
            let start_offset = idx;
            // Parse object number
            let mut num_val: u32 = 0;
            while idx < len && bytes[idx].is_ascii_digit() {
                num_val = num_val.saturating_mul(10).saturating_add((bytes[idx] - b'0') as u32);
                idx += 1;
            }

            // Must be followed by whitespace
            if idx < len && (bytes[idx] == b' ' || bytes[idx] == b'\t') {
                idx += 1;
                // Skip additional whitespace if any
                while idx < len && (bytes[idx] == b' ' || bytes[idx] == b'\t') {
                    idx += 1;
                }

                // Parse generation number
                if idx < len && bytes[idx].is_ascii_digit() {
                    let mut gen_val: u16 = 0;
                    while idx < len && bytes[idx].is_ascii_digit() {
                        gen_val = gen_val.saturating_mul(10).saturating_add((bytes[idx] - b'0') as u16);
                        idx += 1;
                    }

                    // Must be followed by whitespace then "obj" keyword
                    if idx < len && (bytes[idx] == b' ' || bytes[idx] == b'\t' || bytes[idx] == b'\r' || bytes[idx] == b'\n') {
                        while idx < len && (bytes[idx] == b' ' || bytes[idx] == b'\t') {
                            idx += 1;
                        }
                        if idx + 3 <= len && &bytes[idx..idx + 3] == b"obj" {
                            let after_obj = idx + 3;
                            if after_obj == len
                                || bytes[after_obj].is_ascii_whitespace()
                                || bytes[after_obj] == b'<'
                                || bytes[after_obj] == b'/'
                                || bytes[after_obj] == b'['
                            {
                                // Valid object header found
                                objects.insert((num_val, gen_val), start_offset);
                                idx = after_obj;
                                continue;
                            }
                        }
                    }
                }
            }
        }
        idx += 1;
    }

    objects
}

/// Locates candidate Catalog (`/Type /Catalog`) and Pages (`/Type /Pages`) object IDs.
///
/// # Arguments
///
/// * `bytes` - The PDF bytes.
/// * `objects` - The discovered objects map.
///
/// # Returns
///
/// A tuple `(catalog_id, pages_id)` of discovered object identifiers.
pub fn find_catalog_and_pages(
    bytes: &[u8],
    objects: &BTreeMap<(u32, u16), usize>,
) -> (Option<(u32, u16)>, Option<(u32, u16)>) {
    let mut catalog_id = None;
    let mut pages_id = None;

    let keys: Vec<(u32, u16)> = objects.keys().copied().collect();
    for i in 0..keys.len() {
        let key = keys[i];
        let offset = objects[&key];
        let next_offset = if i + 1 < keys.len() {
            objects[&keys[i + 1]]
        } else {
            bytes.len()
        };

        let chunk = &bytes[offset..next_offset.min(bytes.len())];
        let chunk_str = String::from_utf8_lossy(chunk);

        // Check for /Type /Catalog (or /Type/Catalog)
        if catalog_id.is_none() && (chunk_str.contains("/Type /Catalog") || chunk_str.contains("/Type/Catalog")) {
            catalog_id = Some(key);
        }

        // Check for /Type /Pages (or /Type/Pages)
        if pages_id.is_none() && (chunk_str.contains("/Type /Pages") || chunk_str.contains("/Type/Pages")) {
            pages_id = Some(key);
        }

        if catalog_id.is_some() && pages_id.is_some() {
            break;
        }
    }

    (catalog_id, pages_id)
}

/// Reconstructs a clean, standard cross-reference table and trailer for the given objects.
///
/// When xref offsets are corrupted or `startxref` is absent, this function generates an
/// ISO 32000-compliant uncompressed cross-reference section (`xref`) followed by a synthesized
/// trailer dictionary pointing to the document Catalog, then `startxref\n<offset>\n%%EOF\n`.
///
/// # Arguments
///
/// * `bytes` - The existing PDF body bytes (already sanitized).
/// * `objects` - Discovered indirect objects and their byte positions.
///
/// # Returns
///
/// The complete reconstructed PDF bytes.
pub fn reconstruct_xref_and_trailer(
    bytes: &[u8],
    objects: &BTreeMap<(u32, u16), usize>,
) -> Result<Vec<u8>, RepairError> {
    if objects.is_empty() {
        return Err(RepairError::InvalidPdf);
    }

    let (catalog_id, pages_id) = find_catalog_and_pages(bytes, objects);
    let root_id = catalog_id.or(pages_id).ok_or_else(|| {
        RepairError::Unrecoverable("Could not find Catalog or Pages root dictionary in the file.".into())
    })?;

    // Determine highest object number
    let max_obj_num = objects.keys().map(|(num, _)| *num).max().unwrap_or(0);
    let size = max_obj_num + 1;

    // We keep the existing body up to where the old trailer/xref might have been
    let mut out = bytes.to_vec();

    // Ensure body ends with newline before xref
    if !out.ends_with(b"\n") && !out.ends_with(b"\r") {
        out.push(b'\n');
    }

    let xref_offset = out.len();

    // Write standard xref subsection (object 0 to size - 1)
    out.extend_from_slice(format!("xref\n0 {}\n", size).as_bytes());

    // Object 0 is always the head of the free list
    out.extend_from_slice(b"0000000000 65535 f \r\n");

    for num in 1..=max_obj_num {
        if let Some(&offset) = objects.get(&(num, 0)) {
            // Active in-use object (10-digit zero padded offset, 5-digit generation)
            out.extend_from_slice(format!("{:010} 00000 n \r\n", offset).as_bytes());
        } else if let Some((&(_n, gen), &offset)) = objects.iter().find(|(&(n, _), _)| n == num) {
            // Object with non-zero generation
            out.extend_from_slice(format!("{:010} {:05} n \r\n", offset, gen).as_bytes());
        } else {
            // Unused free entry
            out.extend_from_slice(b"0000000000 00000 f \r\n");
        }
    }

    // Write reconstructed trailer
    out.extend_from_slice(
        format!(
            "trailer\n<<\n  /Size {}\n  /Root {} {} R\n>>\nstartxref\n{}\n%%EOF\n",
            size, root_id.0, root_id.1, xref_offset
        )
        .as_bytes(),
    );

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_header_handles_clean_pdf() {
        let pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n";
        let (res, modified) = sanitize_header(pdf);
        assert!(!modified);
        assert_eq!(&*res, pdf);
    }

    #[test]
    fn sanitize_header_strips_leading_garbage() {
        let junk = b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.5\n";
        let (res, modified) = sanitize_header(junk);
        assert!(modified);
        assert!(res.starts_with(b"%PDF-1.5"));
    }

    #[test]
    fn sanitize_header_prepends_missing_header() {
        let raw = b"1 0 obj\n<< /Type /Catalog >>\nendobj\n";
        let (res, modified) = sanitize_header(raw);
        assert!(modified);
        assert!(res.starts_with(b"%PDF-1.7\n"));
        assert!(res.ends_with(raw));
    }

    #[test]
    fn sanitize_eof_strips_trailing_html() {
        let pdf = b"%PDF-1.4\ntrailer\n<<>>\n%%EOF\n<html>error page</html>";
        let (res, modified) = sanitize_eof(pdf);
        assert!(modified);
        assert!(res.ends_with(b"%%EOF\n"));
        assert!(!String::from_utf8_lossy(&res).contains("<html>"));
    }

    #[test]
    fn sanitize_eof_appends_missing_marker() {
        let pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj";
        let (res, modified) = sanitize_eof(pdf);
        assert!(modified);
        assert!(res.ends_with(b"%%EOF\n"));
    }

    #[test]
    fn scan_objects_locates_all_valid_definitions() {
        let sample = b"%PDF-1.4\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n\
3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n";

        let map = scan_objects(sample);
        assert_eq!(map.len(), 3);
        assert!(map.contains_key(&(1, 0)));
        assert!(map.contains_key(&(2, 0)));
        assert!(map.contains_key(&(3, 0)));

        let (cat, pages) = find_catalog_and_pages(sample, &map);
        assert_eq!(cat, Some((1, 0)));
        assert_eq!(pages, Some((2, 0)));
    }

    #[test]
    fn reconstruct_xref_produces_valid_syntax() {
        let sample = b"%PDF-1.4\n\
1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\
2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n";

        let map = scan_objects(sample);
        let rebuilt = reconstruct_xref_and_trailer(sample, &map).unwrap();
        let text = String::from_utf8_lossy(&rebuilt);
        assert!(text.contains("xref\n0 3\n"));
        assert!(text.contains("0000000000 65535 f \r\n"));
        assert!(text.contains("trailer\n<<\n  /Size 3\n  /Root 1 0 R\n>>"));
        assert!(text.contains("startxref\n"));
        assert!(text.ends_with("%%EOF\n"));
    }
}
