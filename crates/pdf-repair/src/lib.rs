//! PDF Repair WebAssembly library.
//!
//! Reconstructs corrupted, damaged, or unreadable PDF files by performing
//! linear object carving, header and EOF sanitization, and rebuilding
//! standard cross-reference tables and trailers.

pub mod carve;
pub mod document;
pub mod error;
pub mod ffi;
pub mod report;

pub use document::{repair_document, RepairOutput};
pub use error::RepairError;
pub use report::RepairReport;
