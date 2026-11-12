/**
 * The shared client shell.
 *
 * Composes The Mantel and the four module editors (Writer, Sheets, Records,
 * Calendar) into one windowed workspace, driven by a single {@link HearthClient}.
 * Both the desktop (Tauri) and mobile (Capacitor) clients mount this exact host -
 * the only thing that differs between platforms is the transport behind the
 * client and the native shell around it. The render layer is framework-agnostic
 * DOM, like every Hearth Suite module.
 *
 * The chrome is a calm, persistent left rail (brand flame + module nav + theme
 * toggle + identity) beside a content region, with a quiet "On your device" cue
 *, the Mantel's progressive-depth home lives in the content region.
 */

import "../styles/chrome.css";
import "../styles/search-palette.css";
import "../styles/surfaces.css";
import "../styles/onboarding.css";
import "../styles/seal-dialog.css";

import { Calendar, type CalEvent, type CalDavTransport } from "@hearth/calendar";
import type { ChartData, ChartSource } from "@hearth/charts";
import {
  birthdayEvents,
  contactsToMergeRecords,
  contactsToRecordRows,
  loadContacts,
} from "@hearth/contacts";
import type { DocType, HearthClient, RecordValue } from "@hearth/core-client";
import {
  hasOnboarded,
  icon,
  initTheme,
  resolveTheme,
  setOnboarded,
  setPreferenceStore,
  setTheme,
  type IconName,
} from "@hearth/design-system";
import { setLexiconSource } from "@hearth/lexicon";
import { Records } from "@hearth/records";
import { Mantel, createClientSource } from "@hearth/shell";
import type { CreateOptions, ModuleId, OpenTarget } from "@hearth/shell";
import { Sheets } from "@hearth/sheets";
import { Writer } from "@hearth/writer";
import type { MergeSource, WriterDocument } from "@hearth/writer";

import { openAddToBundle } from "./add-to-bundle";
import { BundlesView } from "./bundles-view";
import { showCoach } from "./coach-panel";
import { exportWriterDocument } from "./export-document";
import { ContactsView } from "./contacts-view";
import { HelpView } from "./help-view";
import { openLegacyImport, type LegacyOpenPayload } from "./legacy-import";
import { Onboarding } from "./onboarding";
import { SealDialog, type Recipient } from "./seal-dialog";
import type { WdbIr, WksIr, WpsIr } from "@hearth/legacy";

import { parseChartEntry, serializeChartEntry } from "./chart-store.mjs";
import { parseSheetCsv } from "./sheet-merge.mjs";
import { createVaultPreferenceStore } from "./vault-prefs.mjs";
import type { TransparencyEntry } from "./key-verify";
import { SearchPalette } from "./search-palette";
import { SettingsView, type SettingsOptions } from "./settings-view";
import { toast } from "./toast";

export type { OpenTarget } from "@hearth/shell";
export { fetchCalDavTransport, basicAuthHeader } from "./caldav.mjs";
export type { CalDavTransport, FetchLike } from "./caldav.mjs";
export type { SettingsOptions } from "./settings-view";

/**
 * The Sheets→Writer chart bridge: a registry of chart source data keyed by
 * source. Sheets publishes a chart's data here whenever it renders; Writer
 * resolves it (synchronously) to keep a live-linked embedded chart up to date.
 *
 * It is now **vault-backed** (seam #5 closed): each published entry is persisted
 * as a "chart" document in its source Bundle, and {@link hydrateChartBridge}
 * reloads them on mount, so a live-link re-resolves after a reload and across
 * Bundles, not just within one session.
 */
const chartBridge = new Map<string, ChartData>();
function chartKey(source: ChartSource): string {
  return `${source.bundleId ?? ""}::${(source.sheet ?? "").toUpperCase()}::${(source.range ?? "").toUpperCase()}`;
}

/** Persist a chart-source entry to its Bundle's vault, only when it changed. */
function persistChartData(client: HearthClient, source: ChartSource, data: ChartData): void {
  const key = chartKey(source);
  const changed = JSON.stringify(chartBridge.get(key)) !== JSON.stringify(data);
  chartBridge.set(key, data);
  if (!source.bundleId || !changed) {
    return;
  }
  void client
    .saveDocument({
      bundle_id: source.bundleId,
      doc_type: "chart",
      title: key,
      content_base64: encodeBase64Utf8(serializeChartEntry(key, data)),
    })
    .catch(() => undefined);
}

