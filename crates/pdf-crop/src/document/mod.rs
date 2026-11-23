//! Cropping a whole document with lopdf: load, crop each page, save.

pub mod annotations;
pub mod boxes;
pub mod fonts;
pub mod resources;
pub mod streams;

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::clip::{clip_content, StrokeStyle};
use crate::content::rewrite::apply_edits;
use crate::error::CropError;
use crate::geometry::{Matrix, Rect};
use crate::plan::CropPlan;
use crate::report::CropReport;
use resources::{Editor, Scope};

/// The cropped file and what was done to it.
#[derive(Debug)]
pub struct CropOutput {
    pub pdf: Vec<u8>,
    pub report: CropReport,
}

/// Crop the pages a plan names.
///
/// Order of work, and why:
/// 1. Load the file. Encrypted files are refused: lopdf would save them
///    decrypted, silently removing their protection.
/// 2. Check every page entry and work out its crop (the requested area
///    clipped to the page's visible area, rounded to what the file can
///    store) before changing anything, so a bad entry fails the whole job
///    instead of leaving it half done.
/// 3. For each page: when removing, delete annotations and content outside
///    the crop; then write the boxes.
/// 4. When removing, drop every object no longer reachable from the
///    document (the replaced content streams still hold the removed text
///    and images, and would otherwise be saved as unreferenced objects).
/// 5. Save a complete new file (no incremental update, so no earlier
///    revision of the content survives either).
///
/// # Errors
///
/// See [`CropError`].
pub fn crop_document(input: &[u8], plan: &CropPlan) -> Result<CropOutput, CropError> {
    let mut doc = load(input)?;
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let count = page_ids.len() as u32;
    let mut jobs = Vec::with_capacity(plan.pages.len());
    for page in &plan.pages {
        let index = page.page_index;
        let id = *page_ids
            .get(index as usize)
            .ok_or(CropError::PageOutOfRange { page: index, count })?;
        let visible =
            boxes::visible_area(&doc, id).ok_or(CropError::MissingMediaBox { page: index })?;
        let crop = page
            .rect
            .intersect(&visible)
            .map(|r| boxes::storable(&r))
            .filter(|r| r.width() > 0.0 && r.height() > 0.0)
            .ok_or(CropError::EmptyCrop { page: index })?;
        jobs.push((id, crop));
    }

    let mut report = CropReport::default();
    let mut editor = Editor::new(&mut doc);
    for (id, crop) in jobs {
        if plan.remove_outside {
            let annotations = annotations::remove_outside(editor.doc, id, &crop);
            report.annotations_removed += annotations.removed;
            report.form_fields_kept += annotations.widgets_kept;
            clip_page(&mut editor, id, &crop, &mut report);
        }
        let mut page = editor
            .doc
            .get_dictionary(id)
            .map_err(|e| CropError::Unreadable(e.to_string()))?
            .clone();
        boxes::write_crop(editor.doc, &mut page, &crop, plan.remove_outside);
        editor.doc.objects.insert(id, Object::Dictionary(page));
        report.pages_cropped += 1;
    }
    if plan.remove_outside {
        doc.prune_objects();
    }
    let mut pdf = Vec::new();
    doc.save_to(&mut pdf)
        .map_err(|e| CropError::Write(e.to_string()))?;
    Ok(CropOutput { pdf, report })
}

/// Load a PDF, refusing encrypted ones.
fn load(input: &[u8]) -> Result<Document, CropError> {
    match Document::load_mem(input) {
        Ok(doc) if doc.was_encrypted() || doc.is_encrypted() => Err(CropError::Encrypted),
        Ok(doc) => Ok(doc),
        Err(lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_)) => {
            Err(CropError::Encrypted)
        }
        Err(err) => Err(CropError::Unreadable(err.to_string())),
    }
}

