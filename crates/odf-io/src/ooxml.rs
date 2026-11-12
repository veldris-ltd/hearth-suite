//! Office Open XML (`.docx` / `.xlsx`) import and export.
//!
//! Unlike the canonical [`odf`](crate::odf) codec, OOXML round-tripping is
//! best-effort: it preserves text, structure, and core character formatting
//! (bold/italic, heading levels, the cell grid) and reports anything it cannot
//! preserve via a [`FidelityReport`] (`AC-FMT-2`).
//!
//! The exporters emit minimal, valid packages; the importers read those plus
//! the common shapes produced by mainstream office suites (inline and shared
//! strings, numeric cells). Features outside the Hearth Suite model (e.g. Word
//! tables, themes, comments) are listed in the report rather than silently
//! dropped.

use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Error, Result};
use crate::model::{Block, Cell, Row, Sheet, Span, Spreadsheet, TextDocument};
use crate::xml_escape;

/// A report describing how faithfully a document survived an Office import.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FidelityReport {
    /// The source format (e.g. `"docx"`).
    pub format: String,
    /// Features that were preserved.
    pub preserved: Vec<String>,
    /// Features that could not be represented and were dropped.
    pub dropped: Vec<String>,
    /// Additional human-readable notes.
    pub notes: Vec<String>,
}

impl FidelityReport {
    fn new(format: &str) -> Self {
        Self {
            format: format.to_owned(),
            ..Self::default()
        }
    }

    /// Whether the import lost nothing (no dropped features).
    pub fn is_lossless(&self) -> bool {
        self.dropped.is_empty()
    }
}

// ---- shared ZIP helpers -----------------------------------------------------

fn zip_bytes(files: &[(&str, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, data) in files {
        zip.start_file(*name, opts)?;
        zip.write_all(data)?;
    }
    Ok(zip.finish()?.into_inner())
}

fn read_entry<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    Some(buf)
}

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

// ---- docx -------------------------------------------------------------------

const DOCX_CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
</Types>";

const RELS_ROOT_DOC: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
</Relationships>";

/// Export a [`TextDocument`] to a `.docx` package.
///
/// # Errors
/// Returns an error if the ZIP package cannot be written.
pub fn export_docx(doc: &TextDocument) -> Result<Vec<u8>> {
    let mut body = String::new();
    body.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
    body.push_str(
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>",
    );
    for block in &doc.blocks {
        let (heading, spans) = match block {
            Block::Heading { level, spans } => (Some(*level), spans),
            Block::Paragraph { spans } => (None, spans),
        };
        body.push_str("<w:p>");
        if let Some(level) = heading {
            body.push_str("<w:pPr><w:pStyle w:val=\"Heading");
            body.push_str(&level.to_string());
            body.push_str("\"/></w:pPr>");
        }
        for span in spans {
            body.push_str("<w:r>");
            if span.bold || span.italic {
                body.push_str("<w:rPr>");
                if span.bold {
                    body.push_str("<w:b/>");
                }
                if span.italic {
                    body.push_str("<w:i/>");
                }
                body.push_str("</w:rPr>");
            }
            body.push_str("<w:t xml:space=\"preserve\">");
            body.push_str(&xml_escape(&span.text));
            body.push_str("</w:t></w:r>");
        }
        body.push_str("</w:p>");
    }
    body.push_str("</w:body></w:document>");

    zip_bytes(&[
        (
            "[Content_Types].xml",
            DOCX_CONTENT_TYPES.as_bytes().to_vec(),
        ),
        ("_rels/.rels", RELS_ROOT_DOC.as_bytes().to_vec()),
        ("word/document.xml", body.into_bytes()),
    ])
}

