//! Removing annotations that lie outside the crop area.

use std::collections::HashSet;

use lopdf::{Document, Object, ObjectId};

use super::boxes::read_rect;
use crate::geometry::{Placement, Rect};

/// What [`remove_outside`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AnnotationOutcome {
    /// Annotations taken off the page.
    pub removed: u32,
    /// Form fields (widget annotations) outside the crop area that were
    /// kept: removing a widget from the page would leave its field in the
    /// form, still holding its value, so the form would break and nothing
    /// would be gained.
    pub widgets_kept: u32,
}

/// Take every annotation that lies entirely outside `crop` off the page.
///
/// Rules:
/// - an annotation whose `/Rect` cannot be read is kept (it cannot be
///   placed);
/// - widgets are kept (see [`AnnotationOutcome::widgets_kept`]);
/// - a popup follows its parent (`/Parent`): it is removed when the parent
///   is removed and kept when the parent is kept, wherever the popup sits
///   (popups are usually placed in the margin, and only display the
///   parent's text);
/// - any other annotation outside is removed.
///
/// The page gets its own direct `/Annots` array, so an array shared with
/// another page is never changed.
pub fn remove_outside(doc: &mut Document, page: ObjectId, crop: &Rect) -> AnnotationOutcome {
    let mut outcome = AnnotationOutcome::default();
    let Some(entries) = annotation_entries(doc, page) else {
        return outcome;
    };
    let mut removed: HashSet<ObjectId> = HashSet::new();
    let mut keep = vec![true; entries.len()];
    let mut popups = Vec::new();
    for (i, entry) in entries.iter().enumerate() {
        let Some(annot) = doc
            .dereference(entry)
            .ok()
            .and_then(|(_, o)| o.as_dict().ok())
        else {
            continue;
        };
        let subtype = annot
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok())
            .unwrap_or(b"");
        if subtype == b"Popup" {
            popups.push(i);
            continue;
        }
        let outside = annot
            .get(b"Rect")
            .ok()
            .and_then(|r| read_rect(doc, r))
            .is_some_and(|r| r.placement_in(crop) == Placement::Outside);
        if !outside {
            continue;
        }
        if subtype == b"Widget" {
            outcome.widgets_kept += 1;
            continue;
        }
        keep[i] = false;
        if let Object::Reference(id) = entry {
            removed.insert(*id);
        }
    }
    for i in popups {
        let parent = doc
            .dereference(&entries[i])
            .ok()
            .and_then(|(_, o)| o.as_dict().ok())
            .and_then(|d| d.get(b"Parent").ok())
            .and_then(|p| p.as_reference().ok());
        if parent.is_some_and(|p| removed.contains(&p)) {
            keep[i] = false;
        }
    }
    outcome.removed = keep.iter().filter(|k| !**k).count() as u32;
    if outcome.removed > 0 {
        let kept: Vec<Object> = entries
            .into_iter()
            .zip(keep)
            .filter_map(|(e, k)| k.then_some(e))
            .collect();
        if let Ok(page) = doc.get_dictionary_mut(page) {
            if kept.is_empty() {
                page.remove(b"Annots");
            } else {
                page.set("Annots", Object::Array(kept));
            }
        }
    }
    outcome
}

