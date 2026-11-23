//! WebAssembly C FFI exports for linear memory integration.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;
use crate::document::repair_document;

/// Return code indicating repair operation succeeded.
pub const STATUS_OK: u32 = 0;
/// Return code indicating repair operation failed.
pub const STATUS_ERROR: u32 = 1;
/// The ABI contract version for pdf-repair.
pub const ABI_VERSION: u32 = 1;

/// Stores the outcome of the most recent repair execution.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Repaired PDF bytes, or JSON error description on failure.
    pub result: Vec<u8>,
    /// Serialized JSON repair report (empty on failure).
    pub report: Vec<u8>,
}

thread_local! {
    static LAST: RefCell<Outcome> = RefCell::new(Outcome::default());
}

/// Returns the exported ABI version so TypeScript loaders can ensure compatibility.
#[no_mangle]
pub extern "C" fn pdfrepair_abi_version() -> u32 {
    ABI_VERSION
}

/// Allocates linear memory buffer of the requested length.
///
/// # Arguments
///
/// * `len` - Number of bytes to allocate.
///
/// # Returns
///
/// Pointer to allocated buffer, or null on allocation failure.
#[no_mangle]
pub extern "C" fn pdfrepair_alloc(len: usize) -> *mut u8 {
    match Layout::from_size_align(len.max(1), 1) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => std::ptr::null_mut(),
    }
}

/// Deallocates memory previously reserved with [`pdfrepair_alloc`].
///
/// # Safety
///
/// `ptr` must have been returned by [`pdfrepair_alloc`] with the identical `len`.
#[no_mangle]
pub unsafe extern "C" fn pdfrepair_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(len.max(1), 1)) }
}

/// Runs the repair engine against the provided PDF buffer.
///
/// # Safety
///
/// `pdf` must be a valid pointer to readable memory of length `pdf_len`.
#[no_mangle]
pub unsafe extern "C" fn pdfrepair_run(pdf: *const u8, pdf_len: usize) -> u32 {
    let slice = if pdf.is_null() || pdf_len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(pdf, pdf_len) }
    };

    let (status, outcome) = run_core(slice);
    LAST.with(|last| *last.borrow_mut() = outcome);
    status
}

/// Core execution routine returning status code and output representation.
pub fn run_core(pdf: &[u8]) -> (u32, Outcome) {
    match repair_document(pdf) {
        Ok(output) => (
            STATUS_OK,
            Outcome {
                result: output.pdf,
                report: output.report.to_json().into_bytes(),
            },
        ),
        Err(err) => {
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
    }
}

/// Helper to escape an error string for JSON wrapping.
fn escape_json_err(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

/// Returns the pointer to the last execution result.
#[no_mangle]
pub extern "C" fn pdfrepair_result_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().result.as_ptr())
}

/// Returns the byte length of the last execution result.
#[no_mangle]
pub extern "C" fn pdfrepair_result_len() -> usize {
    LAST.with(|last| last.borrow().result.len())
}

/// Returns the pointer to the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfrepair_report_ptr() -> *const u8 {
    LAST.with(|last| last.borrow().report.as_ptr())
}

/// Returns the byte length of the last execution report JSON.
#[no_mangle]
pub extern "C" fn pdfrepair_report_len() -> usize {
    LAST.with(|last| last.borrow().report.len())
}

/// Frees cached results from the last repair operation.
#[no_mangle]
pub extern "C" fn pdfrepair_clear() {
    LAST.with(|last| *last.borrow_mut() = Outcome::default());
}

/// The randomness source for `getrandom` under `wasm32-unknown-unknown`.
///
/// lopdf declares an optional dependency on `getrandom` for encryption features,
/// which are never used during document repair.
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
        assert_eq!(pdfrepair_abi_version(), ABI_VERSION);
    }

    #[test]
    fn alloc_and_free_round_trip() {
        let ptr = pdfrepair_alloc(64);
        assert!(!ptr.is_null());
        unsafe { pdfrepair_free(ptr, 64) };
        unsafe { pdfrepair_free(std::ptr::null_mut(), 0) };
    }

    #[test]
    fn run_reports_errors_for_empty_buffer() {
        let (status, outcome) = run_core(&[]);
        assert_eq!(status, STATUS_ERROR);
        let text = String::from_utf8(outcome.result).unwrap();
        assert!(text.contains("\"code\":\"empty-input\""));
        assert!(outcome.report.is_empty());
    }

    #[test]
    fn exported_run_stores_and_clears_outcome() {
        let (status, _) = run_core(b"not a valid pdf");
        assert_eq!(status, STATUS_ERROR);

        let ptr = pdfrepair_alloc(10);
        let run_status = unsafe { pdfrepair_run(ptr, 10) };
        assert_eq!(run_status, STATUS_ERROR);
        assert!(pdfrepair_result_len() > 0);
        assert!(!pdfrepair_result_ptr().is_null());

        pdfrepair_clear();
        assert_eq!(pdfrepair_result_len(), 0);
        unsafe { pdfrepair_free(ptr, 10) };
    }
}
