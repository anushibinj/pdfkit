//! Reading stream data strictly, and writing new streams.

use std::io::Read;

use flate2::read::ZlibDecoder;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

use super::boxes::number;

/// Largest decoded size of one stream the crop will read (256 MB). Larger
/// streams are kept unchanged.
pub const MAX_STREAM_BYTES: usize = 256 * 1024 * 1024;

/// Most filters in one chain the crop will decode.
const MAX_FILTERS: usize = 4;

/// The decoded data of a stream, or `None` unless it decodes cleanly.
///
/// Supported: no filter, or a chain of up to [`MAX_FILTERS`] of
/// `ASCII85Decode`, `ASCIIHexDecode` and `FlateDecode` (without a
/// predictor), with their abbreviations. Each is decoded strictly here
/// rather than with lopdf's decoders, because lopdf's Flate decoder returns
/// whatever it managed to decode when the data is damaged: a stream that is
/// rewritten must be complete, or the rewrite would silently drop its
/// undecodable tail. Anything else (other filters, damaged data, more than
/// [`MAX_STREAM_BYTES`]) gives `None`, and the caller keeps the stream as
/// it is.
pub fn decode_strict(doc: &Document, stream: &Stream) -> Option<Vec<u8>> {
    let filters: Vec<&[u8]> = match stream.dict.get(b"Filter") {
        Err(_) => Vec::new(),
        Ok(filter) => match doc.dereference(filter).ok()?.1 {
            Object::Name(name) => vec![name.as_slice()],
            Object::Array(items) if items.len() <= MAX_FILTERS => items
                .iter()
                .map(|o| doc.dereference(o).ok()?.1.as_name().ok())
                .collect::<Option<_>>()?,
            _ => return None,
        },
    };
    let mut data = stream.content.clone();
    for (index, filter) in filters.iter().enumerate() {
        data = match *filter {
            b"FlateDecode" | b"Fl" => {
                if has_predictor(doc, &stream.dict, index) {
                    return None;
                }
                inflate(&data, MAX_STREAM_BYTES)?
            }
            b"ASCII85Decode" | b"A85" => decode_ascii85(&data)?,
            b"ASCIIHexDecode" | b"AHx" => decode_ascii_hex(&data)?,
            _ => return None,
        };
    }
    (data.len() <= MAX_STREAM_BYTES).then_some(data)
}

/// Whether the `/DecodeParms` of the filter at `index` asks for a PNG or
/// TIFF predictor (> 1). `/DecodeParms` is one dictionary for a single
/// filter, or an array with one entry (dictionary or null) per filter.
fn has_predictor(doc: &Document, dict: &Dictionary, index: usize) -> bool {
    let Ok(params) = dict.get(b"DecodeParms") else {
        return false;
    };
    let params = match doc.dereference(params).map(|(_, o)| o) {
        Ok(Object::Dictionary(d)) => d,
        Ok(Object::Array(items)) => match items.get(index).map(|o| doc.dereference(o)) {
            Some(Ok((_, Object::Dictionary(d)))) => d,
            Some(Ok((_, Object::Null))) | None => return false,
            _ => return true,
        },
        Ok(Object::Null) => return false,
        _ => return true,
    };
    params
        .get(b"Predictor")
        .ok()
        .and_then(|p| number(doc, p))
        .is_some_and(|p| p > 1.0)
}

