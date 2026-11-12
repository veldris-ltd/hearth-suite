/**
 * Hearth Suite Sheets, a spreadsheet over the formula engine and workbook model in
 * `core.mjs`.
 *
 * Parity-plus with classic Works: the full function library, AutoSum, fill
 * series, range names, freeze panes, cell/sheet protection, number formats
 * (currency/percent/date/leading zeros), preset table formats, find & replace,
 * and print areas with headers/footers. A Formula Helper stepper walks novices
 * through choosing and filling a function (Easy Calc heir), beside Ember
 * natural-language entry. Multi-sheet workbooks are core, with a graceful
 * single-sheet default, tabs only appear once a second sheet is added.
 */

import type { EmberRequest, FieldValue, HearthClient } from "@hearth/core-client";
import {
  cls,
  EmberPanel,
  icon,
  makeStyleSet,
  saveCustomStyleSet,
  styleSetCss,
  styleSetsFor,
  type PreferenceStorage,
  type StyleSet,
} from "@hearth/design-system";

import {
  Workbook,
  NUMBER_FORMATS,
  autoSumFormula,
  buildFormulaRequest,
  dataTableToRecords,
  explainFormula,
  fillSeries,
  fillRangeRefs,
  formatNumber,
} from "./core.mjs";
import type { CellValue, Sheet as SheetType } from "./core.mjs";
import {
  CHART_TYPES,
  extractChartData,
  makeChartSpec,
  renderChartSvg,
  suggestChartType,
  suggestChartReason,
} from "@hearth/charts";
import type { ChartData, ChartSource, ChartSpec, ChartType } from "@hearth/charts";
import { FormulaHelper } from "./formula-helper";

/** Host hooks for the Sheets editor. */
export interface SheetsOptions {
  bundleId: string;
  rows?: number;
  cols?: number;
  /** Starter cells keyed by reference (e.g. from a Mantel template). */
  initialCells?: Record<string, string>;
  /** Starter charts (e.g. re-created from a legacy .wks import). */
  initialCharts?: ChartSpec[];
  /**
   * Publish a chart's source data so Writer can live-link to it (the Sheets→
   * Writer chart bridge). Called whenever a chart renders with fresh values.
   */
  onPublishChartData?: (source: ChartSource, data: ChartData) => void;
  /** Send the current sheet into a chosen Bundle (Portfolio collect-flow). */
  onAddToBundle?: (payload: { docType: string; title: string; contentBase64: string }) => void;
  /**
   * Where custom "Easy Formats" style sets are stored. Defaults to
   * `localStorage`; the client shell injects a vault-backed adapter so style
   * sets persist encrypted and travel with sync (P2-CL3).
   */
  styleStorage?: PreferenceStorage;
  onError?: (message: string) => void;
}

/** Preset table formats (the "AutoFormat" heir). */
const TABLE_FORMATS = [
  { id: "none", label: "Plain" },
  { id: "banded", label: "Banded rows" },
  { id: "headline", label: "Bold header" },
  { id: "grid", label: "Full grid" },
  { id: "ledger", label: "Ledger (header + banded + grid)" },
];

/** Per-sheet UI state that lives alongside the pure cell data. */
interface SheetUi {
  formats: Map<string, string>;
  styles: Map<string, StyleSet>;
  protectedCells: Set<string>;
  protectedSheet: boolean;
  freezeRows: number;
  freezeCols: number;
  tableFormat: string;
  header: string;
  footer: string;
  printArea: string | null;
  charts: ChartSpec[];
  /** Per-column pixel widths, 0-based column index → px (absent = default). */
  columnWidths: Map<number, number>;
}

/** The Sheets editor. */
export class Sheets {
  private readonly workbook = new Workbook();
  private activeName: string;
  private readonly ui = new Map<string, SheetUi>();
  private readonly rows: number;
  private readonly cols: number;
  private active = "A1";
  private ember: EmberPanel<EmberRequest> | undefined;
  private styleMenuWrap: HTMLElement | undefined;
  private root: HTMLElement | undefined;
  private gridHost: HTMLElement | undefined;
  private formulaBar: HTMLInputElement | undefined;
  private nameBox: HTMLInputElement | undefined;
  private tabsHost: HTMLElement | undefined;
  private findBar: HTMLElement | undefined;
  private chartsHost: HTMLElement | undefined;
  private chartSeq = 0;
  private measureCanvas: HTMLCanvasElement | undefined;
  // Undo/redo history of the active sheet's cells (AC-WKS-X1, "with undo").
  private undoStack: Array<{ name: string; cells: Map<string, string> }> = [];
  private redoStack: Array<{ name: string; cells: Map<string, string> }> = [];

  constructor(
    private readonly client: HearthClient,
    private readonly options: SheetsOptions,
  ) {
    this.rows = options.rows ?? 16;
    this.cols = options.cols ?? 8;
    this.activeName = this.workbook.names()[0] ?? "Sheet1";
    const ui = freshUi();
    if (options.initialCharts && options.initialCharts.length > 0) {
      ui.charts.push(...options.initialCharts);
    }
    this.ui.set(this.activeName, ui);
    for (const [ref, raw] of Object.entries(options.initialCells ?? {})) {
      this.sheet().setCell(ref, raw);
    }
  }

  /** Set a cell's raw content programmatically. */
  set(ref: string, raw: string): void {
    this.sheet().setCell(ref, raw);
  }

  private sheet(): SheetType {
    return this.workbook.sheet(this.activeName) as SheetType;
  }

  private curUi(): SheetUi {
    let state = this.ui.get(this.activeName);
    if (!state) {
      state = freshUi();
      this.ui.set(this.activeName, state);
    }
    return state;
  }

