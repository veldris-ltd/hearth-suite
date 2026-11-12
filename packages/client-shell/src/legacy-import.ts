/**
 * Legacy Works import (AC-WKS-G3, AC-LEG-1/2).
 *
 * Choose a .wps/.wks/.wdb file; the bytes are decoded natively by libwps (the
 * FFI seam), then translated into Hearth Suite's models by `@hearth/legacy`, and the
 * fidelity report is shown, every approximation or loss enumerated honestly -
 * before the result opens in the right module. In the browser preview (no FFI),
 * "Try a sample" runs a representative decoded file through the same path.
 */

import { cls } from "@hearth/design-system";
import { LEGACY_FORMATS, formatImportReport, importLegacy } from "@hearth/legacy";
import type { ImportReport, WdbIr, WksIr, WpsIr } from "@hearth/legacy";

import { toast } from "./toast";

/** What the host receives to open a translated import. */
export interface LegacyOpenPayload {
  module: "writer" | "sheets" | "records";
  writerDoc?: unknown;
  cells?: Record<string, string>;
  charts?: unknown[];
  recordsData?: { fields: unknown[]; rows: Array<Record<string, unknown>> };
  title: string;
}

export interface LegacyImportOptions {
  onOpen: (payload: LegacyOpenPayload) => void;
  /** Decode a real file via libwps (Tauri). Absent in the web preview. */
  decode?: (format: string, file: File) => Promise<WpsIr | WksIr | WdbIr>;
  onError?: (message: string) => void;
}

/** Representative decoded files (the libwps output) for the preview. */
const SAMPLES: Record<string, WpsIr | WksIr | WdbIr> = {
  wps: {
    title: "Quarterly memo",
    header: "Acme Corp, Confidential",
    footer: "Page",
    blocks: [
      { kind: "heading", level: 1, runs: [{ text: "Quarterly memo" }] },
      {
        kind: "paragraph",
        style: "Body",
        runs: [
          { text: "The quarter closed " },
          { text: "strongly", bold: true },
          { text: ", with revenue up across all regions." },
        ],
        footnotes: [{ text: "Figures are unaudited." }],
      },
      {
        kind: "table",
        rows: [
          [{ text: "Region" }, { text: "Revenue" }],
          [{ text: "North" }, { text: "£42,000" }],
        ],
      },
      { kind: "paragraph", style: "Fancy Caption", runs: [{ text: "Prepared by Finance." }] },
    ],
    unsupported: [
      { kind: "WordArt", detail: "a WordArt title was dropped; its text was kept as a heading" },
    ],
  } as WpsIr,
  wks: {
    name: "Budget 2026",
    cells: [
      { ref: "A1", value: "Month" },
      { ref: "B1", value: "Spend" },
      { ref: "A2", value: "Jan" },
      { ref: "B2", value: 1200 },
      { ref: "A3", value: "Feb" },
      { ref: "B3", value: 1500 },
      { ref: "B4", formula: "SUM(B2:B3)" },
      { ref: "B5", formula: "BESSELJ(B4,1)" },
    ],
    names: [{ name: "spend", range: "B2:B3" }],
    charts: [
      {
        type: "column",
        title: "Spend by month",
        dataRange: "A1:B3",
        categories: ["Jan", "Feb"],
        series: [{ name: "Spend", values: [1200, 1500] }],
      },
      {
        type: "3-D Bar",
        title: "Spend (3-D)",
        categories: ["Jan", "Feb"],
        series: [{ name: "Spend", values: [1200, 1500] }],
      },
      { type: "radar", title: "Old radar chart" },
    ],
  } as WksIr,
  wdb: {
    name: "Members",
    fields: [
      { name: "Name", type: "text" },
      { name: "Joined", type: "date" },
      { name: "Dues", type: "currency" },
      { name: "Paid up", type: "formula", formula: "[Dues]>0" },
      { name: "Status", type: "Sentiment" },
    ],
    rows: [
      { Name: "Ada Lovelace", Joined: "2024-01-15", Dues: 40 },
      { Name: "Linus", Joined: "2023-06-01", Dues: 0 },
    ],
    filters: [
      {
        name: "Paid members",
        match: "all",
        conditions: [{ field: "Dues", op: "greater than", value: 0 }],
      },
    ],
    reports: [
      {
        name: "Dues by status",
        groupBy: "Name",
        summaries: [
          { field: "Dues", agg: "total" },
          { field: "Dues", agg: "Standard Deviation" },
        ],
      },
    ],
    reportsUnavailable: 1,
  } as WdbIr,
};

