// Real binary Office export tests (AC-WRITER-4): validate the zip packaging
// and OOXML/ODF content for .docx and .odt. We can't open Word/LibreOffice in
// CI, so we assert the archive is structurally valid (signatures, entries, CRC
// round-trip) and that the body XML carries the text and marks.

import test from "node:test";
import assert from "node:assert/strict";

import { crc32, zipStore, unzipStore, utf8 } from "../src/office-zip.mjs";
import { buildDocx, buildOdt } from "../src/office-docs.mjs";

const MODEL = {
  blocks: [
    { kind: "heading", level: 1, spans: [{ text: "My Report" }] },
    {
      kind: "paragraph",
      spans: [
        { text: "Plain then " },
        { text: "bold", bold: true },
        { text: " and " },
        { text: "linked", href: "https://example.com/a&b" },
        { text: "." },
      ],
    },
  ],
};

const textOf = (entries, name) =>
  new TextDecoder().decode(entries.find((e) => e.name === name).data);

test("zip: CRC32 matches a known vector ('123456789' = 0xCBF43926)", () => {
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
});

test("zip: STORED archive round-trips through unzip with valid CRCs", () => {
  const archive = zipStore([
    { name: "a.txt", data: utf8("hello") },
    { name: "dir/b.xml", data: utf8("<x/>") },
  ]);
  // Local-file-header signature PK\x03\x04 at the start.
  assert.deepEqual([...archive.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const entries = unzipStore(archive);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["a.txt", "dir/b.xml"],
  );
  assert.ok(
    entries.every((e) => e.crcOk),
    "every entry's CRC re-computes",
  );
  assert.equal(new TextDecoder().decode(entries[0].data), "hello");
});

test("docx: is a valid zip with the required OOXML parts", () => {
  const entries = unzipStore(buildDocx(MODEL));
  const names = entries.map((e) => e.name);
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/_rels/document.xml.rels",
  ]) {
    assert.ok(names.includes(part), `missing ${part}`);
  }
  assert.ok(
    entries.every((e) => e.crcOk),
    "CRCs valid",
  );
});

test("docx: document.xml carries the text, a bold run, a heading and a hyperlink", () => {
  const entries = unzipStore(buildDocx(MODEL));
  const doc = textOf(entries, "word/document.xml");
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(doc, /My Report/);
  assert.match(doc, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">bold<\/w:t>/);
  assert.match(doc, /<w:hyperlink r:id="rId100">/);
  // The href is externalised into the rels part and XML-escaped.
  const rels = textOf(entries, "word/_rels/document.xml.rels");
  assert.match(
    rels,
    /Id="rId100"[^>]*Target="https:\/\/example.com\/a&amp;b"[^>]*TargetMode="External"/,
  );
});

test("odt: mimetype is the first, uncompressed entry with the exact media type", () => {
  const entries = unzipStore(buildOdt(MODEL));
  assert.equal(entries[0].name, "mimetype", "mimetype must be first");
  assert.equal(
    new TextDecoder().decode(entries[0].data),
    "application/vnd.oasis.opendocument.text",
  );
});

test("odt: has the required ODF parts and content.xml carries text + a bold span", () => {
  const entries = unzipStore(buildOdt(MODEL));
  const names = entries.map((e) => e.name);
  for (const part of ["mimetype", "META-INF/manifest.xml", "styles.xml", "content.xml"]) {
    assert.ok(names.includes(part), `missing ${part}`);
  }
  assert.ok(
    entries.every((e) => e.crcOk),
    "CRCs valid",
  );
  const content = textOf(entries, "content.xml");
  assert.match(content, /<text:h text:style-name="Heading_20_1"[^>]*>.*My Report.*<\/text:h>/);
  assert.match(content, /<text:span text:style-name="T1">bold<\/text:span>/);
  assert.match(
    content,
    /<text:a xlink:type="simple" xlink:href="https:\/\/example.com\/a&amp;b">linked<\/text:a>/,
  );
});
