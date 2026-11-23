//! Binary compression plan parser and serializer for the TypeScript ↔ WASM contract.
//!
//! Follows Single Responsibility Principle (SRP) by defining the immutable
//! configuration data structures and their deterministic binary wire encoding.

use crate::error::CompressError;

/// Magic header identifying a valid binary compression plan (`PCMP`).
pub const PLAN_MAGIC: &[u8; 4] = b"PCMP";
/// Supported binary plan protocol version.
pub const PLAN_VERSION: u32 = 1;
/// Header size in bytes: magic (4) + version (4) + flags (4) + target_dpi (4) + quality (4) + count (4).
const HEADER_SIZE: usize = 24;
/// Per-replacement fixed header size: hash (8) + 5 * u32 (20) + data_len (4) = 32 bytes.
const ENTRY_HEADER_SIZE: usize = 32;

/// A pre-encoded replacement JPEG stream supplied by the caller (e.g. decoded via PDFium
/// for CMYK/JPEG2000/CCITT/Indexed images that need full color-space resolution).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageReplacement {
    /// 64-bit FNV-1a hash of the original raw stream content bytes.
    pub raw_hash: u64,
    /// Original image width in pixels.
    pub original_width: u32,
    /// Original image height in pixels.
    pub original_height: u32,
    /// Replacement JPEG width in pixels.
    pub new_width: u32,
    /// Replacement JPEG height in pixels.
    pub new_height: u32,
    /// Whether the replacement JPEG is 1-channel DeviceGray (true) or 3-channel DeviceRGB (false).
    pub grayscale: bool,
    /// Encoded baseline JPEG bytes (`/DCTDecode` stream payload).
    pub jpeg_bytes: Vec<u8>,
}

/// Complete compression plan governing structural and image optimizations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressPlan {
    /// When true, only lossless structural passes (dedup, Flate-9, prune) run.
    pub lossless: bool,
    /// Target maximum effective image DPI (0 disables downsampling).
    pub target_dpi: u32,
    /// Target baseline JPEG quality in `[1, 100]`.
    pub quality: u8,
    /// When true, converts eligible opaque images to grayscale.
    pub grayscale: bool,
    /// Pre-encoded JPEG replacements keyed by `(raw_hash, original_width, original_height)`.
    pub replacements: Vec<ImageReplacement>,
}

impl Default for CompressPlan {
    /// Returns a safe lossless default configuration.
    fn default() -> Self {
        Self {
            lossless: true,
            target_dpi: 0,
            quality: 75,
            grayscale: false,
            replacements: Vec::new(),
        }
    }
}

impl CompressPlan {
    /// Parses a binary compression plan buffer produced by TypeScript.
    ///
    /// An empty buffer resolves to [`CompressPlan::default()`] (lossless mode).
    ///
    /// Wire layout (all integers little-endian):
    /// - `[0..4]`   magic `"PCMP"`
    /// - `[4..8]`   version (`1`)
    /// - `[8..12]`  flags (`bit 0 = lossless`, `bit 1 = grayscale`)
    /// - `[12..16]` `target_dpi` (`u32`)
    /// - `[16..20]` `quality` (`u32`, clamped `1..=100`)
    /// - `[20..24]` `replacement_count` (`u32`)
    /// - Followed by `replacement_count` variable-length replacement records.
    ///
    /// # Arguments
    ///
    /// * `bytes` - Raw plan bytes passed across the FFI boundary.
    ///
    /// # Errors
    ///
    /// Returns [`CompressError::InvalidConfig`] if the header, version, or record lengths are invalid.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CompressError> {
        if bytes.is_empty() {
            return Ok(Self::default());
        }
        if bytes.len() < HEADER_SIZE || &bytes[0..4] != PLAN_MAGIC {
            return Err(CompressError::InvalidConfig);
        }

        let version = read_u32_le(bytes, 4)?;
        if version != PLAN_VERSION {
            return Err(CompressError::InvalidConfig);
        }

        let flags = read_u32_le(bytes, 8)?;
        let lossless = (flags & 1) != 0;
        let grayscale = (flags & 2) != 0;
        let target_dpi = read_u32_le(bytes, 12)?;
        let raw_quality = read_u32_le(bytes, 16)?;
        let quality = raw_quality.clamp(1, 100) as u8;
        let count = read_u32_le(bytes, 20)? as usize;

        let mut offset = HEADER_SIZE;
        let mut replacements = Vec::with_capacity(count.min(4096));

