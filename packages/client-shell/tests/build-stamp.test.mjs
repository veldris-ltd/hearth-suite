// Build stamp for Settings > About (AC-WIN-1). `node --test`.

import test from "node:test";
import assert from "node:assert/strict";

import { buildStamp, DEVELOPER_BUILD } from "../src/build-stamp.mjs";

test("ac_win_1: a release build shows version, channel and short commit", () => {
  assert.equal(
    buildStamp({ appVersion: "1.0.0-beta.3", channel: "beta", buildCommit: "a1b2c3d4e5f6" }),
    "1.0.0-beta.3 · beta · a1b2c3d",
  );
});

test("ac_win_1: missing parts are left out, never invented", () => {
  assert.equal(buildStamp({ appVersion: "1.0.0" }), "1.0.0");
  assert.equal(buildStamp({ appVersion: "1.0.0", buildCommit: "abc1234" }), "1.0.0 · abc1234");
});

test("ac_win_1: no version reads as a developer build", () => {
  assert.equal(buildStamp({}), DEVELOPER_BUILD);
  assert.equal(
    buildStamp({ appVersion: "  ", buildCommit: "abc1234" }),
    "developer build · abc1234",
  );
});
