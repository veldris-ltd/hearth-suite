// Hearth Suite Contacts core, the local-first Address Book heir.
//
// One contact record drives Writer mail-merge, Records linking, and Calendar
// birthday/anniversary auto-events with no re-entry (AC-WKS-S10), and birthdays
// auto-event annually (AC-WKS-C4). Pure logic, no DOM, no network; persistence
// is an injectable key/value store (localStorage in the client; the SEAM for the
// vault-encrypted core store). Unit-tested with `node --test`.

/** Normalise a string to a stable id fragment. */
function slug(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Build a contact record from partial input (id derived from name if absent). */
export function makeContact(input) {
  const name = String(input?.name ?? "").trim();
  return {
    id: input?.id ? String(input.id) : slug(name) || "contact",
    name,
    emails: Array.isArray(input?.emails) ? input.emails.filter(Boolean) : [],
    phones: Array.isArray(input?.phones) ? input.phones.filter(Boolean) : [],
    address: input?.address ?? "",
    organization: input?.organization ?? "",
    birthday: input?.birthday ?? "",
    anniversary: input?.anniversary ?? "",
    notes: input?.notes ?? "",
    lastModified: input?.lastModified,
  };
}

/** Extract a recurring "MM-DD" from "YYYY-MM-DD" or "--MM-DD"; null if absent. */
export function monthDay(date) {
  const m = /(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Annual birthday/anniversary auto-events for a given year (AC-WKS-C4). Returns
 * CalEvent-shaped records so the Calendar can merge them directly; `source` is
 * "contacts" so they're visually distinct and never written back to .ics.
 */
export function birthdayEvents(contacts, year) {
  const events = [];
  for (const c of contacts ?? []) {
    const bday = monthDay(c.birthday);
    if (bday) {
      events.push({
        uid: `bday-${c.id}-${year}`,
        summary: `🎂 ${c.name}'s birthday`,
        start: `${year}-${bday}`,
        source: "contacts",
        allDay: true,
      });
    }
    const anniv = monthDay(c.anniversary);
    if (anniv) {
      events.push({
        uid: `anniv-${c.id}-${year}`,
        summary: `💍 ${c.name}, anniversary`,
        start: `${year}-${anniv}`,
        source: "contacts",
        allDay: true,
      });
    }
  }
  return events;
}

/** Map contacts to flat merge records for Writer's Compose-from-Data. */
export function contactsToMergeRecords(contacts) {
  return (contacts ?? []).map((c) => ({
    Name: c.name,
    Email: (c.emails ?? [])[0] ?? "",
    Phone: (c.phones ?? [])[0] ?? "",
    Address: c.address ?? "",
    Organization: c.organization ?? "",
    Birthday: c.birthday ?? "",
  }));
}

/** A field schema + rows for seeding/linking a Records table from contacts. */
export function contactsToRecordRows(contacts) {
  const fields = [
    { name: "Name", datatype: "text" },
    { name: "Email", datatype: "text" },
    { name: "Phone", datatype: "text" },
    { name: "Organization", datatype: "text" },
  ];
  const rows = (contacts ?? []).map((c) => ({
    Name: c.name,
    Email: (c.emails ?? [])[0] ?? "",
    Phone: (c.phones ?? [])[0] ?? "",
    Organization: c.organization ?? "",
  }));
  return { fields, rows };
}

// ---- vCard (RFC 6350 subset: FN, EMAIL, TEL, ADR, ORG, BDAY, NOTE, UID) -----

function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,");
}
function unescapeText(value) {
  return String(value ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
}

/** Serialise contacts to vCard 3.0 text. */
export function toVcard(contacts) {
  const out = [];
  for (const c of contacts ?? []) {
    out.push("BEGIN:VCARD", "VERSION:3.0", `UID:${c.id}`, `FN:${escapeText(c.name)}`);
    for (const email of c.emails ?? []) out.push(`EMAIL:${escapeText(email)}`);
    for (const phone of c.phones ?? []) out.push(`TEL:${escapeText(phone)}`);
    if (c.address) out.push(`ADR:;;${escapeText(c.address)}`);
    if (c.organization) out.push(`ORG:${escapeText(c.organization)}`);
    if (c.birthday) out.push(`BDAY:${c.birthday}`);
    if (c.anniversary) out.push(`ANNIVERSARY:${c.anniversary}`);
    if (c.notes) out.push(`NOTE:${escapeText(c.notes)}`);
    out.push("END:VCARD");
  }
  return out.join("\r\n");
}

/** Parse vCard text into contacts. */
export function parseVcard(text) {
  const contacts = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === "BEGIN" && value.toUpperCase() === "VCARD") {
      current = { name: "", emails: [], phones: [] };
    } else if (key === "END" && value.toUpperCase() === "VCARD") {
      if (current) contacts.push(makeContact(current));
      current = null;
    } else if (current) {
      if (key === "FN") current.name = unescapeText(value);
      else if (key === "UID") current.id = value;
      else if (key === "EMAIL") current.emails.push(unescapeText(value));
      else if (key === "TEL") current.phones.push(unescapeText(value));
      else if (key === "ADR") current.address = unescapeText(value.replace(/^;+/, ""));
      else if (key === "ORG") current.organization = unescapeText(value);
      else if (key === "BDAY") current.birthday = value;
      else if (key === "ANNIVERSARY") current.anniversary = value;
      else if (key === "NOTE") current.notes = unescapeText(value);
    }
  }
  return contacts;
}

// ---- Persistence (app-wide Address Book) ------------------------------------
// The address book is a single suite-level blob under one key. Pass a `storage`
// adapter to control where it lives: the client shell injects the vault-backed
// preference store (PW-1.3), so contacts are encrypted at rest and travel with
// sync exactly like theme/effort and style sets. With no adapter it falls back
// to `localStorage` (the no-Tauri preview and tests).

const KEY = "hb-contacts";

function resolveStore(storage) {
  if (storage) return storage;
  return typeof globalThis !== "undefined" && globalThis.localStorage
    ? globalThis.localStorage
    : null;
}

/** Load the address book. */
export function loadContacts(storage) {
  const store = resolveStore(storage);
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(makeContact) : [];
  } catch {
    return [];
  }
}