        for _ in 0..count {
            if offset + ENTRY_HEADER_SIZE > bytes.len() {
                return Err(CompressError::InvalidConfig);
            }
            let raw_hash = read_u64_le(bytes, offset)?;
            let original_width = read_u32_le(bytes, offset + 8)?;
            let original_height = read_u32_le(bytes, offset + 12)?;
            let new_width = read_u32_le(bytes, offset + 16)?;
            let new_height = read_u32_le(bytes, offset + 20)?;
            let entry_flags = read_u32_le(bytes, offset + 24)?;
            let data_len = read_u32_le(bytes, offset + 28)? as usize;
            offset += ENTRY_HEADER_SIZE;

            if offset.checked_add(data_len).is_none_or(|end| end > bytes.len()) {
                return Err(CompressError::InvalidConfig);
            }
            let jpeg_bytes = bytes[offset..offset + data_len].to_vec();
            offset += data_len;

            replacements.push(ImageReplacement {
                raw_hash,
                original_width,
                original_height,
                new_width,
                new_height,
                grayscale: (entry_flags & 1) != 0,
                jpeg_bytes,
            });
        }

        if offset != bytes.len() {
            return Err(CompressError::InvalidConfig);
        }

        Ok(Self {
            lossless,
            target_dpi,
            quality,
            grayscale,
            replacements,
        })
    }

    /// Serializes this compression plan into the binary `PCMP` wire format.
    ///
    /// # Returns
    ///
    /// Byte vector suitable for passing to [`CompressPlan::from_bytes`].
    pub fn to_bytes(&self) -> Vec<u8> {
        let extra: usize = self
            .replacements
            .iter()
            .map(|r| ENTRY_HEADER_SIZE + r.jpeg_bytes.len())
            .sum();
        let mut out = Vec::with_capacity(HEADER_SIZE + extra);
        out.extend_from_slice(PLAN_MAGIC);
        out.extend_from_slice(&PLAN_VERSION.to_le_bytes());

        let mut flags = 0u32;
        if self.lossless {
            flags |= 1;
        }
        if self.grayscale {
            flags |= 2;
        }
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&self.target_dpi.to_le_bytes());
        out.extend_from_slice(&(self.quality as u32).to_le_bytes());
        out.extend_from_slice(&(self.replacements.len() as u32).to_le_bytes());

        for r in &self.replacements {
            out.extend_from_slice(&r.raw_hash.to_le_bytes());
            out.extend_from_slice(&r.original_width.to_le_bytes());
            out.extend_from_slice(&r.original_height.to_le_bytes());
            out.extend_from_slice(&r.new_width.to_le_bytes());
            out.extend_from_slice(&r.new_height.to_le_bytes());
            let entry_flags = u32::from(r.grayscale);
            out.extend_from_slice(&entry_flags.to_le_bytes());
            out.extend_from_slice(&(r.jpeg_bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(&r.jpeg_bytes);
        }

        out
    }
}

/// Reads a little-endian `u32` at `offset` with bounds verification.
fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, CompressError> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or(CompressError::InvalidConfig)?;
    let arr: [u8; 4] = slice.try_into().map_err(|_| CompressError::InvalidConfig)?;
    Ok(u32::from_le_bytes(arr))
}

/// Reads a little-endian `u64` at `offset` with bounds verification.
fn read_u64_le(bytes: &[u8], offset: usize) -> Result<u64, CompressError> {
    let slice = bytes
        .get(offset..offset + 8)
        .ok_or(CompressError::InvalidConfig)?;
    let arr: [u8; 8] = slice.try_into().map_err(|_| CompressError::InvalidConfig)?;
    Ok(u64::from_le_bytes(arr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_buffer_defaults_to_lossless() {
        let plan = CompressPlan::from_bytes(&[]).expect("empty buffer returns default");
        assert!(plan.lossless);
        assert_eq!(plan.target_dpi, 0);
        assert_eq!(plan.quality, 75);
        assert!(!plan.grayscale);
        assert!(plan.replacements.is_empty());
    }

    #[test]
    fn round_trips_plan_with_replacements() {
        let original = CompressPlan {
            lossless: false,
            target_dpi: 150,
            quality: 72,
            grayscale: true,
            replacements: vec![ImageReplacement {
                raw_hash: 0x0123_4567_89ab_cdef,
                original_width: 1200,
                original_height: 800,
                new_width: 600,
                new_height: 400,
                grayscale: true,
                jpeg_bytes: vec![0xff, 0xd8, 0xff, 0xd9],
            }],
        };

        let encoded = original.to_bytes();
        let decoded = CompressPlan::from_bytes(&encoded).expect("round-trip decode");
        assert_eq!(decoded, original);
    }

    #[test]
    fn rejects_invalid_magic_or_truncated_buffers() {
        assert_eq!(
            CompressPlan::from_bytes(b"NOPE00000000000000000000"),
            Err(CompressError::InvalidConfig)
        );
        let mut encoded = CompressPlan::default().to_bytes();
        encoded.pop();
        assert_eq!(
            CompressPlan::from_bytes(&encoded),
            Err(CompressError::InvalidConfig)
        );
    }
}
