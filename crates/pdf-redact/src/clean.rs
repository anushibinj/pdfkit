//! Document-wide object-graph sanitization passes for true PDF redaction.
//!
//! Each cleanup concern is isolated into a small, single-responsibility
//! function operating on a `lopdf::Document` so metadata, attachments, scripts,
//! hidden layers, bookmarks, and overlapping annotations/form fields can be
//! tested and evolved independently.

use std::collections::HashSet;

use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};

use crate::plan::PageRedactionBox;

/// Decodes a PDF text string (`PDFDocEncoding` or UTF-16BE with `\xFE\xFF` BOM)
/// into a Rust `String` so redacted terms can be matched reliably across encodings.
pub fn decode_pdf_text_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) && bytes.len() >= 2 {
        let utf16: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }
    // PDFDocEncoding matches ISO-8859-1 for 0x20..=0xFF except a handful of
    // control/typographic slots in 0x80..=0x9F; mapping bytes directly as char
    // handles all ASCII and Latin-1 terms reliably.
    bytes.iter().map(|&b| b as char).collect()
}

/// Encodes a Rust string as a PDF string object: ASCII literal when possible,
/// or UTF-16BE with `\xFE\xFF` BOM when non-ASCII characters are present.
pub fn encode_pdf_string_object(text: &str) -> Object {
    if text.is_ascii() {
        Object::String(text.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut bytes = Vec::with_capacity(2 + text.len() * 2);
        bytes.extend_from_slice(&[0xFE, 0xFF]);
        for code in text.encode_utf16() {
            bytes.extend_from_slice(&code.to_be_bytes());
        }
        Object::String(bytes, StringFormat::Hexadecimal)
    }
}

/// Case-insensitively replaces every occurrence of any non-empty term in `terms`
/// inside `input` with `replacement`. Returns `Some(scrubbed)` only if at least
/// one term matched.
///
/// Matches are applied longest-term-first so overlapping terms (e.g., an email
/// and its domain) are scrubbed completely rather than partially.
pub fn scrub_terms_in_text(input: &str, terms: &[String], replacement: &str) -> Option<String> {
    if input.is_empty() || terms.is_empty() {
        return None;
    }
    let mut sorted: Vec<&str> = terms
        .iter()
        .map(String::as_str)
        .filter(|t| !t.is_empty())
        .collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by_key(|t| std::cmp::Reverse(t.len()));

    let lower_input = input.to_lowercase();
    // Collect non-overlapping byte intervals in `lower_input`? Note: Unicode
    // case folding can change byte offsets, so we compare char-by-char or
    // work on identical ASCII/lowercase indices when lengths match, and fall
    // back to a char-indexed scan when Unicode case-folding changes byte lengths.
    if lower_input.len() == input.len() {
        return replace_ascii_aligned(input, &lower_input, &sorted, replacement);
    }
    replace_unicode_safe(input, &sorted, replacement)
}

fn replace_ascii_aligned(
    input: &str,
    lower: &str,
    sorted_terms: &[&str],
    replacement: &str,
) -> Option<String> {
    let mut out = String::with_capacity(input.len());
    let mut pos = 0usize;
    let mut changed = false;

    while pos < input.len() {
        // Ensure `pos` sits on a UTF-8 char boundary before slicing.
        if !lower.is_char_boundary(pos) {
            pos += 1;
            continue;
        }
        let mut matched_len = 0usize;
        for term in sorted_terms {
            let term_lower = term.to_lowercase();
            if term_lower.len() == term.len() && lower[pos..].starts_with(&term_lower) {
                matched_len = term.len();
                break;
            }
        }
        if matched_len > 0 && input.is_char_boundary(pos + matched_len) {
            out.push_str(replacement);
            pos += matched_len;
            changed = true;
        } else if let Some(ch) = input[pos..].chars().next() {
            out.push(ch);
            pos += ch.len_utf8();
        } else {
            break;
        }
    }

    changed.then_some(out)
}

fn replace_unicode_safe(input: &str, sorted_terms: &[&str], replacement: &str) -> Option<String> {
    let chars: Vec<(usize, char)> = input.char_indices().collect();
    let lower_terms: Vec<Vec<char>> = sorted_terms
        .iter()
        .map(|t| t.chars().flat_map(char::to_lowercase).collect())
        .collect();
    let lower_chars: Vec<(usize, char)> = chars
        .iter()
        .flat_map(|&(byte_idx, c)| c.to_lowercase().map(move |lc| (byte_idx, lc)))
        .collect();

    let mut out = String::with_capacity(input.len());
    let mut lc_idx = 0usize;
    let mut last_byte = 0usize;
    let mut changed = false;

    while lc_idx < lower_chars.len() {
        let mut matched_lc = 0usize;
        for term in &lower_terms {
            if !term.is_empty()
                && lc_idx + term.len() <= lower_chars.len()
                && lower_chars[lc_idx..lc_idx + term.len()]
                    .iter()
                    .zip(term.iter())
                    .all(|((_, a), b)| a == b)
            {
                matched_lc = term.len();
                break;
            }
        }
        if matched_lc > 0 {
            let start_byte = lower_chars[lc_idx].0;
            if start_byte > last_byte {
                out.push_str(&input[last_byte..start_byte]);
            }
            out.push_str(replacement);
            let next_lc = lc_idx + matched_lc;
            last_byte = if next_lc < lower_chars.len() {
                lower_chars[next_lc].0
            } else {
                input.len()
            };
            lc_idx = next_lc;
            changed = true;
        } else {
            lc_idx += 1;
        }
    }

    if !changed {
        return None;
    }
    if last_byte < input.len() {
        out.push_str(&input[last_byte..]);
    }
    Some(out)
}

/// Removes document metadata (`/Info` trailer entry, XMP `/Metadata` streams
/// on the catalog, pages, and objects, `/PieceInfo`, page `/Thumb` thumbnails,
/// and `/StructTreeRoot` entries containing redacted terms).
///
/// Returns `(metadata_entries_removed, xmp_streams_removed)`.
pub fn clean_document_metadata(
    doc: &mut Document,
    terms: &[String],
    replacement: &str,
) -> (u32, u32) {
    let mut metadata_removed = 0u32;
    let mut xmp_removed = 0u32;

    if doc.trailer.remove(b"Info").is_some() {
        metadata_removed += 1;
    }

    if let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        if let Ok(catalog) = doc.get_dictionary_mut(catalog_id) {
            if catalog.remove(b"Metadata").is_some() {
                xmp_removed += 1;
            }
            if catalog.remove(b"PieceInfo").is_some() {
                metadata_removed += 1;
            }
        }
    }

    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        if let Ok(page) = doc.get_dictionary_mut(page_id) {
            if page.remove(b"Metadata").is_some() {
                xmp_removed += 1;
            }
            if page.remove(b"PieceInfo").is_some() {
                metadata_removed += 1;
            }
            if page.remove(b"Thumb").is_some() {
                metadata_removed += 1;
            }
        }
    }

    // Also scrub any remaining `/Metadata` streams on XObjects or other dicts,
    // and scrub `/ActualText` / `/Alt` / `/T` structure-tree attributes that
    // could still reveal a redacted term.
    let object_ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in object_ids {
        let Some(obj) = doc.objects.get_mut(&id) else {
            continue;
        };
        let dict_opt = match obj {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&mut s.dict),
            _ => None,
        };
        let Some(dict) = dict_opt else {
            continue;
        };
        if dict.remove(b"Metadata").is_some() {
            xmp_removed += 1;
        }
        if dict.remove(b"PieceInfo").is_some() {
            metadata_removed += 1;
        }
        for key in [b"ActualText".as_slice(), b"Alt".as_slice()] {
            if let Ok(Object::String(raw, _)) = dict.get(key) {
                let decoded = decode_pdf_text_string(raw);
                if let Some(scrubbed) = scrub_terms_in_text(&decoded, terms, replacement) {
                    dict.set(key, encode_pdf_string_object(&scrubbed));
                    metadata_removed += 1;
                }
            }
        }
    }

    (metadata_removed, xmp_removed)
}

