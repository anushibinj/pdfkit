//! WebAssembly C FFI exports for linear memory integration.
//!
//! Follows Single Responsibility Principle (SRP) and Interface Segregation
//! Principle (ISP) by exposing a minimal C ABI for allocation, gzip decompression,
//! DPI-aware BMP encoding, overlay normalization, and text-layer construction.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

use crate::bmp::preprocess_and_encode_bmp;
use crate::error::{escape_json, OcrError};
use crate::gzip::decompress_gzip_or_raw;
use crate::overlay::normalize_overlay_pdf;
use crate::text_layer::{build_text_layer_pdf, parse_words_tsv};

/// Return code indicating the FFI call succeeded.
pub const STATUS_OK: u32 = 0;
/// Return code indicating the FFI call failed (JSON error stored in `LAST`).
pub const STATUS_ERROR: u32 = 1;
/// ABI contract version verified by TypeScript loaders.
pub const ABI_VERSION: u32 = 1;

thread_local! {
    static LAST: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Returns the exported ABI version so TypeScript loaders can verify compatibility.
#[no_mangle]
pub extern "C" fn pdfocr_abi_version() -> u32 {
    ABI_VERSION
}

/// Allocates a linear memory buffer of `len` bytes.
///
/// # Arguments
///
/// * `len` - Requested byte length.
///
/// # Returns
///
/// Pointer to allocated buffer, or null on allocation failure.
#[no_mangle]
pub extern "C" fn pdfocr_alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Deallocates a buffer previously allocated by [`pdfocr_alloc`].
///
/// # Safety
///
/// `ptr` must have been returned by [`pdfocr_alloc`] with the identical `len`.
#[no_mangle]
pub unsafe extern "C" fn pdfocr_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
}

/// Decompresses a gzip-compressed `.traineddata.gz` buffer (or passes through raw bytes).
///
/// # Safety
///
/// `data` must point to `len` readable bytes (or be null when `len == 0`).
#[no_mangle]
pub unsafe extern "C" fn pdfocr_gunzip(data: *const u8, len: usize) -> u32 {
    let slice = if data.is_null() || len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(data, len) }
    };
    let (status, bytes) = gunzip_core(slice);
    LAST.with(|last| *last.borrow_mut() = bytes);
    status
}

/// Preprocesses RGBA pixels and encodes a 24-bit DPI-tagged BMP.
///
/// # Safety
///
/// `rgba` must point to `rgba_len` readable bytes (`width * height * 4`).
#[no_mangle]
pub unsafe extern "C" fn pdfocr_preprocess_bmp(
    rgba: *const u8,
    rgba_len: usize,
    width: u32,
    height: u32,
    dpi_x: u32,
    dpi_y: u32,
    enhance: u32,
) -> u32 {
    let slice = if rgba.is_null() || rgba_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(rgba, rgba_len) }
    };
    let (status, bytes) = preprocess_bmp_core(slice, width, height, dpi_x, dpi_y, enhance != 0);
    LAST.with(|last| *last.borrow_mut() = bytes);
    status
}

/// Normalizes a 1-page overlay PDF's `/MediaBox` and coordinate transform to match target page dimensions.
///
/// # Safety
///
/// `pdf` must point to `pdf_len` readable bytes (or be null when `pdf_len == 0`).
#[no_mangle]
pub unsafe extern "C" fn pdfocr_normalize_overlay(
    pdf: *const u8,
    pdf_len: usize,
    target_width_pt: f64,
    target_height_pt: f64,
) -> u32 {
    let slice = if pdf.is_null() || pdf_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(pdf, pdf_len) }
    };
    let (status, bytes) = normalize_overlay_core(slice, target_width_pt, target_height_pt);
    LAST.with(|last| *last.borrow_mut() = bytes);
    status
}

/// Builds a 1-page invisible Unicode text-layer PDF from Tesseract TSV output.
///
/// # Safety
///
/// `tsv` must point to `tsv_len` readable UTF-8 bytes (or be null when `tsv_len == 0`).
#[no_mangle]
pub unsafe extern "C" fn pdfocr_build_text_layer(
    tsv: *const u8,
    tsv_len: usize,
    target_width_pt: f64,
    target_height_pt: f64,
    image_width_px: u32,
    image_height_px: u32,
) -> u32 {
    let slice = if tsv.is_null() || tsv_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(tsv, tsv_len) }
    };
    let (status, bytes) = build_text_layer_core(
        slice,
        target_width_pt,
        target_height_pt,
        image_width_px,
        image_height_px,
    );
    LAST.with(|last| *last.borrow_mut() = bytes);
    status
}