/** Open the Legacy import flow. */
export function openLegacyImport(options: LegacyImportOptions): void {
  const overlay = el("div", { class: "hb-modal__backdrop hb-legacy" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const card = el("div", {
    class: "hb-legacy__card",
    role: "dialog",
    "aria-label": "Open a Works file",
  });
  card.append(
    el("h2", { class: "hb-legacy__title" }, "Open a Microsoft Works file"),
    el(
      "p",
      { class: "hb-legacy__lead" },
      "Hearth Suite reads classic .wps documents, .wks spreadsheets and .wdb databases, and tells you exactly what carried over.",
    ),
  );

  const sel = el("select", { class: cls.input, "aria-label": "File type" }) as HTMLSelectElement;
  for (const f of LEGACY_FORMATS) sel.append(el("option", { value: f.id }, f.label));

  const body = el("div", { class: "hb-legacy__body" });

  const run = (ir: WpsIr | WksIr | WdbIr): void => {
    const format = sel.value;
    const result = importLegacy(format, ir);
    body.replaceChildren(
      renderReport(result.report),
      renderActions(format, result, options, overlay),
    );
    const flagged = result.report.items.filter(
      (i) => i.severity === "degraded" || i.severity === "lost",
    ).length;
    if (flagged > 0) {
      toast(
        `${flagged} item${flagged === 1 ? "" : "s"} need a closer look, see the import report.`,
        {
          variant: "warning",
          title: "Imported with changes",
        },
      );
    } else {
      toast("Import looks clean, everything carried over.", { variant: "success" });
    }
  };

  const fileInput = el("input", {
    class: cls.input,
    type: "file",
    accept: ".wps,.wks,.wdb",
    "aria-label": "Choose a file",
  }) as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    if (!options.decode) {
      body.replaceChildren(
        el(
          "p",
          { class: "hb-legacy__seam" },
          "Reading the file needs the native decoder (available in the desktop and mobile apps). Try a sample below to see the import report.",
        ),
      );
      return;
    }
    void options
      .decode(sel.value, file)
      .then(run)
      .catch((error) => options.onError?.(String(error)));
  });

  const sampleBtn = el("button", { class: cls.button, type: "button" }, "Try a sample");
  sampleBtn.addEventListener("click", () => run(SAMPLES[sel.value] ?? {}));

  card.append(
    labelled("File type", sel),
    el("div", { class: "hb-legacy__pick" }, fileInput, sampleBtn),
    body,
  );
  overlay.append(card);
  document.body.append(overlay);
}

function renderReport(report: ImportReport): HTMLElement {
  const wrap = el("div", { class: "hb-legacy__report" });
  wrap.append(
    el("p", { class: `hb-legacy__summary${report.ok ? " is-ok" : ""}` }, summaryLine(report)),
  );
  const groups: Array<["info" | "degraded" | "lost", string]> = [
    ["info", "Kept"],
    ["degraded", "Approximated"],
    ["lost", "Not converted"],
  ];
  for (const [sev, label] of groups) {
    const items = report.items.filter((i) => i.severity === sev);
    if (items.length === 0) continue;
    const group = el("div", { class: `hb-legacy__group hb-legacy__group--${sev}` });
    group.append(el("div", { class: "hb-legacy__group-label" }, label));
    const list = el("ul", { class: "hb-legacy__items" });
    for (const item of items) list.append(el("li", {}, `${item.area}: ${item.detail}`));
    group.append(list);
    wrap.append(group);
  }
  return wrap;
}

function summaryLine(report: ImportReport): string {
  return formatImportReport(report).split("\n")[0] ?? "Imported.";
}

function renderActions(
  format: string,
  result: {
    report: ImportReport;
    doc?: unknown;
    cells?: Record<string, string>;
    charts?: unknown[];
    fields?: unknown[];
    rows?: Array<Record<string, unknown>>;
    name?: string;
  },
  options: LegacyImportOptions,
  overlay: HTMLElement,
): HTMLElement {
  const foot = el("div", { class: "hb-legacy__foot" });
  const moduleFor = LEGACY_FORMATS.find((f) => f.id === format)?.module ?? "writer";
  const openBtn = el(
    "button",
    { class: `${cls.button} hb-legacy__primary`, type: "button" },
    `Open in ${capitalize(moduleFor)}`,
  );
  openBtn.addEventListener("click", () => {
    const payload: LegacyOpenPayload = { module: moduleFor, title: result.name ?? "Imported" };
    if (format === "wps") payload.writerDoc = result.doc;
    if (format === "wks") {
      payload.cells = result.cells;
      payload.charts = result.charts;
    }
    if (format === "wdb")
      payload.recordsData = { fields: result.fields ?? [], rows: result.rows ?? [] };
    options.onOpen(payload);
    overlay.remove();
  });
  const close = el("button", { class: cls.button, type: "button" }, "Close");
  close.addEventListener("click", () => overlay.remove());
  foot.append(close, openBtn);
  return foot;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "hb-legacy__field" });
  wrap.append(el("span", { class: "hb-legacy__field-label" }, label), control);
  return wrap;
}
function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
