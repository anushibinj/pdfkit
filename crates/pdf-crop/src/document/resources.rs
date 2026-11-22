//! Resources of a content stream, read from the document, and trimmed
//! copies of form XObjects.

use std::collections::HashMap;
use std::rc::Rc;

use lopdf::{Dictionary, Document, Object, ObjectId};

use super::boxes::{number, read_rect};
use super::fonts::load_font;
use super::streams::{add_stream, decode_strict};
use crate::clip::{clip_content, ContentContext, ExtGState, FontLookup, XObject};
use crate::content::rewrite::apply_edits;
use crate::geometry::{Matrix, Rect};
use crate::report::CropReport;

/// Deepest chain of forms inside forms that is trimmed.
const MAX_FORM_DEPTH: usize = 12;

/// The document being cropped, plus what has been learned about it.
pub struct Editor<'d> {
    pub doc: &'d mut Document,
    /// Fonts already measured, by object number (fonts are shared widely).
    fonts: HashMap<ObjectId, FontLookup>,
}

impl<'d> Editor<'d> {
    /// Start editing `doc`.
    pub fn new(doc: &'d mut Document) -> Editor<'d> {
        Editor {
            doc,
            fonts: HashMap::new(),
        }
    }

    /// The metrics of a font resource (a reference or a dictionary).
    fn font(&mut self, font: &Object) -> FontLookup {
        let measure = |doc: &Document, dict: &Dictionary| match load_font(doc, dict) {
            Some(metrics) => FontLookup::Measured(Rc::new(metrics)),
            None => FontLookup::Unmeasurable,
        };
        match font {
            Object::Reference(id) => {
                if let Some(known) = self.fonts.get(id) {
                    return known.clone();
                }
                let lookup = match self.doc.get_dictionary(*id) {
                    Ok(dict) => measure(self.doc, dict),
                    Err(_) => FontLookup::Unmeasurable,
                };
                self.fonts.insert(*id, lookup.clone());
                lookup
            }
            Object::Dictionary(dict) => measure(self.doc, dict),
            _ => FontLookup::Unmeasurable,
        }
    }
}

/// The resources one content stream sees, and the trimmed forms added for
/// it.
pub struct Scope<'e, 'd> {
    editor: &'e mut Editor<'d>,
    crop: Rect,
    /// The stream's `/Resources`, resolved.
    resources: Dictionary,
    /// Forms being trimmed around this stream, outermost first.
    chain: Vec<ObjectId>,
    /// Trimmed copies to add to this stream's XObjects, by new name.
    added: Vec<(Vec<u8>, ObjectId)>,
}

impl<'e, 'd> Scope<'e, 'd> {
    /// The scope of a stream with `resources`, inside the forms `chain`.
    pub fn new(
        editor: &'e mut Editor<'d>,
        crop: Rect,
        resources: Dictionary,
        chain: Vec<ObjectId>,
    ) -> Scope<'e, 'd> {
        Scope {
            editor,
            crop,
            resources,
            chain,
            added: Vec::new(),
        }
    }

    /// A resource category (`/Font`, `/XObject`, ...), resolved.
    fn category(&self, key: &[u8]) -> Option<&Dictionary> {
        let value = self.resources.get(key).ok()?;
        self.editor.doc.dereference(value).ok()?.1.as_dict().ok()
    }

    /// The entry `name` of a resource category (as stored: usually a
    /// reference).
    fn entry(&self, key: &[u8], name: &[u8]) -> Option<Object> {
        self.category(key)?.get(name).ok().cloned()
    }

    /// The resources with the trimmed copies added to `/XObject`, or `None`
    /// when nothing was added. The `/XObject` dictionary is copied, so one
    /// shared with other streams never changes.
    pub fn resources_with_added(&self) -> Option<Dictionary> {
        if self.added.is_empty() {
            return None;
        }
        let mut resources = self.resources.clone();
        let mut xobjects = self.category(b"XObject").cloned().unwrap_or_default();
        for (name, id) in &self.added {
            xobjects.set(name.clone(), Object::Reference(*id));
        }
        resources.set("XObject", Object::Dictionary(xobjects));
        Some(resources)
    }

    /// A new XObject name based on `base` that this stream's resources do
    /// not use yet.
    fn unique_name(&self, base: &[u8]) -> Vec<u8> {
        let taken = |name: &[u8]| {
            self.category(b"XObject").is_some_and(|d| d.has(name))
                || self.added.iter().any(|(n, _)| n == name)
        };
        (1..)
            .map(|n| [base, format!("_crop{n}").as_bytes()].concat())
            .find(|candidate| !taken(candidate))
            .unwrap_or_default()
    }
}

impl ContentContext for Scope<'_, '_> {
    fn font(&mut self, name: &[u8]) -> FontLookup {
        match self.entry(b"Font", name) {
            Some(font) => self.editor.font(&font),
            None => FontLookup::Unmeasurable,
        }
    }

