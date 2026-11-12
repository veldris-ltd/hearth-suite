//! Importing legacy Works files into Hearth Suite documents.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use hearth_odf_io::model::{Block, Cell, Document, Row, Sheet, Span, Spreadsheet, TextDocument};

use crate::extract::{recover_text, Recovered};
use crate::report::{Container, Encoding, Import, ImportReport, LegacyFormat};

/// OLE2 / Compound File Binary magic signature.
const OLE2_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Infer the legacy format of a path from its extension.
pub fn detect_format(path: &Path) -> Option<LegacyFormat> {
    path.extension()
        .and_then(|e| e.to_str())
        .and_then(LegacyFormat::from_extension)
}

/// Import a legacy file from disk.
///
/// # Errors
/// Returns an error if the file cannot be read, or if its extension is not a
/// recognized legacy format (`.wps`, `.wks`, `.wdb`).
pub fn import_path(path: &Path) -> std::io::Result<Import> {
    let format = detect_format(path).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "unrecognized legacy file extension (expected .wps, .wks, or .wdb)",
        )
    })?;
    let bytes = std::fs::read(path)?;
    Ok(import_bytes(&bytes, format))
}

/// The portable, best-effort decode of a legacy file: the recovered text blocks
/// plus the honest fidelity notes and the detected container/encoding.
///
/// This is the seam the FFI exposes to the desktop and mobile clients (each maps
/// it into the translator's intermediate representation). A native `libwps`
/// backend can replace the recovery for full fidelity; the shape stays the same.
#[derive(Debug, Clone)]
pub struct Decoded {
    /// Recovered text, one entry per paragraph (`.wps`) or row (`.wks`/`.wdb`).
    pub blocks: Vec<String>,
    /// Honest, human-readable notes on what could not be converted.
    pub notes: Vec<String>,
    /// The container the bytes were read from.
    pub container: Container,
    /// The text encoding the payload was recovered as.
    pub encoding: Encoding,
    /// Total characters recovered.
    pub chars: usize,
    /// Whether the decode was only partial (nothing recovered, or an OLE2
    /// parse fell back to a raw byte scan).
    pub partial: bool,
}

/// Decode legacy bytes into recovered text blocks and an honest set of notes.
///
/// Never fails: unreadable or corrupt input degrades to whatever text can be
/// recovered, with the shortfall recorded in [`Decoded::notes`] (`AC-LEG-2`).
pub fn decode_bytes(bytes: &[u8], format: LegacyFormat) -> Decoded {
    let mut notes = Vec::new();
    let is_ole2 = bytes.starts_with(&OLE2_MAGIC);

    let (payload, container) = if is_ole2 {
        if let Some(streams) = read_ole2_streams(bytes) {
            (streams, Container::Ole2)
        } else {
            notes.push(
                "OLE2 structure could not be parsed; recovered via raw byte scan.".to_owned(),
            );
            (bytes.to_vec(), Container::Ole2)
        }
    } else {
        (bytes.to_vec(), Container::Flat)
    };
    let ole2_fallback = container == Container::Ole2 && notes.iter().any(|n| n.contains("OLE2"));

    let Recovered {
        blocks,
        encoding,
        chars,
    } = recover_text(&payload);

    // Always disclose the fidelity limits of best-effort extraction.
    notes.push(
        "Character and paragraph formatting are not preserved (best-effort text extraction)."
            .to_owned(),
    );
    match format {
        LegacyFormat::Wks => notes.push(
            "Spreadsheet cells and formulas are approximated as one text value per row.".to_owned(),
        ),
        LegacyFormat::Wdb => notes.push(
            "Database field structure is not recovered; each value is placed in a single column."
                .to_owned(),
        ),
        LegacyFormat::Wps => {}
    }
    if blocks.is_empty() {
        notes.push("No readable text could be recovered from this file.".to_owned());
    }

    let partial = blocks.is_empty() || ole2_fallback;

    Decoded {
        blocks,
        notes,
        container,
        encoding,
        chars,
        partial,
    }
}

/// Import legacy bytes of a known format.
///
/// This never fails: unreadable or corrupt input degrades to whatever text can
/// be recovered, with the shortfall recorded in the [`ImportReport`]
/// (`AC-LEG-2`).
pub fn import_bytes(bytes: &[u8], format: LegacyFormat) -> Import {
    let decoded = decode_bytes(bytes, format);
    let document = build_document(format, &decoded.blocks);
    Import {
        document,
        report: ImportReport {
            source_format: format,
            container: decoded.container,
            encoding: decoded.encoding,
            recovered_blocks: decoded.blocks.len(),
            recovered_chars: decoded.chars,
            partial: decoded.partial,
            notes: decoded.notes,
        },
    }
}

/// Map recovered text blocks into the closest Hearth Suite document for the format.
fn build_document(format: LegacyFormat, blocks: &[String]) -> Document {
    match format {
        LegacyFormat::Wps => {
            let blocks = blocks
                .iter()
                .map(|text| Block::Paragraph {
                    spans: vec![Span::plain(text.clone())],
                })
                .collect();
            Document::Text(TextDocument { blocks })
        }
        LegacyFormat::Wks | LegacyFormat::Wdb => {
            let rows = blocks
                .iter()
                .map(|text| Row {
                    cells: vec![Cell::Text(text.clone())],
                })
                .collect();
            let name = if format == LegacyFormat::Wks {
                "Imported Sheet"
            } else {
                "Imported Records"
            };
            Document::Spreadsheet(Spreadsheet {
                sheets: vec![Sheet {
                    name: name.to_owned(),
                    rows,
                }],
            })
        }
    }
}

/// Read and concatenate all stream contents from an OLE2 compound document.
///
/// Returns `None` if the bytes are not a parseable compound file.
fn read_ole2_streams(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut comp = cfb::CompoundFile::open(Cursor::new(bytes)).ok()?;
    let paths: Vec<PathBuf> = comp
        .walk()
        .filter(cfb::Entry::is_stream)
        .map(|entry| entry.path().to_path_buf())
        .collect();

    let mut payload = Vec::new();
    for path in paths {
        if let Ok(mut stream) = comp.open_stream(&path) {
            // Ignore per-stream read errors; recover whatever we can.
            let _ = stream.read_to_end(&mut payload);
        }
    }
    Some(payload)
}
