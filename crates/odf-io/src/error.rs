//! Error type for OpenDocument and Office I/O.

use std::io;

/// Errors that can occur while reading or writing documents.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// An underlying I/O failure.
    #[error("i/o error: {0}")]
    Io(#[from] io::Error),

    /// The container (ZIP package) could not be read or written.
    #[error("zip container error: {0}")]
    Zip(#[from] zip::result::ZipError),

    /// The document XML was malformed.
    #[error("xml error: {0}")]
    Xml(String),

    /// A required part was missing from the package (e.g. `content.xml`).
    #[error("missing package part: {0}")]
    MissingPart(String),

    /// The package declared a mimetype this crate does not handle.
    #[error("unsupported document type: {0}")]
    UnsupportedType(String),

    /// A numeric value in the document could not be parsed.
    #[error("invalid value: {0}")]
    InvalidValue(String),
}

impl From<quick_xml::Error> for Error {
    fn from(value: quick_xml::Error) -> Self {
        Self::Xml(value.to_string())
    }
}

impl From<quick_xml::events::attributes::AttrError> for Error {
    fn from(value: quick_xml::events::attributes::AttrError) -> Self {
        Self::Xml(value.to_string())
    }
}

impl From<quick_xml::encoding::EncodingError> for Error {
    fn from(value: quick_xml::encoding::EncodingError) -> Self {
        Self::Xml(value.to_string())
    }
}

/// A convenient `Result` alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;