/** Reload persisted chart-source data into the in-session bridge (every Bundle),
 *  so a live-linked Writer chart re-resolves after a reload and cross-Bundle. */
async function hydrateChartBridge(client: HearthClient): Promise<void> {
  try {
    for (const bundle of await client.listBundles()) {
      const docs = await client.listDocuments(bundle.id);
      for (const doc of docs) {
        if (doc.doc_type !== "chart") {
          continue;
        }
        const content = await client.openDocument(doc.id);
        const entry = parseChartEntry(decodeBase64Utf8(content.content_base64));
        if (entry) {
          chartBridge.set(entry.key, entry.data as ChartData);
        }
      }
    }
  } catch {
    // Offline or store unavailable: the in-session bridge still works.
  }
}

/**
 * Load the full offline dictionary/thesaurus from the core (seam #9) and make
 * the Define / lookup surfaces use it. The bundled CC0 sample stays active when
 * there's no core or the dataset is empty (e.g. the web preview).
 */
async function hydrateLexicon(client: HearthClient): Promise<void> {
  try {
    setLexiconSource(await client.lexiconDataset());
  } catch {
    // No core / unsupported: the bundled sample remains active.
  }
}

/** Base64-encode UTF-8 text for a document payload. */
function encodeBase64Utf8(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Base64-encode a picked file's raw bytes (for the legacy decoder seam). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * The Records→Writer report bridge: reports a user "sends to a letter" become
 * Mailings merge sources for documents in the same Bundle (in-session).
 */
const reportBridge = new Map<
  string,
  Array<{ name: string; records: Array<Record<string, string>> }>
>();
function publishReport(
  bundleId: string,
  name: string,
  records: Array<Record<string, string>>,
): void {
  const list = reportBridge.get(bundleId) ?? [];
  const existing = list.findIndex((r) => r.name === name);
  if (existing >= 0) {
    list[existing] = { name, records };
  } else {
    list.push({ name, records });
  }
  reportBridge.set(bundleId, list);
}

/** Map a FieldValue to a plain scalar (text/number/bool/null). */
function recordScalar(value: RecordValue | undefined): string {
  if (value === undefined || value === "null") {
    return "";
  }
  if ("text" in value) return value.text;
  if ("number" in value) return String(value.number);
  if ("integer" in value) return String(value.integer);
  if ("bool" in value) return value.bool ? "Yes" : "No";
  return "";
}

/**
 * Build a Mailings merge source for every Records table in a Bundle, reading
 * field names via `list_fields` and rows via `query_rows` (PW-2.6 closed the
 * field-name seam). Returns `[]` on any error so Mailings still offers Contacts.
 */
async function recordsMergeSources(client: HearthClient, bundleId: string): Promise<MergeSource[]> {
  try {
    const tables = await client.listTables(bundleId);
    const sources: MergeSource[] = [];
    for (const table of tables) {
      const fields = await client.listFields(table.id);
      if (fields.length === 0) {
        continue;
      }
      const rows = await client.queryRows(table.id);
      const records = rows.map((row) => {
        const byId = new Map(row.values.map((v) => [v.field_id, v.value]));
        const record: Record<string, string> = {};
        for (const field of fields) {
          record[field.name] = recordScalar(byId.get(field.id));
        }
        return record;
      });
      sources.push({
        id: `records:${table.id}`,
        label: `Records, ${table.name}`,
        kind: "records",
        records,
      });
    }
    return sources;
  } catch {
    return [];
  }
}

/**
 * Build a Mailings merge source for every saved Sheets document in a Bundle,
 * decoding its CSV export into header-keyed records (seam #4). Returns `[]` on
 * any error so Mailings still offers Contacts and Records.
 */
async function sheetsMergeSources(client: HearthClient, bundleId: string): Promise<MergeSource[]> {
  try {
    const docs = await client.listDocuments(bundleId);
    const sources: MergeSource[] = [];
    for (const doc of docs) {
      if (doc.doc_type !== "sheet") {
        continue;
      }
      const content = await client.openDocument(doc.id);
      const records = parseSheetCsv(decodeBase64Utf8(content.content_base64));
      if (records.length === 0) {
        continue;
      }
      sources.push({
        id: `sheets:${doc.id}`,
        label: `Sheet, ${doc.title ?? "Sheet"}`,
        kind: "sheets",
        records,
      });
    }
    return sources;
  } catch {
    return [];
  }
}

/** Decode a base64 (UTF-8) document payload to text. */
function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A handle to a mounted workspace. */
export interface WorkspaceHandle {
  /** Return to The Mantel home surface. */
  showHome(): Promise<void>;
  /** Open a module on a target (creating nothing). */
  open(target: OpenTarget): Promise<void>;
  /** Open the universal search palette. */
  openSearch(): void;
  /** The content region modules render into. */
  readonly content: HTMLElement;
}

/** Options for {@link mountWorkspace}. */
export interface WorkspaceOptions {
  /** Label for the home/brand button (defaults to "Hearth Suite"). */
  homeLabel?: string;
  /** The signed-in person's name, used for the Mantel greeting and avatar. */
  userName?: string;
  /** Open straight to this target instead of home (deep-link / new window, W28). */
  initialTarget?: OpenTarget;
  /**
   * Open a target in a new OS/browser window (W28). The host wires this to
   * Tauri's WebviewWindow on desktop, or `window.open` on the web. When absent,
   * the "Open in new window" affordance is hidden.
   */
  openWindow?: (target: OpenTarget) => void;
  /**
   * Directory / transparency-log host seams for the Seal flow (DSG-S6). When
   * wired, the seal dialog can scan a recipient's key card, show the append-only
   * transparency log for a key, and (via `changed` recipients) raise the
   * key-rotation alert. All optional, absent hooks degrade to plain
   * "available online" copy, never invented log entries.
   */
  directory?: {
    onScanKey?: () => Promise<{ name?: string; publicKey: string } | null>;
    transparencyLog?: (recipient: Recipient) => TransparencyEntry[] | Promise<TransparencyEntry[]>;
  };
  /**
   * Restore an identity from a recovery phrase during first-run onboarding
   * (seam #7). The host recovers the seed, persists it to secure storage, and
   * reopens the core (e.g. a Tauri `restore_identity` command). When omitted,
   * onboarding hides the "I already have a phrase" path. Should reject on an
   * invalid phrase so onboarding can show an error.
   */
  onRestore?: (phrase: string) => Promise<void>;
  /**
   * Schedule OS-level reminders for calendar events that have one (seam #11).
   * The host wires a per-platform scheduler (Tauri notifications on desktop,
   * Capacitor local notifications on mobile). When omitted, the in-app reminder
   * banner still fires.
   */
  onScheduleReminders?: (events: CalEvent[]) => void;
  /**
   * Transport for CalDAV/ICS calendar subscriptions (AC-CAL-3/4). Supplied by
   * the desktop/mobile entries over their native HTTP plugins so cross-origin
   * feeds bypass the web CORS sandbox. When omitted (e.g. the web preview), the
   * Calendar shows where subscriptions live and keeps `.ics` import/export.
   */
  calDavTransport?: CalDavTransport;
  /**
   * Host hooks for Settings: the build stamp shown in About and Updates
   * (AC-WIN-1), the update check and paired devices. Absent hooks fall back to
   * the honest "developer build" and seam labels.
   */
  settings?: SettingsOptions;
}

interface RailEntry {
  id: string;
  glyph: IconName;
  label: string;
}

const NAV: RailEntry[] = [
  { id: "home", glyph: "home", label: "Home" },
  { id: "writer", glyph: "writer", label: "New document" },
  { id: "sheets", glyph: "sheets", label: "New sheet" },
  { id: "records", glyph: "records", label: "New records" },
  { id: "calendar", glyph: "calendar", label: "New calendar" },
  { id: "contacts", glyph: "contact", label: "Contacts" },
];

const MODULE_TITLES: Record<ModuleId, string> = {
  writer: "Writer",
  sheets: "Sheets",
  records: "Records",
  calendar: "Calendar",
};

/** Mount the shared workspace into `root`, returning a navigation handle. */
export function mountWorkspace(
  client: HearthClient,
  root: HTMLElement,
  options: WorkspaceOptions = {},
): WorkspaceHandle {
  const homeLabel = options.homeLabel ?? "Hearth Suite";
  // The main landmark and skip-to-content target (P2-Q1). `tabindex="-1"` lets
  // the skip link move focus here without making it a tab stop otherwise.
  const content = el("main", { class: "hb-chrome__content", id: "hb-main", tabindex: "-1" });

  // Reload persisted chart live-links into the in-session bridge (seam #5), so
  // an embedded Writer chart can re-resolve its source after a reload.
  void hydrateChartBridge(client);

  // Upgrade the offline lexicon to the core's full dataset (seam #9); the
  // bundled CC0 sample stays active until (or unless) it lands.
  void hydrateLexicon(client);

  // Vault-backed preferences (seam #6, P2-CL3): theme/effort/onboarding (via the
  // design system) and Sheets "Easy Formats" style sets now persist encrypted in
  // the store and travel with sync, instead of being device-local localStorage.
  // The store is a synchronous write-through cache; hydrating it from the vault
  // can complete after first paint, so we re-apply the theme once it lands.
  const prefStorage = createVaultPreferenceStore(client, (error) => {
    toast(error instanceof Error ? error.message : "Could not save a preference.");
  });
  setPreferenceStore(prefStorage);
  void (async () => {
    try {
      await prefStorage.hydrate();
      initTheme();
    } catch {
      // Offline or store unavailable: localStorage-free defaults still apply.
    }
  })();

  const fail = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    content.replaceChildren(el("p", { class: "hb-chrome__error", role: "alert" }, message));
  };

  // --- Top bar: brand wordmark + current surface, and the on-device cue. ----
  const crumb = el("span", { class: "hb-topbar__crumb" }, "The Mantel");
  const title = el(
    "div",
    { class: "hb-topbar__title" },
    el("span", { class: "hb-topbar__brand" }, homeLabel),
    el("span", { class: "hb-topbar__sep" }, ","),
    crumb,
  );
  const device = el("span", { class: "hb-ondevice", title: "Everything stays on this device" });
  device.innerHTML = `${icon("device", 14)}<span>On your device</span>`;
  const topbar = el("header", { class: "hb-topbar" }, title, device);

  const setCrumb = (label: string): void => {
    crumb.textContent = label;
  };

  // --- Navigation rail. -----------------------------------------------------
  const railItems = new Map<string, HTMLButtonElement>();
  const setActive = (id: string): void => {
    for (const [key, button] of railItems) {
      const active = key === id;
      button.classList.toggle("is-active", active);
      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  };

  const brand = el("button", {
    class: "hb-rail__brand",
    type: "button",
    "aria-label": `${homeLabel}, all Bundles`,
    title: `${homeLabel}, all Bundles`,
  }) as HTMLButtonElement;
  brand.innerHTML = icon("flame", 26);
  brand.addEventListener("click", () => void showBundles());

  const nav = el("nav", { class: "hb-rail__nav", "aria-label": "Workspace" });
  for (const entry of NAV) {
    const button = el("button", {
      class: "hb-rail__item",
      type: "button",
      "aria-label": entry.label,
      title: entry.label,
    }) as HTMLButtonElement;
    button.innerHTML = icon(entry.glyph, 22);
    button.addEventListener("click", () => {
      if (entry.id === "home") {
        void showHome();
      } else if (entry.id === "contacts") {
        void showContacts();
      } else {
        void create(entry.id as ModuleId);
      }
    });
    railItems.set(entry.id, button);
    nav.append(button);
  }

  const helpBtn = el(
    "button",
    {
      class: "hb-rail__action hb-rail__help",
      type: "button",
      "aria-label": "Help",
      title: "Help",
    },
    "?",
  ) as HTMLButtonElement;
  helpBtn.addEventListener("click", () => showHelp());

  const themeToggle = el("button", {
    class: "hb-rail__action",
    type: "button",
  }) as HTMLButtonElement;
  const paintTheme = (): void => {
    const current = resolveTheme();
    const next = current === "dark" ? "light" : "dark";
    themeToggle.innerHTML = icon(current === "dark" ? "moon" : "sun", 20);
    themeToggle.setAttribute("aria-label", `Switch to ${next} theme`);
    themeToggle.title = `Switch to ${next} theme`;
  };
  themeToggle.addEventListener("click", () => {
    setTheme(resolveTheme() === "dark" ? "light" : "dark");
    paintTheme();
  });

  const initial = (options.userName ?? homeLabel).trim().charAt(0).toUpperCase() || "H";
  const avatar = el(
    "button",
    {
      class: "hb-rail__avatar",
      type: "button",
      "aria-label": options.userName ? `${options.userName}'s settings` : "Settings",
      title: "Settings",
    },
    initial,
  ) as HTMLButtonElement;
  avatar.addEventListener("click", () => void showSettings());

  const rail = el(
    "aside",
    { class: "hb-rail" },
    brand,
    nav,
    el("div", { class: "hb-rail__spacer" }),
    helpBtn,
    themeToggle,
    avatar,
  );

  initTheme();
  paintTheme();

  const workspace = el("div", { class: "hb-workspace" }, topbar, content);
  root.replaceChildren(el("div", { class: "hb-app" }, rail, workspace));

  // --- Navigation. ----------------------------------------------------------
  const showHome = async (): Promise<void> => {
    setActive("home");
    setCrumb("The Mantel");
    try {
      const mantel = new Mantel(createClientSource(client), {
        onOpen: (target) => void open(target),
        onCreate: (module, opts) => void create(module, opts),
        onNewBundle: () => void newBundle(),
        userName: options.userName,
      });
      await mantel.mount(content);
    } catch (error) {
      fail(error);
    }
  };

  const open = async (target: OpenTarget): Promise<void> => {
    setActive(target.module);
    setCrumb(MODULE_TITLES[target.module]);
    await mountModule(target.module, target.bundleId ?? "", target.itemId);
  };

  const create = async (module: ModuleId, opts?: CreateOptions): Promise<void> => {
    try {
      const title = opts?.title ?? `New ${MODULE_TITLES[module]}`;
      const bundle = await client.createBundle({ title });
      setActive(module);
      setCrumb(MODULE_TITLES[module]);
      await mountModule(module, bundle.id, undefined, opts);
    } catch (error) {
      fail(error);
    }
  };

  const newBundle = async (): Promise<void> => {
    try {
      await client.createBundle({ title: "New Bundle" });
      await showHome();
    } catch (error) {
      fail(error);
    }
  };

  const showBundles = async (): Promise<void> => {
    setActive("bundles");
    setCrumb("Bundles");
    try {
      await new BundlesView(client, {
        onOpen: (bundleId) => void open({ module: "writer", bundleId }),
        onNewBundle: () => void newBundle(),
        onOpenModule: (bundleId, module) => void open({ module, bundleId }),
        onImportLegacy: () => importLegacyFlow(),
        onSealBundle: (_bundleId, title, contentBase64) =>
          void new SealDialog(client, {
            subject: `the “${title}” Bundle`,
            content: () => contentBase64,
            onError: (message) => fail(message),
            onScanKey: options.directory?.onScanKey,
            transparencyLog: options.directory?.transparencyLog,
          }).open(),
      }).mount(content);
    } catch (error) {
      fail(error);
    }
  };

  const showSettings = async (): Promise<void> => {
    setActive("settings");
    setCrumb("Settings");
    try {
      await new SettingsView(client, options.settings).mount(content);
    } catch (error) {
      fail(error);
    }
  };

  /** Open the searchable, task-oriented help index (AC-WKS-G4). */
  const showHelp = (focusModule?: string): void => {
    new HelpView(client).open(focusModule);
  };

  // A pending legacy import: set when the user opens a translated Works file,
  // read once by the next editor mount, then cleared.
  let pendingImport: LegacyOpenPayload | null = null;

  /** Open the legacy Works import flow (AC-WKS-G3), translate, report, open. */
  const importLegacyFlow = (): void => {
    openLegacyImport({
      onError: (message) => toast(message, { variant: "danger", title: "Import failed" }),
      onOpen: (payload) => {
        pendingImport = payload;
        void create(payload.module as ModuleId, { title: payload.title });
      },
      // Decode real .wps/.wks/.wdb bytes via the core (seam #12 wired): the
      // desktop/mobile hosts run the native decoder, the preview returns a
      // representative sample. Both reach here through the same transport.
      decode: async (format, file) => {
        const base64 = await fileToBase64(file);
        return (await client.decodeLegacy(format, base64)) as WpsIr | WksIr | WdbIr;
      },
    });
  };

  const showContacts = async (): Promise<void> => {
    setActive("contacts");
    setCrumb("Contacts");
    try {
      new ContactsView(prefStorage).mount(content);
    } catch (error) {
      fail(error);
    }
  };

  const mountModule = async (
    module: ModuleId,
    bundleId: string,
    itemId?: string,
    create?: CreateOptions,
  ): Promise<void> => {
    // Non-fatal module errors (save, seal, merge…) surface as a toast, not a
    // full-screen failure, the editor stays put.
    const onError = (message: string): void => {
      toast(message, { variant: "danger", title: "Something went wrong" });
    };
    const seed = create ? templateSeed(create.template) : {};
    // The Portfolio collect-flow (S7): every editor offers "Add to Bundle…".
    const onAddToBundle = (payload: {
      docType: string;
      title: string;
      contentBase64: string;
    }): void =>
      void openAddToBundle(
        client,
        { ...payload, docType: payload.docType as DocType },
        () => toast("Added to your Bundle.", { variant: "success" }),
        onError,
      );
    // A pending legacy import is consumed once by this mount (PW-3.1).
    const imported = pendingImport;
    pendingImport = null;
    try {
      switch (module) {
        case "writer":
          new Writer(client, {
            bundleId,
            onError,
            initialDocument: (imported?.writerDoc as WriterDocument | undefined) ?? seed.writerDoc,
            initialBrief: create?.brief,
            // Open this document in a new OS/browser window (W28).
            onNewWindow: options.openWindow
              ? () => options.openWindow?.({ module: "writer", bundleId })
              : undefined,
            // Mailings merge sources (letters/envelopes/labels, W19/W20):
            // Contacts, every Records table, and every saved Sheets table in
            // this Bundle (the client exposes list_fields/query_rows and the
            // sheet-content reader, seam #4 closed).
            mergeSources: async (): Promise<MergeSource[]> => [
              {
                id: "contacts",
                label: "Contacts",
                kind: "contacts",
                records: contactsToMergeRecords(loadContacts(prefStorage)),
              },
              ...(await recordsMergeSources(client, bundleId)),
              ...(await sheetsMergeSources(client, bundleId)),
              // Reports the user sent to a letter (PW-2.7).
              ...(reportBridge.get(bundleId) ?? []).map((r, i) => ({
                id: `report:${i}`,
                label: `Report, ${r.name}`,
                kind: "records" as const,
                records: r.records,
              })),
            ],
            // Live-linked embedded charts resolve their data from the bridge
            // that Sheets publishes into (PW-2.5, AC-WKS-X7).
            chartDataResolver: (source) => chartBridge.get(chartKey(source)) ?? null,
            onAddToBundle,
            // Style sets persist in the vault (seam #6), not device-local
            // storage, same as Sheets, so "Easy Formats" travel with sync.
            styleStorage: prefStorage,
            // Export to PDF (print), ODF (.fodt), and Word (.doc) — real files.
            onExport: (payload) => exportWriterDocument(payload, onError),
            onSeal: (contentBase64) =>
              void new SealDialog(client, {
                subject: "this document",
                content: () => contentBase64,
                onError,
                onScanKey: options.directory?.onScanKey,
                transparencyLog: options.directory?.transparencyLog,
              }).open(),
          }).mount(content);
          break;
        case "sheets":
          new Sheets(client, {
            bundleId,
            onError,
            initialCells: (imported?.cells as Record<string, string> | undefined) ?? seed.cells,
            initialCharts: imported?.charts as never,
            // Publish chart source data for Writer's live-linked embeds.
            onPublishChartData: (source, data) => persistChartData(client, source, data),
            onAddToBundle,
            // Style sets persist in the vault (seam #6), not device-local storage.
            styleStorage: prefStorage,
          }).mount(content);
          break;
        case "records":
          await new Records(client, {
            bundleId,
            tableId: itemId,
            onError,
            // Contacts are a link source for Records (AC-WKS-S10).
            contactsProvider: () => contactsToRecordRows(loadContacts(prefStorage)),
            // A report "sent to a letter" becomes a Writer merge source (D14).
            onPublishReport: (name, records) => publishReport(bundleId, name, records),
            onAddToBundle,
            // Form Designer layout persists in the vault (seam #6), like style
            // sets — so it travels with sync, not just device-local storage.
            layoutStorage: prefStorage,
            initialData: imported?.recordsData as never,
          }).mount(content);
          break;
        case "calendar":
          // Birthdays/anniversaries from Contacts appear annually (AC-WKS-C4).
          new Calendar(client, {
            bundleId,
            onError,
            seedEvents: birthdayEvents(loadContacts(prefStorage), new Date().getFullYear()),
            onAddToBundle,
            // Schedule OS reminders via the host (seam #11); banner still fires.
            onScheduleReminders: options.onScheduleReminders,
            // CalDAV/ICS subscribe over the host's native HTTP (AC-CAL-3/4);
            // absent in the web preview, which keeps .ics import/export.
            transport: options.calDavTransport,
            // Events / to-dos / named calendars persist in the vault (seam #6),
            // so they survive reopen and travel with sync (C6).
            stateStorage: prefStorage,
          }).mount(content);
          break;
      }
      // First-time coach for this module (dismissed forever in one tap). The
      // dismiss flag persists in the vault (seam #6), so it travels with sync.
      showCoach(module, () => showHelp(module), prefStorage);
    } catch (error) {
      fail(error);
    }
  };

  // Universal search palette, opened with ⌘K / Ctrl-K from anywhere.
  const palette = new SearchPalette(createClientSource(client), (target) => void open(target));
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.isOpen) {
        palette.close();
      } else {
        void palette.open();
      }
    }
  });

  // A deep-link / new window (W28) opens straight to its document; otherwise the
  // Mantel home, with first-run onboarding overlaid on the primary window only.
  if (options.initialTarget) {
    void open(options.initialTarget);
  } else {
    void showHome();
    if (!hasOnboarded()) {
      void new Onboarding(client, {
        userName: options.userName,
        onRestore: options.onRestore,
        onDone: () => setOnboarded(),
      }).open();
    }
  }

  return { showHome, open, content, openSearch: () => void palette.open() };
}

