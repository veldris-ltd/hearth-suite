# Hearth Suite seams, the single tracked inventory

A **seam** is a point where the app layer meets a capability that isn't yet
real in this environment (the Rust/Tauri core and its vault store can't be built
or run here). This file is the one place that records every seam, so no feature
ever silently ships as "done" when part of it is stubbed.

## Two classes of seam

- **Clean boundary**, the capability sits behind a stable, already-defined
  interface (the `Transport`/`HearthClient` contract, or an injectable storage
  arg). The app codes against the contract; only the far side is pending. _Not
  debt._
- **Accepted limitation**, a deliberately scoped-down behaviour with a visible,
  honest UI cue. _Not debt, but tracked._
- **Missing contract**, the interface didn't exist, so the UI did something
  incomplete with no agreed shape. _This is the only real debt._ The fix is to
  define the contract now (so it becomes a clean boundary).

## The golden rule

A seam may **limit** a feature but must never **fake** it. Anything still
device-local or in-memory must say so in the UI (e.g. "Saved on this device"),
or be gated until its contract is real.

## Inventory

| # | Seam | Class | Status | Mitigation in place | Acceptance criterion (to fully close) |
|---|------|-------|--------|---------------------|----------------------------------------|
| 1 | Backend transport (`MockTransport` ↔ `TauriTransport`) | Clean boundary | **Closed** | Every method routed through `Transport.call`; **the real `HearthCore` now implements every dispatched method string** (`list_documents`, `reorder_documents`, `list_fields`, `update_row`, `delete_row` added alongside the rest) and **populates `list_bundles.updated_at`** as an RFC 3339 UTC string (dependency-free civil-date conversion) for The Mantel's History date + recency sort (AC-WKS-S3). `crates/ffi/tests/contract_store.rs` asserts the same behaviour `mock-store.test.mjs` does, against the core | Done — the core dispatch covers the full client surface and the contract suite is green against it |
| 2 | Records edit/delete of **saved** rows | Missing contract → defined → **implemented** | **Closed** | `update_row`/`delete_row` on `HearthClient` + `MockStore`; editor persists via `updateRow`/`deleteRow` ("Saved on this device" shown). **The Rust core + `Store` now implement `update_row`/`delete_row`**, exercised by `contract_store.rs` | Done — core implements `update_row`/`delete_row`; the contract suite passes against it |
| 3 | Records field-name enumeration | Missing contract → defined → **implemented** | **Closed** | `list_fields` + `MockStore`; client-shell builds a **Records merge source** per table from `list_fields`+`query_rows`. **The Rust core surfaces `list_fields`** (the `Store` method was already present), covered by `contract_store.rs` | Done — core implements `list_fields` |
| 4 | Sheets as a Mailings merge source | Clean boundary | **Closed (PW-2.3)** | `list_documents` + `MockStore` impl; a sheet content reader (`parseSheetCsv`) decodes the CSV a sheet is serialized as (the same format `addToBundle` writes), and `sheetsMergeSources` builds a Mailings merge source per saved sheet — verified end-to-end alongside Records and Contacts | Done for merge: header row → field names, data rows → records. A full-fidelity sheet decoder (formulas/number formats/multi-sheet) remains a separate concern, not needed for merge |
| 5 | Sheets→Writer chart **live-link** across bundles / reloads | Accepted limitation | **Closed (P2-CL2)** | `chart` `DocType` persisted per source bundle (only on change); `hydrateChartBridge` reloads every bundle's chart docs at mount, so the link re-resolves after reload and across bundles; the data snapshot also travels in the saved Writer doc | Done, source data persists in the vault keyed by source |
| 6 | Style sets ("Easy Formats") **+ theme/effort/onboarding preferences** | Clean boundary | **Closed (P2-CL3)** | Vault-encrypted `preference` KV (`set`/`get`/`list_preference`, value encrypted with the document cipher) behind the injectable `PreferenceStorage`; `createVaultPreferenceStore` is a synchronous write-through cache hydrated from the vault at mount; the design system (theme/effort) and Sheets `styleStorage` both route through it | Done, preferences persist in the vault and travel with sync |
| 7 | Recovery phrase / restore | Missing wiring → **now wired** | **Closed (P2-CL4)** | `key-manager`'s real BIP-39 `RecoveryPhrase` exposed via `HearthCore::recovery_phrase()` / `open_from_phrase()` + `recovery_phrase` dispatch + C-ABI `hearth_core_open_from_phrase`; onboarding shows the real 24 words (FNV stub removed) and restores via the desktop `restore_identity` Tauri command | Done, the phrase encodes the identity seed and restoring rebuilds the identical identity (Android JNI restore follows in N1) |
| 8 | Seal / unseal / verify | Clean boundary | **Closed** | The real `hearth-seal` crate is behind the unchanged `seal`/`unseal`/`verify` FFI calls (`crates/ffi/src/core.rs`): hybrid **X25519 + ML-KEM-768** key wrap, **ML-DSA-65** manifest signatures, **AES-256-GCM** content. Proven by the crate's KAT vectors + tamper tests (`crates/seal/src/crypto.rs`) and `crates/ffi/tests/bindings.rs` (cross-identity round-trip, **verify rejects a non-signer**, tampered ciphertext fails to unseal). The preview mock now round-trips the sealed content honestly instead of returning a fixed sample | Done — real post-quantum crypto behind the calls; round-trip + signature/tamper rejection tested |
| 9 | Lexicon (dictionary/thesaurus) | Clean boundary | **Closed** | The **`lexicon` FFI now exists**: new `hearth-lexicon` crate (lookup + the same normalise/stemming rules as `lexicon.mjs`, over an entry map) behind `core.lexicon_dataset` (`crates/ffi/src/cabi.rs`); `client.lexiconDataset()` loads it and `setLexiconSource` swaps the active `@hearth/lexicon` set at mount, so Define/lookup use the core's full dataset. The crate embeds the **same** CC0 `data.json` (single source via `include_str!`) as the dev/preview fallback; production drops in the full WordNet/Wiktionary file behind the identical shape. Tested: 6 crate contract tests mirror `lexicon.test.mjs`; `bindings.rs` asserts the dispatch returns the dataset | Done — the FFI is implemented and used; production swaps the dataset file, no surface change |
| 10 | PW-0 Works archive audit (AC-WKS-0) | Accepted limitation → **discharged** | **Closed (P2-W1)** | Live Works 9 install driven menu-by-menu (all five components); every VM-pending item confirmed/corrected; three precision targets resolved (75 functions/8 categories; 12 field types; 14 named filter operators); original screenshot set filed (`works9-audit/`, gitignored). Parity Pack v1.3 §A.7 | Done, AC-WKS-0 closed by the live audit |
| 11 | Calendar reminder **background scheduler** | Clean boundary → **now wired** | **Closed (P2-CL5)** | `onScheduleReminders` threaded through `WorkspaceOptions`; desktop fires native notifications via `tauri-plugin-notification` (a `schedule_reminders` command with per-reminder timers + generation-cancellation); mobile schedules via `@capacitor/local-notifications` (added at device-build by `apply-native.sh`); in-app banner still fires everywhere | Done, OS reminders fire from desktop now and mobile on the device build |
| 12 | Legacy **native decode** of `.wps`/`.wks`/`.wdb` bytes → IR | Clean boundary → **now wired** | **Closed (P2-CL5)** | The `hearth-legacy-import` crate decodes real bytes (`cfb`/OLE2 + UTF-16LE/Latin-1 text recovery) via the core's `decode_legacy`; `client-shell` wires the `decode` hook to `client.decodeLegacy`, so real files import on desktop and mobile (the preview returns samples). The IR flows through the unchanged `importLegacy` translators + honest report | Done for the portable decoder; full-fidelity formatting/charts remain a feature-gated `libwps` C++ backend behind the same shape |

## How this is enforced

- **Contracts first.** New capabilities are added to `HearthClient`/`Transport`
  and implemented in `MockStore` before the UI relies on them (rows 2–4).
- **Contract tests.** `apps/desktop/tests/mock-store.test.mjs` asserts the exact
  behaviour the UI relies on (update reflects, delete removes, `list_fields`,
  `list_documents`, reorder persists). `crates/ffi/tests/contract_store.rs` is the
  equivalent suite against the **real** `HearthCore`, so both sides of seam #1 are
  pinned to the same contract.
- **Honest UI.** In-memory/device-local state is labelled, never disguised.
- **This file.** Every seam is listed here with an owner-facing acceptance
  criterion; a feature is only "done" when its row is closed.
