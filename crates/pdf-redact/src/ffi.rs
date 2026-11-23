//! WebAssembly C FFI exports for `pdf-redact` linear memory integration.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

use crate::document::sanitize_document;
use crate::error::RedactError;
use crate::plan::SanitizePlan;

/// Return code indicating sanitization succeeded.
pub const STATUS_OK: u32 = 0;
/// Return code indicating sanitization failed.
pub const STATUS_ERROR: u32 = 1;
/// The ABI contract version for `pdf-redact`.
pub const ABI_VERSION: u32 = 1;

/// Stores the outcome of the most recent `pdfredact_run` call.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Sanitized PDF bytes on success, or JSON error description on failure.
    pub result: Vec<u8>,
    /// Serialized JSON report on success (empty on failure).
    pub report: Vec<u8>,
}

thread_local! {
    static LAST: RefCell<Outcome> = RefCell::new(Outcome::default());
}

/// Returns the exported ABI version so TypeScript loaders can ensure compatibility.
#[no_mangle]
pub extern "C" fn pdfredact_abi_version() -> u32 {
    ABI_VERSION
}

/// Allocates a linear memory buffer of the requested length.
#[no_mangle]
pub extern "C" fn pdfredact_alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Deallocates memory previously reserved with [`pdfredact_alloc`].
///
/// # Safety
///
/// `ptr` must have been returned by [`pdfredact_alloc`] with the same `len`.
#[no_mangle]
pub unsafe extern "C" fn pdfredact_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
}

/// Runs the sanitization engine against `pdf` using the binary `plan`.
///
/// # Safety
///
/// `pdf` must point to `pdf_len` readable bytes, and `plan` must point to
/// `plan_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn pdfredact_run(
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

/// Pure Rust core called by [`pdfredact_run`] and native unit tests.
pub fn run_core(pdf: &[u8], plan_bytes: &[u8]) -> (u32, Outcome) {
    let result = SanitizePlan::decode(plan_bytes).and_then(|plan| sanitize_document(pdf, &plan));
    match result {
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

fn error_outcome(err: &RedactError) -> (u32, Outcome) {
    let json = format!(
        "{{\"code\":\"{}\",\"message\":\"{}\"}}",
        err.code(),
        escape_json_err(&err.to_string())
    );
    (
        STATUS_ERROR,
        Outcome {
            result: json.into_bytes(),
            report: Vec::new(),
        },
    )
}

fn escape_json_err(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// Returns the pointer to the last execution result.
#[no_mangle]
pub extern "C" fn pdfredact_result_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().result.as_ptr())
}

/// Returns the byte length of the last execution result.
#[no_mangle]
pub extern "C" fn pdfredact_result_len() -> usize {
    LAST.with(|last| last.borrow().result.len())
}

/// Returns the pointer to the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfredact_report_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().report.as_ptr())
}

/// Returns the byte length of the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfredact_report_len() -> usize {
    LAST.with(|last| last.borrow().report.len())
}

/// Frees cached results from the last sanitization run.
#[no_mangle]
pub extern "C" fn pdfredact_clear() {
    LAST.with(|last| *last.borrow_mut() = Outcome::default());
}

/// Randomness stub for `getrandom` under `wasm32-unknown-unknown`.
///
/// `lopdf` pulls in `getrandom` for encryption routines that `pdf-redact`
/// never invokes.
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
    fn abi_version_matches() {
        assert_eq!(pdfredact_abi_version(), ABI_VERSION);
    }

    #[test]
    fn alloc_and_free_round_trip() {
        let ptr = pdfredact_alloc(64);
        assert!(!ptr.is_null());
        unsafe { pdfredact_free(ptr, 64) };
        unsafe { pdfredact_free(std::ptr::null_mut(), 0) };
    }

    #[test]
    fn run_core_reports_invalid_plan_and_empty_input() {
        let (status, outcome) = run_core(&[], &[]);
        assert_eq!(status, STATUS_ERROR);
        assert!(String::from_utf8(outcome.result)
            .unwrap()
            .contains("\"code\":\"invalid-plan\""));

        let plan = SanitizePlan {
            clean_metadata: true,
            clean_attachments: true,
            clean_javascript: true,
            clean_hidden_layers: true,
            clean_bookmarks: true,
            replacement_label: "[REDACTED]".into(),
            terms: vec![],
            boxes: vec![],
        }
        .encode();
        let (status2, outcome2) = run_core(&[], &plan);
        assert_eq!(status2, STATUS_ERROR);
        assert!(String::from_utf8(outcome2.result)
            .unwrap()
            .contains("\"code\":\"empty-input\""));
    }

    #[test]
    fn exported_run_stores_and_clears_outcome() {
        let plan = SanitizePlan {
            clean_metadata: true,
            clean_attachments: false,
            clean_javascript: false,
            clean_hidden_layers: false,
            clean_bookmarks: false,
            replacement_label: "[REDACTED]".into(),
            terms: vec![],
            boxes: vec![],
        }
        .encode();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
        let pdf = std::fs::read(format!("{fixtures}plain.pdf")).unwrap();

        let pdf_ptr = pdfredact_alloc(pdf.len());
        let plan_ptr = pdfredact_alloc(plan.len());
        unsafe {
            std::ptr::copy_nonoverlapping(pdf.as_ptr(), pdf_ptr, pdf.len());
            std::ptr::copy_nonoverlapping(plan.as_ptr(), plan_ptr, plan.len());
            assert_eq!(
                pdfredact_run(pdf_ptr, pdf.len(), plan_ptr, plan.len()),
                STATUS_OK
            );
            assert!(pdfredact_result_len() > 0);
            assert!(!pdfredact_result_ptr().is_null());
            assert!(pdfredact_report_len() > 0);
            assert!(!pdfredact_report_ptr().is_null());
            pdfredact_free(pdf_ptr, pdf.len());
            pdfredact_free(plan_ptr, plan.len());
        }
        pdfredact_clear();
        assert_eq!(pdfredact_result_len(), 0);
        assert_eq!(pdfredact_report_len(), 0);
    }
}
