//! Page boxes: reading the visible area and writing the crop.

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::geometry::Rect;

/// How many `/Parent` levels are followed for inherited attributes.
const MAX_INHERITANCE_DEPTH: usize = 64;

/// A number object (integer or real), through a reference if needed.
pub fn number(doc: &Document, obj: &Object) -> Option<f64> {
    match doc.dereference(obj).ok()?.1 {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

/// A rectangle object (`[x0 y0 x1 y1]`, corners in any order), through
/// references if needed; `None` unless it has four finite numbers.
pub fn read_rect(doc: &Document, obj: &Object) -> Option<Rect> {
    let Object::Array(items) = doc.dereference(obj).ok()?.1 else {
        return None;
    };
    let values: Vec<f64> = items
        .iter()
        .map(|o| number(doc, o))
        .collect::<Option<_>>()?;
    let [x0, y0, x1, y1] = values.as_slice() else {
        return None;
    };
    let rect = Rect::new(*x0, *y0, *x1, *y1);
    rect.is_finite().then_some(rect)
}

/// A page attribute, looked up the `/Parent` chain when the page itself
/// does not have it (ISO 32000-1, 7.7.3.4: `Resources`, `MediaBox`,
/// `CropBox` and `Rotate` are inheritable).
pub fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut node = doc.get_dictionary(page).ok()?;
    for _ in 0..MAX_INHERITANCE_DEPTH {
        if let Ok(value) = node.get(key) {
            return Some(value);
        }
        let parent = node.get(b"Parent").ok()?.as_reference().ok()?;
        node = doc.get_dictionary(parent).ok()?;
    }
    None
}

/// The page's visible area: the CropBox (MediaBox when absent) clipped to
/// the MediaBox, the same area PDF readers show. `None` when the MediaBox
/// is missing or unusable, or the CropBox does not overlap it.
pub fn visible_area(doc: &Document, page: ObjectId) -> Option<Rect> {
    let media = read_rect(doc, inherited(doc, page, b"MediaBox")?)?;
    match inherited(doc, page, b"CropBox").and_then(|o| read_rect(doc, o)) {
        Some(crop) => crop.intersect(&media),
        None => (media.width() > 0.0 && media.height() > 0.0).then_some(media),
    }
}

/// `rect` rounded to the precision the file can store.
///
/// lopdf keeps real numbers as 32-bit floats, so this is what the written
/// box will contain. Rounding first means the box in the file and the box
/// every keep-or-delete decision was made against are exactly the same.
pub fn storable(rect: &Rect) -> Rect {
    let f = |v: f64| f64::from(v as f32);
    Rect::new(f(rect.left), f(rect.bottom), f(rect.right), f(rect.top))
}

/// A rectangle as a PDF array; whole numbers are written as integers.
pub fn rect_object(rect: &Rect) -> Object {
    Object::Array(
        rect.to_array()
            .iter()
            .map(|&v| {
                if v.fract() == 0.0 && v.abs() < 1e9 {
                    Object::Integer(v as i64)
                } else {
                    Object::Real(v as f32)
                }
            })
            .collect(),
    )
}

/// Write the crop into a page dictionary.
///
/// - Hiding only (`remove_outside` false): set the `CropBox`. The content
///   stays in the file and anyone can bring it back by resetting the box.
/// - Removing: set both the `MediaBox` and the `CropBox`, so no box reset
///   can reveal anything beyond the crop; shrink the `BleedBox`, `TrimBox`
///   and `ArtBox` (if present; they are not inherited) into it, since they
///   must not extend past the media; and drop the page thumbnail (`Thumb`,
///   an image of the whole uncropped page) and private application data
///   (`PieceInfo`, which can hold the page's original artwork).
pub fn write_crop(doc: &Document, page: &mut Dictionary, crop: &Rect, remove_outside: bool) {
    page.set("CropBox", rect_object(crop));
    if !remove_outside {
        return;
    }
    page.set("MediaBox", rect_object(crop));
    for key in [&b"BleedBox"[..], b"TrimBox", b"ArtBox"] {
        let current = page.get(key).ok().and_then(|o| read_rect(doc, o));
        if let Some(rect) = current {
            let inside = rect.intersect(crop).unwrap_or(*crop);
            page.set(key.to_vec(), rect_object(&inside));
        } else if page.has(key) {
            page.remove(key);
        }
    }
    page.remove(b"Thumb");
    page.remove(b"PieceInfo");
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn doc_with_page(page: Dictionary, parent: Dictionary) -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.7");
        let parent_id = doc.add_object(parent);
        let mut page = page;
        page.set("Parent", parent_id);
        let page_id = doc.add_object(page);
        (doc, page_id)
    }

    fn rect(values: [i64; 4]) -> Object {
        Object::Array(values.iter().map(|v| Object::Integer(*v)).collect())
    }

    #[test]
    fn number_reads_integers_reals_and_references() {
        let mut doc = Document::with_version("1.7");
        let id = doc.add_object(Object::Real(2.5));
        assert_eq!(number(&doc, &Object::Integer(3)), Some(3.0));
        assert_eq!(number(&doc, &Object::Reference(id)), Some(2.5));
        assert_eq!(number(&doc, &Object::Null), None);
    }

    #[test]
    fn read_rect_normalises_and_validates() {
        let doc = Document::with_version("1.7");
        assert_eq!(
            read_rect(&doc, &rect([612, 792, 0, 0])),
            Some(Rect::new(0.0, 0.0, 612.0, 792.0))
        );
        assert_eq!(
            read_rect(&doc, &rect([0, 0, 1, 1]).clone()),
            Some(Rect::new(0.0, 0.0, 1.0, 1.0))
        );
        assert_eq!(
            read_rect(&doc, &Object::Array(vec![Object::Integer(1)])),
            None
        );
        assert_eq!(read_rect(&doc, &Object::Integer(1)), None);
        let nan = Object::Array(vec![Object::Real(f32::NAN), 0.into(), 1.into(), 1.into()]);
        assert_eq!(read_rect(&doc, &nan), None);
    }

    #[test]
    fn inherited_walks_up_the_parents() {
        let (doc, page) = doc_with_page(
            dictionary! {},
            dictionary! { "MediaBox" => rect([0, 0, 10, 20]) },
        );
        assert!(inherited(&doc, page, b"MediaBox").is_some());
        assert!(inherited(&doc, page, b"CropBox").is_none());
    }

    #[test]
    fn visible_area_clips_crop_box_to_media_box() {
        let (doc, page) = doc_with_page(
            dictionary! { "CropBox" => rect([-10, 50, 300, 900]) },
            dictionary! { "MediaBox" => rect([0, 0, 612, 792]) },
        );
        assert_eq!(
            visible_area(&doc, page),
            Some(Rect::new(0.0, 50.0, 300.0, 792.0))
        );
        let (doc, page) = doc_with_page(dictionary! {}, dictionary! {});
        assert_eq!(visible_area(&doc, page), None);
        let (doc, page) = doc_with_page(
            dictionary! { "MediaBox" => rect([0, 0, 0, 10]) },
            dictionary! {},
        );
        assert_eq!(visible_area(&doc, page), None);
    }

    #[test]
    fn storable_rounds_to_f32() {
        let r = storable(&Rect::new(0.1, 0.0, 595.2756, 841.8898));
        assert_eq!(r.left, f64::from(0.1f32));
        assert_eq!(r.right, f64::from(595.2756f32));
    }

    #[test]
    fn rect_object_prefers_integers() {
        assert_eq!(
            rect_object(&Rect::new(0.0, 0.5, 10.0, 20.0)),
            Object::Array(vec![0.into(), Object::Real(0.5), 10.into(), 20.into()])
        );
    }

    #[test]
    fn write_crop_hiding_only_sets_the_crop_box() {
        let doc = Document::with_version("1.7");
        let mut page = dictionary! { "MediaBox" => rect([0, 0, 600, 800]), "Thumb" => 1 };
        write_crop(&doc, &mut page, &Rect::new(10.0, 10.0, 100.0, 100.0), false);
        assert_eq!(page.get(b"CropBox").unwrap(), &rect([10, 10, 100, 100]));
        assert_eq!(page.get(b"MediaBox").unwrap(), &rect([0, 0, 600, 800]));
        assert!(page.has(b"Thumb"));
    }

    #[test]
    fn write_crop_removing_sets_every_box_and_drops_hidden_data() {
        let doc = Document::with_version("1.7");
        let mut page = dictionary! {
            "MediaBox" => rect([0, 0, 600, 800]),
            "TrimBox" => rect([50, 50, 550, 750]),
            "BleedBox" => rect([500, 500, 600, 800]),
            "ArtBox" => "broken",
            "Thumb" => 1,
            "PieceInfo" => dictionary! {},
        };
        write_crop(&doc, &mut page, &Rect::new(0.0, 0.0, 300.0, 400.0), true);
        assert_eq!(page.get(b"MediaBox").unwrap(), &rect([0, 0, 300, 400]));
        assert_eq!(page.get(b"CropBox").unwrap(), &rect([0, 0, 300, 400]));
        assert_eq!(page.get(b"TrimBox").unwrap(), &rect([50, 50, 300, 400]));
        // No overlap: the box becomes the crop itself.
        assert_eq!(page.get(b"BleedBox").unwrap(), &rect([0, 0, 300, 400]));
        assert!(!page.has(b"ArtBox"));
        assert!(!page.has(b"Thumb"));
        assert!(!page.has(b"PieceInfo"));
    }
}