  /** Render the editor into `root`. */
  mount(root: HTMLElement): void {
    this.root = root;
    const shell = el("div", { class: "hb-sheets" });
    this.formulaBar = el("input", {
      class: cls.input,
      "aria-label": "Formula bar",
    }) as HTMLInputElement;
    this.nameBox = el("input", {
      class: "hb-sheets__namebox",
      "aria-label": "Cell or range name",
      title: "Cell reference, type a name to define one",
    }) as HTMLInputElement;
    this.gridHost = el("div", { class: "hb-sheets__gridwrap" });
    this.tabsHost = el("div", { class: "hb-sheets__tabs" });
    this.findBar = this.renderFindBar();
    this.chartsHost = el("div", { class: "hb-sheets__charts" });

    shell.append(
      this.renderHeader(),
      this.renderToolbar(),
      this.renderFormulaRow(),
      this.findBar,
      this.gridHost,
      this.tabsHost,
      this.chartsHost,
      this.renderEmber(),
    );
    root.replaceChildren(shell);
    this.renderGrid();
    this.renderTabs();
    this.renderCharts();
  }

  private renderHeader(): HTMLElement {
    const header = el("div", { class: "hb-sheets__header" });
    const titles = el(
      "div",
      {},
      el("h1", { class: "hb-sheets__title" }, "Sheet"),
      el("p", { class: "hb-sheets__meta" }, `${this.cols} columns · ${this.rows} rows`),
    );
    const enc = el("span", { class: "hb-sheets__enc" });
    enc.innerHTML = `${icon("lock", 14)}<span>Encrypted on this device</span>`;
    header.append(titles, enc);
    return header;
  }

  // ---- toolbar -------------------------------------------------------------

  private renderToolbar(): HTMLElement {
    const bar = el("div", { class: "hb-sheets__toolbar", role: "toolbar" });
    bar.append(
      iconButton("Σ", "AutoSum", () => this.autoSum()),
      button("Fill down", () => this.fillDown()),
      this.renderGridMenu(),
      iconButton("↶", "Undo", () => this.undo()),
      iconButton("↷", "Redo", () => this.redo()),
      this.renderFormatMenu(),
      this.renderTableMenu(),
      this.renderStyles(),
      button("Freeze", () => this.toggleFreeze()),
      button("Protect", () => this.toggleProtect()),
      button("Find", () => this.toggleFind()),
      button("ƒx Helper", () => this.openFormulaHelper()),
      button("New chart", () => this.openNewChart()),
      button("Print", () => this.openPrint()),
      button("Promote to Records", () => void this.promoteToRecords()),
    );
    if (this.options.onAddToBundle) {
      bar.append(button("Add to Bundle", () => this.addToBundle()));
    }
    return bar;
  }

  /** Send the current sheet (as CSV) into a chosen Bundle (Portfolio S7). */
  private addToBundle(): void {
    const lines: string[] = [];
    for (let r = 1; r <= this.rows; r += 1) {
      const row = range(this.cols).map((c) => this.display(`${colName(c)}${r}`));
      if (row.some((v) => v !== "")) {
        lines.push(row.map((v) => (v.includes(",") ? `"${v}"` : v)).join(","));
      }
    }
    this.options.onAddToBundle?.({
      docType: "sheet",
      title: "Sheet",
      contentBase64: toBase64(lines.join("\n")),
    });
  }

  private renderFormatMenu(): HTMLElement {
    const sel = el("select", {
      class: cls.select,
      "aria-label": "Number format",
      title: "Number format",
    }) as HTMLSelectElement;
    for (const fmt of NUMBER_FORMATS) {
      sel.append(el("option", { value: fmt.id }, fmt.label));
    }
    sel.addEventListener("change", () => this.setFormat(sel.value));
    return sel;
  }

  private renderTableMenu(): HTMLElement {
    const sel = el("select", {
      class: cls.select,
      "aria-label": "Table format",
      title: "Table format",
    }) as HTMLSelectElement;
    sel.append(el("option", { value: "" }, "Table format…"));
    for (const fmt of TABLE_FORMATS) {
      sel.append(el("option", { value: fmt.id }, fmt.label));
    }
    sel.addEventListener("change", () => {
      if (sel.value) {
        this.applyTableFormat(sel.value);
        sel.value = "";
      }
    });
    return sel;
  }

  // ---- insert/delete rows & columns + undo (AC-WKS-X1) ---------------------

  private renderGridMenu(): HTMLElement {
    const sel = el("select", {
      class: cls.select,
      "aria-label": "Insert or delete rows and columns",
      title: "Insert or delete rows and columns",
    }) as HTMLSelectElement;
    sel.append(
      el("option", { value: "" }, "Rows / columns…"),
      el("option", { value: "ir" }, "Insert row above"),
      el("option", { value: "dr" }, "Delete this row"),
      el("option", { value: "ic" }, "Insert column left"),
      el("option", { value: "dc" }, "Delete this column"),
    );
    sel.addEventListener("change", () => {
      const { col, row } = parseRef(this.active);
      if (sel.value === "ir") this.spliceActive("row", row - 1, 1);
      else if (sel.value === "dr") this.spliceActive("row", row - 1, -1);
      else if (sel.value === "ic") this.spliceActive("col", col, 1);
      else if (sel.value === "dc") this.spliceActive("col", col, -1);
      sel.value = "";
    });
    return sel;
  }

