// Hearth Suite Writer core tests (AC-WRITER-1..4, AC-UX-SEAL-2).

import test from "node:test";
import assert from "node:assert/strict";

import {
  composeFromData,
  fillPlaceholders,
  buildAskRequest,
  sealStatusText,
  toOdfModel,
  toPlainText,
  emptyDocument,
  STYLES,
  documentStats,
  autoCorrectWord,
  applyAutoCorrect,
  expandSpecials,
  findMatches,
  replaceAll,
  replaceInDoc,
  countInDoc,
  pageGeometry,
  paginate,
  PAGE_SIZES,
  spansToHtml,
  spansFromHtml,
  mergeFields,
  formatAddress,
  ENVELOPE_SIZES,
  envelopeById,
  LABEL_SHEETS,
  labelSheetById,
  paginateLabels,
} from "../src/core.mjs";

const sampleDoc = {
  title: "Sample",
  blocks: [
    { kind: "heading", level: 1, spans: [{ text: "The plan" }] },
    { kind: "paragraph", style: "body", spans: [{ text: "We keep teh budget calm." }] },
    { kind: "paragraph", style: "body", spans: [{ text: "" }] },
    { kind: "paragraph", style: "body", spans: [{ text: "Calm and warm." }] },
  ],
};

test("W16: documentStats counts words, characters, and non-empty paragraphs", () => {
  const stats = documentStats(sampleDoc);
  assert.equal(stats.words, 10); // 2 + 5 + 3 across the heading and two paragraphs
  assert.equal(stats.paragraphs, 3); // heading + 2 non-empty paragraphs; blank excluded
  assert.ok(stats.charactersNoSpaces < stats.characters);
});

test("W18: autoCorrectWord fixes typos and preserves leading capital", () => {
  assert.equal(autoCorrectWord("teh"), "the");
  assert.equal(autoCorrectWord("Teh"), "The");
  assert.equal(autoCorrectWord("fine"), "fine");
  assert.equal(autoCorrectWord("(c)"), "©");
  assert.equal(applyAutoCorrect("teh cat adn teh dog"), "the cat and the dog");
});

test("W18: autocorrect rules are user-editable (custom rules override)", () => {
  assert.equal(autoCorrectWord("hb", { hb: "Hearth Suite" }), "Hearth Suite");
});

test("W17: expandSpecials turns escapes into tab/newline", () => {
  assert.equal(expandSpecials("a\\tb"), "a\tb");
  assert.equal(expandSpecials("a\\nb"), "a\nb");
  assert.equal(expandSpecials("a¶b"), "a\nb");
});

test("W17: findMatches locates all occurrences (case-insensitive by default)", () => {
  assert.deepEqual(findMatches("Calm calm CALM", "calm"), [0, 5, 10]);
  assert.deepEqual(findMatches("Calm calm", "calm", { caseSensitive: true }), [5]);
});

test("W17: replaceAll and replaceInDoc replace across text and document", () => {
  assert.deepEqual(replaceAll("calm calm", "calm", "warm"), { text: "warm warm", count: 2 });
  const { doc, count } = replaceInDoc(sampleDoc, "Calm", "Warm"); // case-insensitive by default
  assert.equal(count, 2);
  assert.match(toPlainText(doc), /Warm and warm\./);
  // Case-sensitive replace touches only the capitalised "Calm".
  assert.equal(replaceInDoc(sampleDoc, "Calm", "Warm", { caseSensitive: true }).count, 1);
});

