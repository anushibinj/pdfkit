//! WebAssembly C FFI exports for linear memory integration.
//!
//! Follows Single Responsibility Principle (SRP) and Interface Segregation
//! Principle (ISP) by exposing a minimal C ABI for allocation, PDF compression,
//! standalone JPEG encoding, and result retrieval.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

use crate::document::compress_document;
use crate::error::CompressError;
use crate::jpeg::process_and_encode_jpeg;
use crate::plan::CompressPlan;
use crate::report::escape_json;

/// Return code indicating the operation succeeded.
pub const STATUS_OK: u32 = 0;
/// Return code indicating the operation failed.
pub const STATUS_ERROR: u32 = 1;
/// The ABI contract version expected by TypeScript loaders.
pub const ABI_VERSION: u32 = 1;

/// Stores the outcome of the most recent FFI invocation.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Compressed PDF/JPEG bytes on success, or JSON error description on failure.
    pub result: Vec<u8>,
    /// Serialized JSON compression report (empty on failure or standalone JPEG encode).
    pub report: Vec<u8>,
}

thread_local! {
    static LAST: RefCell<Outcome> = RefCell::new(Outcome::default());
}

/// Returns the exported ABI version so TypeScript loaders can verify compatibility.
#[no_mangle]
pub extern "C" fn pdfcompress_abi_version() -> u32 {
    ABI_VERSION
}

/// Allocates a linear memory buffer of the requested length.
///
/// # Arguments
///
/// * `len` - Number of bytes to allocate.
///
/// # Returns
///
/// Pointer to allocated buffer, or null on allocation failure.
#[no_mangle]
pub extern "C" fn pdfcompress_alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Deallocates memory previously reserved with [`pdfcompress_alloc`].
///
/// # Safety
///
/// `ptr` must have been returned by [`pdfcompress_alloc`] with the identical `len`.
#[no_mangle]
pub unsafe extern "C" fn pdfcompress_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
}

/// Compresses a PDF buffer according to a serialized [`CompressPlan`].
///
/// # Safety
///
/// `pdf` must point to `pdf_len` readable bytes and `plan` must point to `plan_len` readable bytes
/// (or be null when `plan_len == 0`).
#[no_mangle]
pub unsafe extern "C" fn pdfcompress_run(
    pdf: *const u8,
    pdf_len: usize,
    plan: *const u8,
    plan_len: usize,
) -> u32 {
    let pdf_slice = if pdf.is_null() || pdf_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(pdf, pdf_len) }
    };
    let plan_slice = if plan.is_null() || plan_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(plan, plan_len) }
    };

    let (status, outcome) = run_core(pdf_slice, plan_slice);
    LAST.with(|last| *last.borrow_mut() = outcome);
    status
}

/// Encodes an RGBA pixel buffer (with optional area-averaged downsampling and grayscale conversion)
/// into a baseline DCT JPEG stored in the `LAST.result` buffer.
///
/// # Safety
///
/// `rgba` must point to `rgba_len` readable bytes (`width * height * 4`).
#[no_mangle]
pub unsafe extern "C" fn pdfcompress_encode_jpeg(
    rgba: *const u8,
    rgba_len: usize,
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
    quality: u32,
    grayscale: u32,
) -> u32 {
    let slice = if rgba.is_null() || rgba_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(rgba, rgba_len) }
    };

    let (status, outcome) = encode_jpeg_core(
        slice,
        width,
        height,
        target_width,
        target_height,
        quality.clamp(1, 100) as u8,
        grayscale != 0,
    );
    LAST.with(|last| *last.borrow_mut() = outcome);
    status
}

/// Pure core wrapper for PDF compression returning status code and outcome.
pub fn run_core(pdf: &[u8], plan_bytes: &[u8]) -> (u32, Outcome) {
    let plan = match CompressPlan::from_bytes(plan_bytes) {
        Ok(p) => p,
        Err(err) => return error_outcome(&err),
    };

    match compress_document(pdf, &plan) {
        Ok(output) => (
            STATUS_OK,
            Outcome {
                result: output.pdf,
                report: output.report.to_json().into_bytes(),
            },
        ),
        Err(err) => error_outcome(&err),
    }
}

/// Pure core wrapper for RGBA -> downsampled baseline JPEG encoding.
pub fn encode_jpeg_core(
    rgba: &[u8],
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
    quality: u8,
    grayscale: bool,
) -> (u32, Outcome) {
    match process_and_encode_jpeg(
        rgba,
        width,
        height,
        target_width,
        target_height,
        quality,
        grayscale,
    ) {
        Ok(jpeg) => (
            STATUS_OK,
            Outcome {
                result: jpeg,
                report: Vec::new(),
            },
        ),
        Err(err) => error_outcome(&err),
    }
}

/// Wraps a [`CompressError`] into an FFI JSON error envelope.
fn error_outcome(err: &CompressError) -> (u32, Outcome) {
    let json = format!(
        "{{\"code\":\"{}\",\"message\":{}}}",
        err.code(),
        escape_json(&err.to_string())
    );
    (
        STATUS_ERROR,
        Outcome {
            result: json.into_bytes(),
            report: Vec::new(),
        },
    )
}

/// Returns the pointer to the last execution result bytes.
#[no_mangle]
pub extern "C" fn pdfcompress_result_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().result.as_ptr())
}

/// Returns the byte length of the last execution result.
#[no_mangle]
pub extern "C" fn pdfcompress_result_len() -> usize {
    LAST.with(|last| last.borrow().result.len())
}

/// Returns the pointer to the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfcompress_report_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().report.as_ptr())
}

/// Returns the byte length of the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfcompress_report_len() -> usize {
    LAST.with(|last| last.borrow().report.len())
}

/// Frees cached results from the last compression operation.
#[no_mangle]
pub extern "C" fn pdfcompress_clear() {
    LAST.with(|last| *last.borrow_mut() = Outcome::default());
}

/// Custom `getrandom` backend for `pdf-compress`.
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
    fn abi_version_matches() {
        assert_eq!(pdfcompress_abi_version(), ABI_VERSION);
    }

    #[test]
    fn alloc_and_free_round_trip() {
        let ptr = pdfcompress_alloc(128);
        assert!(!ptr.is_null());
        unsafe { pdfcompress_free(ptr, 128) };
        unsafe { pdfcompress_free(std::ptr::null_mut(), 0) };
    }

    #[test]
    fn run_core_reports_empty_input_and_invalid_config() {
        let (status, outcome) = run_core(&[], &[]);
        assert_eq!(status, STATUS_ERROR);
        let text = String::from_utf8(outcome.result).unwrap();
        assert!(text.contains("\"code\":\"empty-input\""));

        let (cfg_status, cfg_outcome) = run_core(b"%PDF-1.4", b"BAD!");
        assert_eq!(cfg_status, STATUS_ERROR);
        let cfg_text = String::from_utf8(cfg_outcome.result).unwrap();
        assert!(cfg_text.contains("\"code\":\"invalid-config\""));
    }

    #[test]
    fn encode_jpeg_core_produces_jpeg_bytes() {
        let rgba = vec![180u8; 16 * 16 * 4];
        let (status, outcome) = encode_jpeg_core(&rgba, 16, 16, 8, 8, 75, false);
        assert_eq!(status, STATUS_OK);
        assert_eq!(&outcome.result[0..2], &[0xff, 0xd8]);
        assert_eq!(&outcome.result[outcome.result.len() - 2..], &[0xff, 0xd9]);
    }
}
