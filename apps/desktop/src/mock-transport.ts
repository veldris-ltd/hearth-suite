/**
 * An in-memory {@link Transport} used only by the preview harness (`preview.ts`).
 *
 * It answers the same method surface the Tauri core does, with canned demo data,
 * so the full workspace, The Mantel and every module editor, can be rendered
 * and screenshotted in a plain browser, with no native runtime. Never shipped.
 */

import type { Transport } from "@hearth/core-client";

import { createMockStore } from "./mock-store.mjs";
import type { MockStore } from "./mock-store.mjs";

interface Bundle {
  id: string;
  title: string;
  sealed: boolean;
  document_count: number;
  updated_at?: string;
}

const BUNDLES: Bundle[] = [
  {
    id: "b1",
    title: "Board letter",
    sealed: true,
    document_count: 2,
    updated_at: "2026-06-09T16:20:00Z",
  },
  {
    id: "b2",
    title: "Budget 2026",
    sealed: false,
    document_count: 0,
    updated_at: "2026-05-28T09:05:00Z",
  },
  {
    id: "b3",
    title: "Contacts",
    sealed: false,
    document_count: 1,
    updated_at: "2026-06-02T11:40:00Z",
  },
  {
    id: "b4",
    title: "Q3 Roadmap",
    sealed: false,
    document_count: 3,
    updated_at: "2026-06-10T08:15:00Z",
  },
];

const SAMPLE_DOC = btoa(
  "<h1>Board letter</h1><p>Dear members, our quarter closed with the hearth " +
    "still warm. Everything below stays on your device.</p>",
);

// Representative decoded Works output for the dev preview only (no native
// decoder in the browser). The real desktop/mobile apps decode actual files via
// the core's `decode_legacy`.
const LEGACY_SAMPLES: Record<string, unknown> = {
  wps: {
    title: "Quarterly memo",
    blocks: [
      { kind: "heading", level: 1, runs: [{ text: "Quarterly memo" }] },
      { kind: "paragraph", style: "Body", runs: [{ text: "The quarter closed strongly." }] },
    ],
    unsupported: [
      { kind: "Fidelity", detail: "Sample data (browser preview has no native decoder)." },
    ],
  },
  wks: {
    name: "Budget 2026",
    cells: [
      { ref: "A1", value: "Month" },
      { ref: "B1", value: "Spend" },
      { ref: "A2", value: "Jan" },
      { ref: "B2", value: 1200 },
    ],
    unsupported: [
      { kind: "Fidelity", detail: "Sample data (browser preview has no native decoder)." },
    ],
  },
  wdb: {
    name: "Members",
    fields: [{ name: "Name", type: "text" }],
    rows: [{ Name: "Ada Lovelace" }],
    unsupported: [
      { kind: "Fidelity", detail: "Sample data (browser preview has no native decoder)." },
    ],
  },
};

/** A {@link Transport} backed entirely by in-memory demo data. */
export class MockTransport implements Transport {
  private readonly store: MockStore = createMockStore({
    tables: [{ bundleId: "b3", name: "Contacts" }],
  });