test("W17: countInDoc reports total matches; limit replaces singly", () => {
  // Two "calm"-ish matches across the doc (case-insensitive): "calm" + "Calm".
  assert.equal(countInDoc(sampleDoc, "calm"), 2);
  assert.equal(countInDoc(sampleDoc, "missing"), 0);

  // limit:1 replaces only the FIRST match across the whole document (the one
  // in "We keep teh budget calm."), leaving the later "Calm" untouched.
  const once = replaceInDoc(sampleDoc, "calm", "warm", { limit: 1 });
  assert.equal(once.count, 1);
  assert.match(toPlainText(once.doc), /budget warm\./);
  assert.match(toPlainText(once.doc), /Calm and warm\./);
  // One match remains, so a second pass finishes the job.
  assert.equal(countInDoc(once.doc, "calm"), 1);

  // limit at/above the match count behaves like replace-all.
  assert.equal(replaceAll("calm calm calm", "calm", "x", { limit: 2 }).count, 2);
  assert.deepEqual(replaceAll("calm calm", "calm", "x", { limit: 5 }), { text: "x x", count: 2 });
});

test("WRITER-2: Compose from Data produces correct per-record documents", () => {
  const template = {
    title: "Invoice for {{name}}",
    blocks: [
      {
        kind: "paragraph",
        style: "body",
        spans: [{ text: "Dear " }, { text: "{{name}}", bold: true }],
      },
      { kind: "paragraph", style: "body", spans: [{ text: "You owe {{amount}}." }] },
    ],
  };
  const records = [
    { name: "Maria", amount: "£40" },
    { name: "Jon", amount: "£0" },
  ];

  const docs = composeFromData(template, records);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].title, "Invoice for Maria");
  assert.equal(toPlainText(docs[0]), "Dear Maria\nYou owe £40.");
  assert.equal(toPlainText(docs[1]), "Dear Jon\nYou owe £0.");
  // Character formatting is preserved through the merge.
  assert.equal(docs[0].blocks[0].spans[1].bold, true);
});

test("mail-merge fills table cells and leaves unknown fields blank", () => {
  const template = {
    title: "T",
    blocks: [{ kind: "table", rows: [[[{ text: "{{a}}" }], [{ text: "{{missing}}" }]]] }],
  };
  const [doc] = composeFromData(template, [{ a: "X" }]);
  assert.equal(doc.blocks[0].rows[0][0][0].text, "X");
  assert.equal(doc.blocks[0].rows[0][1][0].text, "");
  assert.equal(fillPlaceholders("{{x}}-{{y}}", { x: "1" }), "1-");
});

test("WRITER-3: ask-your-document builds a local query over the document text", () => {
  const doc = {
    title: "Plan",
    blocks: [
      { kind: "heading", level: 1, spans: [{ text: "Project Plan" }] },
      { kind: "paragraph", spans: [{ text: "The deadline is in March." }] },
    ],
  };
  const req = buildAskRequest(doc, "when is the deadline?");
  assert.equal(req.task, "query");
  assert.equal(req.request, "when is the deadline?");
  assert.ok(req.document.includes("deadline is in March"));
  assert.ok(req.document.includes("Project Plan"));
});

test("AC-UX-SEAL-2: Seal status reads in plain language, never jargon", () => {
  assert.equal(sealStatusText([]), "Only you can open this");
  assert.equal(sealStatusText(["Maria"]), "Only you and Maria can open this");
  assert.equal(sealStatusText(["Maria", "Jon"]), "Only you, Maria and Jon can open this");
  assert.equal(sealStatusText(["Maria"], "Alex"), "Only Alex and Maria can open this");

  const text = sealStatusText(["Maria"]);
  for (const jargon of ["ML-KEM", "key", "cipher", "AES", "encrypt"]) {
    assert.ok(!text.toLowerCase().includes(jargon.toLowerCase()), `no jargon: ${jargon}`);
  }
});

