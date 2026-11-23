//! PDF OCR helper WebAssembly library.
//!
//! Provides fast client-side primitives for the OCR PDF tool:
//! - RFC 1952 gzip decompression for self-hosted `.traineddata.gz` files
//! - DPI-aware 24-bit BMP encoding with optional scan contrast enhancement
//! - Glyphless TrueType + UTF-16BE `/ToUnicode` CMap invisible text-layer builder
//! - Overlay `/MediaBox` & coordinate transform normalization for `qpdf --overlay`

pub mod bmp;
pub mod error;
pub mod ffi;
pub mod font;
pub mod gzip;
pub mod overlay;
pub mod text_layer;

pub use bmp::preprocess_and_encode_bmp;
pub use error::OcrError;
pub use gzip::decompress_gzip_or_raw;
pub use overlay::normalize_overlay_pdf;
pub use text_layer::{build_text_layer_pdf, parse_words_tsv, OcrWord};
