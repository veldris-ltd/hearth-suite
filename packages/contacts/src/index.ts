/**
 * Hearth Suite Contacts, the local-first Address Book, shared across Writer (merge),
 * Records (link source), and Calendar (birthday/anniversary auto-events).
 *
 * One stored record drives all three with no re-entry (AC-WKS-S10) and birthdays
 * auto-event annually (AC-WKS-C4). Persistence is local and synchronous; the
 * production store is the vault-encrypted core via FFI (the store functions are
 * the seam). CardDAV sync is optional and layered on top of the same model.
 */

import seedData from "./data.json";
import {
  birthdayEvents,
  contactsToMergeRecords,
  contactsToRecordRows,
  loadContacts,
  makeContact,
  monthDay,
  parseVcard,
  removeContact,
  saveContacts,
  toVcard,
  upsertContact,
} from "./contacts.mjs";
import type { Contact, ContactEvent, ContactStorage } from "./contacts.mjs";

export {
  birthdayEvents,
  contactsToMergeRecords,
  contactsToRecordRows,
  loadContacts,
  makeContact,
  monthDay,
  parseVcard,
  removeContact,
  saveContacts,
  toVcard,
  upsertContact,
};
export type { Contact, ContactEvent, ContactStorage };

/** Demo address book for previews/first-run seeding (not shipped data). */
export const sampleContacts: Contact[] = (seedData.seed as Array<Partial<Contact>>).map(
  makeContact,
);
