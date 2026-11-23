//! PDF Image XObject inspection, drawn-DPI estimation, Flate decoding,
//! soft-mask preservation, and size-guarded JPEG re-encoding.
//!
//! Follows Single Responsibility Principle (SRP) by isolating PDF image XObject
//! processing from document-level stream deduplication and FFI marshalling.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::content::Content;
use lopdf::{Document, Object, ObjectId, Stream};

use crate::jpeg::{fnv1a_hash64, process_and_encode_jpeg};
use crate::plan::{CompressPlan, ImageReplacement};
use crate::report::CompressReport;

/// Maximum nesting depth when walking Form XObjects for drawn image sizes.
const MAX_FORM_DEPTH: usize = 16;

/// 2D affine matrix `[a, b, c, d, e, f]` matching PDF CTM semantics.
#[derive(Debug, Clone, Copy)]
struct Matrix([f64; 6]);

impl Matrix {
    fn identity() -> Self {
        Self([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }

    /// Concatenates `other * self` (PDF `cm` operator pre-multiplies CTM).
    fn concat(self, other: [f64; 6]) -> Self {
        let [a, b, c, d, e, f] = self.0;
        let [oa, ob, oc, od, oe, of] = other;
        Self([
            oa * a + ob * c,
            oa * b + ob * d,
            oc * a + od * c,
            oc * b + od * d,
            oe * a + of * c + e,
            oe * b + of * d + f,
        ])
    }

    /// Returns the displayed `(width_pt, height_pt)` of a unit `[0..1, 0..1]` image square
    /// transformed by this matrix (PDF images are mapped onto a 1x1 unit square).
    fn unit_square_extent_pt(self) -> (f64, f64) {
        let [a, b, c, d, _, _] = self.0;
        let w = (a * a + b * b).sqrt();
        let h = (c * c + d * d).sqrt();
        (w, h)
    }
}

/// Collects every `ObjectId` referenced as a `/SMask` or `/Mask` on any stream.
///
/// Soft masks and stencil masks hold critical transparency/clipping alpha channels
/// and must never be converted to lossy JPEG or stripped of their mask role.
///
/// # Arguments
///
/// * `doc` - PDF document to scan.
///
/// # Returns
///
/// Set of `ObjectId`s used as image masks.
pub fn collect_mask_object_ids(doc: &Document) -> HashSet<ObjectId> {
    let mut masks = HashSet::new();
    for obj in doc.objects.values() {
        if let Object::Stream(stream) = obj {
            for key in [&b"SMask"[..], &b"Mask"[..]] {
                if let Ok(Object::Reference(id)) = stream.dict.get(key) {
                    masks.insert(*id);
                }
            }
        }
    }
    masks
}

/// Checks whether an Image XObject carries transparency via `/SMask`, `/Mask`, or `/ImageMask`.
///
/// # Arguments
///
/// * `stream` - Image XObject stream.
///
/// # Returns
///
/// `true` if the image uses a soft mask, explicit mask, colour-key mask array, or is a stencil mask.
pub fn has_image_transparency(stream: &Stream) -> bool {
    stream.dict.has(b"SMask")
        || stream.dict.has(b"Mask")
        || matches!(
            stream.dict.get(b"ImageMask"),
            Ok(Object::Boolean(true))
        )
}

/// Extracts numeric `f64` from an integer or real PDF object.
fn obj_as_f64(obj: &Object) -> Option<f64> {
    match obj {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(f) => Some(f64::from(*f)),
        _ => None,
    }
}

/// Walks a content stream, tracking CTM `q`/`Q`/`cm` and recording drawn sizes for `/Subtype /Image`.
fn walk_content_for_images(
    doc: &Document,
    content_bytes: &[u8],
    resources_dict: Option<&lopdf::Dictionary>,
    initial_ctm: Matrix,
    depth: usize,
    out_sizes: &mut HashMap<ObjectId, (f64, f64)>,
) {
    let Ok(content) = Content::decode(content_bytes) else {
        return;
    };
    let mut ctm = initial_ctm;
    let mut stack: Vec<Matrix> = Vec::new();

    for op in &content.operations {
        match op.operator.as_str() {
            "q" => stack.push(ctm),
            "Q" => {
                if let Some(prev) = stack.pop() {
                    ctm = prev;
                }
            }
            "cm" if op.operands.len() == 6 => {
                if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                    obj_as_f64(&op.operands[0]),
                    obj_as_f64(&op.operands[1]),
                    obj_as_f64(&op.operands[2]),
                    obj_as_f64(&op.operands[3]),
                    obj_as_f64(&op.operands[4]),
                    obj_as_f64(&op.operands[5]),
                ) {
                    ctm = ctm.concat([a, b, c, d, e, f]);
                }
            }
            "Do" if op.operands.len() == 1 => {
                let Ok(name) = op.operands[0].as_name() else {
                    continue;
                };
                let Some(res) = resources_dict else {
                    continue;
                };
                let Some(xobjects) = res.get(b"XObject").ok().and_then(|o| match o {
                    Object::Reference(id) => doc.get_dictionary(*id).ok(),
                    Object::Dictionary(d) => Some(d),
                    _ => None,
                }) else {
                    continue;
                };
                let Ok(Object::Reference(xobj_id)) = xobjects.get(name) else {
                    continue;
                };
                let Ok(Object::Stream(stream)) = doc.get_object(*xobj_id) else {
                    continue;
                };
                let Ok(subtype) = stream.dict.get(b"Subtype").and_then(Object::as_name) else {
                    continue;
                };

                if subtype == b"Image" {
                    let (w_pt, h_pt) = ctm.unit_square_extent_pt();
                    out_sizes
                        .entry(*xobj_id)
                        .and_modify(|(mw, mh)| {
                            if w_pt > *mw {
                                *mw = w_pt;
                            }
                            if h_pt > *mh {
                                *mh = h_pt;
                            }
                        })
                        .or_insert((w_pt, h_pt));
                } else if subtype == b"Form" && depth < MAX_FORM_DEPTH {
                    let form_matrix = stream
                        .dict
                        .get(b"Matrix")
                        .ok()
                        .and_then(|o| o.as_array().ok())
                        .filter(|arr| arr.len() == 6)
                        .and_then(|arr| {
                            Some([
                                obj_as_f64(&arr[0])?,
                                obj_as_f64(&arr[1])?,
                                obj_as_f64(&arr[2])?,
                                obj_as_f64(&arr[3])?,
                                obj_as_f64(&arr[4])?,
                                obj_as_f64(&arr[5])?,
                            ])
                        })
                        .unwrap_or([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

                    let form_res = stream
                        .dict
                        .get(b"Resources")
                        .ok()
                        .and_then(|o| match o {
                            Object::Reference(id) => doc.get_dictionary(*id).ok(),
                            Object::Dictionary(d) => Some(d),
                            _ => None,
                        })
                        .or(resources_dict);

                    if let Ok(decoded) = stream.decompressed_content() {
                        walk_content_for_images(
                            doc,
                            &decoded,
                            form_res,
                            ctm.concat(form_matrix),
                            depth + 1,
                            out_sizes,
                        );
                    } else {
                        walk_content_for_images(
                            doc,
                            &stream.content,
                            form_res,
                            ctm.concat(form_matrix),
                            depth + 1,
                            out_sizes,
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

/// Estimates the maximum drawn size in PDF points `(width_pt, height_pt)` for each
/// Image XObject referenced in page or Form XObject content streams.
///
/// # Arguments
///
/// * `doc` - Parsed `lopdf::Document`.
///
/// # Returns
///
/// Map from Image XObject `ObjectId` to maximum `(width_pt, height_pt)`.
pub fn estimate_image_drawn_sizes(doc: &Document) -> HashMap<ObjectId, (f64, f64)> {
    let mut sizes = HashMap::new();
    for page_id in doc.get_pages().into_values() {
        let content = doc.get_page_content(page_id);
        if content.is_empty() {
            continue;
        }
        let page_res = doc.get_page_resources(page_id).ok().and_then(|(opt_dict, res_ids)| {
            opt_dict.or_else(|| {
                res_ids
                    .into_iter()
                    .find_map(|id| doc.get_dictionary(id).ok())
            })
        });
        walk_content_for_images(doc, &content, page_res, Matrix::identity(), 0, &mut sizes);
    }
    sizes
}

/// Computes target pixel dimensions `(new_w, new_h, was_downsampled)` given `target_dpi`.
///
/// Never upscales an image. If `drawn_pt` is known, computes effective DPI as
/// `pixel_dim * 72 / drawn_pt` on each axis and only downsamples when the effective
/// DPI exceeds `target_dpi * 1.05`. If `drawn_pt` is unavailable (e.g. unmeasured
/// inline/nested placement), treats the image as 300 DPI if larger than `target_dpi`
/// scaled from 300 DPI.
///
/// # Arguments
///
/// * `width` - Stored image width in pixels.
/// * `height` - Stored image height in pixels.
/// * `drawn_pt` - Maximum drawn size in PDF points, if measured.
/// * `target_dpi` - Requested maximum DPI (`0` disables downsampling).
///
/// # Returns
///
/// Tuple `(target_width, target_height, downsampled)`.
pub fn compute_target_pixel_size(
    width: u32,
    height: u32,
    drawn_pt: Option<(f64, f64)>,
    target_dpi: u32,
) -> (u32, u32, bool) {
    if target_dpi == 0 || width <= 1 || height <= 1 {
        return (width, height, false);
    }

    let scale = match drawn_pt {
        Some((w_pt, h_pt)) if w_pt > 1.0 && h_pt > 1.0 => {
            let dpi_x = (f64::from(width) * 72.0) / w_pt;
            let dpi_y = (f64::from(height) * 72.0) / h_pt;
            let eff_dpi = dpi_x.max(dpi_y);
            if eff_dpi <= f64::from(target_dpi) * 1.05 {
                1.0
            } else {
                f64::from(target_dpi) / eff_dpi
            }
        }
        _ => {
            // Without a measured drawn size, assume a conservative 300 DPI baseline
            // only if the image is high-resolution (> 400px on a side).
            if width.max(height) > 400 && target_dpi < 300 {
                f64::from(target_dpi) / 300.0
            } else {
                1.0
            }
        }
    };

    if scale >= 0.98 {
        return (width, height, false);
    }

    let new_w = ((f64::from(width) * scale).round() as u32).max(1).min(width);
    let new_h = ((f64::from(height) * scale).round() as u32).max(1).min(height);
    let downsampled = new_w < width || new_h < height;
    (new_w, new_h, downsampled)
}

/// Checks if a stream's `/Filter` matches `expected_filter` (either as a single Name
/// or single-element Array).
fn has_single_filter(stream: &Stream, expected_filter: &[u8]) -> bool {
    match stream.dict.get(b"Filter") {
        Ok(Object::Name(name)) => name == expected_filter,
        Ok(Object::Array(arr)) if arr.len() == 1 => {
            matches!(&arr[0], Object::Name(name) if name == expected_filter)
        }
        _ => false,
    }
}

/// Applies PNG row predictors (10..=15) used by PDF `/FlateDecode` `/DecodeParms`.
fn unfilter_png_rows(data: &[u8], width: usize, channels: usize) -> Option<Vec<u8>> {
    let row_bytes = width.checked_mul(channels)?;
    let stride = row_bytes + 1; // 1 filter byte per scanline
    if data.is_empty() || !data.len().is_multiple_of(stride) {
        return None;
    }
    let height = data.len() / stride;
    let mut out = vec![0u8; height * row_bytes];

    for y in 0..height {
        let filter = data[y * stride];
        let src_row = &data[y * stride + 1..(y + 1) * stride];
        let dst_start = y * row_bytes;

        for x in 0..row_bytes {
            let raw = src_row[x];
            let left = if x >= channels {
                out[dst_start + x - channels]
            } else {
                0
            };
            let up = if y > 0 {
                out[(y - 1) * row_bytes + x]
            } else {
                0
            };
            let up_left = if y > 0 && x >= channels {
                out[(y - 1) * row_bytes + x - channels]
            } else {
                0
            };

            let val = match filter {
                0 => raw,
                1 => raw.wrapping_add(left),
                2 => raw.wrapping_add(up),
                3 => {
                    let avg = ((u16::from(left) + u16::from(up)) / 2) as u8;
                    raw.wrapping_add(avg)
                }
                4 => raw.wrapping_add(paeth_predictor(left, up, up_left)),
                _ => return None,
            };
            out[dst_start + x] = val;
        }
    }

    Some(out)
}

/// Standard PNG Paeth predictor (`RFC 2083`).
#[inline]
fn paeth_predictor(a: u8, b: u8, c: u8) -> u8 {
    let ia = i32::from(a);
    let ib = i32::from(b);
    let ic = i32::from(c);
    let p = ia + ib - ic;
    let pa = (p - ia).abs();
    let pb = (p - ib).abs();
    let pc = (p - ic).abs();
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Decodes a `/FlateDecode` (or unfiltered) 8-bit `/DeviceRGB` or `/DeviceGray` PDF image stream
/// into an RGBA buffer `(rgba, width, height)`.
///
/// # Arguments
///
/// * `stream` - PDF Image XObject stream.
///
/// # Returns
///
/// `Some((rgba_pixels, width, height))` if supported and cleanly decoded, else `None`.
pub fn decode_flate_image_to_rgba(stream: &Stream) -> Option<(Vec<u8>, u32, u32)> {
    let width = stream.dict.get(b"Width").ok()?.as_i64().ok()? as u32;
    let height = stream.dict.get(b"Height").ok()?.as_i64().ok()? as u32;
    if width == 0 || height == 0 {
        return None;
    }

    let bpc = stream
        .dict
        .get(b"BitsPerComponent")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(8);
    if bpc != 8 {
        return None;
    }

    let cs_name = stream.dict.get(b"ColorSpace").ok()?.as_name().ok()?;
    let channels = match cs_name {
        b"DeviceRGB" => 3usize,
        b"DeviceGray" => 1usize,
        _ => return None,
    };

    let raw_bytes = if !stream.dict.has(b"Filter") {
        stream.content.clone()
    } else if has_single_filter(stream, b"FlateDecode") {
        let mut decoder = ZlibDecoder::new(&stream.content[..]);
        let mut decoded = Vec::new();
        decoder.read_to_end(&mut decoded).ok()?;
        decoded
    } else {
        return None;
    };

    // Handle optional PNG Predictor (10..=15) in /DecodeParms
    let predictor = stream
        .dict
        .get(b"DecodeParms")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"Predictor").ok())
        .and_then(|p| p.as_i64().ok())
        .unwrap_or(1);

    let samples = if (10..=15).contains(&predictor) {
        unfilter_png_rows(&raw_bytes, width as usize, channels)?
    } else if predictor == 1 {
        raw_bytes
    } else {
        return None;
    };

    let pixel_count = (width as usize).checked_mul(height as usize)?;
    if samples.len() != pixel_count.checked_mul(channels)? {
        return None;
    }

    let mut rgba = Vec::with_capacity(pixel_count * 4);
    if channels == 3 {
        for rgb in samples.chunks_exact(3) {
            rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
        }
    } else {
        for &g in &samples {
            rgba.extend_from_slice(&[g, g, g, 255]);
        }
    }

    Some((rgba, width, height))
}

/// Recompresses raw bytes using zlib level 9 (`flate2::Compression::best()`).
pub fn compress_flate_level9(raw: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(raw).ok()?;
    encoder.finish().ok()
}

/// Matches a pre-encoded replacement supplied by the caller for a given stream.
fn find_matching_replacement(
    replacements: &[ImageReplacement],
    raw_hash: u64,
    width: u32,
    height: u32,
) -> Option<&ImageReplacement> {
    replacements.iter().find(|r| {
        r.raw_hash == raw_hash && r.original_width == width && r.original_height == height
    })
}

/// Applies image compression across all Image XObjects in `doc` according to `plan`.
///
/// Key safeguards enforced here:
/// - **Transparency preservation**: images referenced as `/SMask` or `/Mask`, and images
///   carrying `/SMask`, `/Mask`, or `/ImageMask true`, are never converted to lossy JPEG.
/// - **Non-expansion guarantee**: an image is only replaced when the candidate JPEG bytes
///   are strictly shorter than the existing PDF image stream bytes.
/// - **Lossless mode**: skips all lossy re-encoding while still inspecting and counting images.
///
/// # Arguments
///
/// * `doc` - Mutable PDF document.
/// * `plan` - Compression plan with quality, target DPI, grayscale flag, and optional replacements.
/// * `report` - Telemetry report updated with inspection, re-encoding, and preservation counts.
pub fn optimize_images(doc: &mut Document, plan: &CompressPlan, report: &mut CompressReport) {
    let mask_ids = collect_mask_object_ids(doc);
    let drawn_sizes = estimate_image_drawn_sizes(doc);

    let mut object_ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    object_ids.sort_unstable();

    for id in object_ids {
        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };
        let is_image = matches!(
            stream.dict.get(b"Subtype").and_then(Object::as_name),
            Ok(b"Image")
        );
        if !is_image {
            continue;
        }

        report.images_inspected += 1;

        // Protect mask streams and transparent images so alpha/transparency renders accurately.
        if mask_ids.contains(&id) || has_image_transparency(stream) {
            report.transparency_preserved += 1;
            continue;
        }

        if plan.lossless {
            continue;
        }

        let width = stream
            .dict
            .get(b"Width")
            .ok()
            .and_then(|o| o.as_i64().ok())
            .unwrap_or(0) as u32;
        let height = stream
            .dict
            .get(b"Height")
            .ok()
            .and_then(|o| o.as_i64().ok())
            .unwrap_or(0) as u32;
        if width == 0 || height == 0 {
            continue;
        }

        let current_len = stream.content.len();
        let raw_hash = fnv1a_hash64(&stream.content);

        // 1. Prefer caller-supplied replacement (decoded via PDFium for JPEG/CMYK/JPX/Indexed)
        if let Some(rep) = find_matching_replacement(&plan.replacements, raw_hash, width, height) {
            if rep.jpeg_bytes.len() < current_len && !rep.jpeg_bytes.is_empty() {
                let downsampled = rep.new_width < width || rep.new_height < height;
                let jpeg_bytes = rep.jpeg_bytes.clone();
                let new_w = rep.new_width;
                let new_h = rep.new_height;
                let gray = rep.grayscale;

                if let Some(Object::Stream(mut_stream)) = doc.objects.get_mut(&id) {
                    apply_jpeg_stream_replacement(mut_stream, jpeg_bytes, new_w, new_h, gray);
                    report.images_reencoded += 1;
                    if downsampled {
                        report.images_downsampled += 1;
                    }
                }
            } else {
                report.images_skipped_larger += 1;
            }
            continue;
        }

        // 2. Fallback: decode Flate/raw RGB or Gray images natively in Rust
        let Some((rgba, src_w, src_h)) = decode_flate_image_to_rgba(stream) else {
            continue;
        };

        let drawn = drawn_sizes.get(&id).copied();
        let (dst_w, dst_h, downsampled) =
            compute_target_pixel_size(src_w, src_h, drawn, plan.target_dpi);

        let Ok(candidate_jpeg) = process_and_encode_jpeg(
            &rgba,
            src_w,
            src_h,
            dst_w,
            dst_h,
            plan.quality,
            plan.grayscale,
        ) else {
            continue;
        };

        // Strict non-expansion guard: keep original whenever re-encode is bigger or equal.
        if candidate_jpeg.len() >= current_len {
            report.images_skipped_larger += 1;
            continue;
        }

        if let Some(Object::Stream(mut_stream)) = doc.objects.get_mut(&id) {
            apply_jpeg_stream_replacement(
                mut_stream,
                candidate_jpeg,
                dst_w,
                dst_h,
                plan.grayscale,
            );
            report.images_reencoded += 1;
            if downsampled {
                report.images_downsampled += 1;
            }
        }
    }
}

/// Replaces a PDF image stream's payload and dictionary metadata with a baseline DCT JPEG stream.
fn apply_jpeg_stream_replacement(
    stream: &mut Stream,
    jpeg_bytes: Vec<u8>,
    width: u32,
    height: u32,
    grayscale: bool,
) {
    let cs = if grayscale { "DeviceGray" } else { "DeviceRGB" };
    let len = i64::try_from(jpeg_bytes.len()).unwrap_or(0);
    stream.dict.set("Width", Object::Integer(i64::from(width)));
    stream.dict.set("Height", Object::Integer(i64::from(height)));
    stream.dict.set("ColorSpace", Object::Name(cs.as_bytes().to_vec()));
    stream.dict.set("BitsPerComponent", Object::Integer(8));
    stream.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
    stream.dict.set("Length", Object::Integer(len));
    stream.dict.remove(b"DecodeParms");
    stream.dict.remove(b"Decode");
    // Assign raw compressed payload directly; `set_plain_content` would strip `/Filter`.
    stream.content = jpeg_bytes;
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    #[test]
    fn collects_smask_and_mask_object_ids() {
        let mut doc = Document::with_version("1.5");
        let smask_id = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 4, "Height" => 4 },
            vec![255; 16],
        ));
        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 4,
                "Height" => 4,
                "SMask" => smask_id,
            },
            vec![0; 48],
        ));
        let masks = collect_mask_object_ids(&doc);
        assert!(masks.contains(&smask_id));
        assert!(!masks.contains(&img_id));
    }

    #[test]
    fn compute_target_pixel_size_downsamples_high_dpi_and_never_upscales() {
        // 600px drawn across 72pt (1 inch) = 600 DPI -> target 150 DPI => 150px
        let (w, h, down) = compute_target_pixel_size(600, 300, Some((72.0, 36.0)), 150);
        assert_eq!((w, h, down), (150, 75, true));

        // 100px drawn across 72pt (100 DPI) -> target 150 DPI => untouched
        let (w2, h2, down2) = compute_target_pixel_size(100, 100, Some((72.0, 72.0)), 150);
        assert_eq!((w2, h2, down2), (100, 100, false));
    }

    #[test]
    fn decodes_flate_rgb_image_and_skips_when_jpeg_is_larger() {
        let mut doc = Document::with_version("1.5");
        // Highly compressible 64x64 solid Flate image (~50 bytes compressed)
        let raw_rgb = vec![120u8; 64 * 64 * 3];
        let flate_bytes = compress_flate_level9(&raw_rgb).unwrap();

        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 64,
                "Height" => 64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "FlateDecode",
            },
            flate_bytes.clone(),
        ));

