//! Test-only helpers: build small PDFs with lopdf and inspect results.

use flate2::read::ZlibDecoder;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use std::io::Read;

/// One page to build: its content and resources.
pub struct PageSpec {
    pub content: Vec<u8>,
    pub resources: Dictionary,
    pub media_box: [i64; 4],
}

impl PageSpec {
    /// A 400 x 400 page with this content and resources.
    pub fn new(content: &[u8], resources: Dictionary) -> PageSpec {
        PageSpec {
            content: content.to_vec(),
            resources,
            media_box: [0, 0, 400, 400],
        }
    }
}

/// A document with the given pages. Returns it with its page ids.
pub fn build(doc: &mut Document, pages: Vec<PageSpec>) -> Vec<ObjectId> {
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for page in pages {
        let content = doc.add_object(Stream::new(dictionary! {}, page.content));
        let id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => page.media_box.iter().map(|v| Object::Integer(*v)).collect::<Vec<_>>(),
            "Contents" => content,
            "Resources" => page.resources,
        });
        kids.push(id);
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids.iter().map(|k| Object::Reference(*k)).collect::<Vec<_>>(),
            "Count" => kids.len() as i64,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    kids
}

/// The bytes of a document.
pub fn save(doc: &mut Document) -> Vec<u8> {
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

/// Helvetica as most writers declare it: standard font, no widths.
pub fn helvetica() -> Dictionary {
    dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding" }
}

/// Resources with Helvetica as `/F1`.
pub fn text_resources() -> Dictionary {
    dictionary! { "Font" => dictionary! { "F1" => helvetica() } }
}

/// Every stream of a saved PDF, decoded where possible and concatenated,
/// plus the raw file: where removed text must not appear.
pub fn everything(pdf: &[u8]) -> Vec<u8> {
    let doc = Document::load_mem(pdf).unwrap();
    let mut all = pdf.to_vec();
    for object in doc.objects.values() {
        if let Object::Stream(stream) = object {
            let mut decoded = Vec::new();
            if ZlibDecoder::new(stream.content.as_slice())
                .read_to_end(&mut decoded)
                .is_ok()
            {
                all.extend(decoded);
            }
        }
    }
    all
}

/// Whether `needle` occurs in `haystack`.
pub fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// The decoded content of a page of a saved PDF (lopdf ends every stream
/// it joins with a line break; one trailing break is dropped).
pub fn page_content(pdf: &[u8], index: usize) -> Vec<u8> {
    let doc = Document::load_mem(pdf).unwrap();
    let page = *doc.get_pages().values().nth(index).unwrap();
    let mut content = doc.get_page_content(page);
    if content.last() == Some(&b'\n') {
        content.pop();
    }
    content
}

/// A page dictionary of a saved PDF.
pub fn page_dict(pdf: &[u8], index: usize) -> (Document, ObjectId) {
    let doc = Document::load_mem(pdf).unwrap();
    let page = *doc.get_pages().values().nth(index).unwrap();
    (doc, page)
}
