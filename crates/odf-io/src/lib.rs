//! OpenDocument I/O for Hearth Suite.
//!
//! Reads and writes OpenDocument (ODT/ODS) as the canonical format, and provides
//! best-effort round-trip import/export for `.docx` and `.xlsx`. All codecs read
//! into and write from the shared [`model`].
//!
//! - [`odf`], the canonical OpenDocument codec (lossless for the model).
//! - [`ooxml`], Office Open XML import/export with a [`ooxml::FidelityReport`].
//!
//! Implemented for P1.1 (`AC-FMT-1..2`).

pub mod error;
pub mod model;
pub mod odf;
pub mod ooxml;

pub use error::{Error, Result};

/// Escape a string for use in XML text or attribute values.
///
/// Escapes the five predefined XML entities so the value is safe in both text
/// and double-quoted attribute positions.
pub(crate) fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Resolve an XML entity/character reference event to its textual value.
///
/// quick-xml emits references (e.g. `&gt;`, `&#62;`) as standalone
/// [`GeneralRef`](quick_xml::events::Event::GeneralRef) events rather than
/// folding them into the surrounding text, so every text-collecting reader
/// routes them through here.
///
/// # Errors
/// Returns an error if the reference cannot be decoded.
pub(crate) fn ref_to_str(r: &quick_xml::events::BytesRef<'_>) -> Result<String> {
    if let Some(ch) = r.resolve_char_ref()? {
        return Ok(ch.to_string());
    }
    let name = r.decode()?;
    Ok(match name.as_ref() {
        "lt" => "<".to_owned(),
        "gt" => ">".to_owned(),
        "amp" => "&".to_owned(),
        "quot" => "\"".to_owned(),
        "apos" => "'".to_owned(),
        other => other.to_owned(),
    })
}