/// Delete the content outside `crop` from a page's content streams.
///
/// The page's streams are decoded and joined, clipped as one stream (as
/// readers treat them), and replaced by a single new stream if anything
/// changed. The old streams are not modified (another page may share them);
/// they become unreachable and are pruned. If the content cannot be read
/// or parsed, the page's content is left exactly as it was and counted.
fn clip_page(editor: &mut Editor, page: ObjectId, crop: &Rect, report: &mut CropReport) {
    let Some(content) = streams::page_content(editor.doc, page) else {
        report.streams_not_analysed += 1;
        return;
    };
    let resources: Dictionary = boxes::inherited(editor.doc, page, b"Resources")
        .and_then(|r| editor.doc.dereference(r).ok())
        .and_then(|(_, o)| o.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    let mut scope = Scope::new(editor, *crop, resources, Vec::new());
    let Ok(result) =
        clip_content(&content, crop, Matrix::IDENTITY, StrokeStyle::default(), &mut scope)
    else {
        report.streams_not_analysed += 1;
        return;
    };
    let new_resources = scope.resources_with_added();
    if result.edits.is_empty() {
        report.merge(&result.report);
        return;
    }
    let Ok(trimmed) = apply_edits(&content, result.edits) else {
        report.streams_not_analysed += 1;
        return;
    };
    let Ok(stream) = streams::add_stream(editor.doc, Dictionary::new(), trimmed) else {
        report.streams_not_analysed += 1;
        return;
    };
    let Ok(page_dict) = editor.doc.get_dictionary_mut(page) else {
        return;
    };
    page_dict.set("Contents", Object::Reference(stream));
    if let Some(resources) = new_resources {
        page_dict.set("Resources", Object::Dictionary(resources));
    }
    report.merge(&result.report);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::PageCrop;
    use crate::test_support::*;
    use boxes::read_rect;
    use lopdf::{dictionary, Stream};

    /// The crop used by most tests: the middle of a 400 x 400 page.
    fn middle() -> Rect {
        Rect::new(100.0, 100.0, 300.0, 300.0)
    }

    fn plan(remove_outside: bool, pages: &[(u32, Rect)]) -> CropPlan {
        CropPlan {
            remove_outside,
            pages: pages
                .iter()
                .map(|(i, r)| PageCrop {
                    page_index: *i,
                    rect: *r,
                })
                .collect(),
        }
    }

    /// Text "SECRET" outside (x = 10) and "KEEP" inside (x = 150).
    const TEXT: &[u8] =
        b"BT /F1 20 Tf 10 50 Td (SECRET) Tj ET BT /F1 20 Tf 150 200 Td (KEEP) Tj ET";

    fn one_page(content: &[u8], resources: Dictionary) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        build(&mut doc, vec![PageSpec::new(content, resources)]);
        save(&mut doc)
    }

    #[test]
    fn hiding_only_sets_the_crop_box_and_keeps_all_content() {
        let input = one_page(TEXT, text_resources());
        let out = crop_document(&input, &plan(false, &[(0, middle())])).unwrap();
        let (doc, page) = page_dict(&out.pdf, 0);
        let dict = doc.get_dictionary(page).unwrap();
        assert_eq!(
            read_rect(&doc, dict.get(b"CropBox").unwrap()),
            Some(middle())
        );
        assert_eq!(
            read_rect(&doc, dict.get(b"MediaBox").unwrap()),
            Some(Rect::new(0.0, 0.0, 400.0, 400.0))
        );
        assert_eq!(page_content(&out.pdf, 0), TEXT);
        assert_eq!(
            out.report,
            CropReport {
                pages_cropped: 1,
                ..CropReport::default()
            }
        );
    }

    #[test]
    fn removing_deletes_text_outside_from_every_byte_of_the_file() {
        let input = one_page(TEXT, text_resources());
        let out = crop_document(&input, &plan(true, &[(0, middle())])).unwrap();
        let all = everything(&out.pdf);
        assert!(!contains(&all, b"SECRET"));
        assert!(contains(&page_content(&out.pdf, 0), b"(KEEP) Tj"));
        assert_eq!(out.report.glyphs_removed, 6);
        let (doc, page) = page_dict(&out.pdf, 0);
        let media = doc.get_dictionary(page).unwrap().get(b"MediaBox").unwrap();
        assert_eq!(read_rect(&doc, media), Some(middle()));
    }

    #[test]
    fn removing_from_one_page_leaves_a_shared_content_stream_alone() {
        let mut doc = Document::with_version("1.7");
        let ids = build(
            &mut doc,
            vec![
                PageSpec::new(TEXT, text_resources()),
                PageSpec::new(b"", text_resources()),
            ],
        );
        let shared = doc
            .get_dictionary(ids[0])
            .unwrap()
            .get(b"Contents")
            .unwrap()
            .clone();
        doc.get_dictionary_mut(ids[1])
            .unwrap()
            .set("Contents", shared);
        let input = save(&mut doc);
        let out = crop_document(&input, &plan(true, &[(0, middle())])).unwrap();
        assert!(!contains(&page_content(&out.pdf, 0), b"SECRET"));
        assert_eq!(page_content(&out.pdf, 1), TEXT);
    }

    #[test]
    fn forms_crossing_the_edge_get_trimmed_copies() {
        let mut doc = Document::with_version("1.7");
        let form = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 400.into(), 400.into()],
                "Resources" => text_resources(),
            },
            TEXT.to_vec(),
        ));
        let resources = dictionary! { "XObject" => dictionary! { "Fm1" => form } };
        let ids = build(
            &mut doc,
            vec![
                PageSpec::new(b"/Fm1 Do", resources.clone()),
                PageSpec::new(b"/Fm1 Do", resources),
            ],
        );
        let input = save(&mut doc);
        let out = crop_document(&input, &plan(true, &[(0, middle())])).unwrap();
        assert_eq!(out.report.forms_trimmed, 1);
        assert_eq!(out.report.glyphs_removed, 6);
        assert!(contains(&page_content(&out.pdf, 0), b"/Fm1_crop1 "));
        // Page 2 still draws the original form, which still has its text.
        assert_eq!(page_content(&out.pdf, 1), b"/Fm1 Do");
        let saved = Document::load_mem(&out.pdf).unwrap();
        let original = saved.get_object(form).unwrap().as_stream().unwrap();
        assert_eq!(original.content, TEXT);
        let _ = ids;
    }

    #[test]
    fn annotations_outside_are_removed_and_widgets_kept() {
        let mut doc = Document::with_version("1.7");
        let ids = build(&mut doc, vec![PageSpec::new(b"", dictionary! {})]);
        let link = doc.add_object(dictionary! { "Subtype" => "Link", "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()] });
        let widget = doc.add_object(dictionary! { "Subtype" => "Widget", "Rect" => vec![0.into(), 0.into(), 10.into(), 10.into()] });
        doc.get_dictionary_mut(ids[0]).unwrap().set(
            "Annots",
            vec![Object::Reference(link), Object::Reference(widget)],
        );
        let input = save(&mut doc);
        let out = crop_document(&input, &plan(true, &[(0, middle())])).unwrap();
        assert_eq!(
            (out.report.annotations_removed, out.report.form_fields_kept),
            (1, 1)
        );
        let saved = Document::load_mem(&out.pdf).unwrap();
        assert!(
            saved.get_object(link).is_err(),
            "the removed link is pruned from the file"
        );
    }

    #[test]
    fn unreadable_content_is_kept_and_counted() {
        let input = one_page(b"BT (unterminated", text_resources());
        let out = crop_document(&input, &plan(true, &[(0, middle())])).unwrap();
        assert_eq!(out.report.streams_not_analysed, 1);
        assert_eq!(page_content(&out.pdf, 0), b"BT (unterminated");
    }

    #[test]
    fn errors_for_bad_pages_and_crops() {
        let input = one_page(b"", dictionary! {});
        assert_eq!(
            crop_document(&input, &plan(false, &[(1, middle())])).unwrap_err(),
            CropError::PageOutOfRange { page: 1, count: 1 }
        );
        assert_eq!(
            crop_document(
                &input,
                &plan(false, &[(0, Rect::new(500.0, 500.0, 600.0, 600.0))])
            )
            .unwrap_err(),
            CropError::EmptyCrop { page: 0 }
        );
        let mut doc = Document::with_version("1.7");
        let ids = build(&mut doc, vec![PageSpec::new(b"", dictionary! {})]);
        doc.get_dictionary_mut(ids[0]).unwrap().remove(b"MediaBox");
        let input = save(&mut doc);
        assert_eq!(
            crop_document(&input, &plan(false, &[(0, middle())])).unwrap_err(),
            CropError::MissingMediaBox { page: 0 }
        );
        assert!(matches!(
            crop_document(b"%PDF-1.7 nonsense", &plan(false, &[(0, middle())])),
            Err(CropError::Unreadable(_))
        ));
    }

    #[test]
    fn crop_is_clipped_to_the_visible_area() {
        let input = one_page(b"", dictionary! {});
        let out = crop_document(
            &input,
            &plan(false, &[(0, Rect::new(-50.0, 300.0, 100.0, 900.0))]),
        )
        .unwrap();
        let (doc, page) = page_dict(&out.pdf, 0);
        let crop = doc.get_dictionary(page).unwrap().get(b"CropBox").unwrap();
        assert_eq!(
            read_rect(&doc, crop),
            Some(Rect::new(0.0, 300.0, 100.0, 400.0))
        );
    }

    #[test]
    fn encrypted_files_are_refused() {
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
        for name in ["owner-restricted.pdf", "user-password.pdf"] {
            let input = std::fs::read(format!("{fixtures}{name}")).unwrap();
            assert_eq!(
                crop_document(&input, &plan(false, &[(0, middle())])).unwrap_err(),
                CropError::Encrypted,
                "{name}"
            );
        }
        let plain = std::fs::read(format!("{fixtures}plain.pdf")).unwrap();
        assert!(crop_document(
            &plain,
            &plan(true, &[(0, Rect::new(0.0, 0.0, 200.0, 200.0))])
        )
        .is_ok());
    }

    #[test]
    fn load_refuses_encryption_and_garbage() {
        assert!(matches!(load(b"garbage"), Err(CropError::Unreadable(_))));
    }

    #[test]
    fn clip_page_replaces_contents_and_adds_resources() {
        let mut doc = Document::with_version("1.7");
        let form = doc.add_object(Stream::new(
            dictionary! { "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 400.into(), 400.into()], "Resources" => text_resources() },
            TEXT.to_vec(),
        ));
        let ids = build(
            &mut doc,
            vec![PageSpec::new(
                b"/Fm1 Do",
                dictionary! { "XObject" => dictionary! { "Fm1" => form } },
            )],
        );
        let mut report = CropReport::default();
        let mut editor = Editor::new(&mut doc);
        clip_page(&mut editor, ids[0], &middle(), &mut report);
        let page = doc.get_dictionary(ids[0]).unwrap();
        let xobjects = page
            .get(b"Resources")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"XObject")
            .unwrap()
            .as_dict()
            .unwrap();
        assert!(xobjects.has(b"Fm1") && xobjects.has(b"Fm1_crop1"));
        assert_eq!(report.forms_trimmed, 1);
    }
}
