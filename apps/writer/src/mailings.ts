/**
 * The Mailings flows, Works "Form Letters", "Envelopes", and "Labels" parity
 * (AC-WKS-W19 / W20). One modal, three entry points:
 *
 *  - Letters:   merge the live letter with a chosen source (Records, Sheets, or
 *               Contacts), preview each filled copy, then create the set as
 *               documents in the Bundle or print them.
 *  - Envelopes: pick a standard size, set an optional return address, take the
 *               recipient from the source, preview, and print.
 *  - Labels:    plain-language "Which label sheet are you printing on?", lay the
 *               source's addresses across an Avery-style grid, preview, print.
 *
 * Pure layout/format logic lives in core.mjs; this file is the DOM/printing
 * shell. Nothing leaves the device.
 */

import { cls } from "@hearth/design-system";

import {
  ENVELOPE_SIZES,
  LABEL_SHEETS,
  composeFromData,
  envelopeById,
  formatAddress,
  labelSheetById,
  mergeFields,
  paginateLabels,
  spansToHtml,
} from "./core.mjs";
import type { LabelSheet, MergeRecord, WriterDocument } from "./core.mjs";

/** A merge data source surfaced by the host (one per Records table, Sheet, …). */
export interface MergeSource {
  id: string;
  label: string;
  kind: "contacts" | "records" | "sheets";
  records: MergeRecord[];
}

/** Options for {@link MailingsDialog}. */
export interface MailingsOptions {
  /** The live letter, used as the merge template and Letters preview. */
  document: () => WriterDocument;
  /** Available merge sources (lazy, read on open). */
  sources: () => Promise<MergeSource[]> | MergeSource[];
  /** Persist the generated set as documents in the Bundle. */
  onCreateDocuments?: (docs: WriterDocument[]) => Promise<void> | void;
  /** Surface a problem to the host. */
  onError?: (message: string) => void;
}

type Mode = "letters" | "envelopes" | "labels";

/** The Mailings dialog (mail merge, envelopes, labels). */
export class MailingsDialog {
  private overlay: HTMLElement | null = null;
  private sources: MergeSource[] = [];
  private sourceId = "";
  private index = 0;
  private envSizeId = ENVELOPE_SIZES[0]?.id ?? "no10";
  private returnAddress = "";
  private sheetId = LABEL_SHEETS[0]?.id ?? "avery5160";
  private startAt = 0;
  private sameText = false;
  private sameTextValue = "";
  private body: HTMLElement | null = null;

  constructor(private readonly options: MailingsOptions) {}

  openLetters(): Promise<void> {
    return this.open("letters");
  }
  openEnvelopes(): Promise<void> {
    return this.open("envelopes");
  }
  openLabels(): Promise<void> {
    return this.open("labels");
  }

