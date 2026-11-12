//! The canonical OpenDocument codec (ODT / ODS).
//!
//! This codec is lossless for the Hearth Suite [`model`](crate::model): a document
//! written with [`write_document`] and read back with [`read_document`] is
//! identical (property-tested, `AC-FMT-1`).
//!
//! The package layout written is a minimal, valid ODF 1.3 package: an
//! uncompressed `mimetype` entry, a `META-INF/manifest.xml`, and `content.xml`.

use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Error, Result};
use crate::model::{Block, Cell, Document, Row, Sheet, Span, Spreadsheet, TextDocument};
use crate::xml_escape;

/// The ODF mimetype for text documents (ODT).
pub const MIME_TEXT: &str = "application/vnd.oasis.opendocument.text";
/// The ODF mimetype for spreadsheets (ODS).
pub const MIME_SPREADSHEET: &str = "application/vnd.oasis.opendocument.spreadsheet";

const NS: &str = concat!(
    " xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\"",
    " xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\"",
    " xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\"",
    " xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\"",
    " xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\"",
);

/// Serialize a [`Document`] to an ODF package (ODT or ODS).
///
/// # Errors
/// Returns an error if the ZIP package cannot be written.
pub fn write_document(doc: &Document) -> Result<Vec<u8>> {
    let (mimetype, content) = match doc {
        Document::Text(t) => (MIME_TEXT, text_content_xml(t)),
        Document::Spreadsheet(s) => (MIME_SPREADSHEET, spreadsheet_content_xml(s)),
    };
    package(mimetype, &content)
}

/// Read a [`Document`] from an ODF package, dispatching on its mimetype.
///
/// # Errors
/// Returns an error if the package is malformed, missing `content.xml`, or has
/// an unsupported mimetype.
pub fn read_document(bytes: &[u8]) -> Result<Document> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    let mimetype = read_entry(&mut archive, "mimetype").unwrap_or_default();
    let content = read_entry(&mut archive, "content.xml")
        .ok_or_else(|| Error::MissingPart("content.xml".to_owned()))?;

    match mimetype.trim() {
        MIME_TEXT => Ok(Document::Text(read_text(&content)?)),
        MIME_SPREADSHEET => Ok(Document::Spreadsheet(read_spreadsheet(&content)?)),
        other => Err(Error::UnsupportedType(other.to_owned())),
    }
}

fn read_entry<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    Some(buf)
}

/// Build an ODF package: `mimetype` (stored, first), manifest, and content.
fn package(mimetype: &str, content_xml: &str) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));

    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file("mimetype", stored)?;
    zip.write_all(mimetype.as_bytes())?;

    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("META-INF/manifest.xml", deflated)?;
    zip.write_all(manifest_xml(mimetype).as_bytes())?;

    zip.start_file("content.xml", deflated)?;
    zip.write_all(content_xml.as_bytes())?;

    Ok(zip.finish()?.into_inner())
}

fn manifest_xml(mimetype: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
<manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.3\">\
<manifest:file-entry manifest:full-path=\"/\" manifest:media-type=\"{mime}\"/>\
<manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>\
</manifest:manifest>",
        mime = xml_escape(mimetype),
    )
}

// ---- text (ODT) -------------------------------------------------------------

fn style_name(bold: bool, italic: bool) -> Option<&'static str> {
    match (bold, italic) {
        (false, false) => None,
        (true, false) => Some("T_b"),
        (false, true) => Some("T_i"),
        (true, true) => Some("T_bi"),
    }
}

fn style_flags(name: &str) -> (bool, bool) {
    match name {
        "T_b" => (true, false),
        "T_i" => (false, true),
        "T_bi" => (true, true),
        _ => (false, false),
    }
}

fn write_spans(out: &mut String, spans: &[Span]) {
    for span in spans {
        if let Some(name) = style_name(span.bold, span.italic) {
            out.push_str("<text:span text:style-name=\"");
            out.push_str(name);
            out.push_str("\">");
        } else {
            out.push_str("<text:span>");
        }
        out.push_str(&xml_escape(&span.text));
        out.push_str("</text:span>");
    }
}

