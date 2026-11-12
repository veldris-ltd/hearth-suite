# Hearth Suite user guide

Hearth Suite is four core applications unified by **The Mantel** and bound together by
**Bundles**, **Seal**, and **Ember**. Everything is local-first and offline by
default.

## Concepts

- **Bundle**, a project: a signed, open archive holding your documents, data, and
  assets. Bundles can be **Sealed** (end-to-end encrypted) in one step.
- **The Mantel**, the home surface: quick-create, universal search, recent
  Bundles. Advanced controls (encryption, sync, relations) stay tucked behind
  progressive disclosure until you need them.
- **Seal**, post-quantum end-to-end encryption, described in plain language.
- **Ember**, the on-device AI assistant; never sends content off the device.

## Writer

A block-based word processor with live styles, real tables, and images, and a
distraction-free default.

- **Ember panel**, draft, rewrite, summarise, change tone, and "ask your
  document" (answered locally from the document text).
- **Compose from Data**, mail-merge: generate one document per record from a
  Records table or sheet.
- **Export**, ODF, `.docx`, and PDF.
- **Seal**, encrypt the document to chosen recipients; the status reads in plain
  language.

## Sheets

A spreadsheet with a real formula engine.

- Arithmetic, references, ranges, named ranges, and functions (e.g. `SUM`,
  `SUMIF`, `IF`), with dependency recalculation and cycle detection.
- **Pivot** summaries and **chart** suggestions.
- **Explain this formula** in plain language; request a formula from a natural-
  language description (on-device).
- Promote a data table to **Records** with no data loss; export to `.xlsx`.

## Records

A flat, form-driven database, no SQL required.

- Define fields with types and validation; enter data through forms or a list.
- **No-code relations / lookups** between tables.
- **Reports** (filter / sort / project) that can feed a Writer mail-merge.
- **Smart CSV import** infers fields and types.

## Calendar & Contacts

A calm agenda and contacts.

- Events round-trip via **iCalendar**; contacts via **vCard**.
- **CalDAV/CardDAV** subscribe and publish (the host supplies the networked
  transport; auth never stores a provider password).
- External providers map cleanly; each source toggles independently.
- Reminders, with deterministic two-way conflict handling.

## Sealing & sharing

Seal a Bundle to specific people. Only listed recipients can open it; the
manifest is signed so recipients can verify authorship. If you sync (opt-in),
only encrypted blobs ever leave your device.

## Sync (optional)

Sync is **off by default**. When enabled, Hearth Suite syncs **sealed deltas** through a
zero-knowledge relay, the relay (and any operator) sees only opaque ciphertext,
never your content. You can self-host the relay (see the self-hosting guide).

## Importing from Microsoft Works

Hearth Suite imports legacy `.wps` / `.wks` / `.wdb` files, recovering text and tables
into Writer/Sheets/Records.

## Privacy at a glance

- No account, no telemetry, no cloud by default.
- On-device AI only.
- Encrypted at rest; post-quantum end-to-end when sealed.
- Open formats and an open licence (Apache-2.0).