test("WRITER-1/4: model + ODF mapping (headings, paragraphs, table rows)", () => {
  assert.ok(STYLES.some((s) => s.id === "h1"));
  assert.equal(emptyDocument().blocks.length, 1);

  const doc = {
    title: "Doc",
    blocks: [
      { kind: "heading", level: 2, spans: [{ text: "Section", bold: true }] },
      { kind: "paragraph", spans: [{ text: "Body text." }] },
      { kind: "table", rows: [[[{ text: "a" }], [{ text: "b" }]]] },
    ],
  };
  const odf = toOdfModel(doc);
  assert.equal(odf.blocks[0].kind, "heading");
  assert.equal(odf.blocks[0].level, 2);
  assert.equal(odf.blocks[0].spans[0].bold, true);
  assert.equal(odf.blocks[1].kind, "paragraph");
  // Table flattens to a tab-joined paragraph until the ODF core models tables.
  assert.equal(odf.blocks[2].spans[0].text, "a\tb");
});

test("W10: pageGeometry yields sane line/char counts and honours orientation", () => {
  const a4 = pageGeometry({ size: "A4", orientation: "portrait", marginMm: 25, fontPt: 11 });
  assert.ok(a4.charsPerLine > 40 && a4.charsPerLine < 120);
  assert.ok(a4.linesPerPage > 20 && a4.linesPerPage < 80);
  const land = pageGeometry({ size: "A4", orientation: "landscape" });
  assert.ok(land.charsPerLine > a4.charsPerLine); // wider page, more chars per line
  assert.ok(PAGE_SIZES.A4.h > PAGE_SIZES.A4.w);
});

test("W9/W10: paginate flows a long document into multiple numbered pages", () => {
  const blocks = [];
  for (let i = 0; i < 120; i += 1) {
    blocks.push({
      kind: "paragraph",
      style: "body",
      spans: [{ text: `Paragraph number ${i} with a little text.` }],
    });
  }
  const geo = pageGeometry({ size: "A4" });
  const pages = paginate({ title: "Long", blocks }, geo, {
    header: "Hearth Suite",
    footer: "Page {page} of {pages}",
  });
  assert.ok(pages.length > 1, "splits into multiple pages");
  assert.equal(pages[0].pageNumber, 1);
  assert.equal(pages[0].totalPages, pages.length);
  assert.equal(pages[0].footer, `Page 1 of ${pages.length}`);
  assert.equal(pages[pages.length - 1].footer, `Page ${pages.length} of ${pages.length}`);
  // Every block is placed exactly once.
  const placed = pages.reduce((n, p) => n + p.blocks.length, 0);
  assert.equal(placed, 120);
});

test("W10: a short document is a single page; header/date tokens resolve", () => {
  const pages = paginate(
    { title: "Note", blocks: [{ kind: "paragraph", spans: [{ text: "Short." }] }] },
    pageGeometry(),
    { header: "{date}", footer: "Page {page}", dateLabel: "4 June 2026" },
  );
  assert.equal(pages.length, 1);
  assert.equal(pages[0].header, "4 June 2026");
  assert.equal(pages[0].footer, "Page 1");
});

test("W21: a footnote is placed on the page that carries its marker", () => {
  const blocks = [];
  for (let i = 0; i < 80; i += 1) {
    const block = { kind: "paragraph", spans: [{ text: `Body line ${i} of the document.` }] };
    if (i === 79) block.footnoteRefs = [1];
    blocks.push(block);
  }
  const pages = paginate({ title: "Fn", blocks }, pageGeometry(), {
    footnotes: { 1: "A clarifying note." },
  });
  assert.ok(pages.length > 1);
  const withNote = pages.filter((p) => p.footnotes.length > 0);
  assert.equal(withNote.length, 1);
  assert.equal(withNote[0].footnotes[0].text, "A clarifying note.");
  assert.equal(withNote[0].pageNumber, pages.length); // last block → last page
});

// ---- Deep rich-inline round-trip (ODF inline formatting fidelity) ---------