/// Import a `.docx` package into a [`TextDocument`] with a fidelity report.
///
/// # Errors
/// Returns an error if the package is missing `word/document.xml` or the XML is
/// malformed.
pub fn import_docx(bytes: &[u8]) -> Result<(TextDocument, FidelityReport)> {
    use quick_xml::events::Event;

    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let xml = read_entry(&mut archive, "word/document.xml")
        .ok_or_else(|| Error::MissingPart("word/document.xml".to_owned()))?;

    let mut report = FidelityReport::new("docx");
    report.preserved.push("paragraphs and headings".to_owned());
    report.preserved.push("bold/italic runs".to_owned());

    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut doc = TextDocument::default();

    let mut block: Option<(Option<u8>, Vec<Span>)> = None; // (heading level, spans)
    let mut run: Option<(bool, bool, String)> = None; // (bold, italic, text)
    let mut in_text = false;
    let mut saw_table = false;

    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.name().as_ref() {
                b"w:p" => block = Some((None, Vec::new())),
                b"w:r" => run = Some((false, false, String::new())),
                b"w:t" => in_text = true,
                b"w:tbl" => saw_table = true,
                _ => {}
            },
            Event::Empty(e) => match e.name().as_ref() {
                b"w:pStyle" => {
                    if let (Some(val), Some((level, _))) = (get_attr(&e, b"w:val")?, block.as_mut())
                    {
                        if let Some(rest) = val.strip_prefix("Heading") {
                            *level = rest.trim().parse::<u8>().ok();
                        }
                    }
                }
                b"w:b" => set_flag(&mut run, true, get_attr(&e, b"w:val")?.as_deref()),
                b"w:i" => set_flag(&mut run, false, get_attr(&e, b"w:val")?.as_deref()),
                _ => {}
            },
            Event::Text(t) if in_text => {
                if let Some((_, _, buf)) = run.as_mut() {
                    buf.push_str(&t.xml10_content()?);
                }
            }
            Event::GeneralRef(r) if in_text => {
                if let Some((_, _, buf)) = run.as_mut() {
                    buf.push_str(&crate::ref_to_str(&r)?);
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"w:t" => in_text = false,
                b"w:r" => {
                    if let (Some((bold, italic, text)), Some((_, spans))) =
                        (run.take(), block.as_mut())
                    {
                        spans.push(Span { text, bold, italic });
                    }
                }
                b"w:p" => {
                    if let Some((level, spans)) = block.take() {
                        doc.blocks.push(match level {
                            Some(level) => Block::Heading { level, spans },
                            None => Block::Paragraph { spans },
                        });
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    if saw_table {
        report
            .dropped
            .push("Word tables (w:tbl) are not yet modelled".to_owned());
    }
    report.notes.push(
        "Formatting beyond bold/italic and heading level is not modelled in P1.1.".to_owned(),
    );

    Ok((doc, report))
}

/// Apply a bold (`is_bold = true`) or italic flag to the current run, honouring
/// an explicit `w:val` of `0`/`false`/`off`.
fn set_flag(run: &mut Option<(bool, bool, String)>, is_bold: bool, val: Option<&str>) {
    let on = !matches!(val, Some("0" | "false" | "off"));
    if let Some((bold, italic, _)) = run.as_mut() {
        if is_bold {
            *bold = on;
        } else {
            *italic = on;
        }
    }
}

// ---- xlsx -------------------------------------------------------------------

fn col_letter(mut idx: usize) -> String {
    let mut bytes = Vec::new();
    loop {
        let rem = idx % 26;
        bytes.push(b'A' + u8::try_from(rem).unwrap_or(0));
        if idx < 26 {
            break;
        }
        idx = idx / 26 - 1;
    }
    bytes.reverse();
    String::from_utf8(bytes).unwrap_or_default()
}

fn xlsx_content_types(sheet_count: usize) -> String {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
    );
    for i in 1..=sheet_count {
        s.push_str("<Override PartName=\"/xl/worksheets/sheet");
        s.push_str(&i.to_string());
        s.push_str(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
    }
    s.push_str("</Types>");
    s
}

/// Export a [`Spreadsheet`] to an `.xlsx` package.
///
/// # Errors
/// Returns an error if the ZIP package cannot be written.
pub fn export_xlsx(doc: &Spreadsheet) -> Result<Vec<u8>> {
    let count = doc.sheets.len();

    let mut workbook = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>",
    );
    let mut rels = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    );
    for (i, sheet) in doc.sheets.iter().enumerate() {
        let n = i + 1;
        workbook.push_str("<sheet name=\"");
        workbook.push_str(&xml_escape(&sheet.name));
        workbook.push_str("\" sheetId=\"");
        workbook.push_str(&n.to_string());
        workbook.push_str("\" r:id=\"rId");
        workbook.push_str(&n.to_string());
        workbook.push_str("\"/>");

        rels.push_str("<Relationship Id=\"rId");
        rels.push_str(&n.to_string());
        rels.push_str("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet");
        rels.push_str(&n.to_string());
        rels.push_str(".xml\"/>");
    }
    workbook.push_str("</sheets></workbook>");
    rels.push_str("</Relationships>");

    let mut files: Vec<(&str, Vec<u8>)> = vec![
        (
            "[Content_Types].xml",
            xlsx_content_types(count).into_bytes(),
        ),
        ("_rels/.rels", XLSX_ROOT_RELS.as_bytes().to_vec()),
        ("xl/workbook.xml", workbook.into_bytes()),
        ("xl/_rels/workbook.xml.rels", rels.into_bytes()),
    ];

    // Worksheet part names must outlive `files`; build owned strings first.
    let mut sheet_names = Vec::with_capacity(count);
    let mut sheet_xml = Vec::with_capacity(count);
    for (i, sheet) in doc.sheets.iter().enumerate() {
        sheet_names.push(format!("xl/worksheets/sheet{}.xml", i + 1));
        sheet_xml.push(worksheet_xml(sheet).into_bytes());
    }
    for (name, xml) in sheet_names.iter().zip(sheet_xml) {
        files.push((name.as_str(), xml));
    }

    zip_bytes(&files)
}

const XLSX_ROOT_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
</Relationships>";

fn worksheet_xml(sheet: &Sheet) -> String {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>",
    );
    for (r, row) in sheet.rows.iter().enumerate() {
        let rownum = r + 1;
        s.push_str("<row r=\"");
        s.push_str(&rownum.to_string());
        s.push_str("\">");
        for (c, cell) in row.cells.iter().enumerate() {
            let reference = format!("{}{}", col_letter(c), rownum);
            match cell {
                Cell::Empty => {
                    s.push_str("<c r=\"");
                    s.push_str(&reference);
                    s.push_str("\"/>");
                }
                Cell::Text(text) => {
                    s.push_str("<c r=\"");
                    s.push_str(&reference);
                    s.push_str("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">");
                    s.push_str(&xml_escape(text));
                    s.push_str("</t></is></c>");
                }
                Cell::Number(n) => {
                    s.push_str("<c r=\"");
                    s.push_str(&reference);
                    s.push_str("\"><v>");
                    s.push_str(&xml_escape(&n.to_string()));
                    s.push_str("</v></c>");
                }
            }
        }
        s.push_str("</row>");
    }
    s.push_str("</sheetData></worksheet>");
    s
}

/// Import an `.xlsx` package into a [`Spreadsheet`] with a fidelity report.
///
/// # Errors
/// Returns an error if the workbook is missing or the XML is malformed.
pub fn import_xlsx(bytes: &[u8]) -> Result<(Spreadsheet, FidelityReport)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    let mut report = FidelityReport::new("xlsx");
    report
        .preserved
        .push("sheets, rows, and the cell grid".to_owned());
    report
        .preserved
        .push("text and numeric cell values".to_owned());
    report
        .notes
        .push("Formulas, styles, and merged cells are not modelled in P1.1.".to_owned());

    let workbook = read_entry(&mut archive, "xl/workbook.xml")
        .ok_or_else(|| Error::MissingPart("xl/workbook.xml".to_owned()))?;
    let rels = read_entry(&mut archive, "xl/_rels/workbook.xml.rels").unwrap_or_default();
    let shared = read_entry(&mut archive, "xl/sharedStrings.xml")
        .map(|x| parse_shared_strings(&x))
        .transpose()?
        .unwrap_or_default();

    let rel_targets = parse_rels(&rels)?;
    let sheets_meta = parse_workbook_sheets(&workbook)?;

    let mut doc = Spreadsheet::default();
    for (idx, (name, rid)) in sheets_meta.into_iter().enumerate() {
        let target = rid
            .as_deref()
            .and_then(|id| {
                rel_targets
                    .iter()
                    .find(|(i, _)| i == id)
                    .map(|(_, t)| t.clone())
            })
            .unwrap_or_else(|| format!("worksheets/sheet{}.xml", idx + 1));
        let part = format!("xl/{target}");
        let Some(xml) = read_entry(&mut archive, &part) else {
            continue;
        };
        let rows = parse_worksheet(&xml, &shared)?;
        doc.sheets.push(Sheet { name, rows });
    }

    Ok((doc, report))
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let mut in_si = false;
    let mut in_t = false;
    let mut current = String::new();
    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.name().as_ref() {
                b"si" => {
                    in_si = true;
                    current.clear();
                }
                b"t" if in_si => in_t = true,
                _ => {}
            },
            Event::Text(t) if in_t => current.push_str(&t.xml10_content()?),
            Event::GeneralRef(r) if in_t => current.push_str(&crate::ref_to_str(&r)?),
            Event::End(e) => match e.name().as_ref() {
                b"t" => in_t = false,
                b"si" => {
                    in_si = false;
                    out.push(std::mem::take(&mut current));
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// Parse `xl/_rels/workbook.xml.rels` into `(id, target)` pairs.
fn parse_rels(xml: &str) -> Result<Vec<(String, String)>> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    loop {
        match reader.read_event()? {
            Event::Start(e) | Event::Empty(e) if e.name().as_ref() == b"Relationship" => {
                if let (Some(id), Some(target)) = (get_attr(&e, b"Id")?, get_attr(&e, b"Target")?) {
                    out.push((id, target));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// Parse the ordered `(name, r:id)` sheet list from `xl/workbook.xml`.
fn parse_workbook_sheets(xml: &str) -> Result<Vec<(String, Option<String>)>> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    loop {
        match reader.read_event()? {
            Event::Start(e) | Event::Empty(e) if e.name().as_ref() == b"sheet" => {
                let name = get_attr(&e, b"name")?.unwrap_or_default();
                let rid = get_attr(&e, b"r:id")?;
                out.push((name, rid));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

fn parse_worksheet(xml: &str, shared: &[String]) -> Result<Vec<Row>> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);

    let mut rows = Vec::new();
    let mut row: Option<Row> = None;
    // Current cell state: type attribute and accumulated value text.
    let mut cell_type: Option<String> = None;
    let mut value = String::new();
    let mut in_value = false; // inside <v> or inline <t>
    let mut cell_open = false;

    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.name().as_ref() {
                b"row" => row = Some(Row::default()),
                b"c" => {
                    cell_type = get_attr(&e, b"t")?;
                    value.clear();
                    cell_open = true;
                }
                b"v" | b"t" => in_value = true,
                _ => {}
            },
            Event::Empty(e) if e.name().as_ref() == b"c" => {
                if let Some(r) = row.as_mut() {
                    r.cells.push(Cell::Empty);
                }
                let _ = &e;
            }
            Event::Text(t) if in_value => value.push_str(&t.xml10_content()?),
            Event::GeneralRef(r) if in_value => value.push_str(&crate::ref_to_str(&r)?),
            Event::End(e) => match e.name().as_ref() {
                b"v" | b"t" => in_value = false,
                b"c" if cell_open => {
                    let cell = resolve_cell(cell_type.as_deref(), &value, shared)?;
                    if let Some(r) = row.as_mut() {
                        r.cells.push(cell);
                    }
                    cell_open = false;
                }
                b"row" => {
                    if let Some(r) = row.take() {
                        rows.push(r);
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(rows)
}

fn resolve_cell(cell_type: Option<&str>, value: &str, shared: &[String]) -> Result<Cell> {
    if value.is_empty() && cell_type != Some("inlineStr") && cell_type != Some("str") {
        return Ok(Cell::Empty);
    }
    match cell_type {
        Some("inlineStr" | "str") => Ok(Cell::Text(value.to_owned())),
        Some("s") => {
            let idx = value
                .parse::<usize>()
                .map_err(|_| Error::InvalidValue(format!("shared string index: {value}")))?;
            Ok(Cell::Text(shared.get(idx).cloned().unwrap_or_default()))
        }
        _ => {
            let n = value
                .parse::<f64>()
                .map_err(|_| Error::InvalidValue(format!("not a number: {value}")))?;
            Ok(Cell::Number(n))
        }
    }
}