/// Removes embedded file attachments (`/EmbeddedFiles` in Catalog `/Names`,
/// `/AF` associated-file arrays, and `/FileAttachment` page annotations).
pub fn clean_document_attachments(doc: &mut Document) -> u32 {
    let mut removed = 0u32;

    if let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        let names_ref = doc
            .get_dictionary(catalog_id)
            .ok()
            .and_then(|cat| cat.get(b"Names").ok())
            .and_then(|n| n.as_reference().ok());

        if let Some(names_id) = names_ref {
            if let Ok(names_dict) = doc.get_dictionary_mut(names_id) {
                if names_dict.remove(b"EmbeddedFiles").is_some() {
                    removed += 1;
                }
            }
        }

        if let Ok(cat) = doc.get_dictionary_mut(catalog_id) {
            if let Ok(Object::Dictionary(names_dict)) = cat.get_mut(b"Names") {
                if names_dict.remove(b"EmbeddedFiles").is_some() {
                    removed += 1;
                }
            }
            if cat.remove(b"AF").is_some() {
                removed += 1;
            }
        }
    }

    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        removed += remove_matching_annotations(doc, page_id, |annot| {
            annot
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .is_some_and(|s| s == b"FileAttachment")
        });
        if let Ok(page) = doc.get_dictionary_mut(page_id) {
            if page.remove(b"AF").is_some() {
                removed += 1;
            }
        }
    }

    removed
}