    fn ext_gstate(&mut self, name: &[u8]) -> Option<ExtGState> {
        let entry = self.entry(b"ExtGState", name)?;
        let doc: &Document = self.editor.doc;
        let dict = doc.dereference(&entry).ok()?.1.as_dict().ok()?.clone();
        // Present but unreadable values count as unknown (infinite reach).
        let read = |key: &[u8]| {
            dict.get(key)
                .ok()
                .map(|o| number(doc, o).unwrap_or(f64::INFINITY))
        };
        let line_width = read(b"LW");
        let miter_limit = read(b"ML");
        let font = match dict
            .get(b"Font")
            .ok()
            .map(|o| doc.dereference(o).map(|(_, v)| v.clone()))
        {
            Some(Ok(Object::Array(items))) if items.len() == 2 => match number(doc, &items[1]) {
                Some(size) => Some((self.editor.font(&items[0]), size)),
                None => Some((FontLookup::Unmeasurable, 0.0)),
            },
            Some(_) => Some((FontLookup::Unmeasurable, 0.0)),
            None => None,
        };
        Some(ExtGState {
            line_width,
            miter_limit,
            font,
        })
    }

    fn xobject(&mut self, name: &[u8]) -> Option<XObject> {
        let Object::Reference(id) = self.entry(b"XObject", name)? else {
            return Some(XObject::Other);
        };
        let doc: &Document = self.editor.doc;
        let Ok(stream) = doc.get_object(id).and_then(Object::as_stream) else {
            return Some(XObject::Other);
        };
        let dict = &stream.dict;
        Some(
            match dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) {
                Some(b"Image") => XObject::Image,
                Some(b"Form") => {
                    let bbox = dict.get(b"BBox").ok().and_then(|o| read_rect(doc, o));
                    let matrix = match dict
                        .get(b"Matrix")
                        .ok()
                        .map(|o| doc.dereference(o).map(|(_, v)| v))
                    {
                        None => Some(Matrix::IDENTITY),
                        Some(Ok(Object::Array(items))) => items
                            .iter()
                            .map(|o| number(doc, o))
                            .collect::<Option<Vec<f64>>>()
                            .and_then(|v| Matrix::from_slice(&v)),
                        Some(_) => None,
                    };
                    match (bbox, matrix) {
                        (Some(bbox), Some(matrix)) if matrix.is_finite() => {
                            XObject::Form { bbox, matrix }
                        }
                        _ => XObject::Other,
                    }
                }
                _ => XObject::Other,
            },
        )
    }

