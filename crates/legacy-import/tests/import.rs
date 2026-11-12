//! Legacy import tests (`AC-LEG-1`, `AC-LEG-2`).
//!
//! Fixtures under `tests/fixtures/` stand in for real Works files: flat Latin-1
//! and UTF-16LE payloads embedded among binary noise, plus a deliberately
//! corrupt OLE2 file.

use std::io::Write;

use hearth_legacy_import::{
    decode_bytes, detect_format, import_bytes, import_path, Container, Encoding, LegacyFormat,
};
use hearth_odf_io::model::{Block, Cell, Document};

const WPS: &[u8] = include_bytes!("fixtures/sample.wps");
const WKS: &[u8] = include_bytes!("fixtures/sample.wks");
const WDB: &[u8] = include_bytes!("fixtures/sample.wdb");
const CORRUPT: &[u8] = include_bytes!("fixtures/corrupt.wps");

/// Flatten all recovered text in a document for substring assertions.
fn all_text(doc: &Document) -> String {
    let mut out = String::new();
    match doc {
        Document::Text(t) => {
            for block in &t.blocks {
                let (Block::Heading { spans, .. } | Block::Paragraph { spans }) = block;
                for span in spans {
                    out.push_str(&span.text);
                    out.push('\n');
                }
            }
        }
        Document::Spreadsheet(s) => {
            for sheet in &s.sheets {
                for row in &sheet.rows {
                    for cell in &row.cells {
                        if let Cell::Text(t) = cell {
                            out.push_str(t);
                            out.push('\n');
                        }
                    }
                }
            }
        }
    }
    out
}

/// AC-LEG-1: a `.wps` file yields a text document with the original prose.
#[test]
fn wps_text_extraction() {
    let import = import_bytes(WPS, LegacyFormat::Wps);
    let text = all_text(&import.document);

    assert!(text.contains("quick brown fox"), "got: {text:?}");
    assert!(matches!(import.document, Document::Text(_)));
    assert_eq!(import.report.encoding, Encoding::Utf16Le);
    assert!(import.report.recovered_blocks >= 1);
    assert!(!import.report.partial);
    // The report must disclose lost fidelity.
    assert!(import.report.notes.iter().any(|n| n.contains("formatting")));
}

/// AC-LEG-1: a `.wks` file yields a spreadsheet with recovered cell text.
#[test]
fn wks_text_extraction() {
    let import = import_bytes(WKS, LegacyFormat::Wks);
    let text = all_text(&import.document);

    assert!(
        text.contains("Region") && text.contains("Total"),
        "got: {text:?}"
    );
    assert!(matches!(import.document, Document::Spreadsheet(_)));
    assert_eq!(import.report.encoding, Encoding::Latin1);
    assert!(!import.report.partial);
    assert!(import.report.notes.iter().any(|n| n.contains("cell")));
}

/// AC-LEG-1: a `.wdb` file yields records with recovered text and a clear note.
#[test]
fn wdb_text_extraction() {
    let import = import_bytes(WDB, LegacyFormat::Wdb);
    let text = all_text(&import.document);

    assert!(text.contains("Alice"), "got: {text:?}");
    assert!(matches!(import.document, Document::Spreadsheet(_)));
    assert!(import
        .report
        .notes
        .iter()
        .any(|n| n.to_lowercase().contains("field")));
}

/// AC-LEG-2: a corrupt file degrades gracefully, no panic, clear report.
#[test]
fn corrupt_file_degrades_gracefully() {
    let import = import_bytes(CORRUPT, LegacyFormat::Wps);

    assert!(import.report.partial);
    assert_eq!(import.report.recovered_chars, 0);
    assert!(import
        .report
        .notes
        .iter()
        .any(|n| n.contains("No readable text") || n.contains("OLE2")));
}

/// The OLE2 (compound document) path is exercised: text inside a stream of a
/// real compound file is recovered.
#[test]
fn ole2_streams_are_read() {
    use std::io::Cursor;

    let mut comp = cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("create");
    {
        let mut stream = comp.create_stream("CONTENTS").expect("stream");
        let utf16: Vec<u8> = "Confidential quarterly report figures."
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        stream.write_all(&utf16).expect("write");
    }
    let bytes = comp.into_inner().into_inner();

    let import = import_bytes(&bytes, LegacyFormat::Wps);
    assert_eq!(import.report.container, Container::Ole2);
    assert!(all_text(&import.document).contains("quarterly report"));
}

/// `decode_bytes` (the seam the FFI maps into the translator IR) recovers real
/// text blocks from an OLE2 stream and always carries honest fidelity notes.
#[test]
fn decode_bytes_recovers_blocks_with_notes() {
    use std::io::Cursor;

    let mut comp = cfb::CompoundFile::create(Cursor::new(Vec::new())).expect("create");
    {
        let mut stream = comp.create_stream("CONTENTS").expect("stream");
        let utf16: Vec<u8> = "Region\nNorth\nSouth"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        stream.write_all(&utf16).expect("write");
    }
    let bytes = comp.into_inner().into_inner();

    let decoded = decode_bytes(&bytes, LegacyFormat::Wks);
    assert!(!decoded.blocks.is_empty(), "real text should be recovered");
    assert!(decoded.blocks.iter().any(|b| b.contains("Region")));
    assert_eq!(decoded.container, Container::Ole2);
    // Honest disclosure is always present.
    assert!(decoded
        .notes
        .iter()
        .any(|n| n.contains("formatting are not preserved")));
    assert!(decoded
        .notes
        .iter()
        .any(|n| n.contains("Spreadsheet cells")));
}

#[test]
fn detect_format_from_extension() {
    use std::path::Path;
    assert_eq!(detect_format(Path::new("a.WkS")), Some(LegacyFormat::Wks));
    assert_eq!(detect_format(Path::new("doc.wps")), Some(LegacyFormat::Wps));
    assert_eq!(detect_format(Path::new("x.txt")), None);
}

#[test]
fn import_path_reads_from_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("legacy.wps");
    std::fs::File::create(&path)
        .unwrap()
        .write_all(WPS)
        .unwrap();

    let import = import_path(&path).expect("import");
    assert!(all_text(&import.document).contains("quick brown fox"));
}
