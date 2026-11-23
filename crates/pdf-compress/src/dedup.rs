//! Identical stream and image object deduplication across a PDF document.
//!
//! Follows Single Responsibility Principle (SRP) by isolating structural stream
//! hashing, canonical ID selection, and recursive reference rewriting.

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::jpeg::fnv1a_hash64;

/// Builds a canonical byte signature for a stream's dictionary (ignoring `/Length`),
/// combined with its payload hash and byte length, for collision-free bucketing.
fn stream_bucket_key(dict: &Dictionary, content: &[u8]) -> (u64, usize, Vec<u8>) {
    let mut keys: Vec<&[u8]> = dict
        .iter()
        .map(|(k, _)| k.as_slice())
        .filter(|k| *k != b"Length")
        .collect();
    keys.sort_unstable();

    let mut sig = Vec::new();
    for k in keys {
        sig.extend_from_slice(k);
        sig.push(b'=');
        if let Ok(val) = dict.get(k) {
            sig.extend_from_slice(format!("{val:?}").as_bytes());
        }
        sig.push(b';');
    }

    (fnv1a_hash64(content), content.len(), sig)
}

/// Checks whether two streams are exact semantic duplicates (ignoring `/Length`).
fn streams_equal(a: &lopdf::Stream, b: &lopdf::Stream) -> bool {
    if a.content != b.content {
        return false;
    }
    let a_keys: Vec<_> = a
        .dict
        .iter()
        .filter(|(k, _)| k.as_slice() != b"Length")
        .collect();
    let b_keys: Vec<_> = b
        .dict
        .iter()
        .filter(|(k, _)| k.as_slice() != b"Length")
        .collect();
    if a_keys.len() != b_keys.len() {
        return false;
    }
    for (k, v) in a_keys {
        match b.dict.get(k) {
            Ok(bv) if bv == v => {}
            _ => return false,
        }
    }
    true
}

/// Recursively rewrites `Object::Reference(old)` -> `Object::Reference(new)` inside `obj`.
fn rewrite_references_in_object(obj: &mut Object, aliases: &HashMap<ObjectId, ObjectId>) {
    match obj {
        Object::Reference(id) => {
            if let Some(&canonical) = aliases.get(id) {
                *id = canonical;
            }
        }
        Object::Array(items) => {
            for item in items.iter_mut() {
                rewrite_references_in_object(item, aliases);
            }
        }
        Object::Dictionary(dict) => {
            for (_, value) in dict.iter_mut() {
                rewrite_references_in_object(value, aliases);
            }
        }
        Object::Stream(stream) => {
            for (_, value) in stream.dict.iter_mut() {
                rewrite_references_in_object(value, aliases);
            }
        }
        _ => {}
    }
}

/// Deduplicates identical indirect stream objects (such as repeated logos, fonts,
/// or Form XObjects) across the document.
///
/// Only streams with identical decoded/encoded payload bytes and matching dictionary
/// metadata (excluding `/Length`) are merged. Structural PDF container streams
/// (`/Type /ObjStm` and `/Type /XRef`) are excluded from deduplication.
///
/// # Arguments
///
/// * `doc` - Mutable `lopdf::Document` to optimize in place.
///
/// # Returns
///
/// Number of duplicate stream objects eliminated.
pub fn deduplicate_streams(doc: &mut Document) -> usize {
    let mut ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    ids.sort_unstable();

    let mut buckets: HashMap<(u64, usize, Vec<u8>), Vec<ObjectId>> = HashMap::new();
    let mut aliases: HashMap<ObjectId, ObjectId> = HashMap::new();

    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };

        // Never merge internal PDF cross-reference or object streams
        if let Ok(obj_type) = stream.dict.get(b"Type").and_then(Object::as_name) {
            if obj_type == b"ObjStm" || obj_type == b"XRef" {
                continue;
            }
        }

        // Skip zero-byte streams to avoid accidentally aliasing uninitialized placeholders
        if stream.content.is_empty() {
            continue;
        }

        let key = stream_bucket_key(&stream.dict, &stream.content);
        let candidates = buckets.entry(key).or_default();

        let mut matched_canonical: Option<ObjectId> = None;
        for &canonical_id in candidates.iter() {
            if let Some(Object::Stream(canonical_stream)) = doc.objects.get(&canonical_id) {
                if streams_equal(canonical_stream, stream) {
                    matched_canonical = Some(canonical_id);
                    break;
                }
            }
        }

        if let Some(canonical_id) = matched_canonical {
            aliases.insert(id, canonical_id);
        } else {
            candidates.push(id);
        }
    }

    if aliases.is_empty() {
        return 0;
    }

    // Rewrite every object reference in the document body and trailer
    for obj in doc.objects.values_mut() {
        rewrite_references_in_object(obj, &aliases);
    }
    for (_, value) in doc.trailer.iter_mut() {
        rewrite_references_in_object(value, &aliases);
    }

    // Remove eliminated duplicate streams
    for dup_id in aliases.keys() {
        doc.objects.remove(dup_id);
    }

    aliases.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    #[test]
    fn collapses_duplicate_image_streams_and_updates_references() {
        let mut doc = Document::with_version("1.5");
        let payload = vec![0xab; 128];

        let img1 = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 8,
                "Height" => 8,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            payload.clone(),
        ));
        let img2 = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 8,
                "Height" => 8,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
                "Length" => 128,
            },
            payload,
        ));
        let resources = doc.add_object(dictionary! {
            "XObject" => dictionary! {
                "Im1" => img1,
                "Im2" => img2,
            }
        });

        let removed = deduplicate_streams(&mut doc);
        assert_eq!(removed, 1);
        assert!(doc.objects.contains_key(&img1));
        assert!(!doc.objects.contains_key(&img2));

        let res_dict = doc.get_dictionary(resources).expect("resources dict");
        let xobj = res_dict
            .get(b"XObject")
            .unwrap()
            .as_dict()
            .expect("XObject dict");
        assert_eq!(xobj.get(b"Im1").unwrap().as_reference().unwrap(), img1);
        assert_eq!(xobj.get(b"Im2").unwrap().as_reference().unwrap(), img1);
    }
}