fn text_content_xml(doc: &TextDocument) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    out.push_str("<office:document-content");
    out.push_str(NS);
    out.push_str(" office:version=\"1.3\">");
    out.push_str(
        "<office:automatic-styles>\
<style:style style:name=\"T_b\" style:family=\"text\"><style:text-properties fo:font-weight=\"bold\"/></style:style>\
<style:style style:name=\"T_i\" style:family=\"text\"><style:text-properties fo:font-style=\"italic\"/></style:style>\
<style:style style:name=\"T_bi\" style:family=\"text\"><style:text-properties fo:font-weight=\"bold\" fo:font-style=\"italic\"/></style:style>\
</office:automatic-styles>",
    );
    out.push_str("<office:body><office:text>");
    for block in &doc.blocks {
        match block {
            Block::Heading { level, spans } => {
                out.push_str("<text:h text:outline-level=\"");
                out.push_str(&level.to_string());
                out.push_str("\">");
                write_spans(&mut out, spans);
                out.push_str("</text:h>");
            }
            Block::Paragraph { spans } => {
                out.push_str("<text:p>");
                write_spans(&mut out, spans);
                out.push_str("</text:p>");
            }
        }
    }
    out.push_str("</office:text></office:body></office:document-content>");
    out
}

/// Parse the `content.xml` of a text document.
///
/// # Errors
/// Returns an error if the XML is malformed.
pub fn read_text(content_xml: &str) -> Result<TextDocument> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(content_xml);
    let mut doc = TextDocument::default();

    // The block currently being built, and whether it is a heading.
    let mut block: Option<(bool, u8, Vec<Span>)> = None;
    // The span currently being built: (bold, italic, text).
    let mut span: Option<(bool, bool, String)> = None;

    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.name().as_ref() {
                b"text:h" => {
                    let level = get_attr(&e, b"text:outline-level")?
                        .and_then(|v| v.parse::<u8>().ok())
                        .unwrap_or(1);
                    block = Some((true, level, Vec::new()));
                }
                b"text:p" => block = Some((false, 0, Vec::new())),
                b"text:span" => {
                    let (bold, italic) = get_attr(&e, b"text:style-name")?
                        .map_or((false, false), |n| style_flags(&n));
                    span = Some((bold, italic, String::new()));
                }
                _ => {}
            },
            Event::Empty(e) if e.name().as_ref() == b"text:span" => {
                let (bold, italic) =
                    get_attr(&e, b"text:style-name")?.map_or((false, false), |n| style_flags(&n));
                if let Some((_, _, spans)) = block.as_mut() {
                    spans.push(Span {
                        text: String::new(),
                        bold,
                        italic,
                    });
                }
            }
            Event::Text(t) => {
                if let Some((_, _, buf)) = span.as_mut() {
                    buf.push_str(&t.xml10_content()?);
                }
            }
            Event::GeneralRef(r) => {
                if let Some((_, _, buf)) = span.as_mut() {
                    buf.push_str(&crate::ref_to_str(&r)?);
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"text:span" => {
                    if let (Some((bold, italic, text)), Some((_, _, spans))) =
                        (span.take(), block.as_mut())
                    {
                        spans.push(Span { text, bold, italic });
                    }
                }
                b"text:h" | b"text:p" => {
                    if let Some((is_heading, level, spans)) = block.take() {
                        doc.blocks.push(if is_heading {
                            Block::Heading { level, spans }
                        } else {
                            Block::Paragraph { spans }
                        });
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(doc)
}

// ---- spreadsheet (ODS) ------------------------------------------------------

fn spreadsheet_content_xml(doc: &Spreadsheet) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    out.push_str("<office:document-content");
    out.push_str(NS);
    out.push_str(" office:version=\"1.3\">");
    out.push_str("<office:body><office:spreadsheet>");
    for sheet in &doc.sheets {
        out.push_str("<table:table table:name=\"");
        out.push_str(&xml_escape(&sheet.name));
        out.push_str("\">");
        for row in &sheet.rows {
            out.push_str("<table:table-row>");
            for cell in &row.cells {
                write_cell(&mut out, cell);
            }
            out.push_str("</table:table-row>");
        }
        out.push_str("</table:table>");
    }
    out.push_str("</office:spreadsheet></office:body></office:document-content>");
    out
}

fn write_cell(out: &mut String, cell: &Cell) {
    match cell {
        Cell::Empty => out.push_str("<table:table-cell/>"),
        Cell::Text(text) => {
            out.push_str("<table:table-cell office:value-type=\"string\"><text:p>");
            out.push_str(&xml_escape(text));
            out.push_str("</text:p></table:table-cell>");
        }
        Cell::Number(n) => {
            let value = n.to_string();
            out.push_str("<table:table-cell office:value-type=\"float\" office:value=\"");
            out.push_str(&xml_escape(&value));
            out.push_str("\"><text:p>");
            out.push_str(&xml_escape(&value));
            out.push_str("</text:p></table:table-cell>");
        }
    }
}

/// Parse the `content.xml` of a spreadsheet.
///
/// # Errors
/// Returns an error if the XML is malformed or a numeric cell value is invalid.
pub fn read_spreadsheet(content_xml: &str) -> Result<Spreadsheet> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(content_xml);
    let mut doc = Spreadsheet::default();

    let mut sheet: Option<Sheet> = None;
    let mut row: Option<Row> = None;
    // The cell being built and a flag indicating we are collecting string text.
    let mut pending: Option<Cell> = None;
    let mut in_string_cell = false;

    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.name().as_ref() {
                b"table:table" => {
                    let name = get_attr(&e, b"table:name")?.unwrap_or_default();
                    sheet = Some(Sheet {
                        name,
                        rows: Vec::new(),
                    });
                }
                b"table:table-row" => row = Some(Row::default()),
                b"table:table-cell" => {
                    let (cell, is_string) = start_cell(&e)?;
                    pending = Some(cell);
                    in_string_cell = is_string;
                }
                _ => {}
            },
            Event::Empty(e) if e.name().as_ref() == b"table:table-cell" => {
                let (cell, _) = start_cell(&e)?;
                if let Some(r) = row.as_mut() {
                    r.cells.push(cell);
                }
            }
            Event::Text(t) if in_string_cell => {
                if let Some(Cell::Text(buf)) = pending.as_mut() {
                    buf.push_str(&t.xml10_content()?);
                }
            }
            Event::GeneralRef(r) if in_string_cell => {
                if let Some(Cell::Text(buf)) = pending.as_mut() {
                    buf.push_str(&crate::ref_to_str(&r)?);
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"table:table-cell" => {
                    if let (Some(cell), Some(r)) = (pending.take(), row.as_mut()) {
                        r.cells.push(cell);
                    }
                    in_string_cell = false;
                }
                b"table:table-row" => {
                    if let (Some(r), Some(s)) = (row.take(), sheet.as_mut()) {
                        s.rows.push(r);
                    }
                }
                b"table:table" => {
                    if let Some(s) = sheet.take() {
                        doc.sheets.push(s);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(doc)
}

/// Resolve a `table:table-cell` start/empty event into a cell and a flag
/// indicating whether following text should be collected as the cell's string.
fn start_cell(e: &quick_xml::events::BytesStart<'_>) -> Result<(Cell, bool)> {
    match get_attr(e, b"office:value-type")?.as_deref() {
        Some("float") => {
            let raw = get_attr(e, b"office:value")?
                .ok_or_else(|| Error::InvalidValue("missing office:value".to_owned()))?;
            let n = raw
                .parse::<f64>()
                .map_err(|_| Error::InvalidValue(format!("not a number: {raw}")))?;
            Ok((Cell::Number(n), false))
        }
        Some("string") => Ok((Cell::Text(String::new()), true)),
        _ => Ok((Cell::Empty, false)),
    }
}

/// Look up an attribute by its (prefixed) name on a start/empty element.
///
/// # Errors
/// Returns an error if an attribute is malformed.
fn get_attr(e: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Result<Option<String>> {
    for attr in e.attributes() {
        let attr = attr?;
        if attr.key.as_ref() == name {
            return Ok(Some(
                attr.normalized_value(quick_xml::XmlVersion::Explicit1_0)?
                    .into_owned(),
            ));
        }
    }
    Ok(None)
}
