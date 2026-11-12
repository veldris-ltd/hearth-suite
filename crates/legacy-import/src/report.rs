//! Result and report types for legacy import.

use hearth_odf_io::model::Document;

/// A legacy Microsoft Works file format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyFormat {
    /// Works word processor document (`.wps`).
    Wps,
    /// Works spreadsheet (`.wks`).
    Wks,
    /// Works database (`.wdb`).
    Wdb,
}

impl LegacyFormat {
    /// Infer the format from a file extension (case-insensitive).
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "wps" => Some(Self::Wps),
            "wks" => Some(Self::Wks),
            "wdb" => Some(Self::Wdb),
            _ => None,
        }
    }

    /// The canonical lowercase extension for this format.
    pub fn extension(self) -> &'static str {
        match self {
            Self::Wps => "wps",
            Self::Wks => "wks",
            Self::Wdb => "wdb",
        }
    }
}

/// The on-disk container shape of a legacy file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    /// An OLE2 compound document (newer Works files).
    Ole2,
    /// A flat binary file (older Works files).
    Flat,
}

/// The text encoding recovered from the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    /// Single-byte (Latin-1 / Windows-1252-ish) text.
    Latin1,
    /// UTF-16 little-endian text.
    Utf16Le,
}

/// A report describing what an import recovered and what it could not convert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportReport {
    /// The source format that was imported.
    pub source_format: LegacyFormat,
    /// The detected container shape.
    pub container: Container,
    /// The encoding used to recover text.
    pub encoding: Encoding,
    /// Number of text blocks (paragraphs / rows) recovered.
    pub recovered_blocks: usize,
    /// Total number of characters recovered.
    pub recovered_chars: usize,
    /// True if the import was incomplete or degraded (see `notes`).
    pub partial: bool,
    /// Human-readable notes listing anything that could not be fully converted.
    pub notes: Vec<String>,
}

/// The outcome of importing a legacy file: the recovered document and a report.
#[derive(Debug, Clone, PartialEq)]
pub struct Import {
    /// The recovered Hearth Suite document.
    pub document: Document,
    /// What was recovered and what was lost.
    pub report: ImportReport,
}
