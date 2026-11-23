//! PDF Compress WebAssembly library.
//!
//! Optimizes PDF file sizes client-side via stream deduplication, level-9 Flate
//! recompression, area-averaged image downsampling, baseline JPEG encoding,
//! soft-mask transparency preservation, and strict non-expansion safeguards.

pub mod dedup;
pub mod document;
pub mod error;
pub mod ffi;
pub mod image;
pub mod jpeg;
pub mod plan;
pub mod report;

pub use document::{compress_document, CompressOutput};
pub use error::CompressError;
pub use plan::{CompressPlan, ImageReplacement};
pub use report::CompressReport;
