//! The in-memory document model shared by the OpenDocument and Office codecs.
//!
//! The model is deliberately small: it captures the content and core formatting
//! that Hearth Suite round-trips losslessly through ODF (the canonical format) and
//! best-effort through `.docx`/`.xlsx`. It is the single representation every
//! codec reads into and writes from.

/// A Hearth Suite document, either a text document or a spreadsheet.
#[derive(Debug, Clone, PartialEq)]
pub enum Document {
    /// A word-processing document (canonical on disk as ODT).
    Text(TextDocument),
    /// A spreadsheet (canonical on disk as ODS).
    Spreadsheet(Spreadsheet),
}

/// A word-processing document: an ordered list of block-level elements.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TextDocument {
    /// The block-level content, in document order.
    pub blocks: Vec<Block>,
}

/// A block-level element of a [`TextDocument`].
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    /// A heading at the given outline level (1-based).
    Heading {
        /// Outline level (1 = top level).
        level: u8,
        /// The heading's inline content.
        spans: Vec<Span>,
    },
    /// A body paragraph.
    Paragraph {
        /// The paragraph's inline content.
        spans: Vec<Span>,
    },
}

/// A run of text with uniform character formatting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    /// The text content (non-empty in well-formed documents).
    pub text: String,
    /// Whether the run is bold.
    pub bold: bool,
    /// Whether the run is italic.
    pub italic: bool,
}

impl Span {
    /// Create a plain (non-bold, non-italic) span.
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            bold: false,
            italic: false,
        }
    }
}

/// A spreadsheet: an ordered list of sheets.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Spreadsheet {
    /// The sheets, in tab order.
    pub sheets: Vec<Sheet>,
}

/// A single sheet (table) within a [`Spreadsheet`].
#[derive(Debug, Clone, PartialEq)]
pub struct Sheet {
    /// The sheet's display name.
    pub name: String,
    /// The rows, top to bottom.
    pub rows: Vec<Row>,
}

/// A row of cells within a [`Sheet`].
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Row {
    /// The cells, left to right.
    pub cells: Vec<Cell>,
}

/// A spreadsheet cell value.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    /// An empty cell.
    Empty,
    /// A text cell.
    Text(String),
    /// A numeric cell.
    Number(f64),
}
