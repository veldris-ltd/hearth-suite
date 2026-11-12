/**
 * Real binary Office document builders for Writer export (AC-WRITER-4):
 *  - `buildDocx(model)` → a zip-packaged OOXML `.docx`
 *  - `buildOdt(model)`  → a zip-packaged OpenDocument `.odt`
 *
 * Both carry headings, bold/italic/underline/strike, super/subscript and
 * hyperlinks. Packaging is the STORED-method zip writer in `office-zip.mjs`
 * (zero deps). The `model` is the Writer ODF model: `{ blocks: [{ kind, level,
 * spans: [{ text, bold, italic, underline, strike, sup, sub, href }] }] }`.
 */

import { zipStore, utf8 } from "./office-zip.mjs";

export const escapeXml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---- real .docx (OOXML) ----------------------------------------------------

const W_HEAD_SIZE = [32, 28, 26, 24, 22, 20]; // half-points for Heading 1..6

/** One OOXML run, carrying its marks; wrapped in a hyperlink when linked. */
function docxRun(sp, relForHref) {
  const props = [];
  if (sp.bold) props.push("<w:b/>");
  if (sp.italic) props.push("<w:i/>");
  if (sp.underline) props.push('<w:u w:val="single"/>');
  if (sp.strike) props.push("<w:strike/>");
  if (sp.sup) props.push('<w:vertAlign w:val="superscript"/>');
  if (sp.sub) props.push('<w:vertAlign w:val="subscript"/>');
  const rPr = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(sp.text ?? "")}</w:t></w:r>`;
  return sp.href ? `<w:hyperlink r:id="${relForHref(sp.href)}">${run}</w:hyperlink>` : run;
}

/** Build a genuine zip-packaged `.docx` from the model. */
export function buildDocx(model) {
  const rels = [];
  const relForHref = (href) => {
    const id = `rId${100 + rels.length}`;
    rels.push({ id, target: href });
    return id;
  };
  const body = (model.blocks ?? [])
    .map((b) => {
      const runs = (b.spans ?? []).map((sp) => docxRun(sp, relForHref)).join("");
      const pPr =
        b.kind === "heading"
          ? `<w:pPr><w:pStyle w:val="Heading${Math.min(6, Math.max(1, b.level ?? 1))}"/></w:pPr>`
          : "";
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join("");

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"` +
          ` Target="${escapeXml(r.target)}" TargetMode="External"/>`,
      )
      .join("") +
    `</Relationships>`;

  const headingStyles = W_HEAD_SIZE.map(
    (sz, idx) =>
      `<w:style w:type="paragraph" w:styleId="Heading${idx + 1}"><w:name w:val="heading ${idx + 1}"/>` +
      `<w:pPr><w:outlineLvl w:val="${idx}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`,
  ).join("");
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    headingStyles +
    `</w:styles>`;

  return zipStore([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels) },
    { name: "word/document.xml", data: utf8(documentXml) },
    { name: "word/styles.xml", data: utf8(stylesXml) },
    { name: "word/_rels/document.xml.rels", data: utf8(docRels) },
  ]);
}

// ---- real .odt (OpenDocument) ----------------------------------------------

const ODT_HEAD_SIZE = [18, 16, 14, 13, 12, 11]; // pt for Heading 1..6

/** Build a genuine zip-packaged `.odt` from the model. */
export function buildOdt(model) {
  // Register one automatic text:style per unique mark combination.
  const used = new Map();
  const nameForSpan = (sp) => {
    const key = `${sp.bold ? 1 : 0}${sp.italic ? 1 : 0}${sp.underline ? 1 : 0}${sp.strike ? 1 : 0}${sp.sup ? 1 : 0}${sp.sub ? 1 : 0}`;
    if (key === "000000") {
      return null;
    }
    if (!used.has(key)) {
      used.set(key, `T${used.size + 1}`);
    }
    return used.get(key) ?? null;
  };
  const spanXml = (sp) => {
    const name = nameForSpan(sp);
    const text = escapeXml(sp.text ?? "");
    const styled = name ? `<text:span text:style-name="${name}">${text}</text:span>` : text;
    return sp.href
      ? `<text:a xlink:type="simple" xlink:href="${escapeXml(sp.href)}">${styled}</text:a>`
      : styled;
  };
  const blockXml = (b) => {
    const runs = (b.spans ?? []).map(spanXml).join("");
    if (b.kind === "heading") {
      const lvl = Math.min(6, Math.max(1, b.level ?? 1));
      return `<text:h text:style-name="Heading_20_${lvl}" text:outline-level="${lvl}">${runs}</text:h>`;
    }
    return `<text:p text:style-name="Standard">${runs || ""}</text:p>`;
  };
  const bodyXml = (model.blocks ?? []).map(blockXml).join(""); // populates `used`

  const autoStyles = [...used.entries()]
    .map(([key, name]) => {
      const [b, i, u, s, sup, sub] = key.split("").map(Number);
      const props = [];
      if (b) props.push('fo:font-weight="bold"');
      if (i) props.push('fo:font-style="italic"');
      if (u)
        props.push(
          'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"',
        );
      if (s) props.push('style:text-line-through-style="solid"');
      if (sup) props.push('style:text-position="super 58%"');
      if (sub) props.push('style:text-position="sub 58%"');
      return `<style:style style:name="${name}" style:family="text"><style:text-properties ${props.join(" ")}/></style:style>`;
    })
    .join("");

  const contentXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<office:document-content office:version="1.3"` +
    ` xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"` +
    ` xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"` +
    ` xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"` +
    ` xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink">` +
    `<office:automatic-styles>${autoStyles}</office:automatic-styles>` +
    `<office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;

  const headingStyles = ODT_HEAD_SIZE.map(
    (sz, idx) =>
      `<style:style style:name="Heading_20_${idx + 1}" style:display-name="Heading ${idx + 1}" style:family="paragraph"` +
      ` style:default-outline-level="${idx + 1}"><style:text-properties fo:font-weight="bold" fo:font-size="${sz}pt"/></style:style>`,
  ).join("");
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<office:document-styles office:version="1.3"` +
    ` xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"` +
    ` xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"` +
    ` xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">` +
    `<office:styles><style:style style:name="Standard" style:family="paragraph"/>${headingStyles}</office:styles>` +
    `</office:document-styles>`;

  const manifest =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
    `<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>` +
    `</manifest:manifest>`;

  // `mimetype` MUST be the first archive member and stored uncompressed (ODF §3).
  return zipStore([
    { name: "mimetype", data: utf8("application/vnd.oasis.opendocument.text") },
    { name: "META-INF/manifest.xml", data: utf8(manifest) },
    { name: "styles.xml", data: utf8(stylesXml) },
    { name: "content.xml", data: utf8(contentXml) },
  ]);
}