  private async open(mode: Mode): Promise<void> {
    try {
      this.sources = [...(await this.options.sources())];
    } catch (error) {
      this.sources = [];
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
    this.sourceId = this.sources[0]?.id ?? "";

    const overlay = el("div", { class: "hb-modal__backdrop hb-mailings" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) this.close();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.close();
    };
    document.addEventListener("keydown", onKey);
    this.onKey = onKey;

    const card = el("div", {
      class: "hb-mailings__card",
      role: "dialog",
      "aria-label": this.title(mode),
    });
    const head = el("div", { class: "hb-mailings__head" });
    head.append(el("h2", { class: "hb-mailings__title" }, this.title(mode)));
    const close = el(
      "button",
      { class: "hb-mailings__close", type: "button", "aria-label": "Close" },
      "×",
    );
    close.addEventListener("click", () => this.close());
    head.append(close);

    this.body = el("div", { class: "hb-mailings__body" });
    card.append(head, this.body, this.renderFooter(mode));
    overlay.append(card);
    document.body.append(overlay);
    this.overlay = overlay;
    this.renderBody(mode);
  }

  private onKey: ((event: KeyboardEvent) => void) | null = null;

  private title(mode: Mode): string {
    return mode === "letters"
      ? "Mail merge, letters"
      : mode === "envelopes"
        ? "Envelopes"
        : "Labels";
  }

  private close(): void {
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }

  private activeSource(): MergeSource | undefined {
    return this.sources.find((s) => s.id === this.sourceId);
  }

  private records(): MergeRecord[] {
    return this.activeSource()?.records ?? [];
  }

  // ---- Shared controls -----------------------------------------------------

  private sourceSelect(): HTMLElement {
    const row = el("label", { class: "hb-mailings__field" });
    row.append(el("span", { class: "hb-mailings__label" }, "Merge with"));
    if (this.sources.length === 0) {
      row.append(
        el(
          "span",
          { class: "hb-mailings__hint" },
          "No data sources yet, add Contacts, a Sheet, or Records.",
        ),
      );
      return row;
    }
    const sel = el("select", { class: cls.select }) as HTMLSelectElement;
    for (const source of this.sources) {
      const opt = el("option", { value: source.id }, `${source.label} (${source.records.length})`);
      sel.append(opt);
    }
    sel.value = this.sourceId;
    sel.addEventListener("change", () => {
      this.sourceId = sel.value;
      this.index = 0;
      this.rerender();
    });
    row.append(sel);
    return row;
  }

  private mode: Mode = "letters";

  private renderBody(mode: Mode): void {
    this.mode = mode;
    this.rerender();
  }

  private rerender(): void {
    if (!this.body) return;
    if (this.mode === "letters") this.body.replaceChildren(this.lettersBody());
    else if (this.mode === "envelopes") this.body.replaceChildren(this.envelopesBody());
    else this.body.replaceChildren(this.labelsBody());
  }

  // ---- Letters -------------------------------------------------------------

  private lettersBody(): HTMLElement {
    const wrap = el("div", { class: "hb-mailings__cols" });
    const controls = el("div", { class: "hb-mailings__controls" });
    controls.append(this.sourceSelect());

    const fields = mergeFields(this.options.document());
    const hint = el("div", { class: "hb-mailings__hint" });
    hint.textContent =
      fields.length > 0
        ? `Fields in this letter: ${fields.map((f) => `{{${f}}}`).join(", ")}`
        : "This letter has no merge fields yet. Add {{field}} placeholders, e.g. {{name}}.";
    controls.append(hint);

    const count = this.records().length;
    controls.append(this.recordPager(count));
    wrap.append(controls);

    const preview = el("div", { class: "hb-mailings__preview" });
    const record = this.records()[this.index];
    if (record) {
      const [filled] = composeFromData(this.options.document(), [record]);
      preview.append(renderDocPreview(filled ?? this.options.document()));
    } else {
      preview.append(renderDocPreview(this.options.document()));
    }
    wrap.append(preview);
    return wrap;
  }

  private recordPager(count: number): HTMLElement {
    const pager = el("div", { class: "hb-mailings__pager" });
    const prev = el("button", { class: cls.button, type: "button" }, "‹ Prev");
    const next = el("button", { class: cls.button, type: "button" }, "Next ›");
    const label = el(
      "span",
      { class: "hb-mailings__count" },
      count > 0 ? `Record ${this.index + 1} of ${count}` : "No records",
    );
    prev.addEventListener("click", () => {
      this.index = Math.max(0, this.index - 1);
      this.rerender();
    });
    next.addEventListener("click", () => {
      this.index = Math.min(count - 1, this.index + 1);
      this.rerender();
    });
    if (this.index <= 0) prev.setAttribute("disabled", "");
    if (this.index >= count - 1) next.setAttribute("disabled", "");
    pager.append(prev, label, next);
    return pager;
  }

  // ---- Envelopes -----------------------------------------------------------

  private envelopesBody(): HTMLElement {
    const wrap = el("div", { class: "hb-mailings__cols" });
    const controls = el("div", { class: "hb-mailings__controls" });
    controls.append(this.sourceSelect());

    const sizeRow = el("label", { class: "hb-mailings__field" });
    sizeRow.append(el("span", { class: "hb-mailings__label" }, "Envelope size"));
    const sizeSel = el("select", { class: cls.select }) as HTMLSelectElement;
    for (const size of ENVELOPE_SIZES) sizeSel.append(el("option", { value: size.id }, size.label));
    sizeSel.value = this.envSizeId;
    sizeSel.addEventListener("change", () => {
      this.envSizeId = sizeSel.value;
      this.rerender();
    });
    sizeRow.append(sizeSel);
    controls.append(sizeRow);

    const retRow = el("label", { class: "hb-mailings__field" });
    retRow.append(el("span", { class: "hb-mailings__label" }, "Return address (optional)"));
    const ret = el("textarea", {
      class: "hb-mailings__textarea",
      rows: "3",
      placeholder: "Your name\nYour street\nYour town",
    }) as HTMLTextAreaElement;
    ret.value = this.returnAddress;
    ret.addEventListener("input", () => {
      this.returnAddress = ret.value;
      this.refreshEnvelopePreview();
    });
    retRow.append(ret);
    controls.append(retRow);

    controls.append(this.recordPager(this.records().length));
    wrap.append(controls);

    const preview = el("div", { class: "hb-mailings__preview hb-mailings__preview--canvas" });
    preview.append(this.envelopePreviewNode());
    wrap.append(preview);
    this.envPreviewHost = preview;
    return wrap;
  }

  private envPreviewHost: HTMLElement | null = null;

  private refreshEnvelopePreview(): void {
    this.envPreviewHost?.replaceChildren(this.envelopePreviewNode());
  }

  private envelopePreviewNode(): HTMLElement {
    const size = envelopeById(this.envSizeId);
    const record = this.records()[this.index];
    const scale = el("div", { class: "hb-mailings__scale" });
    scale.append(
      renderEnvelope(record ? formatAddress(record) : ["(no recipient)"], size, this.returnAddress),
    );
    return scale;
  }

  // ---- Labels --------------------------------------------------------------

  private labelsBody(): HTMLElement {
    const wrap = el("div", { class: "hb-mailings__cols" });
    const controls = el("div", { class: "hb-mailings__controls" });

    const sheetRow = el("label", { class: "hb-mailings__field" });
    sheetRow.append(
      el("span", { class: "hb-mailings__label" }, "Which label sheet are you printing on?"),
    );
    const sheetSel = el("select", { class: cls.select }) as HTMLSelectElement;
    for (const sheet of LABEL_SHEETS)
      sheetSel.append(el("option", { value: sheet.id }, sheet.label));
    sheetSel.value = this.sheetId;
    sheetSel.addEventListener("change", () => {
      this.sheetId = sheetSel.value;
      this.rerender();
    });
    sheetRow.append(sheetSel);
    controls.append(sheetRow);

    controls.append(this.sourceSelect());

    const skipRow = el("label", { class: "hb-mailings__field" });
    skipRow.append(
      el("span", { class: "hb-mailings__label" }, "Skip this many labels (for a part-used sheet)"),
    );
    const skip = el("input", {
      class: cls.input,
      type: "number",
      min: "0",
      value: String(this.startAt),
    }) as HTMLInputElement;
    skip.addEventListener("input", () => {
      this.startAt = Math.max(0, Number(skip.value) || 0);
      this.rerender();
    });
    skipRow.append(skip);
    controls.append(skipRow);

    const sameRow = el("label", { class: "hb-mailings__check" });
    const same = el("input", { type: "checkbox" }) as HTMLInputElement;
    same.checked = this.sameText;
    same.addEventListener("change", () => {
      this.sameText = same.checked;
      this.rerender();
    });
    sameRow.append(same, el("span", {}, "Use the same text on every label"));
    controls.append(sameRow);

    if (this.sameText) {
      const ta = el("textarea", {
        class: "hb-mailings__textarea",
        rows: "3",
        placeholder: "Text for every label",
      }) as HTMLTextAreaElement;
      ta.value = this.sameTextValue;
      ta.addEventListener("input", () => {
        this.sameTextValue = ta.value;
        this.refreshLabelPreview();
      });
      controls.append(ta);
    }
    wrap.append(controls);

    const preview = el("div", { class: "hb-mailings__preview hb-mailings__preview--canvas" });
    preview.append(this.labelPreviewNode());
    wrap.append(preview);
    this.labelPreviewHost = preview;
    return wrap;
  }

  private labelPreviewHost: HTMLElement | null = null;

  private refreshLabelPreview(): void {
    this.labelPreviewHost?.replaceChildren(this.labelPreviewNode());
  }

  private labelCells(): Array<MergeRecord | null> {
    return this.labelPages()[0] ?? [];
  }

  private labelPages(): Array<Array<MergeRecord | null>> {
    const sheet = labelSheetById(this.sheetId);
    const records = this.sameText
      ? Array.from({ length: sheet.across * sheet.down }, () => ({ __same: this.sameTextValue }))
      : this.records();
    return paginateLabels(records, sheet, { startAt: this.startAt });
  }

  private labelPreviewNode(): HTMLElement {
    const sheet = labelSheetById(this.sheetId);
    const scale = el("div", { class: "hb-mailings__scale" });
    scale.append(renderLabelSheet(this.labelCells(), sheet, this.sameText));
    return scale;
  }

  // ---- Footer / actions ----------------------------------------------------

  private renderFooter(mode: Mode): HTMLElement {
    const foot = el("div", { class: "hb-mailings__foot" });
    const cancel = el("button", { class: cls.button, type: "button" }, "Cancel");
    cancel.addEventListener("click", () => this.close());

    if (mode === "letters") {
      const create = el(
        "button",
        { class: `${cls.button} hb-mailings__primary`, type: "button" },
        "Create documents",
      );
      create.addEventListener("click", () => void this.createLetters());
      const print = el("button", { class: cls.button, type: "button" }, "Print all");
      print.addEventListener("click", () => this.printLetters());
      foot.append(cancel, print, create);
    } else if (mode === "envelopes") {
      const print = el(
        "button",
        { class: `${cls.button} hb-mailings__primary`, type: "button" },
        "Print envelopes",
      );
      print.addEventListener("click", () => this.printEnvelopes());
      foot.append(cancel, print);
    } else {
      const print = el(
        "button",
        { class: `${cls.button} hb-mailings__primary`, type: "button" },
        "Print labels",
      );
      print.addEventListener("click", () => this.printLabels());
      foot.append(cancel, print);
    }
    return foot;
  }

  private async createLetters(): Promise<void> {
    const records = this.records();
    if (records.length === 0) {
      this.options.onError?.("Choose a data source with at least one record.");
      return;
    }
    const docs = composeFromData(this.options.document(), records);
    try {
      await this.options.onCreateDocuments?.(docs);
      this.close();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private printLetters(): void {
    const records = this.records();
    const docs =
      records.length > 0
        ? composeFromData(this.options.document(), records)
        : [this.options.document()];
    const pages = docs.map((doc) => {
      const sheet = el("div", { class: "hb-mailings-print__letter" });
      sheet.append(renderDocPreview(doc));
      return sheet;
    });
    printSheets(pages, 210, 297);
  }

  private printEnvelopes(): void {
    const size = envelopeById(this.envSizeId);
    const records = this.records();
    const list = records.length > 0 ? records : [{}];
    const pages = list.map((record) =>
      renderEnvelope(formatAddress(record), size, this.returnAddress, true),
    );
    printSheets(pages, size.widthMm, size.heightMm);
  }

  private printLabels(): void {
    const sheet = labelSheetById(this.sheetId);
    const pages = this.labelPages().map((cells) =>
      renderLabelSheet(cells, sheet, this.sameText, true),
    );
    printSheets(pages, sheet.pageWmm, sheet.pageHmm);
  }
}

// ---- Rendering helpers ------------------------------------------------------

/** A read-only preview of a Writer document (used in the Letters preview/print). */
function renderDocPreview(doc: WriterDocument): HTMLElement {
  const page = el("div", { class: "hb-mailings__doc" });
  for (const block of doc.blocks) {
    if (block.kind === "heading") {
      const h = el(`h${block.level}`);
      h.innerHTML = spansToHtml(block.spans);
      page.append(h);
    } else if (block.kind === "table") {
      const table = el("table", { class: "hb-mailings__doc-table" });
      for (const row of block.rows) {
        const tr = el("tr");
        for (const cell of row) {
          const td = el("td");
          td.innerHTML = spansToHtml(cell);
          tr.append(td);
        }
        table.append(tr);
      }
      page.append(table);
    } else if (block.kind === "image") {
      page.append(
        el(
          "div",
          { class: "hb-mailings__doc-img" },
          block.alt ? `[image: ${block.alt}]` : "[image]",
        ),
      );
    } else if (block.kind === "chart") {
      const title = (block.spec as { title?: string } | undefined)?.title ?? "Chart";
      page.append(el("div", { class: "hb-mailings__doc-img" }, `[chart: ${title}]`));
    } else {
      const p = el("p");
      p.innerHTML = spansToHtml(block.spans) || "<br>";
      page.append(p);
    }
  }
  return page;
}

/** A single envelope sized to real millimetres, with optional return address. */
function renderEnvelope(
  addressLines: string[],
  size: { widthMm: number; heightMm: number },
  returnAddress: string,
  forPrint = false,
): HTMLElement {
  const env = el("div", { class: `hb-envelope${forPrint ? " hb-envelope--print" : ""}` });
  env.style.width = `${size.widthMm}mm`;
  env.style.height = `${size.heightMm}mm`;
  if (returnAddress.trim() !== "") {
    const ret = el("div", { class: "hb-envelope__return" });
    for (const line of returnAddress.split(/\n/)) ret.append(el("div", {}, line));
    env.append(ret);
  }
  const to = el("div", { class: "hb-envelope__to" });
  for (const line of addressLines.length > 0 ? addressLines : ["(no recipient)"]) {
    to.append(el("div", {}, line));
  }
  env.append(to);
  return env;
}

/** One label sheet: a page sized in mm with absolutely-positioned label cells. */
function renderLabelSheet(
  cells: Array<MergeRecord | null>,
  sheet: LabelSheet,
  sameText: boolean,
  forPrint = false,
): HTMLElement {
  const page = el("div", { class: `hb-label-sheet${forPrint ? " hb-label-sheet--print" : ""}` });
  page.style.width = `${sheet.pageWmm}mm`;
  page.style.height = `${sheet.pageHmm}mm`;
  cells.forEach((record, i) => {
    if (!record) return;
    const col = i % sheet.across;
    const row = Math.floor(i / sheet.across);
    const cell = el("div", { class: "hb-label-cell" });
    cell.style.left = `${sheet.marginLeftMm + col * sheet.pitchXmm}mm`;
    cell.style.top = `${sheet.marginTopMm + row * sheet.pitchYmm}mm`;
    cell.style.width = `${sheet.labelWmm}mm`;
    cell.style.height = `${sheet.labelHmm}mm`;
    const lines = sameText
      ? String((record as { __same?: string }).__same ?? "").split(/\n/)
      : formatAddress(record);
    for (const line of lines) cell.append(el("div", {}, line));
    page.append(cell);
  });
  return page;
}

/**
 * Print a set of mm-sized page elements. Injects an `@page` rule matching the
 * page size so envelopes/labels land in the right place, shows only the print
 * holder via the `@media print` rules in writer.css, then cleans up.
 */
function printSheets(pages: HTMLElement[], pageWmm: number, pageHmm: number): void {
  const holder = el("div", { class: "hb-mailings-print" });
  for (const page of pages) {
    page.classList.add("hb-mailings-print__page");
    holder.append(page);
  }
  const style = document.createElement("style");
  style.id = "hb-mailings-page";
  style.textContent = `@page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }`;
  document.head.append(style);
  document.body.append(holder);

  const cleanup = (): void => {
    holder.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  try {
    window.print();
  } finally {
    setTimeout(cleanup, 1500);
  }
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