/// The entries of the page's `/Annots` array (references or dictionaries).
fn annotation_entries(doc: &Document, page: ObjectId) -> Option<Vec<Object>> {
    let annots = doc.get_dictionary(page).ok()?.get(b"Annots").ok()?;
    match doc.dereference(annots).ok()?.1 {
        Object::Array(items) => Some(items.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    fn annot(doc: &mut Document, subtype: &str, rect: [i64; 4]) -> ObjectId {
        doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => subtype,
            "Rect" => rect.iter().map(|v| Object::Integer(*v)).collect::<Vec<_>>(),
        })
    }

    fn page_with(doc: &mut Document, annots: Vec<Object>) -> ObjectId {
        doc.add_object(dictionary! { "Annots" => annots })
    }

    fn crop() -> Rect {
        Rect::new(100.0, 100.0, 300.0, 300.0)
    }

    fn remaining(doc: &Document, page: ObjectId) -> Vec<Object> {
        annotation_entries(doc, page).unwrap_or_default()
    }

    #[test]
    fn removes_annotations_outside_and_keeps_the_rest() {
        let mut doc = Document::with_version("1.7");
        let outside = annot(&mut doc, "Link", [0, 0, 50, 50]);
        let crossing = annot(&mut doc, "Square", [50, 150, 150, 200]);
        let inside = annot(&mut doc, "Text", [150, 150, 160, 160]);
        let page = page_with(
            &mut doc,
            vec![outside.into(), crossing.into(), inside.into()],
        );
        let outcome = remove_outside(&mut doc, page, &crop());
        assert_eq!(
            outcome,
            AnnotationOutcome {
                removed: 1,
                widgets_kept: 0
            }
        );
        assert_eq!(remaining(&doc, page), vec![crossing.into(), inside.into()]);
    }

    #[test]
    fn keeps_widgets_and_unreadable_rects() {
        let mut doc = Document::with_version("1.7");
        let widget = annot(&mut doc, "Widget", [0, 0, 50, 50]);
        let broken = doc.add_object(dictionary! { "Subtype" => "Link", "Rect" => "nope" });
        let page = page_with(
            &mut doc,
            vec![widget.into(), broken.into(), Object::Integer(7)],
        );
        let outcome = remove_outside(&mut doc, page, &crop());
        assert_eq!(
            outcome,
            AnnotationOutcome {
                removed: 0,
                widgets_kept: 1
            }
        );
        assert_eq!(remaining(&doc, page).len(), 3);
    }

    #[test]
    fn popups_follow_their_parent() {
        let mut doc = Document::with_version("1.7");
        let gone = annot(&mut doc, "Text", [0, 0, 10, 10]);
        let kept = annot(&mut doc, "Text", [150, 150, 160, 160]);
        let popup_of_gone = doc.add_object(dictionary! { "Subtype" => "Popup", "Rect" => vec![150.into(), 150.into(), 200.into(), 200.into()], "Parent" => gone });
        let popup_of_kept = doc.add_object(dictionary! { "Subtype" => "Popup", "Rect" => vec![0.into(), 0.into(), 50.into(), 50.into()], "Parent" => kept });
        let page = page_with(
            &mut doc,
            vec![
                gone.into(),
                kept.into(),
                popup_of_gone.into(),
                popup_of_kept.into(),
            ],
        );
        let outcome = remove_outside(&mut doc, page, &crop());
        assert_eq!(outcome.removed, 2);
        assert_eq!(
            remaining(&doc, page),
            vec![kept.into(), popup_of_kept.into()]
        );
    }

    #[test]
    fn removing_everything_drops_the_array_and_never_touches_a_shared_one() {
        let mut doc = Document::with_version("1.7");
        let outside = annot(&mut doc, "Link", [0, 0, 50, 50]);
        let shared = doc.add_object(Object::Array(vec![outside.into()]));
        let page = doc.add_object(dictionary! { "Annots" => shared });
        let outcome = remove_outside(&mut doc, page, &crop());
        assert_eq!(outcome.removed, 1);
        assert!(!doc.get_dictionary(page).unwrap().has(b"Annots"));
        assert_eq!(
            doc.get_object(shared).unwrap(),
            &Object::Array(vec![outside.into()])
        );
    }

    #[test]
    fn pages_without_annotations_are_untouched() {
        let mut doc = Document::with_version("1.7");
        let page = doc.add_object(dictionary! {});
        assert_eq!(
            remove_outside(&mut doc, page, &crop()),
            AnnotationOutcome::default()
        );
        assert!(annotation_entries(&doc, page).is_none());
    }
}