test("W2/W22: spansToHtml nests every mark and escapes text", () => {
  assert.equal(spansToHtml([{ text: "plain" }]), "plain");
  assert.equal(spansToHtml([{ text: "x", bold: true, italic: true }]), "<b><i>x</i></b>");
  assert.equal(spansToHtml([{ text: "up", sup: true }]), "<sup>up</sup>");
  assert.equal(
    spansToHtml([{ text: "c", color: "#b4540a", font: "Fraunces", size: "12pt" }]),
    '<span style="color:#b4540a;font-family:Fraunces;font-size:12pt">c</span>',
  );
  assert.equal(
    spansToHtml([{ text: "go", href: "https://x.test" }]),
    '<a href="https://x.test">go</a>',
  );
  assert.equal(spansToHtml([{ text: "a<b>&c" }]), "a&lt;b&gt;&amp;c");
});

test("ODF round-trip: spansFromHtml(spansToHtml(x)) preserves the full mark set", () => {
  const spans = [
    { text: "Hello " },
    { text: "bold", bold: true },
    { text: " and " },
    { text: "linked", italic: true, underline: true, href: "https://hearth.test" },
    { text: " x", sup: true, color: "#0a7d4b" },
    { text: "2", sub: true, size: "10pt", font: "Spline Sans" },
  ];
  const roundTripped = spansFromHtml(spansToHtml(spans));
  // Compare on the normalised shape spansFromHtml emits.
  assert.deepEqual(roundTripped, spansFromHtml(spansToHtml(roundTripped)));
  const link = roundTripped.find((s) => s.href);
  assert.equal(link.href, "https://hearth.test");
  assert.equal(link.italic, true);
  assert.equal(link.underline, true);
  assert.equal(roundTripped.find((s) => s.sup)?.color, "#0a7d4b");
  assert.equal(roundTripped.find((s) => s.sub)?.size, "10pt");
});

test("ODF round-trip: tolerant of browser markup (strong/em/del/font/style)", () => {
  const spans = spansFromHtml(
    "Hi <strong>bold</strong> <em>it</em> <del>old</del> " +
      '<font color="#ff0000" face="Arial">red</font> ' +
      '<span style="font-weight:700;text-decoration:underline">heavy</span>',
  );
  assert.equal(spans.find((s) => s.text === "bold").bold, true);
  assert.equal(spans.find((s) => s.text === "it").italic, true);
  assert.equal(spans.find((s) => s.text === "old").strike, true);
  const red = spans.find((s) => s.text === "red");
  assert.equal(red.color, "#ff0000");
  assert.equal(red.font, "Arial");
  const heavy = spans.find((s) => s.text === "heavy");
  assert.equal(heavy.bold, true);
  assert.equal(heavy.underline, true);
});

test("ODF round-trip: nested marks and entities decode; runs coalesce", () => {
  const spans = spansFromHtml("<b>A<i>B</i></b>C &amp; D&nbsp;E");
  assert.equal(spans.find((s) => s.text === "A").bold, true);
  const ab = spans.find((s) => s.text === "B");
  assert.equal(ab.bold, true);
  assert.equal(ab.italic, true);
  assert.equal(spans.map((s) => s.text).join(""), "ABC & D E");
});

// ---- Mail merge: fields, envelopes, labels (W19/W20) ----------------------

test("W19/W20: mergeFields finds distinct {{fields}} across blocks in order", () => {
  const doc = {
    title: "{{title}}",
    blocks: [
      { kind: "heading", level: 1, spans: [{ text: "Dear {{name}}," }] },
      { kind: "paragraph", spans: [{ text: "Your balance is {{amount}}, {{name}}." }] },
      { kind: "table", rows: [[[{ text: "{{city}}" }], [{ text: "{{name}}" }]]] },
    ],
  };
  // Title is not a block; fields come from block text only.
  assert.deepEqual(mergeFields(doc), ["name", "amount", "city"]);
});