/// Decode `ASCII85Decode` data strictly (ISO 32000-1, 7.4.3).
///
/// Every 5 characters `!`..`u` are a base-85 number giving 4 bytes; `z`
/// alone stands for 4 zero bytes; white space is ignored; `~>` ends the
/// data (a missing `~>` at the very end is tolerated). A final group of
/// 2 to 4 characters is padded with `u` and gives 1 to 3 bytes. Anything
/// else (other characters, a group above 2^32 - 1, a final single
/// character, data after `~>`) is an error.
pub fn decode_ascii85(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() * 4 / 5);
    let mut group = [0u8; 5];
    let mut count = 0;
    let mut bytes = data.iter().copied();
    while let Some(c) = bytes.next() {
        match c {
            b'~' => {
                if bytes.next() != Some(b'>')
                    || bytes.any(|b| !crate::content::lexer::is_whitespace(b))
                {
                    return None;
                }
                break;
            }
            b'z' if count == 0 => out.extend_from_slice(&[0; 4]),
            b'!'..=b'u' => {
                group[count] = c - b'!';
                count += 1;
                if count == 5 {
                    out.extend_from_slice(&base85_word(&group)?.to_be_bytes());
                    count = 0;
                }
            }
            c if crate::content::lexer::is_whitespace(c) => {}
            _ => return None,
        }
    }
    match count {
        0 => {}
        1 => return None,
        n => {
            group[n..].fill(b'u' - b'!');
            out.extend_from_slice(&base85_word(&group)?.to_be_bytes()[..n - 1]);
        }
    }
    Some(out)
}

/// The 32-bit value of five base-85 digits, or `None` if it overflows.
fn base85_word(digits: &[u8; 5]) -> Option<u32> {
    let value = digits.iter().fold(0u64, |acc, d| acc * 85 + u64::from(*d));
    u32::try_from(value).ok()
}

/// Decode `ASCIIHexDecode` data strictly (ISO 32000-1, 7.4.2): hex digit
/// pairs, white space ignored, `>` ends the data (a missing `>` at the very
/// end is tolerated), an odd final digit is padded with 0. Any other
/// character is an error.
pub fn decode_ascii_hex(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() / 2);
    let mut high: Option<u8> = None;
    for (i, &c) in data.iter().enumerate() {
        if c == b'>' {
            if data[i + 1..]
                .iter()
                .any(|&b| !crate::content::lexer::is_whitespace(b))
            {
                return None;
            }
            break;
        }
        if crate::content::lexer::is_whitespace(c) {
            continue;
        }
        let digit = (c as char).to_digit(16)? as u8;
        match high.take() {
            Some(h) => out.push(h << 4 | digit),
            None => high = Some(digit),
        }
    }
    if let Some(h) = high {
        out.push(h << 4);
    }
    Some(out)
}

/// Inflate zlib data, failing on any damage or when the output would exceed
/// `limit` bytes.
pub fn inflate(data: &[u8], limit: usize) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut reader = ZlibDecoder::new(data).take(limit as u64 + 1);
    reader.read_to_end(&mut out).ok()?;
    (out.len() <= limit).then_some(out)
}

/// The decoded content of a page: its content streams joined with a line
/// break (streams split anywhere between tokens, and the break keeps a
/// token at the end of one stream from running into the next). `None` if
/// any stream cannot be decoded strictly.
pub fn page_content(doc: &Document, page: ObjectId) -> Option<Vec<u8>> {
    let mut content = Vec::new();
    for id in doc.get_page_contents(page) {
        let stream = doc.get_object(id).ok()?.as_stream().ok()?;
        content.extend(decode_strict(doc, stream)?);
        content.push(b'\n');
    }
    Some(content)
}