  /** Snapshot the active sheet's cells so the next change can be undone. */
  private snapshot(): void {
    this.undoStack.push({ name: this.activeName, cells: new Map(this.sheet().cells) });
    if (this.undoStack.length > 100) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      return;
    }
    const sheet = this.workbook.sheet(prev.name) as SheetType;
    this.redoStack.push({ name: prev.name, cells: new Map(sheet.cells) });
    sheet.cells = prev.cells;
    this.renderGrid();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) {
      return;
    }
    const sheet = this.workbook.sheet(next.name) as SheetType;
    this.undoStack.push({ name: next.name, cells: new Map(sheet.cells) });
    sheet.cells = next.cells;
    this.renderGrid();
  }

  /** Insert/delete a row or column at `at` (0-based), then re-render. */
  private spliceActive(axis: "row" | "col", at: number, delta: number): void {
    if (at < 0) {
      return;
    }
    this.snapshot();
    this.sheet().spliceLines(axis, at, delta);
    this.shiftSheetUi(axis, at, delta);
    this.renderGrid();
  }

  /** Keep cell formats, styles, and protection aligned with shifted cells. */
  private shiftSheetUi(axis: "row" | "col", at: number, delta: number): void {
    const ui = this.curUi();
    const shiftRef = (ref: string): string | null => {
      const { col, row } = parseRef(ref);
      const idx = axis === "row" ? row - 1 : col;
      let ni: number;
      if (delta < 0) {
        if (idx >= at && idx < at - delta) return null;
        ni = idx >= at - delta ? idx + delta : idx;
      } else {
        ni = idx >= at ? idx + delta : idx;
      }
      return axis === "row" ? `${colName(col)}${ni + 1}` : `${colName(ni)}${row}`;
    };
    const remap = <T>(m: Map<string, T>): Map<string, T> => {
      const next = new Map<string, T>();
      for (const [ref, value] of m) {
        const nr = shiftRef(ref);
        if (nr) next.set(nr, value);
      }
      return next;
    };
    ui.formats = remap(ui.formats);
    ui.styles = remap(ui.styles);
    const locked = new Set<string>();
    for (const ref of ui.protectedCells) {
      const nr = shiftRef(ref);
      if (nr) locked.add(nr);
    }
    ui.protectedCells = locked;
  }

  // ---- cell style sets ("Easy Formats" heir) -------------------------------

  private renderStyles(): HTMLElement {
    const wrap = el("div", { class: "hb-stylemenu" });
    const toggle = el(
      "button",
      { class: cls.button, type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
      "Styles ▾",
    );
    toggle.addEventListener("click", () => {
      const open = wrap.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    wrap.append(toggle, this.buildStylePop());
    this.styleMenuWrap = wrap;
    return wrap;
  }

  private buildStylePop(): HTMLElement {
    const pop = el("div", { class: "hb-stylemenu__pop", role: "menu" });
    for (const set of styleSetsFor(this.options.bundleId, "sheets", this.options.styleStorage)) {
      const item = el("button", {
        class: "hb-stylemenu__item",
        type: "button",
        role: "menuitem",
        title: `Apply ${set.name} to the selected cell`,
      });
      const preview = el("span", { class: "hb-stylemenu__preview" }, set.name);
      preview.setAttribute("style", styleSetCss(set));
      item.append(preview);
      if (!set.builtin) {
        item.append(el("span", { class: "hb-stylemenu__tag" }, "Yours"));
      }
      item.addEventListener("click", () => {
        this.applyCellStyle(set);
        this.closeStyleMenu();
      });
      pop.append(item);
    }
    const save = el(
      "button",
      { class: "hb-stylemenu__save", type: "button", role: "menuitem" },
      "✚ Save this look as a style",
    );
    save.addEventListener("click", () => {
      this.closeStyleMenu();
      this.saveCellLook();
    });
    pop.append(save);
    return pop;
  }

  private closeStyleMenu(): void {
    this.styleMenuWrap?.classList.remove("is-open");
    this.styleMenuWrap?.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
  }

  private applyCellStyle(set: StyleSet): void {
    this.curUi().styles.set(this.active, set);
    const cell = this.cellNode(this.active);
    cell?.setAttribute("style", styleSetCss(set));
  }

  private saveCellLook(): void {
    if (typeof getComputedStyle !== "function") {
      return;
    }
    const cell = this.cellNode(this.active);
    if (!cell) {
      return;
    }
    const cs = getComputedStyle(cell);
    const css = [
      `font-weight: ${cs.fontWeight}`,
      `font-style: ${cs.fontStyle}`,
      `color: ${cs.color}`,
      `text-align: ${cs.textAlign}`,
      `background: ${cs.backgroundColor}`,
    ].join("; ");
    const name =
      typeof prompt === "function" ? prompt("Save this cell look as a style, name it:") : null;
    if (!name || name.trim() === "") {
      return;
    }
    const set = makeStyleSet({ name, scope: "sheets", kind: "cell", css });
    saveCustomStyleSet(this.options.bundleId, set, this.options.styleStorage);
    const old = this.styleMenuWrap?.querySelector(".hb-stylemenu__pop");
    if (old) {
      old.replaceWith(this.buildStylePop());
    }
  }

  // ---- formula row (name box + formula bar) --------------------------------

  private renderFormulaRow(): HTMLElement {
    const row = el("div", { class: "hb-sheets__formula" });
    const nameBox = this.nameBox as HTMLInputElement;
    nameBox.value = this.active;
    nameBox.addEventListener("change", () => this.handleNameBox(nameBox.value));
    const fx = el("span", { class: "hb-sheets__fx" }, "ƒx");
    const bar = this.formulaBar as HTMLInputElement;
    bar.addEventListener("change", () => {
      this.setCell(this.active, bar.value);
      this.renderGrid();
    });
    row.append(nameBox, fx, bar);
    return row;
  }

  /** The name box: go to a ref, or define a named range when given a word. */
  private handleNameBox(value: string): void {
    const text = value.trim();
    if (text === "") {
      return;
    }
    if (/^[A-Za-z]+\d+$/.test(text)) {
      this.active = text.toUpperCase();
      this.focusActive();
      return;
    }
    // A name → define it over the current cell or a prompted range.
    const target =
      typeof prompt === "function"
        ? prompt(`Define "${text}" as which cell or range? (e.g. A1:A10)`, this.active)
        : this.active;
    if (target && target.trim() !== "") {
      this.sheet().setName(text, target.trim().toUpperCase());
    }
    if (this.nameBox) this.nameBox.value = this.active;
  }

  // ---- grid ----------------------------------------------------------------

  private renderGrid(): void {
    const host = this.gridHost;
    if (!host) {
      return;
    }
    const ui = this.curUi();
    const table = el("table", { class: `hb-sheets__grid hb-sheets__grid--${ui.tableFormat}` });
    if (ui.freezeRows > 0) table.classList.add("hb-sheets--freeze-row");
    if (ui.freezeCols > 0) table.classList.add("hb-sheets--freeze-col");

    const head = el("tr");
    head.append(el("th", { class: "hb-sheets__corner" }, ""));
    for (let c = 0; c < this.cols; c += 1) {
      const th = el("th", { class: "hb-sheets__colhead", "data-col": String(c) }, colName(c));
      const w = ui.columnWidths.get(c);
      if (w) th.style.inlineSize = `${w}px`;
      // A resize grip on the right edge: drag to size, double-click to autofit.
      const grip = el("span", { class: "hb-sheets__col-resize", "aria-hidden": "true" });
      grip.addEventListener("pointerdown", (event) =>
        this.beginColumnResize(c, event as PointerEvent),
      );
      grip.addEventListener("dblclick", () => this.autofitColumn(c));
      th.append(grip);
      head.append(th);
    }
    table.append(head);

    for (let r = 1; r <= this.rows; r += 1) {
      const tr = el("tr");
      tr.append(el("th", { class: "hb-sheets__rowhead" }, String(r)));
      for (let c = 0; c < this.cols; c += 1) {
        const ref = `${colName(c)}${r}`;
        const cell = el("input", {
          class: "hb-sheets__cell",
          "data-ref": ref,
          "data-col": String(c),
        }) as HTMLInputElement;
        const w = ui.columnWidths.get(c);
        if (w) cell.style.inlineSize = `${w}px`;
        const style = ui.styles.get(ref);
        if (style) {
          cell.setAttribute("style", styleSetCss(style));
        }
        if (this.isProtected(ref)) {
          cell.classList.add("is-locked");
        }
        cell.value = this.display(ref);
        // A per-cell dirty flag: only an actual edit writes back to the model,
        // so tabbing through cells never stores a formatted display string.
        let dirty = false;
        cell.addEventListener("focus", () => {
          this.active = ref;
          if (this.nameBox) this.nameBox.value = ref;
          cell.value = this.sheet().cells.get(ref) ?? "";
          dirty = false;
          if (this.formulaBar) this.formulaBar.value = cell.value;
        });
        cell.addEventListener("input", () => {
          dirty = true;
        });
        cell.addEventListener("blur", () => {
          if (this.isProtected(ref)) {
            cell.value = this.display(ref);
            return;
          }
          if (dirty) {
            this.snapshot();
            this.setCell(ref, cell.value);
            this.refresh();
          }
          cell.value = this.display(ref);
        });
        const td = el("td", { class: "hb-sheets__cell-td" }, cell);
        // A fill handle (shown on the focused cell via CSS): drag to fill a
        // series down or right, reusing fillSeries. Keep focus on pointerdown.
        const fill = el("span", { class: "hb-sheets__fill-handle", "aria-hidden": "true" });
        fill.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          this.beginDragFill(ref, event as PointerEvent);
        });
        td.append(fill);
        tr.append(td);
      }
      table.append(tr);
    }
    host.replaceChildren(table);
  }

  private setCell(ref: string, raw: string): void {
    if (this.isProtected(ref)) {
      this.options.onError?.("This cell is protected. Unprotect the sheet to edit it.");
      return;
    }
    this.sheet().setCell(ref, raw);
  }

  private refresh(): void {
    const table = this.gridHost?.querySelector("table");
    if (!table) {
      return;
    }
    for (const node of table.querySelectorAll("input.hb-sheets__cell")) {
      const cell = node as HTMLInputElement;
      const ref = cell.dataset.ref ?? "";
      if (document.activeElement !== cell) {
        cell.value = this.display(ref);
      }
    }
    // Charts are live-linked to their source range, refresh them with the data.
    this.renderCharts();
  }

  /** The display string for a cell: a computed value under its number format. */
  private display(ref: string): string {
    const value = this.sheet().valueOf(ref);
    const format = this.curUi().formats.get(ref);
    return format ? formatNumber(value, format) : text(value);
  }

  private cellNode(ref: string): HTMLInputElement | undefined {
    return (
      this.root?.querySelector<HTMLInputElement>(`.hb-sheets__cell[data-ref="${ref}"]`) ?? undefined
    );
  }

  private focusActive(): void {
    this.cellNode(this.active)?.focus();
  }

  // ---- AutoSum & fill ------------------------------------------------------

  private autoSum(): void {
    const formula = autoSumFormula((ref) => this.sheet().valueOf(ref), this.active);
    this.snapshot();
    this.setCell(this.active, formula);
    this.renderGrid();
    if (this.formulaBar) this.formulaBar.value = formula;
  }

  /** Fill the active cell's column downward from the run of cells above it. */
  private fillDown(): void {
    this.snapshot();
    const { col, row } = parseRef(this.active);
    const seed: CellValue[] = [];
    for (let r = 1; r < row; r += 1) {
      const raw = this.sheet().cells.get(`${colName(col)}${r}`);
      seed.push(raw === undefined || raw === "" ? null : numericOrText(raw));
    }
    const trimmed = trimLeadingBlanks(seed);
    const count = this.rows - row + 1;
    const series = fillSeries(
      trimmed.length > 0 ? trimmed : [numericOrText(this.sheet().cells.get(this.active) ?? "")],
      count,
    );
    for (let i = 0; i < count; i += 1) {
      const ref = `${colName(col)}${row + i}`;
      if (!this.isProtected(ref)) {
        this.sheet().setCell(ref, String(series[i] ?? ""));
      }
    }
    this.renderGrid();
  }

  // ---- column resize / autofit (AC-WKS-X1) ---------------------------------

  /** Set a column's pixel width and apply it live to the header + every cell. */
  private applyColumnWidth(col: number, width: number): void {
    const w = Math.round(Math.max(48, Math.min(640, width)));
    this.curUi().columnWidths.set(col, w);
    this.root
      ?.querySelectorAll<HTMLElement>(
        `.hb-sheets__colhead[data-col="${col}"], .hb-sheets__cell[data-col="${col}"]`,
      )
      .forEach((node) => {
        node.style.inlineSize = `${w}px`;
      });
  }

  /** Drag the column-header grip to resize. */
  private beginColumnResize(col: number, start: PointerEvent): void {
    start.preventDefault();
    const th = this.root?.querySelector<HTMLElement>(`.hb-sheets__colhead[data-col="${col}"]`);
    const startWidth = th?.getBoundingClientRect().width ?? 96;
    const startX = start.clientX;
    const move = (event: PointerEvent): void =>
      this.applyColumnWidth(col, startWidth + (event.clientX - startX));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Size a column to fit its widest visible value (double-click the grip). */
  private autofitColumn(col: number): void {
    this.applyColumnWidth(col, this.measureColumn(col));
  }

  private measureColumn(col: number): number {
    this.measureCanvas ??= document.createElement("canvas");
    const ctx = this.measureCanvas.getContext("2d");
    if (!ctx) {
      return 96;
    }
    const sample = this.root?.querySelector(".hb-sheets__cell");
    ctx.font = (sample && getComputedStyle(sample).font) || "13px sans-serif";
    let max = ctx.measureText(colName(col)).width;
    for (let r = 1; r <= this.rows; r += 1) {
      const value = this.display(`${colName(col)}${r}`);
      if (value) {
        max = Math.max(max, ctx.measureText(value).width);
      }
    }
    return max + 28; // input padding + a little breathing room
  }

  // ---- drag-fill (AC-WKS-X1) -----------------------------------------------

  /** Drag the active cell's fill handle to extend a series down or right. */
  private beginDragFill(fromRef: string, start: PointerEvent): void {
    start.preventDefault();
    let target = fromRef;
    const move = (event: PointerEvent): void => {
      const node = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const ref = node?.closest?.("[data-ref]")?.getAttribute("data-ref");
      if (ref) {
        target = ref;
        this.previewFillRange(fromRef, target);
      }
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.clearFillPreview();
      this.applyDragFill(fromRef, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private fillRefs(fromRef: string, toRef: string): string[] {
    return fillRangeRefs(fromRef, toRef);
  }

  private previewFillRange(fromRef: string, toRef: string): void {
    this.clearFillPreview();
    for (const ref of this.fillRefs(fromRef, toRef)) {
      this.cellNode(ref)?.classList.add("is-fill-target");
    }
  }

  private clearFillPreview(): void {
    this.root
      ?.querySelectorAll(".hb-sheets__cell.is-fill-target")
      .forEach((n) => n.classList.remove("is-fill-target"));
  }

  private applyDragFill(fromRef: string, toRef: string): void {
    const refs = this.fillRefs(fromRef, toRef);
    if (refs.length === 0) {
      return;
    }
    const from = parseRef(fromRef);
    const to = parseRef(toRef);
    const vertical = Math.abs(to.row - from.row) >= Math.abs(to.col - from.col);
    // Seed from the contiguous run ending at (and including) the active cell,
    // read in the fill axis — so [1,2] extrapolates to 3,4,5 (like fillDown).
    const seed: CellValue[] = [];
    if (vertical) {
      for (let r = 1; r <= from.row; r += 1)
        seed.push(this.cellSeedValue(`${colName(from.col)}${r}`));
    } else {
      for (let c = 0; c <= from.col; c += 1)
        seed.push(this.cellSeedValue(`${colName(c)}${from.row}`));
    }
    const trimmed = trimLeadingBlanks(seed);
    const series = fillSeries(
      trimmed.length > 0 ? trimmed : [this.cellSeedValue(fromRef)],
      refs.length,
    );
    this.snapshot();
    refs.forEach((ref, i) => {
      if (!this.isProtected(ref)) {
        this.sheet().setCell(ref, String(series[i] ?? ""));
      }
    });
    this.renderGrid();
  }

  private cellSeedValue(ref: string): CellValue {
    const raw = this.sheet().cells.get(ref);
    return raw === undefined || raw === "" ? null : numericOrText(raw);
  }

  // ---- number & table formats ----------------------------------------------

  private setFormat(id: string): void {
    if (id === "general") {
      this.curUi().formats.delete(this.active);
    } else {
      this.curUi().formats.set(this.active, id);
    }
    this.refresh();
  }

  private applyTableFormat(id: string): void {
    this.curUi().tableFormat = id;
    this.renderGrid();
  }

  // ---- freeze & protect ----------------------------------------------------

  private toggleFreeze(): void {
    const ui = this.curUi();
    const frozen = ui.freezeRows > 0 || ui.freezeCols > 0;
    ui.freezeRows = frozen ? 0 : 1;
    ui.freezeCols = frozen ? 0 : 1;
    this.renderGrid();
  }

  private toggleProtect(): void {
    const ui = this.curUi();
    ui.protectedSheet = !ui.protectedSheet;
    this.options.onError?.(
      ui.protectedSheet ? "Sheet protected, cells are read-only." : "Sheet unprotected.",
    );
    this.renderGrid();
  }

  private isProtected(ref: string): boolean {
    const ui = this.curUi();
    return ui.protectedSheet || ui.protectedCells.has(ref);
  }

  // ---- find & replace ------------------------------------------------------

  private renderFindBar(): HTMLElement {
    const bar = el("div", { class: "hb-sheets__find", hidden: "" });
    const find = el("input", { class: cls.input, placeholder: "Find" }) as HTMLInputElement;
    const replace = el("input", {
      class: cls.input,
      placeholder: "Replace with",
    }) as HTMLInputElement;
    const status = el("span", { class: "hb-sheets__find-status" });
    const go = button("Replace all", () => {
      const n = this.replaceAll(find.value, replace.value);
      status.textContent = `${n} replaced`;
      this.renderGrid();
    });
    const close = el(
      "button",
      { class: cls.button, type: "button", "aria-label": "Close find" },
      "×",
    );
    close.addEventListener("click", () => this.toggleFind());
    bar.append(find, replace, go, status, close);
    return bar;
  }

  private toggleFind(): void {
    const bar = this.findBar;
    if (!bar) {
      return;
    }
    if (bar.hasAttribute("hidden")) {
      bar.removeAttribute("hidden");
      bar.querySelector("input")?.focus();
    } else {
      bar.setAttribute("hidden", "");
    }
  }

  private replaceAll(find: string, replace: string): number {
    if (find === "") {
      return 0;
    }
    let count = 0;
    for (const [ref, raw] of this.sheet().cells) {
      if (typeof raw === "string" && raw.includes(find) && !this.isProtected(ref)) {
        const next = raw.split(find).join(replace);
        if (next !== raw) {
          this.sheet().setCell(ref, next);
          count += 1;
        }
      }
    }
    return count;
  }

  // ---- Formula Helper ------------------------------------------------------

  private openFormulaHelper(): void {
    new FormulaHelper((formula) => {
      this.setCell(this.active, formula);
      this.renderGrid();
      if (this.formulaBar) this.formulaBar.value = formula;
    }).open();
  }

  // ---- multi-sheet tabs ----------------------------------------------------

  private renderTabs(): void {
    const host = this.tabsHost;
    if (!host) {
      return;
    }
    const names = this.workbook.names();
    host.replaceChildren();
    // Single-sheet default: no tabs until the user adds a second sheet.
    if (names.length > 1) {
      for (const name of names) {
        const tab = el(
          "button",
          {
            class: `hb-sheets__tab${name === this.activeName ? " is-active" : ""}`,
            type: "button",
          },
          name,
        );
        tab.addEventListener("click", () => this.switchSheet(name));
        tab.addEventListener("dblclick", () => this.renameSheet(name));
        host.append(tab);
      }
    }
    const add = el(
      "button",
      { class: "hb-sheets__tab-add", type: "button", title: "Add a sheet" },
      "+",
    );
    add.addEventListener("click", () => this.addSheet());
    host.append(add);
  }

  private addSheet(): void {
    const existing = new Set(this.workbook.names());
    let n = existing.size + 1;
    let name = `Sheet${n}`;
    while (existing.has(name)) {
      n += 1;
      name = `Sheet${n}`;
    }
    this.workbook.addSheet(name);
    this.ui.set(name, freshUi());
    this.switchSheet(name);
  }

  private switchSheet(name: string): void {
    this.activeName = name;
    this.active = "A1";
    if (this.nameBox) this.nameBox.value = "A1";
    if (this.formulaBar) this.formulaBar.value = "";
    this.renderGrid();
    this.renderTabs();
    this.renderCharts();
  }

  private renameSheet(name: string): void {
    const next = typeof prompt === "function" ? prompt("Rename sheet (no spaces):", name) : null;
    if (!next || next.trim() === "") {
      return;
    }
    const clean = next.trim().replace(/\s+/g, "");
    const ui = this.ui.get(name);
    this.workbook.renameSheet(name, clean);
    if (ui) {
      this.ui.delete(name);
      this.ui.set(clean, ui);
    }
    if (this.activeName === name) {
      this.activeName = clean;
    }
    this.renderTabs();
  }

  // ---- print ---------------------------------------------------------------

  private openPrint(): void {
    const ui = this.curUi();
    const overlay = el("div", { class: "hb-sheets-print__backdrop" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const panel = el("div", {
      class: "hb-sheets-print",
      role: "dialog",
      "aria-label": "Print preview",
    });

    const setup = el("div", { class: "hb-sheets-print__setup" });
    const headerIn = el("input", {
      class: cls.input,
      placeholder: "Header (top of every page)",
    }) as HTMLInputElement;
    headerIn.value = ui.header;
    const footerIn = el("input", {
      class: cls.input,
      placeholder: "Footer (e.g. Page or your name)",
    }) as HTMLInputElement;
    footerIn.value = ui.footer;
    const areaIn = el("input", {
      class: cls.input,
      placeholder: "Print area (e.g. A1:F12, blank = all)",
    }) as HTMLInputElement;
    areaIn.value = ui.printArea ?? "";
    const sheet = el("div", { class: "hb-sheets-print__sheet" });
    const rerender = (): void => {
      ui.header = headerIn.value;
      ui.footer = footerIn.value;
      ui.printArea = areaIn.value.trim() === "" ? null : areaIn.value.trim().toUpperCase();
      sheet.replaceChildren(this.renderPrintSheet());
    };
    for (const input of [headerIn, footerIn, areaIn]) input.addEventListener("input", rerender);
    const printBtn = button("Print", () => window.print());
    const close = el("button", { class: cls.button, type: "button" }, "Close");
    close.addEventListener("click", () => overlay.remove());
    setup.append(
      el("label", {}, "Header", headerIn),
      el("label", {}, "Footer", footerIn),
      el("label", {}, "Print area", areaIn),
      printBtn,
      close,
    );

    panel.append(setup, sheet);
    overlay.append(panel);
    document.body.append(overlay);
    rerender();
  }

  private renderPrintSheet(): HTMLElement {
    const ui = this.curUi();
    const page = el("div", { class: "hb-sheets-print__page" });
    if (ui.header) page.append(el("div", { class: "hb-sheets-print__header" }, ui.header));
    const [c0, r0, c1, r1] = this.printBounds();
    const table = el("table", { class: `hb-sheets__grid hb-sheets__grid--${ui.tableFormat}` });
    for (let r = r0; r <= r1; r += 1) {
      const tr = el("tr");
      for (let c = c0; c <= c1; c += 1) {
        tr.append(el("td", {}, this.display(`${colName(c)}${r}`)));
      }
      table.append(tr);
    }
    page.append(table);
    page.append(el("div", { class: "hb-sheets-print__footer" }, ui.footer || "Page 1"));
    return page;
  }

  private printBounds(): [number, number, number, number] {
    const area = this.curUi().printArea;
    if (area && /^[A-Z]+\d+:[A-Z]+\d+$/.test(area)) {
      const [a, b] = area.split(":");
      const pa = parseRef(a ?? "A1");
      const pb = parseRef(b ?? "A1");
      return [
        Math.min(pa.col, pb.col),
        Math.min(pa.row, pb.row),
        Math.max(pa.col, pb.col),
        Math.max(pa.row, pb.row),
      ];
    }
    return [0, 1, this.cols - 1, this.rows];
  }

  // ---- Ember: NL formula + explanation -------------------------------------

  private renderEmber(): HTMLElement {
    if (!this.ember) {
      this.ember = new EmberPanel<EmberRequest>({
        run: (req) => this.client.runEmber(req),
        mono: true,
        intro: "Describe a calculation in plain words and I'll write the formula, on your device.",
        suggestions: [
          {
            label: "Sum this column",
            build: (effort) => buildFormulaRequest("sum this column", this.active, effort),
          },
          {
            label: "Average the selection",
            build: (effort) =>
              buildFormulaRequest("average the selected cells", this.active, effort),
          },
        ],
        ask: {
          placeholder: 'Describe a formula, e.g. "sum sales where region is North"',
          build: (text, effort) => buildFormulaRequest(text, this.active, effort),
        },
        resultActions: (result) => {
          const formula = result.text.split("\n")[0] ?? "";
          return [
            el("span", { class: "hb-sheets__fx-explain" }, explainFormula(formula)),
            button("Use this formula", () => {
              this.setCell(this.active, formula);
              this.renderGrid();
            }),
          ];
        },
        onError: (message) => this.options.onError?.(message),
      });
    }
    return el("aside", { class: "hb-sheets__ember", "aria-label": "Ember" }, this.ember.el());
  }

  // ---- charts (first-class named objects, AC-WKS-X7/X8) --------------------

  /** Read a `A1:C5` range into a 2-D grid of computed values. */
  private gridForRange(rangeStr: string): CellValue[][] {
    const m = /^([A-Za-z]+\d+):([A-Za-z]+\d+)$/.exec(rangeStr.trim());
    if (!m) {
      return [];
    }
    const a = parseRef(m[1] ?? "A1");
    const b = parseRef(m[2] ?? "A1");
    const grid: CellValue[][] = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r += 1) {
      const line: CellValue[] = [];
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c += 1) {
        line.push(this.sheet().valueOf(`${colName(c)}${r}`));
      }
      grid.push(line);
    }
    return grid;
  }

  /** A sensible default data range: the bounding box of the used cells. */
  private usedRange(): string {
    let maxRow = 0;
    let maxCol = 0;
    for (const ref of this.sheet().cells.keys()) {
      const p = parseRef(ref);
      maxRow = Math.max(maxRow, p.row);
      maxCol = Math.max(maxCol, p.col);
    }
    if (maxRow === 0 && maxCol === 0 && !this.sheet().cells.has("A1")) {
      return "A1:B5";
    }
    return `A1:${colName(maxCol)}${maxRow}`;
  }

  /** Open the New Chart flow, proposes a default type from the selection. */
  private openNewChart(): void {
    const defaultRange = this.usedRange();
    const overlay = el("div", { class: "hb-modal__backdrop hb-chartnew" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const card = el("div", {
      class: "hb-chartnew__card",
      role: "dialog",
      "aria-label": "New chart",
    });
    card.append(el("h2", { class: "hb-chartnew__title" }, "New chart"));

    const titleIn = el("input", {
      class: cls.input,
      placeholder: "Chart title",
    }) as HTMLInputElement;
    titleIn.value = "Chart";
    const rangeIn = el("input", {
      class: cls.input,
      placeholder: "Data range, e.g. A1:C7",
    }) as HTMLInputElement;
    rangeIn.value = defaultRange;
    const typeSel = el("select", {
      class: cls.select,
      "aria-label": "Chart type",
    }) as HTMLSelectElement;
    for (const t of CHART_TYPES) {
      typeSel.append(el("option", { value: t.id }, t.label));
    }
    const reason = el("p", { class: "hb-chartnew__reason" });
    const preview = el("div", { class: "hb-chartnew__preview" });

    const refreshPreview = (): void => {
      const spec = makeChartSpec({
        id: "preview",
        title: titleIn.value,
        type: typeSel.value as ChartType,
        grid: this.gridForRange(rangeIn.value),
      });
      preview.innerHTML = renderChartSvg(spec, { width: 320, height: 200 });
    };
    // Re-suggest a type from the current data, and keep the dropdown, the
    // suggestion text, and the preview in step (consistent with Writer's flow).
    const propose = (): void => {
      const suggested = suggestChartType(this.gridForRange(rangeIn.value));
      typeSel.value = suggested;
      reason.textContent = `Suggested: ${CHART_TYPES.find((t) => t.id === suggested)?.label}, ${suggestChartReason(suggested)}`;
      refreshPreview();
    };
    const emberBtn = button("Let Ember choose", () => propose());
    rangeIn.addEventListener("change", propose);
    typeSel.addEventListener("change", refreshPreview);
    for (const input of [titleIn, rangeIn]) input.addEventListener("input", refreshPreview);
    propose();

    const fields = el("div", { class: "hb-chartnew__fields" });
    fields.append(
      labelled("Title", titleIn),
      labelled("Data range", rangeIn),
      labelled("Type", typeSel),
      reason,
      emberBtn,
    );

    const foot = el("div", { class: "hb-chartnew__foot" });
    const cancel = button("Cancel", () => overlay.remove());
    const insert = el(
      "button",
      { class: `${cls.button} hb-chartnew__primary`, type: "button" },
      "Insert chart",
    );
    insert.addEventListener("click", () => {
      this.chartSeq += 1;
      const spec = makeChartSpec({
        id: `chart-${this.chartSeq}`,
        title: titleIn.value.trim() || `Chart ${this.chartSeq}`,
        type: typeSel.value as ChartType,
        grid: this.gridForRange(rangeIn.value),
        source: {
          kind: "sheet",
          bundleId: this.options.bundleId,
          sheet: this.activeName,
          range: rangeIn.value.trim().toUpperCase(),
        },
      });
      this.curUi().charts.push(spec);
      overlay.remove();
      this.renderCharts();
    });
    foot.append(cancel, insert);

    card.append(el("div", { class: "hb-chartnew__cols" }, fields, preview), foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  /** Re-render every chart on the active sheet from current cell values (live). */
  private renderCharts(): void {
    const host = this.chartsHost;
    if (!host) {
      return;
    }
    host.replaceChildren();
    for (const spec of this.curUi().charts) {
      host.append(this.renderChartCard(spec));
    }
  }

  private renderChartCard(spec: ChartSpec): HTMLElement {
    // Live-link: re-extract the data from the source range each render, and
    // publish it so a Writer document linked to the same source can refresh.
    if (spec.source?.range) {
      const data: ChartData = extractChartData(this.gridForRange(spec.source.range));
      spec.categories = data.categories;
      spec.series = data.series;
      this.options.onPublishChartData?.(spec.source as ChartSource, data);
    }
    const card = el("figure", { class: "hb-sheets__chartcard" });
    const bar = el("div", { class: "hb-sheets__chartbar" });
    const typeSel = el("select", {
      class: cls.select,
      "aria-label": "Chart type",
    }) as HTMLSelectElement;
    for (const t of CHART_TYPES) {
      typeSel.append(el("option", { value: t.id }, t.label));
    }
    typeSel.value = spec.type;
    typeSel.addEventListener("change", () => {
      spec.type = typeSel.value as ChartType;
      this.renderCharts();
    });
    const name = el(
      "span",
      { class: "hb-sheets__chartname" },
      `${spec.title} · ${spec.source?.range ?? ""}`,
    );
    const del = el(
      "button",
      { class: cls.button, type: "button", "aria-label": "Delete chart" },
      "Delete",
    );
    del.addEventListener("click", () => {
      const charts = this.curUi().charts;
      const i = charts.indexOf(spec);
      if (i >= 0) charts.splice(i, 1);
      this.renderCharts();
    });
    bar.append(name, typeSel, del);
    const figure = el("div", { class: "hb-sheets__chartsvg" });
    figure.innerHTML = renderChartSvg(spec, { width: 360, height: 220 });
    card.append(bar, figure);
    return card;
  }

  // ---- promote to Records --------------------------------------------------

  async promoteToRecords(): Promise<string> {
    try {
      const header = range(this.cols).map((c) => text(this.sheet().valueOf(`${colName(c)}1`)));
      const dataRows: CellValue[][] = [];
      for (let r = 2; r <= this.rows; r += 1) {
        const row = range(this.cols).map((c) => this.sheet().valueOf(`${colName(c)}${r}`));
        if (row.some((v) => v !== null && v !== "")) {
          dataRows.push(row);
        }
      }
      const records = dataTableToRecords("Imported sheet", header, dataRows);

      const tableId = await this.client.createTable(this.options.bundleId, records.name);
      const fieldIds = new Map<string, string>();
      for (const field of records.fields) {
        fieldIds.set(field.name, await this.client.addField(tableId, field.name, field.datatype));
      }
      for (const row of records.rows) {
        const values: FieldValue[] = records.fields.map((field) => ({
          field_id: fieldIds.get(field.name) ?? "",
          value: toRecordValue(row[field.name]),
        }));
        await this.client.insertRow({ table_id: tableId, values });
      }
      return tableId;
    } catch (error) {
      this.fail(error);
      return "";
    }
  }

  private fail(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error.message : String(error));
  }
}

// ---- helpers ----------------------------------------------------------------

function freshUi(): SheetUi {
  return {
    formats: new Map(),
    styles: new Map(),
    protectedCells: new Set(),
    protectedSheet: false,
    freezeRows: 0,
    freezeCols: 0,
    tableFormat: "none",
    header: "",
    footer: "",
    printArea: null,
    charts: [],
    columnWidths: new Map(),
  };
}

function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) {
    return { col: 0, row: 1 };
  }
  let col = 0;
  for (const ch of (m[1] ?? "").toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { col: col - 1, row: Number(m[2] ?? "1") };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_v, i) => i);
}

function trimLeadingBlanks(values: CellValue[]): CellValue[] {
  let i = 0;
  while (i < values.length && (values[i] === null || values[i] === "")) {
    i += 1;
  }
  return values.slice(i);
}

function numericOrText(raw: string): CellValue {
  if (raw === "") {
    return null;
  }
  const n = Number(raw);
  return !Number.isNaN(n) && raw.trim() !== "" ? n : raw;
}

function toRecordValue(value: unknown): FieldValue["value"] {
  if (typeof value === "number") {
    return { number: value };
  }
  if (typeof value === "boolean") {
    return { bool: value };
  }
  if (value === null || value === undefined || value === "") {
    return "null";
  }
  return { text: String(value) };
}

/** A label wrapping a form control, for the New Chart dialog. */
function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "hb-chartnew__field" });
  wrap.append(el("span", { class: "hb-chartnew__label" }, label), control);
  return wrap;
}

function text(value: CellValue): string {
  return value === null ? "" : String(value);
}

function toBase64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function button(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.button, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function iconButton(glyph: string, label: string, onClick: () => void): HTMLElement {
  const node = el(
    "button",
    {
      class: `${cls.button} hb-sheets__iconbtn`,
      type: "button",
      "aria-label": label,
      title: label,
    },
    glyph,
  );
  node.addEventListener("click", onClick);
  return node;
}

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