/** Replace the entire address book. */
export function saveContacts(contacts, storage) {
  const store = resolveStore(storage);
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(contacts));
    } catch {
      /* ignore */
    }
  }
  return contacts;
}

/** Insert or replace a single contact (by id) and persist. */
export function upsertContact(contact, storage) {
  const c = makeContact(contact);
  const next = [...loadContacts(storage).filter((x) => x.id !== c.id), c];
  return saveContacts(next, storage);
}

/** Remove a contact by id. */
export function removeContact(id, storage) {
  const next = loadContacts(storage).filter((x) => x.id !== id);
  return saveContacts(next, storage);
}

// ---- CardDAV sync (optional seam) -------------------------------------------
// CardDAV exchanges vCard bodies over HTTP. The HTTP transport is a host seam
// (like CalDAV for Calendar); this layer is the pure merge + drive logic. With
// no transport, contacts stay purely local-first.

/**
 * Merge two contact lists by id, newer `lastModified` winning; on a tie the
 * first list (treated as local) is kept, so local-first edits are not clobbered.
 * @param {Contact[]} local
 * @param {Contact[]} remote
 * @returns {Contact[]}
 */
export function mergeContacts(local, remote) {
  const byId = new Map();
  for (const raw of [...(local ?? []), ...(remote ?? [])]) {
    const c = makeContact(raw);
    const prev = byId.get(c.id);
    if (!prev || (c.lastModified ?? "") > (prev.lastModified ?? "")) {
      byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

/**
 * @typedef {object} CardDavTransport
 * @property {() => Promise<string>} pull  Fetch the remote address book as vCard text.
 * @property {(vcard: string) => Promise<void>} push  Write the merged address book back.
 */

/**
 * Optional CardDAV sync: pull the remote vCard, merge with the local book, save,
 * and push the merged result. Returns the merged contacts. Absent a transport it
 * is a no-op that just returns the local book (offline, local-first by default).
 * @param {CardDavTransport | undefined} transport
 * @param {ContactStorage} [storage]
 * @returns {Promise<Contact[]>}
 */
export async function syncCardDav(transport, storage) {
  if (!transport) return loadContacts(storage);
  const remote = parseVcard(await transport.pull());
  const merged = mergeContacts(loadContacts(storage), remote);
  saveContacts(merged, storage);
  await transport.push(toVcard(merged));
  return merged;
}
