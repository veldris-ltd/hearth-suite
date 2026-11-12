import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OFFLINE_METHODS,
  UNLOCK_STATES,
  buildRequest,
  canDownloadWeights,
  chooseTier,
  isOfflineCapable,
  nextUnlockState,
  parseResponse,
} from "../src/core.mjs";

// Mirrors the FFI `ember_tiers` surface.
const TIERS = [
  { id: "phi3_mini", min_ram_mb: 4000, mobile_default: true },
  { id: "nemotron_nano", min_ram_mb: 16000, mobile_default: false },
];

test("AC-MOB-2: defaults to the smallest viable Phi tier", () => {
  assert.equal(chooseTier(TIERS), "phi3_mini");
  // Even on a big device, without opt-in the default stays the light tier.
  assert.equal(chooseTier(TIERS, { ramMb: 32000 }), "phi3_mini");
});

test("AC-MOB-2: a heavier tier is used only when opted-in and the RAM fits", () => {
  assert.equal(chooseTier(TIERS, { ramMb: 32000, allowHeavy: true }), "nemotron_nano");
  // Opted in but not enough RAM → stays on the light tier.
  assert.equal(chooseTier(TIERS, { ramMb: 6000, allowHeavy: true }), "phi3_mini");
});

test("AC-MOB-2: weights download only on Wi-Fi with consent", () => {
  assert.equal(canDownloadWeights({ network: "wifi", consented: true }), true);
  assert.equal(canDownloadWeights({ network: "wifi", consented: false }), false);
  assert.equal(canDownloadWeights({ network: "cellular", consented: true }), false);
  assert.equal(canDownloadWeights({ network: "none", consented: true }), false);
});

test("AC-MOB-3: the vault unlocks only via a successful biometric prompt", () => {
  let s = UNLOCK_STATES.LOCKED;
  s = nextUnlockState(s, "request");
  assert.equal(s, UNLOCK_STATES.UNLOCKING);
  // A failed prompt never reaches `unlocked`.
  const failed = nextUnlockState(s, "failure");
  assert.equal(failed, UNLOCK_STATES.ERROR);
  // The only path to `unlocked` is success.
  assert.equal(nextUnlockState(s, "success"), UNLOCK_STATES.UNLOCKED);
  // Retry from error, then lock again.
  assert.equal(nextUnlockState(failed, "request"), UNLOCK_STATES.UNLOCKING);
  assert.equal(nextUnlockState(UNLOCK_STATES.UNLOCKED, "lock"), UNLOCK_STATES.LOCKED);
});

test("AC-MOB-3: there is no way into the vault except an unlock event", () => {
  // No event other than success moves UNLOCKING → UNLOCKED.
  for (const event of ["request", "failure", "lock", "noise"]) {
    assert.notEqual(nextUnlockState(UNLOCK_STATES.UNLOCKING, event), UNLOCK_STATES.UNLOCKED);
  }
  // From LOCKED you can only ever begin unlocking, never jump straight in.
  assert.equal(nextUnlockState(UNLOCK_STATES.LOCKED, "success"), UNLOCK_STATES.LOCKED);
});

test("AC-MOB-1: core editing and Seal are offline-capable (desktop parity)", () => {
  for (const method of [
    "save_document",
    "open_document",
    "seal",
    "unseal",
    "verify",
    "run_ember",
  ]) {
    assert.equal(isOfflineCapable(method), true, `${method} must work offline`);
  }
  // The surface carries no network-only method.
  assert.ok(OFFLINE_METHODS.length > 0);
  assert.equal(isOfflineCapable("fetch_from_cloud"), false);
});

test("transport envelope round-trips", () => {
  assert.deepEqual(JSON.parse(buildRequest("ember_tiers", {})), {
    method: "ember_tiers",
    params: {},
  });
  assert.deepEqual(parseResponse('{"ok":{"id":"phi3_mini"}}'), { id: "phi3_mini" });
  assert.throws(() => parseResponse('{"error":"no model"}'), /no model/);
});
