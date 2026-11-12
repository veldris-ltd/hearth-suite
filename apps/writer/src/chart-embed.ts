/**
 * Insert a chart into a Writer document (AC-WKS-X7). A chart is a first-class
 * embedded object: build it from pasted data, or **live-link** it to a sheet
 * range so it updates when the source data changes (via the host's
 * `chartDataResolver`). The same `@hearth/charts` renderer Sheets uses produces
 * the embedded SVG, so the look is identical and on-brand.
 */

import { cls } from "@hearth/design-system";
import {
  CHART_TYPES,
  makeChartSpec,
  renderChartSvg,
  suggestChartType,
  suggestChartReason,
} from "@hearth/charts";
import type { ChartData, ChartSource, ChartSpec, ChartType } from "@hearth/charts";

/** Options for {@link ChartDialog}. */
export interface ChartDialogOptions {
  /** Insert the finished chart object into the document at the caret. */
  onInsert: (spec: ChartSpec) => void;
  /** Resolve live data for a linked source (Sheets bridge). */
  resolver?: (source: ChartSource) => ChartData | null;
  /** The current Bundle, used to scope a live link. */
  bundleId?: string;
}

/** The Insert Chart dialog. */
export class ChartDialog {
  private overlay: HTMLElement | null = null;

  constructor(private readonly options: ChartDialogOptions) {}

  open(): void {
    const overlay = el("div", { class: "hb-modal__backdrop hb-chartins" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) this.close();
    });
    const card = el("div", {
      class: "hb-chartins__card",
      role: "dialog",
      "aria-label": "Insert chart",
    });
    card.append(el("h2", { class: "hb-chartins__title" }, "Insert chart"));

    const titleIn = el("input", {
      class: cls.input,
      placeholder: "Chart title",
    }) as HTMLInputElement;
    titleIn.value = "Chart";
    const typeSel = el("select", {
      class: cls.select,
      "aria-label": "Chart type",
    }) as HTMLSelectElement;
    for (const t of CHART_TYPES) typeSel.append(el("option", { value: t.id }, t.label));

    const dataIn = el("textarea", {
      class: "hb-chartins__data",
      rows: "6",
      placeholder:
        "Paste rows (tab- or comma-separated):\nMonth, North, South\nJan, 10, 5\nFeb, 20, 8",
    }) as HTMLTextAreaElement;
    dataIn.value = "Month, North, South\nJan, 10, 5\nFeb, 20, 8\nMar, 15, 12";

    const linkIn = el("input", {
      class: cls.input,
      placeholder: "Live-link a sheet range, e.g. Sheet1!A1:C4 (optional)",
    }) as HTMLInputElement;
    const linkNote = el("p", { class: "hb-chartins__note" });
    if (!this.options.resolver) {
      linkNote.textContent = "Pasted data is embedded as a snapshot.";
    }

    const reason = el("p", { class: "hb-chartins__note" });
    const preview = el("div", { class: "hb-chartins__preview" });
    const buildSpec = (): ChartSpec => {
      const linked = this.resolveLinked(linkIn.value);
      if (linked) {
        return makeChartSpec({
          id: "preview",
          title: titleIn.value,
          type: (typeSel.value as ChartType) || undefined,
          data: linked.data,
          source: linked.source,
        });
      }
      const grid = parsePastedGrid(dataIn.value);
      return makeChartSpec({
        id: "preview",
        title: titleIn.value,
        type: (typeSel.value as ChartType) || undefined,
        grid,
      });
    };
    const refresh = (): void => {
      preview.innerHTML = renderChartSvg(buildSpec(), { width: 320, height: 200 });
    };
    // Re-suggest a type from the current data, and keep the dropdown, the
    // suggestion text, and the preview in step (consistent with Sheets' flow).
    const propose = (): void => {
      const suggested = suggestChartType(parsePastedGrid(dataIn.value));
      typeSel.value = suggested;
      reason.textContent = `Suggested: ${CHART_TYPES.find((t) => t.id === suggested)?.label ?? suggested}, ${suggestChartReason(suggested)}`;
      refresh();
    };
    const emberBtn = el("button", { class: cls.button, type: "button" }, "Let Ember choose");
    emberBtn.addEventListener("click", () => propose());

    dataIn.addEventListener("input", propose);
    titleIn.addEventListener("input", refresh);
    typeSel.addEventListener("change", refresh);
    linkIn.addEventListener("input", () => {
      linkNote.textContent = linkIn.value.trim()
        ? this.options.resolver
          ? "Live-linked, the chart updates when the sheet changes (use Refresh)."
          : "Linking needs a host data source; pasted data will be used."
        : "Pasted data is embedded as a snapshot.";
      refresh();
    });
    propose();

    const fields = el("div", { class: "hb-chartins__fields" });
    fields.append(
      labelled("Title", titleIn),
      labelled("Type", typeSel),
      labelled("Data", dataIn),
      labelled("Live link", linkIn),
      linkNote,
      reason,
      emberBtn,
    );

    const foot = el("div", { class: "hb-chartins__foot" });
    const cancel = el("button", { class: cls.button, type: "button" }, "Cancel");
    cancel.addEventListener("click", () => this.close());
    const insert = el(
      "button",
      { class: `${cls.button} hb-chartins__primary`, type: "button" },
      "Insert chart",
    );
    insert.addEventListener("click", () => {
      const spec = buildSpec();
      spec.id = `chart-${Date.now().toString(36)}`;
      spec.title = titleIn.value.trim() || "Chart";
      this.options.onInsert(spec);
      this.close();
    });
    foot.append(cancel, insert);

    card.append(el("div", { class: "hb-chartins__cols" }, fields, preview), foot);
    overlay.append(card);
    document.body.append(overlay);
    this.overlay = overlay;
  }

  /** Resolve a `Sheet!A1:C4` link to a source + live data via the host. */
  private resolveLinked(value: string): { source: ChartSource; data: ChartData } | null {
    const text = value.trim();
    if (text === "" || !this.options.resolver) {
      return null;
    }
    const m = /^(?:([A-Za-z0-9_]+)!)?([A-Za-z]+\d+:[A-Za-z]+\d+)$/.exec(text);
    if (!m) {
      return null;
    }
    const source: ChartSource = {
      kind: "sheet",
      bundleId: this.options.bundleId,
      sheet: m[1] ?? "Sheet1",
      range: (m[2] ?? "").toUpperCase(),
    };
    const data = this.options.resolver(source);
    return data ? { source, data } : null;
  }

  private close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}

/** Parse a pasted block of rows (tab- or comma-separated) into a 2-D grid. */
export function parsePastedGrid(text: string): Array<Array<string | number>> {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) =>
      line.split(/\t|,/).map((cell) => {
        const t = cell.trim();
        const n = Number(t);
        return t !== "" && !Number.isNaN(n) ? n : t;
      }),
    );
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "hb-chartins__field" });
  wrap.append(el("span", { class: "hb-chartins__label" }, label), control);
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