/// Removes JavaScript actions (`/Names -> /JavaScript`, `/OpenAction` when
/// `/S == /JavaScript`, and `/AA` additional actions across catalog, pages,
/// and annotations).
pub fn clean_document_javascript(doc: &mut Document) -> u32 {
    let mut removed = 0u32;

    if let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        let names_ref = doc
            .get_dictionary(catalog_id)
            .ok()
            .and_then(|cat| cat.get(b"Names").ok())
            .and_then(|n| n.as_reference().ok());

        if let Some(names_id) = names_ref {
            if let Ok(names_dict) = doc.get_dictionary_mut(names_id) {
                if names_dict.remove(b"JavaScript").is_some() {
                    removed += 1;
                }
            }
        }

        let open_action_is_js = doc
            .get_dictionary(catalog_id)
            .ok()
            .and_then(|cat| cat.get(b"OpenAction").ok())
            .is_some_and(|oa| action_is_javascript(doc, oa));

        if let Ok(cat) = doc.get_dictionary_mut(catalog_id) {
            if let Ok(Object::Dictionary(names_dict)) = cat.get_mut(b"Names") {
                if names_dict.remove(b"JavaScript").is_some() {
                    removed += 1;
                }
            }
            if open_action_is_js && cat.remove(b"OpenAction").is_some() {
                removed += 1;
            }
            if cat.remove(b"AA").is_some() {
                removed += 1;
            }
        }
    }

    let object_ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in object_ids {
        let is_js_action = doc
            .objects
            .get(&id)
            .and_then(|o| o.as_dict().ok())
            .is_some_and(|d| {
                d.get(b"S")
                    .ok()
                    .and_then(|s| s.as_name().ok())
                    .is_some_and(|s| s == b"JavaScript")
            });
        if let Some(Object::Dictionary(dict)) = doc.objects.get_mut(&id) {
            if dict.remove(b"AA").is_some() {
                removed += 1;
            }
            if is_js_action {
                dict.remove(b"JS");
                removed += 1;
            }
        }
    }

    removed
}

fn action_is_javascript(doc: &Document, obj: &Object) -> bool {
    let Ok((_, resolved)) = doc.dereference(obj) else {
        return false;
    };
    let Ok(dict) = resolved.as_dict() else {
        return false;
    };
    dict.get(b"S")
        .ok()
        .and_then(|s| s.as_name().ok())
        .is_some_and(|s| s == b"JavaScript")
}

/// Removes Optional Content Group properties (`/OCProperties`) from the catalog
/// and strips `/OC` references from XObjects and pages so hidden layers are gone.
pub fn clean_hidden_layers(doc: &mut Document) -> u32 {
    let mut removed = 0u32;

    if let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        let ocg_count = doc
            .get_dictionary(catalog_id)
            .ok()
            .and_then(|cat| cat.get(b"OCProperties").ok())
            .and_then(|oc| doc.dereference(oc).ok())
            .and_then(|(_, obj)| obj.as_dict().ok())
            .and_then(|d| d.get(b"OCGs").ok())
            .and_then(|ocgs| doc.dereference(ocgs).ok())
            .and_then(|(_, obj)| obj.as_array().ok())
            .map_or(0, |arr| arr.len() as u32);

        if let Ok(cat) = doc.get_dictionary_mut(catalog_id) {
            if cat.remove(b"OCProperties").is_some() {
                removed += ocg_count.max(1);
            }
        }
    }

    let object_ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in object_ids {
        if let Some(obj) = doc.objects.get_mut(&id) {
            match obj {
                Object::Dictionary(d) => {
                    if d.remove(b"OC").is_some() {
                        removed += 1;
                    }
                }
                Object::Stream(s) => {
                    if s.dict.remove(b"OC").is_some() {
                        removed += 1;
                    }
                }
                _ => {}
            }
        }
    }

    removed
}