    /// Trim the form `name` with copy-on-write.
    ///
    /// Steps:
    /// 1. Refuse cycles (a form that draws itself) and very deep nesting.
    /// 2. Decode the form's content strictly; give up if that fails.
    /// 3. Clip it in a child scope with the form's own resources (or, for
    ///    old files whose forms have none, this stream's), drawn with
    ///    `ctm`. Forms inside it are trimmed the same way, recursively.
    /// 4. If nothing changes, keep the original.
    /// 5. Otherwise add a new form: a copy of the original's dictionary
    ///    (BBox, Matrix, Group, ...) with the trimmed content, and with
    ///    resources naming any trimmed inner forms. The original is never
    ///    modified, because other pages or other places on this page may
    ///    draw it uncropped.
    fn trim_form(&mut self, name: &[u8], ctm: &Matrix, report: &mut CropReport) -> Option<Vec<u8>> {
        let Object::Reference(id) = self.entry(b"XObject", name)? else {
            return None;
        };
        if self.chain.contains(&id) || self.chain.len() >= MAX_FORM_DEPTH {
            return None;
        }
        let stream = self
            .editor
            .doc
            .get_object(id)
            .ok()?
            .as_stream()
            .ok()?
            .clone();
        let Some(content) = decode_strict(self.editor.doc, &stream) else {
            report.streams_not_analysed += 1;
            return None;
        };
        let resources = match stream.dict.get(b"Resources") {
            Ok(r) => self
                .editor
                .doc
                .dereference(r)
                .ok()?
                .1
                .as_dict()
                .ok()?
                .clone(),
            Err(_) => self.resources.clone(),
        };
        let mut chain = self.chain.clone();
        chain.push(id);
        let crop = self.crop;
        let mut child = Scope::new(&mut *self.editor, crop, resources, chain);
        let Ok(result) = clip_content(&content, &crop, *ctm, &mut child) else {
            report.streams_not_analysed += 1;
            return None;
        };
        let child_resources = child.resources_with_added();
        if result.edits.is_empty() {
            report.merge(&result.report);
            return None;
        }
        let Ok(trimmed) = apply_edits(&content, result.edits) else {
            report.streams_not_analysed += 1;
            return None;
        };
        let mut dict = stream.dict.clone();
        if let Some(resources) = child_resources {
            dict.set("Resources", Object::Dictionary(resources));
        }
        let new_id = add_stream(self.editor.doc, dict, trimmed).ok()?;
        report.merge(&result.report);
        let new_name = self.unique_name(name);
        self.added.push((new_name.clone(), new_id));
        Some(new_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::helvetica;
    use lopdf::{dictionary, Stream};

    fn crop() -> Rect {
        Rect::new(100.0, 100.0, 300.0, 300.0)
    }

    fn form(doc: &mut Document, content: &[u8], resources: Option<Dictionary>) -> ObjectId {
        let mut dict = dictionary! { "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 400.into(), 400.into()] };
        if let Some(r) = resources {
            dict.set("Resources", r);
        }
        doc.add_object(Stream::new(dict, content.to_vec()))
    }

    #[test]
    fn fonts_are_measured_once_per_object() {
        let mut doc = Document::with_version("1.7");
        let f1 = doc.add_object(helvetica());
        let resources =
            dictionary! { "Font" => dictionary! { "F1" => f1, "F2" => helvetica(), "F3" => 7 } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        assert!(matches!(scope.font(b"F1"), FontLookup::Measured(_)));
        assert!(matches!(scope.font(b"F2"), FontLookup::Measured(_)));
        assert!(matches!(scope.font(b"F3"), FontLookup::Unmeasurable));
        assert!(matches!(scope.font(b"Nope"), FontLookup::Unmeasurable));
        drop(scope);
        assert_eq!(editor.fonts.len(), 1);
    }

    #[test]
    fn ext_gstate_reads_width_limit_and_font() {
        let mut doc = Document::with_version("1.7");
        let f1 = doc.add_object(helvetica());
        let resources = dictionary! { "ExtGState" => dictionary! {
            "A" => dictionary! { "LW" => 3, "ML" => 2 },
            "B" => dictionary! { "LW" => "bad", "Font" => vec![Object::Reference(f1), 12.into()] },
            "C" => dictionary! { "Font" => 5 },
        } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        let a = scope.ext_gstate(b"A").unwrap();
        assert_eq!((a.line_width, a.miter_limit), (Some(3.0), Some(2.0)));
        assert!(a.font.is_none());
        let b = scope.ext_gstate(b"B").unwrap();
        assert!(b.line_width.unwrap().is_infinite());
        assert!(matches!(b.font, Some((FontLookup::Measured(_), size)) if size == 12.0));
        assert!(matches!(
            scope.ext_gstate(b"C").unwrap().font,
            Some((FontLookup::Unmeasurable, _))
        ));
        assert!(scope.ext_gstate(b"D").is_none());
    }

    #[test]
    fn xobject_kinds() {
        let mut doc = Document::with_version("1.7");
        let image = doc.add_object(Stream::new(dictionary! { "Subtype" => "Image" }, vec![]));
        let fm = doc.add_object(Stream::new(
            dictionary! { "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 10.into(), 10.into()], "Matrix" => vec![2.into(), 0.into(), 0.into(), 2.into(), 5.into(), 5.into()] },
            vec![],
        ));
        let no_bbox = doc.add_object(Stream::new(dictionary! { "Subtype" => "Form" }, vec![]));
        let ps = doc.add_object(Stream::new(dictionary! { "Subtype" => "PS" }, vec![]));
        let resources = dictionary! { "XObject" => dictionary! { "I" => image, "F" => fm, "N" => no_bbox, "P" => ps, "D" => 3 } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        assert_eq!(scope.xobject(b"I"), Some(XObject::Image));
        assert_eq!(
            scope.xobject(b"F"),
            Some(XObject::Form {
                bbox: Rect::new(0.0, 0.0, 10.0, 10.0),
                matrix: Matrix::new(2.0, 0.0, 0.0, 2.0, 5.0, 5.0)
            })
        );
        assert_eq!(scope.xobject(b"N"), Some(XObject::Other));
        assert_eq!(scope.xobject(b"P"), Some(XObject::Other));
        assert_eq!(scope.xobject(b"D"), Some(XObject::Other));
        assert_eq!(scope.xobject(b"Missing"), None);
    }

    #[test]
    fn unique_name_avoids_taken_names() {
        let mut doc = Document::with_version("1.7");
        let resources = dictionary! { "XObject" => dictionary! { "Fm1_crop1" => 1 } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        assert_eq!(scope.unique_name(b"Fm1"), b"Fm1_crop2");
        scope.added.push((b"Fm1_crop2".to_vec(), (9, 0)));
        assert_eq!(scope.unique_name(b"Fm1"), b"Fm1_crop3");
    }

    #[test]
    fn resources_with_added_copies_the_xobject_dictionary() {
        let mut doc = Document::with_version("1.7");
        let shared = doc.add_object(dictionary! { "Fm1" => 1 });
        let resources = dictionary! { "XObject" => shared };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        assert!(scope.resources_with_added().is_none());
        scope.added.push((b"New".to_vec(), (9, 0)));
        let updated = scope.resources_with_added().unwrap();
        let xobjects = updated.get(b"XObject").unwrap().as_dict().unwrap();
        assert!(xobjects.has(b"Fm1") && xobjects.has(b"New"));
        drop(scope);
        assert!(!doc.get_dictionary(shared).unwrap().has(b"New"));
    }

    #[test]
    fn trim_form_copies_nested_forms_and_never_changes_originals() {
        let mut doc = Document::with_version("1.7");
        let text = dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let inner = form(&mut doc, b"BT /F1 20 Tf 10 150 Td (GONE) Tj ET", Some(text));
        let outer = form(
            &mut doc,
            b"/Inner Do",
            Some(dictionary! { "XObject" => dictionary! { "Inner" => inner } }),
        );
        let resources = dictionary! { "XObject" => dictionary! { "Outer" => outer } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        let mut report = CropReport::default();
        let name = scope
            .trim_form(b"Outer", &Matrix::IDENTITY, &mut report)
            .unwrap();
        assert_eq!(name, b"Outer_crop1");
        assert_eq!((report.forms_trimmed, report.glyphs_removed), (1, 4));
        let new_outer = scope.added[0].1;
        drop(scope);
        let copy = doc.get_object(new_outer).unwrap().as_stream().unwrap();
        let content = super::super::streams::decode_strict(&doc, copy).unwrap();
        assert!(String::from_utf8_lossy(&content).contains("/Inner_crop1 "));
        assert_eq!(
            doc.get_object(outer).unwrap().as_stream().unwrap().content,
            b"/Inner Do"
        );
        assert_eq!(
            doc.get_object(inner).unwrap().as_stream().unwrap().content,
            b"BT /F1 20 Tf 10 150 Td (GONE) Tj ET"
        );
    }

    #[test]
    fn trim_form_keeps_forms_that_need_no_change_or_cannot_be_read() {
        let mut doc = Document::with_version("1.7");
        let inside = form(&mut doc, b"150 150 10 10 re f", None);
        let broken = doc.add_object(Stream::new(
            dictionary! { "Subtype" => "Form", "Filter" => "DCTDecode" },
            vec![1],
        ));
        let looping = doc.new_object_id();
        doc.objects.insert(looping, Object::Stream(Stream::new(
            dictionary! { "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 400.into(), 400.into()],
                "Resources" => dictionary! { "XObject" => dictionary! { "Self" => looping } } },
            b"/Self Do 0 0 10 10 re f".to_vec(),
        )));
        let resources = dictionary! { "XObject" => dictionary! { "In" => inside, "Bad" => broken, "Loop" => looping, "Direct" => 1 } };
        let mut editor = Editor::new(&mut doc);
        let mut scope = Scope::new(&mut editor, crop(), resources, vec![]);
        let mut report = CropReport::default();
        assert_eq!(scope.trim_form(b"In", &Matrix::IDENTITY, &mut report), None);
        assert_eq!(
            scope.trim_form(b"Bad", &Matrix::IDENTITY, &mut report),
            None
        );
        assert_eq!(report.streams_not_analysed, 1);
        assert_eq!(
            scope.trim_form(b"Direct", &Matrix::IDENTITY, &mut report),
            None
        );
        // The self-reference is not followed again; the path outside is
        // still removed from the one copy.
        assert_eq!(
            scope.trim_form(b"Loop", &Matrix::IDENTITY, &mut report),
            Some(b"Loop_crop1".to_vec())
        );
        assert_eq!(report.paths_removed, 1);
    }
}