/// Pure core wrapper for gunzip returning `(status, result_or_error_json)`.
pub fn gunzip_core(data: &[u8]) -> (u32, Vec<u8>) {
    match decompress_gzip_or_raw(data) {
        Ok(out) => (STATUS_OK, out),
        Err(err) => (STATUS_ERROR, error_json(&err)),
    }
}

/// Pure core wrapper for BMP preprocessing returning `(status, result_or_error_json)`.
pub fn preprocess_bmp_core(
    rgba: &[u8],
    width: u32,
    height: u32,
    dpi_x: u32,
    dpi_y: u32,
    enhance: bool,
) -> (u32, Vec<u8>) {
    match preprocess_and_encode_bmp(rgba, width, height, dpi_x, dpi_y, enhance) {
        Ok(out) => (STATUS_OK, out),
        Err(err) => (STATUS_ERROR, error_json(&err)),
    }
}

/// Pure core wrapper for overlay normalization returning `(status, result_or_error_json)`.
pub fn normalize_overlay_core(
    pdf: &[u8],
    target_width_pt: f64,
    target_height_pt: f64,
) -> (u32, Vec<u8>) {
    match normalize_overlay_pdf(pdf, target_width_pt, target_height_pt) {
        Ok(out) => (STATUS_OK, out),
        Err(err) => (STATUS_ERROR, error_json(&err)),
    }
}

/// Pure core wrapper for TSV-to-PDF text layer construction returning `(status, result_or_error_json)`.
pub fn build_text_layer_core(
    tsv_bytes: &[u8],
    target_width_pt: f64,
    target_height_pt: f64,
    image_width_px: u32,
    image_height_px: u32,
) -> (u32, Vec<u8>) {
    let Ok(tsv) = std::str::from_utf8(tsv_bytes) else {
        return (STATUS_ERROR, error_json(&OcrError::InvalidConfig));
    };
    let words = parse_words_tsv(tsv);
    match build_text_layer_pdf(
        target_width_pt,
        target_height_pt,
        image_width_px,
        image_height_px,
        &words,
    ) {
        Ok(out) => (STATUS_OK, out),
        Err(err) => (STATUS_ERROR, error_json(&err)),
    }
}

/// Serializes an [`OcrError`] as a UTF-8 JSON error envelope.
fn error_json(err: &OcrError) -> Vec<u8> {
    format!(
        "{{\"code\":\"{}\",\"message\":{}}}",
        err.code(),
        escape_json(&err.to_string())
    )
    .into_bytes()
}

/// Returns a pointer to the last execution output buffer.
#[no_mangle]
pub extern "C" fn pdfocr_result_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().as_ptr())
}

/// Returns the byte length of the last execution output buffer.
#[no_mangle]
pub extern "C" fn pdfocr_result_len() -> usize {
    LAST.with(|last| last.borrow().len())
}

/// Clears the cached output buffer in WebAssembly memory.
#[no_mangle]
pub extern "C" fn pdfocr_clear() {
    LAST.with(|last| last.borrow_mut().clear());
}

/// Custom `getrandom` backend for `pdf-ocr`.
///
/// `lopdf` pulls in `getrandom` transitively for encryption, which this crate never performs.
#[no_mangle]
unsafe extern "Rust" fn __getrandom_v03_custom(
    _dest: *mut u8,
    _len: usize,
) -> Result<(), getrandom::Error> {
    Err(getrandom::Error::UNSUPPORTED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_and_alloc_round_trip() {
        assert_eq!(pdfocr_abi_version(), ABI_VERSION);
        let ptr = pdfocr_alloc(64);
        assert!(!ptr.is_null());
        unsafe { pdfocr_free(ptr, 64) };
        unsafe { pdfocr_free(std::ptr::null_mut(), 0) };
    }

    #[test]
    fn cores_handle_valid_and_error_inputs() {
        let (st, err) = gunzip_core(&[]);
        assert_eq!(st, STATUS_ERROR);
        assert!(String::from_utf8(err).unwrap().contains("empty-input"));

        let rgba = vec![200u8; 4 * 4 * 4];
        let (bmp_st, bmp) = preprocess_bmp_core(&rgba, 4, 4, 300, 300, false);
        assert_eq!(bmp_st, STATUS_OK);
        assert_eq!(&bmp[0..2], b"BM");

        let tsv = b"5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t90\tHello\n";
        let (txt_st, pdf) = build_text_layer_core(tsv, 612.0, 792.0, 100, 100);
        assert_eq!(txt_st, STATUS_OK);
        assert!(pdf.starts_with(b"%PDF-"));

        let (norm_st, norm) = normalize_overlay_core(&pdf, 595.0, 842.0);
        assert_eq!(norm_st, STATUS_OK);
        assert!(norm.starts_with(b"%PDF-"));
    }
}