/// Walks the `/Outlines` bookmark tree (with cycle detection) and scrubs any
/// `/Title` containing a redacted term.
pub fn clean_bookmarks(doc: &mut Document, terms: &[String], replacement: &str) -> u32 {
    if terms.is_empty() {
        return 0;
    }
    let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) else {
        return 0;
    };
    let Ok(outlines_id) = doc
        .get_dictionary(catalog_id)
        .and_then(|cat| cat.get(b"Outlines"))
        .and_then(|o| o.as_reference())
    else {
        return 0;
    };

    let mut visited = HashSet::new();
    let mut stack = vec![outlines_id];
    let mut cleaned = 0u32;

    while let Some(node_id) = stack.pop() {
        if !visited.insert(node_id) {
            continue;
        }
        let (first, next, new_title) = {
            let Ok(dict) = doc.get_dictionary(node_id) else {
                continue;
            };
            let first = dict.get(b"First").ok().and_then(|o| o.as_reference().ok());
            let next = dict.get(b"Next").ok().and_then(|o| o.as_reference().ok());
            let new_title = dict
                .get(b"Title")
                .ok()
                .and_then(|t| match t {
                    Object::String(raw, _) => Some(decode_pdf_text_string(raw)),
                    _ => None,
                })
                .and_then(|title| scrub_terms_in_text(&title, terms, replacement));
            (first, next, new_title)
        };

        if let Some(scrubbed) = new_title {
            if let Ok(dict) = doc.get_dictionary_mut(node_id) {
                dict.set("Title", encode_pdf_string_object(&scrubbed));
                cleaned += 1;
            }
        }
        if let Some(n) = next {
            stack.push(n);
        }
        if let Some(f) = first {
            stack.push(f);
        }
    }

    cleaned
}

/// Removes annotations whose `/Rect` overlaps any redaction box on that page,
/// and clears `/V`, `/DV`, and `/AP` on overlapping form field widgets or any
/// `/AcroForm` field whose value contains a redacted term.
///
/// Returns `(annotations_removed, form_values_cleared)`.
pub fn clean_area_annotations_and_forms(
    doc: &mut Document,
    boxes: &[PageRedactionBox],
    terms: &[String],
    replacement: &str,
) -> (u32, u32) {
    let mut annots_removed = 0u32;
    let mut form_values_cleared = 0u32;

    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for (page_idx, page_id) in page_ids.into_iter().enumerate() {
        let page_boxes: Vec<PageRedactionBox> = boxes
            .iter()
            .copied()
            .filter(|b| b.page_index == page_idx as u32)
            .collect();
        if page_boxes.is_empty() {
            continue;
        }
        // Clear widget values if they overlap any box on this page, and remove
        // non-widget (Link, Text, Popup, Highlight, etc.) overlapping annotations.
        let mut widget_ids_to_clear = Vec::new();
        let removed_here = remove_matching_annotations_with_ids(doc, page_id, |d, id, annot| {
            let overlaps = read_annot_rect(d, annot)
                .is_some_and(|[l, b, r, t]| page_boxes.iter().any(|rb| rb.overlaps(l, b, r, t)));
            if !overlaps {
                return false;
            }
            let is_widget = annot
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .is_some_and(|s| s == b"Widget");
            if is_widget {
                if let Some(widget_id) = id {
                    widget_ids_to_clear.push(widget_id);
                }
                false
            } else {
                true
            }
        });
        annots_removed += removed_here;

        for widget_id in widget_ids_to_clear {
            if clear_field_values(doc, widget_id) {
                form_values_cleared += 1;
            }
        }
    }

    // Also inspect all `/AcroForm` fields in case a field value (`/V` or `/DV`)
    // contains a redacted term even if it lives on a shared field dictionary.
    if !terms.is_empty() {
        form_values_cleared += scrub_acroform_terms(doc, terms, replacement);
    }

    (annots_removed, form_values_cleared)
}

