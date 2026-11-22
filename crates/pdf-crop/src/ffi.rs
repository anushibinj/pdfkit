//! The WebAssembly interface: plain C functions over linear memory.
//!
//! No JavaScript glue is generated (no wasm-bindgen): the module has no
//! imports, and the browser calls these exports directly. A call goes:
//!
//! 1. `pdfcrop_alloc` twice, then copy the PDF and the plan (see
//!    `plan.rs` for its format) into the two blocks;
//! 2. `pdfcrop_run(pdf, pdfLen, plan, planLen)`, which returns
//!    [`STATUS_OK`] or [`STATUS_ERROR`];
//! 3. read the result with `pdfcrop_result_ptr` / `_len`: the cropped PDF,
//!    or on error a JSON object `{"code": ..., "message": ...}`; on success
//!    also `pdfcrop_report_ptr` / `_len`, the report as JSON;
//! 4. `pdfcrop_free` both input blocks and `pdfcrop_clear` the result.
//!
//! Results are kept in module memory until the next run or clear. The
//! module is single-threaded (one Web Worker), so a thread-local is enough.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

use crate::plan::CropPlan;

/// `pdfcrop_run` succeeded.
pub const STATUS_OK: u32 = 0;
/// `pdfcrop_run` failed; the result holds an error JSON object.
pub const STATUS_ERROR: u32 = 1;
/// Version of this interface; bumped on any incompatible change.
pub const ABI_VERSION: u32 = 1;

/// The last run's output.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    /// The PDF, or the error JSON.
    pub result: Vec<u8>,
    /// The report JSON (empty after an error).
    pub report: Vec<u8>,
}

thread_local! {
    static LAST: RefCell<Outcome> = RefCell::new(Outcome::default());
}

/// The interface version, so the loader can refuse a mismatched binary.
#[no_mangle]
pub extern "C" fn pdfcrop_abi_version() -> u32 {
    ABI_VERSION
}

/// Reserve `len` bytes; returns null when memory cannot grow.
#[no_mangle]
pub extern "C" fn pdfcrop_alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        // SAFETY: the layout has a non-zero size.
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Release a block from [`pdfcrop_alloc`] (null is ignored).
///
/// # Safety
///
/// `ptr` must come from `pdfcrop_alloc(len)` with the same `len`, and not
/// have been freed.
#[no_mangle]
pub unsafe extern "C" fn pdfcrop_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: same size and alignment as the allocation (caller's promise).
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
}

/// Crop the PDF at `pdf` with the plan at `plan` (see the module docs).
///
/// # Safety
///
/// Both ranges must be readable memory of the given lengths.
#[no_mangle]
pub unsafe extern "C" fn pdfcrop_run(
    pdf: *const u8,
    pdf_len: usize,
    plan: *const u8,
    plan_len: usize,
) -> u32 {
    // SAFETY: the caller promises the ranges are valid; empty ranges never
    // dereference their pointer.
    let (pdf, plan) = unsafe { (slice(pdf, pdf_len), slice(plan, plan_len)) };
    let (status, outcome) = run(pdf, plan);
    LAST.with(|last| *last.borrow_mut() = outcome);
    status
}

/// Where the last result starts.
#[no_mangle]
pub extern "C" fn pdfcrop_result_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().result.as_ptr())
}

/// How long the last result is.
#[no_mangle]
pub extern "C" fn pdfcrop_result_len() -> usize {
    LAST.with(|last| last.borrow().result.len())
}

/// Where the last report starts.
#[no_mangle]
pub extern "C" fn pdfcrop_report_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().report.as_ptr())
}

/// How long the last report is.
#[no_mangle]
pub extern "C" fn pdfcrop_report_len() -> usize {
    LAST.with(|last| last.borrow().report.len())
}

/// Free the last result and report.
#[no_mangle]
pub extern "C" fn pdfcrop_clear() {
    LAST.with(|last| *last.borrow_mut() = Outcome::default());
}

