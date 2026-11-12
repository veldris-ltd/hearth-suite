// Offline client E2E (AC-QA-4). Drives the modules' executable logic through a
// realistic journey, edit (mail-merge) → Ember request → Seal status →
// export/reopen → universal search, with the network hard-disabled. The
// authoritative full-stack create→edit→Ember→Seal→reopen journey through the
// real Rust core lives in crates/ffi/tests/e2e_journey.rs; this asserts the
// client-side flow that the packaged UIs run on top of it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { rankResults, routeForResult } from "@hearth/shell/src/core.mjs";
import {
  buildAskRequest,
  composeFromData,
  sealStatusText,
  toOdfModel,
  toPlainText,
} from "@hearth/writer/src/core.mjs";

// Any network access during the journey is a hard failure.
globalThis.fetch = () => {
  throw new Error("network access is forbidden in the offline E2E");
};

const MODULES = ["writer", "sheets", "records", "calendar"];

test("AC-QA-4: edit → Ember → Seal → export/reopen, fully offline", () => {
  // 1. edit: fill a mail-merge template per record (create + edit).
  const template = {
    title: "Welcome {{name}}",
    blocks: [
      {
        kind: "paragraph",
        style: "body",
        spans: [{ text: "Dear {{name}}, welcome to {{org}}." }],
      },
    ],
  };
  const docs = composeFromData(template, [
    { name: "Maria", org: "Hearth Suite" },
    { name: "Sam", org: "Hearth Suite" },
  ]);
  assert.equal(docs.length, 2);
  assert.match(toPlainText(docs[0]), /Dear Maria, welcome to Hearth Suite\./);

  // 2. Ember: an "ask your document" request is assembled locally; the document
  // is the whole context and the shape carries no network destination.
  const ask = buildAskRequest(docs[0], "Who is this addressed to?");
  assert.equal(ask.task, "query");
  assert.match(ask.document, /Maria/);

  // 3. Seal: the status reads in plain language, never crypto jargon.
  assert.equal(sealStatusText(["Maria"]), "Only you and Maria can open this");

  // 4. export + reopen: map to the shared ODF model and recover the text.
  const model = toOdfModel(docs[0]);
  assert.ok(Array.isArray(model.blocks) && model.blocks.length >= 1);
  const reopened = model.blocks.map((b) => b.spans.map((s) => s.text).join("")).join("\n");
  assert.match(reopened, /Dear Maria, welcome to Hearth Suite\./);
});

test("AC-QA-4: universal search routes a result to a real module (offline)", () => {
  const items = [
    { id: "1", title: "Quarterly letter", kind: "document" },
    { id: "2", title: "Quarterly budget", kind: "record" },
  ];
  const ranked = rankResults("quarterly", items);
  assert.ok(ranked.length >= 1);
  assert.ok(MODULES.includes(routeForResult(ranked[0])));
});
