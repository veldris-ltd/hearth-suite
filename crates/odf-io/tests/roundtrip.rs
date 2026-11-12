//! Round-trip tests for the OpenDocument and Office codecs.
//!
//! - `AC-FMT-1`: ODF is canonical and lossless (property-tested across
//!   generated text documents and spreadsheets).
//! - `AC-FMT-2`: `.docx`/`.xlsx` import then export preserves text, tables, and
//!   core formatting, with a fidelity report.

use hearth_odf_io::model::{Block, Cell, Document, Row, Sheet, Span, Spreadsheet, TextDocument};
use hearth_odf_io::{odf, ooxml};
use proptest::prelude::*;

// ---- strategies -------------------------------------------------------------

// Printable text including the XML metacharacters `&`, `<`, `>` to exercise
// escaping. Excludes control characters and quotes for stable round-tripping.
const TEXT_RE: &str = "[a-zA-Z0-9 .,&<>]{1,24}";
const CELL_RE: &str = "[a-zA-Z0-9 .,&<>]{0,20}";
const NAME_RE: &str = "[A-Za-z0-9_]{1,12}";

fn span_strat() -> impl Strategy<Value = Span> {
    (TEXT_RE, any::<bool>(), any::<bool>()).prop_map(|(text, bold, italic)| Span {
        text,
        bold,
        italic,
    })
}

fn block_strat() -> impl Strategy<Value = Block> {
    prop_oneof![
        (1u8..=6, prop::collection::vec(span_strat(), 1..4))
            .prop_map(|(level, spans)| Block::Heading { level, spans }),
        prop::collection::vec(span_strat(), 1..4).prop_map(|spans| Block::Paragraph { spans }),
    ]
}

fn text_doc_strat() -> impl Strategy<Value = TextDocument> {
    prop::collection::vec(block_strat(), 0..8).prop_map(|blocks| TextDocument { blocks })
}

fn cell_strat() -> impl Strategy<Value = Cell> {
    prop_oneof![
        Just(Cell::Empty),
        CELL_RE.prop_map(Cell::Text),
        (-1_000_000.0f64..1_000_000.0).prop_map(Cell::Number),
    ]
}

fn sheet_strat() -> impl Strategy<Value = Sheet> {
    let rows = prop::collection::vec(
        prop::collection::vec(cell_strat(), 0..6).prop_map(|cells| Row { cells }),
        0..6,
    );
    (NAME_RE, rows).prop_map(|(name, rows)| Sheet { name, rows })
}

fn spreadsheet_strat() -> impl Strategy<Value = Spreadsheet> {
    prop::collection::vec(sheet_strat(), 1..3).prop_map(|sheets| Spreadsheet { sheets })
}

// ---- property tests ---------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// AC-FMT-1: ODT round-trip is lossless for the text model.
    #[test]
    fn odf_text_roundtrip(doc in text_doc_strat()) {
        let bytes = odf::write_document(&Document::Text(doc.clone()))?;
        let back = odf::read_document(&bytes)?;
        prop_assert_eq!(Document::Text(doc), back);
    }

    /// AC-FMT-1: ODS round-trip is lossless for the spreadsheet model.
    #[test]
    fn odf_spreadsheet_roundtrip(doc in spreadsheet_strat()) {
        let bytes = odf::write_document(&Document::Spreadsheet(doc.clone()))?;
        let back = odf::read_document(&bytes)?;
        prop_assert_eq!(Document::Spreadsheet(doc), back);
    }

    /// AC-FMT-2: `.docx` export/import preserves text, structure, and bold/italic.
    #[test]
    fn docx_roundtrip(doc in text_doc_strat()) {
        let bytes = ooxml::export_docx(&doc)?;
        let (back, report) = ooxml::import_docx(&bytes)?;
        prop_assert_eq!(doc, back);
        prop_assert!(report.is_lossless(), "unexpected fidelity loss: {report:?}");
    }

    /// AC-FMT-2: `.xlsx` export/import preserves the cell grid and values.
    #[test]
    fn xlsx_roundtrip(doc in spreadsheet_strat()) {
        let bytes = ooxml::export_xlsx(&doc)?;
        let (back, report) = ooxml::import_xlsx(&bytes)?;
        prop_assert_eq!(doc, back);
        prop_assert!(report.is_lossless(), "unexpected fidelity loss: {report:?}");
    }
}

// ---- explicit examples ------------------------------------------------------

#[test]
fn odf_preserves_xml_metacharacters() {
    let doc = Document::Text(TextDocument {
        blocks: vec![Block::Paragraph {
            spans: vec![Span {
                text: "a & b < c > d".to_owned(),
                bold: true,
                italic: false,
            }],
        }],
    });
    let bytes = odf::write_document(&doc).expect("write");
    let back = odf::read_document(&bytes).expect("read");
    assert_eq!(doc, back);
}

#[test]
fn docx_reports_fidelity() {
    let doc = TextDocument {
        blocks: vec![
            Block::Heading {
                level: 1,
                spans: vec![Span::plain("Title")],
            },
            Block::Paragraph {
                spans: vec![
                    Span {
                        text: "bold".to_owned(),
                        bold: true,
                        italic: false,
                    },
                    Span {
                        text: "italic".to_owned(),
                        bold: false,
                        italic: true,
                    },
                ],
            },
        ],
    };
    let bytes = ooxml::export_docx(&doc).expect("export");
    let (back, report) = ooxml::import_docx(&bytes).expect("import");
    assert_eq!(doc, back);
    assert_ne!(report.preserved, Vec::<String>::new());
    assert!(report.is_lossless());
}

#[test]
fn xlsx_preserves_mixed_cells() {
    let doc = Spreadsheet {
        sheets: vec![Sheet {
            name: "Data".to_owned(),
            rows: vec![
                Row {
                    cells: vec![Cell::Text("name".to_owned()), Cell::Text("qty".to_owned())],
                },
                Row {
                    cells: vec![Cell::Text("widgets".to_owned()), Cell::Number(42.0)],
                },
                Row {
                    cells: vec![Cell::Empty, Cell::Number(-3.5)],
                },
            ],
        }],
    };
    let bytes = ooxml::export_xlsx(&doc).expect("export");
    let (back, _report) = ooxml::import_xlsx(&bytes).expect("import");
    assert_eq!(doc, back);
}
