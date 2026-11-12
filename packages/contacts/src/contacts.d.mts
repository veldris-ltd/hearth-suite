// Type declarations for the pure Contacts core (contacts.mjs).

/** A local-first contact record (the Address Book heir). */
export interface Contact {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  address: string;
  organization: string;
  /** "YYYY-MM-DD" or "--MM-DD". */
  birthday: string;
  anniversary: string;
  notes: string;
  lastModified?: string;
}

/** A CalEvent-shaped auto-event (matches @hearth/calendar's CalEvent subset). */
export interface ContactEvent {
  uid: string;
  summary: string;
  start: string;
  source: "contacts";
  allDay: true;
}

/** A minimal key/value store (localStorage, an injected shim, or an FFI adapter). */
export interface ContactStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A CardDAV transport (vCard over HTTP). The HTTP impl is a host seam. */
export interface CardDavTransport {
  pull(): Promise<string>;
  push(vcard: string): Promise<void>;
}

export function makeContact(input: Partial<Contact> & { name?: string }): Contact;
export function monthDay(date: string): string | null;
export function birthdayEvents(contacts: Contact[], year: number): ContactEvent[];
export function contactsToMergeRecords(contacts: Contact[]): Array<Record<string, string>>;
export function contactsToRecordRows(contacts: Contact[]): {
  fields: Array<{ name: string; datatype: string }>;
  rows: Array<Record<string, string>>;
};
export function toVcard(contacts: Contact[]): string;
export function parseVcard(text: string): Contact[];
export function loadContacts(storage?: ContactStorage): Contact[];
export function saveContacts(contacts: Contact[], storage?: ContactStorage): Contact[];
export function upsertContact(
  contact: Partial<Contact> & { name?: string },
  storage?: ContactStorage,
): Contact[];
export function removeContact(id: string, storage?: ContactStorage): Contact[];
export function mergeContacts(local: Contact[], remote: Contact[]): Contact[];
export function syncCardDav(
  transport: CardDavTransport | undefined,
  storage?: ContactStorage,
): Promise<Contact[]>;
