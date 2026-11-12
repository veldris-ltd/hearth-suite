// Unit tests for the pure Contacts core (src/contacts.mjs). `node --test`.

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeContact,
  monthDay,
  birthdayEvents,
  contactsToMergeRecords,
  contactsToRecordRows,
  toVcard,
  parseVcard,
  loadContacts,
  saveContacts,
  upsertContact,
  removeContact,
  mergeContacts,
  syncCardDav,
} from "../src/contacts.mjs";

function memStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
}

const maria = makeContact({
  name: "Maria Okonkwo",
  emails: ["maria@example.org"],
  phones: ["+44 20 7946 0011"],
  organization: "Hearth Suite board",
  birthday: "1986-03-14",
});

test("makeContact normalises and derives a stable id", () => {
  assert.equal(maria.id, "maria-okonkwo");
  assert.deepEqual(maria.emails, ["maria@example.org"]);
  assert.equal(makeContact({ name: "" }).id, "contact");
});

test("monthDay extracts a recurring MM-DD from full or partial dates", () => {
  assert.equal(monthDay("1986-03-14"), "03-14");
  assert.equal(monthDay("--12-25"), "12-25");
  assert.equal(monthDay(""), null);
});

test("birthdayEvents auto-generates annual events (AC-WKS-C4)", () => {
  const events = birthdayEvents(
    [maria, makeContact({ name: "Lena", anniversary: "2015-06-20" })],
    2026,
  );
  assert.equal(events.length, 2);
  const bday = events.find((e) => e.summary.includes("birthday"));
  assert.equal(bday.start, "2026-03-14");
  assert.equal(bday.source, "contacts");
  const anniv = events.find((e) => e.summary.includes("anniversary"));
  assert.equal(anniv.start, "2026-06-20");
  // A different year re-bases the same contacts (annual recurrence).
  assert.equal(birthdayEvents([maria], 2027)[0].start, "2027-03-14");
});

test("PW-1.3: mergeContacts dedupes by id, newer lastModified wins, local wins ties", () => {
  const local = [
    makeContact({
      name: "Maria Okonkwo",
      organization: "Local edit",
      lastModified: "2026-06-10T10:00:00Z",
    }),
    makeContact({ name: "Only Local" }),
  ];
  const remote = [
    makeContact({
      name: "Maria Okonkwo",
      organization: "Stale remote",
      lastModified: "2026-06-01T00:00:00Z",
    }),
    makeContact({ name: "Only Remote" }),
  ];
  const merged = mergeContacts(local, remote);
  assert.equal(merged.length, 3); // Maria deduped + Only Local + Only Remote
  const maria2 = merged.find((c) => c.id === "maria-okonkwo");
  assert.equal(maria2.organization, "Local edit"); // newer local kept
  assert.ok(merged.some((c) => c.id === "only-remote"));
});

test("PW-1.3: syncCardDav pulls, merges, saves to the (vault) store, and pushes back", async () => {
  const store = memStore();
  saveContacts([makeContact({ name: "Maria Okonkwo" })], store);
  let pushed = "";
  const transport = {
    pull: async () => toVcard([makeContact({ name: "Remote Person", emails: ["r@x.org"] })]),
    push: async (vcard) => {
      pushed = vcard;
    },
  };
  const merged = await syncCardDav(transport, store);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((c) => c.id === "remote-person"));
  // Persisted to the store and pushed back.
  assert.equal(loadContacts(store).length, 2);
  assert.ok(pushed.includes("Remote Person"));
  // No transport => no-op returning the local book.
  assert.equal((await syncCardDav(undefined, store)).length, 2);
});

test("one record drives merge + records with no re-entry (AC-WKS-S10)", () => {
  const merge = contactsToMergeRecords([maria]);
  assert.equal(merge[0].Name, "Maria Okonkwo");
  assert.equal(merge[0].Email, "maria@example.org");
  const { fields, rows } = contactsToRecordRows([maria]);
  assert.ok(fields.some((f) => f.name === "Name"));
  assert.equal(rows[0].Email, "maria@example.org");
});

test("vCard round-trips name, email, phone, org, birthday, notes", () => {
  const card = toVcard([maria]);
  assert.match(card, /BEGIN:VCARD/);
  assert.match(card, /FN:Maria Okonkwo/);
  assert.match(card, /BDAY:1986-03-14/);
  const back = parseVcard(card);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "Maria Okonkwo");
  assert.equal(back[0].emails[0], "maria@example.org");
  assert.equal(back[0].birthday, "1986-03-14");
});

test("store upserts by id, removes, and isolates via injected storage", () => {
  const store = memStore();
  upsertContact(maria, store);
  assert.equal(loadContacts(store).length, 1);
  upsertContact({ ...maria, organization: "Changed" }, store); // replace, not duplicate
  const loaded = loadContacts(store);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].organization, "Changed");
  removeContact("maria-okonkwo", store);
  assert.equal(loadContacts(store).length, 0);
});

test("store tolerates corrupt data", () => {
  const store = memStore();
  store.setItem("hb-contacts", "{bad");
  assert.deepEqual(loadContacts(store), []);
  saveContacts([maria], store);
  assert.equal(loadContacts(store)[0].name, "Maria Okonkwo");
});