/// A new, Flate-compressed stream with `dict`'s entries (minus any old
/// filter and length) and `content`, added to the document.
///
/// # Errors
///
/// lopdf's error when compressing fails or the document has no object
/// numbers left.
pub fn add_stream(
    doc: &mut Document,
    mut dict: Dictionary,
    content: Vec<u8>,
) -> lopdf::Result<ObjectId> {
    for key in [&b"Filter"[..], b"DecodeParms", b"Length", b"DL"] {
        dict.remove(key);
    }
    let mut stream = Stream::new(dict, content);
    stream.compress()?;
    doc.try_add_object(stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use lopdf::dictionary;
    use std::io::Write;

    fn deflate(data: &[u8]) -> Vec<u8> {
        let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    #[test]
    fn decode_strict_reads_plain_and_flate_streams() {
        let doc = Document::with_version("1.7");
        let plain = Stream::new(dictionary! {}, b"q Q".to_vec());
        assert_eq!(decode_strict(&doc, &plain).unwrap(), b"q Q");
        let flate = Stream::new(dictionary! { "Filter" => "FlateDecode" }, deflate(b"BT ET"));
        assert_eq!(decode_strict(&doc, &flate).unwrap(), b"BT ET");
        let array = Stream::new(
            dictionary! { "Filter" => vec![Object::Name(b"FlateDecode".to_vec())] },
            deflate(b"x"),
        );
        assert_eq!(decode_strict(&doc, &array).unwrap(), b"x");
    }

    #[test]
    fn decode_strict_refuses_damage_predictors_and_other_filters() {
        let doc = Document::with_version("1.7");
        let mut damaged = deflate(b"0 0 10 10 re f 0 0 10 10 re f 0 0 10 10 re f");
        damaged.truncate(damaged.len() - 6);
        let s = Stream::new(dictionary! { "Filter" => "FlateDecode" }, damaged);
        assert_eq!(decode_strict(&doc, &s), None);
        let s = Stream::new(
            dictionary! { "Filter" => "FlateDecode", "DecodeParms" => dictionary! { "Predictor" => 12 } },
            deflate(b"x"),
        );
        assert_eq!(decode_strict(&doc, &s), None);
        let s = Stream::new(dictionary! { "Filter" => "LZWDecode" }, b"x".to_vec());
        assert_eq!(decode_strict(&doc, &s), None);
        let too_long = vec![Object::Name(b"AHx".to_vec()); 5];
        let s = Stream::new(dictionary! { "Filter" => too_long }, b"x".to_vec());
        assert_eq!(decode_strict(&doc, &s), None);
        let s = Stream::new(dictionary! { "Filter" => 3 }, b"x".to_vec());
        assert_eq!(decode_strict(&doc, &s), None);
    }

    #[test]
    fn decode_strict_reads_filter_chains_in_order() {
        let doc = Document::with_version("1.7");
        // ASCIIHex of the zlib data, as ReportLab-style chains are written.
        let hex: String = deflate(b"BT ET")
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect();
        let chain = vec![Object::Name(b"AHx".to_vec()), Object::Name(b"Fl".to_vec())];
        let s = Stream::new(
            dictionary! { "Filter" => chain },
            format!("{hex}>").into_bytes(),
        );
        assert_eq!(decode_strict(&doc, &s).unwrap(), b"BT ET");
        // A predictor on the Flate stage (index 1) is refused.
        let chain = vec![Object::Name(b"AHx".to_vec()), Object::Name(b"Fl".to_vec())];
        let params = vec![
            Object::Null,
            Object::Dictionary(dictionary! { "Predictor" => 12 }),
        ];
        let s = Stream::new(
            dictionary! { "Filter" => chain, "DecodeParms" => params },
            format!("{hex}>").into_bytes(),
        );
        assert_eq!(decode_strict(&doc, &s), None);
    }

    #[test]
    fn decode_ascii85_follows_the_spec() {
        // "Man " is the classic example: 9jqo^.
        assert_eq!(decode_ascii85(b"9jqo^~>").unwrap(), b"Man ");
        assert_eq!(decode_ascii85(b"9jqo^ 9jqo^\n~>").unwrap(), b"Man Man ");
        assert_eq!(decode_ascii85(b"z~>").unwrap(), [0, 0, 0, 0]);
        // A final partial group: "Ma" is 9jqo then cut to 3 characters.
        assert_eq!(decode_ascii85(b"9jr~>").unwrap(), b"Ma");
        assert_eq!(
            decode_ascii85(b"9jqo^").unwrap(),
            b"Man ",
            "missing ~> at the end is tolerated"
        );
        assert_eq!(decode_ascii85(b"9~>"), None, "a single final character");
        assert_eq!(decode_ascii85(b"s8W-\"~>"), None, "above 2^32 - 1");
        assert_eq!(decode_ascii85(b"9jqo^~> junk"), None);
        assert_eq!(decode_ascii85(b"9jqo{~>"), None);
        assert_eq!(decode_ascii85(b"9jzo^~>"), None, "z inside a group");
    }

    #[test]
    fn base85_word_detects_overflow() {
        assert_eq!(base85_word(&[0; 5]), Some(0));
        assert_eq!(base85_word(&[84; 5]), None);
    }

    #[test]
    fn decode_ascii_hex_follows_the_spec() {
        assert_eq!(decode_ascii_hex(b"41 42\n43>").unwrap(), b"ABC");
        assert_eq!(decode_ascii_hex(b"414").unwrap(), [0x41, 0x40]);
        assert_eq!(decode_ascii_hex(b"41> x"), None);
        assert_eq!(decode_ascii_hex(b"4G"), None);
    }

    #[test]
    fn has_predictor_reads_dict_and_array_forms() {
        let doc = Document::with_version("1.7");
        assert!(!has_predictor(&doc, &dictionary! {}, 0));
        assert!(!has_predictor(
            &doc,
            &dictionary! { "DecodeParms" => dictionary! { "Predictor" => 1 } },
            0
        ));
        let per_filter = dictionary! {
            "DecodeParms" => vec![Object::Null, Object::Dictionary(dictionary! { "Predictor" => 2 })]
        };
        assert!(!has_predictor(&doc, &per_filter, 0));
        assert!(has_predictor(&doc, &per_filter, 1));
        assert!(!has_predictor(&doc, &per_filter, 2));
        assert!(!has_predictor(
            &doc,
            &dictionary! { "DecodeParms" => Object::Null },
            0
        ));
        assert!(has_predictor(&doc, &dictionary! { "DecodeParms" => 5 }, 0));
    }

    #[test]
    fn inflate_enforces_the_limit() {
        let data = deflate(&[b'a'; 1000]);
        assert_eq!(inflate(&data, 1000).unwrap().len(), 1000);
        assert_eq!(inflate(&data, 999), None);
        assert_eq!(inflate(b"not zlib", 10), None);
    }

    #[test]
    fn page_content_joins_streams_and_requires_all() {
        let mut doc = Document::with_version("1.7");
        let a = doc.add_object(Stream::new(dictionary! {}, b"q".to_vec()));
        let b = doc.add_object(Stream::new(
            dictionary! { "Filter" => "FlateDecode" },
            deflate(b"Q"),
        ));
        let page = doc.add_object(dictionary! { "Contents" => vec![a.into(), b.into()] });
        assert_eq!(page_content(&doc, page).unwrap(), b"q\nQ\n");
        let bad = doc.add_object(Stream::new(
            dictionary! { "Filter" => "DCTDecode" },
            b"x".to_vec(),
        ));
        let page = doc.add_object(dictionary! { "Contents" => vec![a.into(), bad.into()] });
        assert_eq!(page_content(&doc, page), None);
    }

    #[test]
    fn add_stream_compresses_and_drops_old_filters() {
        let mut doc = Document::with_version("1.7");
        let dict = dictionary! { "Subtype" => "Form", "Filter" => "DCTDecode", "Length" => 5 };
        let id = add_stream(&mut doc, dict, vec![b' '; 500]).unwrap();
        let stream = doc.get_object(id).unwrap().as_stream().unwrap();
        assert_eq!(
            stream.dict.get(b"Filter").unwrap().as_name().unwrap(),
            b"FlateDecode"
        );
        assert_eq!(decode_strict(&doc, stream).unwrap(), vec![b' '; 500]);
        assert_eq!(
            stream.dict.get(b"Subtype").unwrap().as_name().unwrap(),
            b"Form"
        );
    }
}