  constructor() {
    // Give the demo bundles real, listable documents so the Portfolio contents
    // view (and "Add to Bundle") behaves like the native store. Counts are then
    // computed live from the store, so collecting a document updates them.
    const seed = (text: string): string => btoa(text);
    this.store.saveDocument("b1", "writer", "Board letter", SAMPLE_DOC);
    this.store.saveDocument("b1", "sheet", "Q4 figures", seed("Quarter,Spend\nQ4,1200"));
    this.store.saveDocument("b3", "record", "Contacts", seed("Name,Email\nAda,ada@example.com"));
    this.store.saveDocument("b4", "writer", "Roadmap brief", seed("Q3 themes and bets."));
    this.store.saveDocument("b4", "sheet", "Timeline", seed("Phase,Weeks\nDiscovery,3"));
    this.store.saveDocument("b4", "calendar", "Milestones", seed("BEGIN:VCALENDAR\nEND:VCALENDAR"));
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    const p = (params ?? {}) as Record<string, unknown>;
    const bundleId = String(p.bundle_id ?? p.bundleId ?? p.id ?? "");
    switch (method) {
      case "list_bundles":
        // Count documents live from the store, so adding one updates the card.
        return BUNDLES.map((b) => ({
          ...b,
          document_count: this.store.listDocuments(b.id).length,
        })) as unknown as T;
      case "create_bundle": {
        const bundle: Bundle = {
          id: `b${BUNDLES.length + 1}`,
          title: String(p.title ?? "Untitled"),
          sealed: false,
          document_count: 0,
          updated_at: new Date().toISOString(),
        };
        BUNDLES.unshift(bundle);
        return bundle as unknown as T;
      }
      case "list_tables":
        return this.store.listTables(bundleId) as unknown as T;
      case "list_documents":
        return this.store.listDocuments(bundleId) as unknown as T;
      case "reorder_documents":
        return this.store.reorderDocuments(bundleId, (p.order as string[]) ?? []) as unknown as T;
      case "open_document": {
        const doc = this.store.getDocument(String(p.id ?? ""));
        return (doc.content_base64 ? doc : { content_base64: SAMPLE_DOC }) as unknown as T;
      }
      case "save_document":
        return this.store.saveDocument(
          bundleId,
          String(p.doc_type ?? "writer"),
          String(p.title ?? ""),
          String(p.content_base64 ?? ""),
        ) as unknown as T;
      case "identity_public":
        return "pk_demo_0001" as unknown as T;
      case "recovery_phrase":
        // A real, valid 24-word BIP-39 mnemonic (the all-zero-entropy test
        // vector) so the preview shows the genuine layout, not faked words.
        return ("abandon abandon abandon abandon abandon abandon abandon abandon " +
          "abandon abandon abandon abandon abandon abandon abandon abandon " +
          "abandon abandon abandon abandon abandon abandon abandon art") as unknown as T;
      case "ember_tiers":
        return [
          {
            id: "phi3-mini",
            name: "Phi-3 mini",
            gguf: "phi-3-mini.gguf",
            supports_thinking: false,
            min_ram_mb: 2355,
            mobile_default: true,
          },
          {
            id: "phi4",
            name: "Phi-4",
            gguf: "phi-4.gguf",
            supports_thinking: true,
            min_ram_mb: 8602,
            mobile_default: false,
          },
          {
            id: "nemotron-nano",
            name: "Nemotron Nano",
            gguf: "nemotron-nano.gguf",
            supports_thinking: true,
            min_ram_mb: 12288,
            mobile_default: false,
          },
        ] as unknown as T;
      case "run_ember":
        return {
          text: "Here's a calmer opening that keeps your intent.",
          model: "ember-local-7b",
          device_local: true,
        } as unknown as T;
      case "create_table":
        return this.store.createTable(bundleId, String(p.name ?? "Records")) as unknown as T;
      case "add_field":
        return this.store.addField(
          String(p.table_id ?? ""),
          String(p.name ?? ""),
          String(p.datatype ?? "text"),
        ) as unknown as T;
      case "list_fields":
        return this.store.listFields(String(p.id ?? p.table_id ?? "")) as unknown as T;
      case "insert_row":
        return this.store.insertRow(String(p.table_id ?? ""), p.values ?? []) as unknown as T;
      case "update_row":
        return this.store.updateRow(String(p.row_id ?? ""), p.values ?? []) as unknown as T;
      case "delete_row":
        return this.store.deleteRow(String(p.id ?? p.row_id ?? "")) as unknown as T;
      case "query_rows":
        return this.store.queryRows(String(p.id ?? p.table_id ?? "")) as unknown as T;
      case "decode_legacy": {
        // The preview has no native decoder; return the representative sample IR
        // for the format (the same data "Try a sample" uses), clearly demo-only.
        const fmt = String(p.format ?? "wps");
        return (LEGACY_SAMPLES[fmt] ?? {}) as unknown as T;
      }
      case "set_preference":
        return this.store.setPreference(String(p.key ?? ""), String(p.value ?? "")) as unknown as T;
      case "get_preference":
        return this.store.getPreference(String(p.key ?? "")) as unknown as T;
      case "list_preferences":
        return this.store.listPreferences() as unknown as T;
      case "sync_status":
        return { enabled: false } as unknown as T;
      case "set_sync_enabled":
        return null as unknown as T;
      case "seal":
        // The preview can't run the post-quantum crypto (that's the core's job,
        // seam #8), but it must still round-trip honestly: carry the actual
        // content in the sealed DTO so `unseal` returns what was sealed.
        return {
          manifest_base64: "bWFuaWZlc3Q=",
          content_base64: String(p.content_base64 ?? ""),
          grants: [],
          signature_base64: "c2lnbmF0dXJl",
        } as unknown as T;
      case "unseal":
        // Return the content the sealed DTO carries (what `seal` stored), not a
        // fixed sample — so seal → unseal recovers *your* document. Falls back
        // to the demo doc only for a seeded already-sealed bundle with no blob.
        return { content_base64: String(p.content_base64 ?? "") || SAMPLE_DOC } as unknown as T;
      case "verify":
        // Real signature verification is the core's (tested in the seal crate +
        // FFI); the preview has no keys, so it only confirms a well-formed DTO.
        return Boolean((p as { signature_base64?: string }).signature_base64) as unknown as T;
      default:
        return null as unknown as T;
    }
  }
}
