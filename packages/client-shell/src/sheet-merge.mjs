// Decode a saved Sheets document into Writer Mailings merge records (P2-CL1,
// seam #4).
//
// Sheets persists "Add to Bundle" as a CSV document (doc_type "sheet"): the
// first row is the header, the rest are data. This pure parser turns that CSV
// back into `{ header: value }` records so Writer can merge over a Sheets table
// exactly as it does Contacts and Records. The host (index.ts) reads the saved
// document bytes; the parsing lives here so it is unit-tested.

/**
 * Parse a Sheets CSV export into merge records (the first row names the fields).
 * Honours simple double-quoted fields (Sheets quotes any cell containing a
 * comma). Returns `[]` when there is no data row.
 *
 * @param {string} csv
 * @returns {Array<Record<string, string>>}
 */
export function parseSheetCsv(csv) {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const header = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const record = {};
    header.forEach((name, idx) => {
      const key = name.trim();
      if (key !== "") {
        record[key] = cells[idx] ?? "";
      }
    });
    records.push(record);
  }
  return records;
}

/** Split one CSV line into fields, honouring `"..."`-quoted fields. */
function parseCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'; // an escaped quote inside a quoted field
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}
