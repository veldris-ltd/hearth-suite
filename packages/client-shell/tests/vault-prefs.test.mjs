import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { createVaultPreferenceStore } from "../src/vault-prefs.mjs";

/** Flush pending fire-and-forget persists (a macrotask drains the chain). */
const flush = () => delay(0);

/** A fake client over an in-memory map, mirroring the vault KV contract. */
function fakeClient(seed = {}) {
  const backing = new Map(Object.entries(seed));
  const writes = [];
  return {
    backing,
    writes,
    async setPreference(key, value) {
      writes.push([key, value]);
      backing.set(key, value);
      return null;
    },
    async listPreferences() {
      return [...backing.entries()].map(([key, value]) => ({ key, value }));
    },
  };
}

test("P2-CL3: reads come back synchronously after a write", () => {
  const store = createVaultPreferenceStore(fakeClient());
  assert.equal(store.getItem("hb-theme"), null);
  store.setItem("hb-theme", "dark");
  assert.equal(store.getItem("hb-theme"), "dark");
});

test("P2-CL3: writes are mirrored to the vault client", async () => {
  const client = fakeClient();
  const store = createVaultPreferenceStore(client);
  store.setItem("hb-effort", "fast");
  store.setItem("hb-styles:b1", '[{"id":"x"}]');
  // Persistence is fire-and-forget; let the queue drain.
  await flush();
  assert.deepEqual(client.backing.get("hb-effort"), "fast");
  assert.deepEqual(client.backing.get("hb-styles:b1"), '[{"id":"x"}]');
});

test("P2-CL3: hydrate loads persisted values into the cache (survives reload)", async () => {
  const client = fakeClient({ "hb-theme": "light", "hb-effort": "thorough" });
  const store = createVaultPreferenceStore(client);
  // Before hydration the fresh cache is empty.
  assert.equal(store.getItem("hb-theme"), null);
  await store.hydrate();
  assert.equal(store.getItem("hb-theme"), "light");
  assert.equal(store.getItem("hb-effort"), "thorough");
});

test("P2-CL3: removeItem tombstones to empty string (parse guards read as unset)", async () => {
  const client = fakeClient({ "hb-theme": "dark" });
  const store = createVaultPreferenceStore(client);
  await store.hydrate();
  store.removeItem("hb-theme");
  assert.equal(store.getItem("hb-theme"), "");
  await flush();
  assert.equal(client.backing.get("hb-theme"), "");
});

test("P2-CL3: a failed persist routes to onError and never throws from setItem", async () => {
  const errors = [];
  const client = {
    async setPreference() {
      throw new Error("vault offline");
    },
    async listPreferences() {
      return [];
    },
  };
  const store = createVaultPreferenceStore(client, (e) => errors.push(e));
  assert.doesNotThrow(() => store.setItem("hb-theme", "dark"));
  // The in-session value is still readable immediately.
  assert.equal(store.getItem("hb-theme"), "dark");
  await flush();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].message), /vault offline/);
});