fn clear_field_values(doc: &mut Document, id: ObjectId) -> bool {
    let parent_id = doc
        .get_dictionary(id)
        .ok()
        .and_then(|d| d.get(b"Parent").ok())
        .and_then(|o| o.as_reference().ok());

    let mut cleared = false;
    if let Ok(dict) = doc.get_dictionary_mut(id) {
        if dict.remove(b"V").is_some() {
            cleared = true;
        }
        if dict.remove(b"DV").is_some() {
            cleared = true;
        }
        dict.remove(b"AP");
    }
    if let Some(pid) = parent_id {
        if let Ok(parent) = doc.get_dictionary_mut(pid) {
            if parent.remove(b"V").is_some() {
                cleared = true;
            }
            if parent.remove(b"DV").is_some() {
                cleared = true;
            }
        }
    }
    cleared
}

fn scrub_acroform_terms(doc: &mut Document, terms: &[String], replacement: &str) -> u32 {
    let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) else {
        return 0;
    };
    let acroform_obj = doc
        .get_dictionary(catalog_id)
        .ok()
        .and_then(|c| c.get(b"AcroForm").ok())
        .cloned();
    let Some(acroform_obj) = acroform_obj else {
        return 0;
    };
    let Ok((_, resolved)) = doc.dereference(&acroform_obj) else {
        return 0;
    };
    let Ok(acroform_dict) = resolved.as_dict() else {
        return 0;
    };
    let Ok(Object::Array(fields)) = acroform_dict
        .get(b"Fields")
        .and_then(|f| doc.dereference(f).map(|(_, o)| o.clone()))
    else {
        return 0;
    };

    let mut stack: Vec<ObjectId> = fields
        .iter()
        .filter_map(|o| o.as_reference().ok())
        .collect();
    let mut visited = HashSet::new();
    let mut count = 0u32;

    while let Some(field_id) = stack.pop() {
        if !visited.insert(field_id) {
            continue;
        }
        let (kids, new_v, new_dv) = {
            let Ok(dict) = doc.get_dictionary(field_id) else {
                continue;
            };
            let kids: Vec<ObjectId> = dict
                .get(b"Kids")
                .ok()
                .and_then(|k| doc.dereference(k).ok())
                .and_then(|(_, o)| o.as_array().ok())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_reference().ok())
                        .collect()
                })
                .unwrap_or_default();
            let new_v = scrub_dict_string_key(dict, b"V", terms, replacement);
            let new_dv = scrub_dict_string_key(dict, b"DV", terms, replacement);
            (kids, new_v, new_dv)
        };
        if let Ok(dict) = doc.get_dictionary_mut(field_id) {
            if let Some(v) = new_v {
                dict.set("V", encode_pdf_string_object(&v));
                dict.remove(b"AP");
                count += 1;
            }
            if let Some(dv) = new_dv {
                dict.set("DV", encode_pdf_string_object(&dv));
                count += 1;
            }
        }
        stack.extend(kids);
    }

    count
}

fn scrub_dict_string_key(
    dict: &Dictionary,
    key: &[u8],
    terms: &[String],
    replacement: &str,
) -> Option<String> {
    let Object::String(raw, _) = dict.get(key).ok()? else {
        return None;
    };
    let decoded = decode_pdf_text_string(raw);
    scrub_terms_in_text(&decoded, terms, replacement)
}

fn read_annot_rect(doc: &Document, annot: &Dictionary) -> Option<[f64; 4]> {
    let rect_obj = annot.get(b"Rect").ok()?;
    let (_, resolved) = doc.dereference(rect_obj).ok()?;
    let arr = resolved.as_array().ok()?;
    if arr.len() != 4 {
        return None;
    }
    let nums: Option<Vec<f64>> = arr
        .iter()
        .map(|o| match o {
            Object::Integer(i) => Some(*i as f64),
            Object::Real(r) => Some(*r as f64),
            _ => None,
        })
        .collect();
    let nums = nums?;
    Some([nums[0], nums[1], nums[2], nums[3]])
}

fn remove_matching_annotations<F>(doc: &mut Document, page_id: ObjectId, pred: F) -> u32
where
    F: Fn(&Dictionary) -> bool,
{
    remove_matching_annotations_with_ids(doc, page_id, |_, _, annot| pred(annot))
}