test("W19: formatAddress builds mailing lines, tolerant of field naming", () => {
  const lines = formatAddress({
    Name: "Maria Vega",
    Company: "Veldris",
    "Address line 1": "12 Elm Street",
    City: "Leeds",
    Postcode: "LS1 4AB",
    Country: "United Kingdom",
  });
  assert.equal(lines[0], "Maria Vega");
  assert.equal(lines[1], "Veldris");
  assert.equal(lines[2], "12 Elm Street");
  assert.ok(lines.some((l) => l.includes("Leeds") && l.includes("LS1 4AB")));
  assert.equal(lines[lines.length - 1], "United Kingdom");
});

test("W19: formatAddress drops blank lines (no company, no line 2)", () => {
  const lines = formatAddress({ name: "Sam", street: "1 Road", city: "York", zip: "YO1" });
  assert.deepEqual(lines, ["Sam", "1 Road", "York  YO1"]);
});

test("W19: envelope catalogue has standard sizes and lookup falls back", () => {
  assert.ok(ENVELOPE_SIZES.length >= 4);
  assert.equal(envelopeById("dl").widthMm, 220);
  assert.equal(envelopeById("nope").id, ENVELOPE_SIZES[0].id);
});

test("W20: label sheets cover Letter and A4 with sane grids", () => {
  const ids = LABEL_SHEETS.map((s) => s.id);
  assert.ok(ids.includes("avery5160"));
  const a4 = LABEL_SHEETS.find((s) => s.page === "A4");
  assert.ok(a4 && a4.across * a4.down > 0);
  assert.equal(labelSheetById("missing").id, LABEL_SHEETS[0].id);
});

test("W20: paginateLabels chunks records into pages and pads with blanks", () => {
  const sheet = labelSheetById("avery5160"); // 3 × 10 = 30 per page
  const records = Array.from({ length: 32 }, (_v, i) => ({ name: `Person ${i}` }));
  const pages = paginateLabels(records, sheet);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 30);
  assert.equal(pages[1].length, 30);
  assert.equal(pages[1][0].name, "Person 30");
  assert.equal(pages[1][2], null); // padded blank
});

test("W20: paginateLabels startAt skips used labels on a partial sheet", () => {
  const sheet = labelSheetById("avery5160");
  const pages = paginateLabels([{ name: "A" }], sheet, { startAt: 5 });
  assert.equal(pages[0][0], null);
  assert.equal(pages[0][4], null);
  assert.equal(pages[0][5].name, "A");
});

test("X7: chart blocks survive plain-text, ODF mapping, and merge scans", () => {
  const doc = {
    title: "Report",
    blocks: [
      { kind: "paragraph", spans: [{ text: "Sales for {{name}}:" }] },
      {
        kind: "chart",
        spec: {
          id: "c1",
          title: "Quarterly sales",
          type: "bar",
          categories: ["Q1"],
          series: [{ name: "S", values: [1] }],
        },
      },
    ],
  };
  assert.match(toPlainText(doc), /\[chart: Quarterly sales\]/);
  const odf = toOdfModel(doc);
  assert.equal(odf.blocks[1].spans[0].text, "[chart: Quarterly sales]");
  // Merge scanning ignores chart blocks but still finds paragraph fields.
  assert.deepEqual(mergeFields(doc), ["name"]);
  // Compose-from-Data leaves the chart untouched.
  const [filled] = composeFromData(doc, [{ name: "Maria" }]);
  assert.equal(filled.blocks[1].kind, "chart");
  assert.equal(filled.blocks[0].spans[0].text, "Sales for Maria:");
});

test("toOdfModel carries rich inline marks into the export model", () => {
  const doc = {
    title: "Rich",
    blocks: [
      {
        kind: "paragraph",
        spans: [
          { text: "see ", italic: true },
          { text: "site", href: "https://h.test" },
        ],
      },
    ],
  };
  const [para] = toOdfModel(doc).blocks;
  assert.equal(para.spans[0].italic, true);
  assert.equal(para.spans[1].href, "https://h.test");
  // Plain-text extraction still ignores marks.
  assert.equal(toPlainText(doc), "see site");
});