/** Build a Writer paragraph block. */
function para(text: string, style = "body"): WriterDocument["blocks"][number] {
  return { kind: "paragraph", style, spans: [{ text }] };
}
/** Build a Writer heading block. */
function heading(text: string, level = 1): WriterDocument["blocks"][number] {
  return { kind: "heading", level, spans: [{ text }] };
}

/**
 * Seed content for a task/gallery template. Writer templates produce a starter
 * document; Sheets templates produce starter cells. Unknown ids seed nothing
 * (a blank document), so "Programs" quick-create stays empty as before.
 */
function templateSeed(template?: string): {
  writerDoc?: WriterDocument;
  cells?: Record<string, string>;
} {
  switch (template) {
    case "letter":
      return {
        writerDoc: {
          title: "Letter",
          blocks: [para("Dear …,"), para(""), para("I'm writing to …"), para(""), para("Yours, …")],
        },
      };
    case "formal-letter":
      return {
        writerDoc: {
          title: "Formal letter",
          blocks: [
            para("[Your address]"),
            para("[Date]"),
            para(""),
            para("Dear Sir or Madam,"),
            para(""),
            para("…"),
            para(""),
            para("Yours faithfully,"),
            para("[Your name]"),
          ],
        },
      };
    case "resume":
      return {
        writerDoc: {
          title: "Résumé",
          blocks: [
            heading("Your Name", 1),
            para("Town · email · phone"),
            heading("Experience", 2),
            para("Role, Employer (dates)"),
            heading("Education", 2),
            para("Qualification, School (dates)"),
          ],
        },
      };
    case "newsletter":
      return {
        writerDoc: {
          title: "Newsletter",
          blocks: [
            heading("Our Newsletter", 1),
            para("A short, friendly intro."),
            heading("News in brief", 2),
            para("• …"),
            heading("What's next", 2),
            para("…"),
          ],
        },
      };
    case "budget":
      return {
        cells: {
          A1: "Item",
          B1: "Amount",
          A2: "Income",
          A3: "Rent",
          A4: "Food",
          A5: "Travel",
          A6: "Total",
          B6: "=SUM(B2:B5)",
        },
      };
    case "invoice":
      return {
        cells: {
          A1: "Description",
          B1: "Qty",
          C1: "Price",
          A2: "",
          B2: "",
          C2: "",
          A4: "Total",
          C4: "=SUM(C2:C3)",
        },
      };
    default:
      return {};
  }
}

/** Minimal typed `createElement` helper. */
function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