fn remove_matching_annotations_with_ids<F>(
    doc: &mut Document,
    page_id: ObjectId,
    mut pred: F,
) -> u32
where
    F: FnMut(&Document, Option<ObjectId>, &Dictionary) -> bool,
{
    let entries = {
        let Ok(page) = doc.get_dictionary(page_id) else {
            return 0;
        };
        let Ok(annots_obj) = page.get(b"Annots") else {
            return 0;
        };
        let Ok((_, resolved)) = doc.dereference(annots_obj) else {
            return 0;
        };
        let Ok(items) = resolved.as_array() else {
            return 0;
        };
        items.clone()
    };

    let mut kept = Vec::with_capacity(entries.len());
    let mut removed = 0u32;

    for entry in entries {
        let id = entry.as_reference().ok();
        let should_remove = doc
            .dereference(&entry)
            .ok()
            .and_then(|(_, obj)| obj.as_dict().ok())
            .is_some_and(|dict| pred(doc, id, dict));
        if should_remove {
            removed += 1;
        } else {
            kept.push(entry);
        }
    }

    if removed > 0 {
        if let Ok(page) = doc.get_dictionary_mut(page_id) {
            if kept.is_empty() {
                page.remove(b"Annots");
            } else {
                page.set("Annots", Object::Array(kept));
            }
        }
    }

    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    #[test]
    fn decode_and_encode_pdf_strings_handle_ascii_and_utf16() {
        assert_eq!(decode_pdf_text_string(b"Hello"), "Hello");
        assert_eq!(
            decode_pdf_text_string(&[0xFE, 0xFF, 0x00, b'A', 0x20, 0xAC]),
            "A€"
        );
        let ascii = encode_pdf_string_object("REDACTED");
        assert!(matches!(ascii, Object::String(ref b, _) if b == b"REDACTED"));
        let non_ascii = encode_pdf_string_object("A€");
        assert!(matches!(non_ascii, Object::String(ref b, _) if b.starts_with(&[0xFE, 0xFF])));
    }

    #[test]
    fn scrub_terms_in_text_handles_case_insensitivity_and_overlapping_terms() {
        let terms = vec!["alice@example.com".to_string(), "example.com".to_string()];
        assert_eq!(
            scrub_terms_in_text("Contact: ALICE@EXAMPLE.COM now", &terms, "[REDACTED]"),
            Some("Contact: [REDACTED] now".to_string())
        );
        assert_eq!(
            scrub_terms_in_text("Nothing secret here", &terms, "[REDACTED]"),
            None
        );
    }

    #[test]
    fn clean_document_metadata_strips_info_xmp_thumb_pieceinfo_and_struct_text() {
        let mut doc = Document::with_version("1.7");
        let info_id = doc.add_object(dictionary! { "Author" => "Alice Secret" });
        let xmp_id = doc.add_object(Stream::new(dictionary! {}, b"<xmp>Secret</xmp>".to_vec()));
        let thumb_id = doc.add_object(Stream::new(dictionary! {}, vec![1, 2, 3]));
        let struct_id = doc.add_object(dictionary! { "ActualText" => "SSN 123-45-6789" });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Metadata" => xmp_id,
            "Thumb" => thumb_id,
            "PieceInfo" => dictionary! { "App" => "Secret" },
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![page_id.into()],
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "Metadata" => xmp_id,
            "StructTreeRoot" => struct_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc.trailer.set("Info", info_id);

        let (meta_removed, xmp_removed) =
            clean_document_metadata(&mut doc, &["123-45-6789".into()], "[REDACTED]");

        assert!(meta_removed >= 3);
        assert_eq!(xmp_removed, 2);
        assert!(!doc.trailer.has(b"Info"));
        let page = doc.get_dictionary(page_id).unwrap();
        assert!(!page.has(b"Metadata"));
        assert!(!page.has(b"Thumb"));
        assert!(!page.has(b"PieceInfo"));
        let s_dict = doc.get_dictionary(struct_id).unwrap();
        assert_eq!(
            decode_pdf_text_string(s_dict.get(b"ActualText").unwrap().as_str().unwrap()),
            "SSN [REDACTED]"
        );
    }

    #[test]
    fn clean_document_attachments_javascript_and_hidden_layers_remove_targets() {
        let mut doc = Document::with_version("1.7");
        let js_action = doc.add_object(dictionary! {
            "S" => "JavaScript",
            "JS" => "app.alert('secret')",
        });
        let names_id = doc.add_object(dictionary! {
            "EmbeddedFiles" => dictionary! {},
            "JavaScript" => dictionary! {},
        });
        let ocg_id = doc.add_object(dictionary! { "Type" => "OCG", "Name" => "HiddenLayer" });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "AA" => dictionary! { "O" => js_action },
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![page_id.into()],
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "Names" => names_id,
            "OpenAction" => js_action,
            "OCProperties" => dictionary! { "OCGs" => vec![ocg_id.into()] },
        });
        doc.trailer.set("Root", catalog_id);

        assert_eq!(clean_document_attachments(&mut doc), 1);
        assert!(clean_document_javascript(&mut doc) >= 3);
        assert_eq!(clean_hidden_layers(&mut doc), 1);

        let cat = doc.get_dictionary(catalog_id).unwrap();
        assert!(!cat.has(b"OpenAction"));
        assert!(!cat.has(b"OCProperties"));
        let names = doc.get_dictionary(names_id).unwrap();
        assert!(!names.has(b"EmbeddedFiles"));
        assert!(!names.has(b"JavaScript"));
    }

    #[test]
    fn clean_bookmarks_scrubs_matching_titles_with_cycle_guard() {
        let mut doc = Document::with_version("1.7");
        let child_id = doc.new_object_id();
        let item_id = doc.new_object_id();
        let outlines_id = doc.add_object(dictionary! {
            "First" => item_id,
            "Last" => item_id,
        });
        doc.objects.insert(
            item_id,
            Object::Dictionary(dictionary! {
                "Title" => "Account: secret@corp.com",
                "First" => child_id,
                "Next" => outlines_id, // intentional cycle
            }),
        );
        doc.objects.insert(
            child_id,
            Object::Dictionary(dictionary! {
                "Title" => "Public Section",
            }),
        );
        let pages_id = doc.add_object(
            dictionary! { "Type" => "Pages", "Count" => 0, "Kids" => Vec::<Object>::new() },
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "Outlines" => outlines_id,
        });
        doc.trailer.set("Root", catalog_id);

        let cleaned = clean_bookmarks(&mut doc, &["secret@corp.com".into()], "[REDACTED]");
        assert_eq!(cleaned, 1);
        assert_eq!(
            decode_pdf_text_string(
                doc.get_dictionary(item_id)
                    .unwrap()
                    .get(b"Title")
                    .unwrap()
                    .as_str()
                    .unwrap()
            ),
            "Account: [REDACTED]"
        );
        assert_eq!(
            decode_pdf_text_string(
                doc.get_dictionary(child_id)
                    .unwrap()
                    .get(b"Title")
                    .unwrap()
                    .as_str()
                    .unwrap()
            ),
            "Public Section"
        );
    }

    #[test]
    fn clean_area_annotations_and_forms_removes_links_and_clears_widget_values() {
        let mut doc = Document::with_version("1.7");
        let link_inside = doc.add_object(dictionary! {
            "Subtype" => "Link",
            "Rect" => vec![10.into(), 10.into(), 50.into(), 30.into()],
        });
        let link_outside = doc.add_object(dictionary! {
            "Subtype" => "Link",
            "Rect" => vec![200.into(), 200.into(), 250.into(), 220.into()],
        });
        let widget_inside = doc.add_object(dictionary! {
            "Subtype" => "Widget",
            "Rect" => vec![15.into(), 15.into(), 45.into(), 25.into()],
            "V" => "Secret Value",
            "DV" => "Secret Default",
        });
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Annots" => vec![link_inside.into(), link_outside.into(), widget_inside.into()],
        });
        let pages_id = doc.add_object(dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![page_id.into()],
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);

        let boxes = vec![PageRedactionBox {
            page_index: 0,
            left: 5.0,
            bottom: 5.0,
            right: 60.0,
            top: 40.0,
        }];
        let (annots_removed, forms_cleared) =
            clean_area_annotations_and_forms(&mut doc, &boxes, &[], "[REDACTED]");
        assert_eq!(annots_removed, 1);
        assert_eq!(forms_cleared, 1);

        let page = doc.get_dictionary(page_id).unwrap();
        let remaining = page.get(b"Annots").unwrap().as_array().unwrap();
        assert_eq!(remaining.len(), 2);
        let widget = doc.get_dictionary(widget_inside).unwrap();
        assert!(!widget.has(b"V"));
        assert!(!widget.has(b"DV"));
    }
}
