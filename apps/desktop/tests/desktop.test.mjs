import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRequest, parseResponse, unwrapEnvelope } from "../src/core.mjs";

test("buildRequest produces a method/params envelope", () => {
  assert.deepEqual(JSON.parse(buildRequest("list_bundles", {})), {
    method: "list_bundles",
    params: {},
  });
  // Missing params default to an empty object.
  assert.deepEqual(JSON.parse(buildRequest("sync_status")), {
    method: "sync_status",
    params: {},
  });
});

test("unwrapEnvelope returns the ok payload", () => {
  assert.deepEqual(unwrapEnvelope({ ok: { id: "abc", title: "Notes" } }), {
    id: "abc",
    title: "Notes",
  });
  assert.equal(unwrapEnvelope({ ok: null }), null);
});

test("unwrapEnvelope throws on the error payload", () => {
  assert.throws(() => unwrapEnvelope({ error: "unknown method: nope" }), /unknown method: nope/);
});

test("unwrapEnvelope rejects malformed envelopes", () => {
  assert.throws(() => unwrapEnvelope(42), /malformed core response/);
  assert.throws(() => unwrapEnvelope({}), /malformed core response/);
  assert.throws(() => unwrapEnvelope(null), /malformed core response/);
});

test("parseResponse parses then unwraps", () => {
  assert.deepEqual(parseResponse('{"ok":[{"id":"1"}]}'), [{ id: "1" }]);
  assert.throws(() => parseResponse('{"error":"boom"}'), /boom/);
});