        let plan = CompressPlan {
            lossless: false,
            target_dpi: 150,
            quality: 75,
            grayscale: false,
            replacements: vec![],
        };
        let mut report = CompressReport::default();
        optimize_images(&mut doc, &plan, &mut report);

        assert_eq!(report.images_inspected, 1);
        // Solid Flate is tiny (~40 bytes), smaller than JPEG header -> must keep original!
        assert_eq!(report.images_reencoded, 0);
        assert_eq!(report.images_skipped_larger, 1);
        let stream = doc.get_object(img_id).unwrap().as_stream().unwrap();
        assert_eq!(stream.content, flate_bytes);
    }

    #[test]
    fn decodes_png_predictor_up_filtered_image() {
        // 2x2 grayscale with PNG Up filter (type 2): row 0 = [10, 20], row 1 = [15, 25]
        // Up residual for row 1: [5, 5]
        let filtered = vec![2, 10, 20, 2, 5, 5];
        let compressed = compress_flate_level9(&filtered).unwrap();
        let stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => 2,
                "Height" => 2,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
                "Filter" => "FlateDecode",
                "DecodeParms" => dictionary! { "Predictor" => 15 },
            },
            compressed,
        );
        let (rgba, w, h) = decode_flate_image_to_rgba(&stream).expect("decode predictor");
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            rgba,
            vec![
                10, 10, 10, 255, //
                20, 20, 20, 255, //
                15, 15, 15, 255, //
                25, 25, 25, 255, //
            ]
        );
    }
}
