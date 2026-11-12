//! Hearth Suite Bundle container.
//!
//! A Bundle is Hearth Suite's project/file container: a signed (optionally sealed)
//! ZIP archive holding a JSON [`manifest`], documents, linked data sources, and
//! assets. This crate implements read/write, the manifest schema, content
//! integrity checks, and manifest signing/verification.
//!
//! - [`Bundle`], the in-memory container with read/write and verification.
//! - [`manifest`], the manifest schema (`id`, `title`, `documents`, `sealed`,
//!   `signatures`, …).
//! - [`sign`], the [`Signer`](sign::Signer)/[`Verifier`](sign::Verifier)
//!   abstraction (post-quantum ML-DSA arrives in P1.4).
//!
//! Implemented for P1.1 (`AC-BND-1..3`).

pub mod container;
pub mod error;
pub mod manifest;
pub mod sign;

pub use container::Bundle;
pub use error::{Error, Result};
pub use manifest::Manifest;

/// Encode bytes as a lowercase hex string.
pub(crate) fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Decode a lowercase/uppercase hex string into bytes, or `None` if malformed.
pub(crate) fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = char::from(bytes[i]).to_digit(16)?;
        let lo = char::from(bytes[i + 1]).to_digit(16)?;
        out.push(u8::try_from(hi * 16 + lo).ok()?);
        i += 2;
    }
    Some(out)
}