/// A byte slice from a pointer and length (an empty slice for length 0).
///
/// # Safety
///
/// For a non-zero `len`, `ptr..ptr + len` must be readable.
unsafe fn slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        // SAFETY: see the function's contract.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

/// Decode the plan, crop, and package the outcome.
pub fn run(pdf: &[u8], plan: &[u8]) -> (u32, Outcome) {
    let result = CropPlan::decode(plan).and_then(|plan| crate::crop_pdf(pdf, &plan));
    match result {
        Ok(output) => (
            STATUS_OK,
            Outcome {
                result: output.pdf,
                report: output.report.to_json().into_bytes(),
            },
        ),
        Err(err) => {
            let json = format!(
                "{{\"code\":{},\"message\":{}}}",
                json_string(err.code()),
                json_string(&err.to_string())
            );
            (
                STATUS_ERROR,
                Outcome {
                    result: json.into_bytes(),
                    report: Vec::new(),
                },
            )
        }
    }
}

/// A JSON string literal (quotes, backslashes and control characters
/// escaped). Error messages can contain text from lopdf about the file.
pub fn json_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The randomness source for `getrandom` (selected in `.cargo/config.toml`).
///
/// lopdf only needs random bytes to encrypt files, which the crop never
/// does (encrypted files are refused). Failing here is therefore never
/// reached, and is safer than pretending to have entropy.
#[cfg(target_arch = "wasm32")]
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
    fn abi_version_is_exported() {
        assert_eq!(pdfcrop_abi_version(), ABI_VERSION);
    }

    #[test]
    fn alloc_and_free_round_trip() {
        let ptr = pdfcrop_alloc(16);
        assert!(!ptr.is_null());
        // SAFETY: same pointer and length.
        unsafe { pdfcrop_free(ptr, 16) };
        // SAFETY: null is ignored.
        unsafe { pdfcrop_free(std::ptr::null_mut(), 0) };
        let empty = pdfcrop_alloc(0);
        assert!(!empty.is_null());
        // SAFETY: same pointer and length.
        unsafe { pdfcrop_free(empty, 0) };
    }

    #[test]
    fn run_reports_errors_as_json() {
        let (status, outcome) = run(b"not a pdf", &[]);
        assert_eq!(status, STATUS_ERROR);
        let text = String::from_utf8(outcome.result).unwrap();
        assert!(text.starts_with("{\"code\":\"invalid-plan\",\"message\":"));
        assert!(outcome.report.is_empty());
    }

    #[test]
    fn exported_run_stores_and_clear_frees_the_outcome() {
        let pdf = b"not a pdf";
        let plan = CropPlan {
            remove_outside: false,
            pages: vec![crate::PageCrop {
                page_index: 0,
                rect: crate::geometry::Rect::new(0.0, 0.0, 1.0, 1.0),
            }],
        }
        .encode();
        // SAFETY: both slices are valid for their lengths.
        let status = unsafe { pdfcrop_run(pdf.as_ptr(), pdf.len(), plan.as_ptr(), plan.len()) };
        assert_eq!(status, STATUS_ERROR);
        assert!(pdfcrop_result_len() > 0);
        assert!(!pdfcrop_result_ptr().is_null());
        assert_eq!(pdfcrop_report_len(), 0);
        let _ = pdfcrop_report_ptr();
        pdfcrop_clear();
        assert_eq!(pdfcrop_result_len(), 0);
    }

    #[test]
    fn slice_handles_empty_and_null() {
        // SAFETY: length 0 never reads.
        assert!(unsafe { slice(std::ptr::null(), 0) }.is_empty());
        let data = [1u8, 2, 3];
        // SAFETY: data is readable for 3 bytes.
        assert_eq!(unsafe { slice(data.as_ptr(), 3) }, &[1, 2, 3]);
    }

    #[test]
    fn json_string_escapes() {
        assert_eq!(json_string("a\"b\\c\nd\u{1}"), "\"a\\\"b\\\\c\\nd\\u0001\"");
        assert_eq!(json_string("plain"), "\"plain\"");
    }
}
