/**
 * Hearth Suite Records, a flat, form-driven database (no SQL), at Works DB parity.
 *
 * Form view is the default: it shows one record at a time with first/prev/next/
 * last navigation, an "n of N" counter, and keyboard paging, plus a free-tier
 * drag-around Form Designer (move fields and labels, drop images). A Table view
 * gives the grid, with a Key column showing each record's sharing state. Fields
 * can be text/email/select/status/relation/number/date/time/yes-no/formula/auto
 * with default values; formula fields may reference each other. Saved named
 * filters use plain-language operators ("contains", "is after", "is greater
 * than") with all/any logic; sorting is multi-key; records and fields can be
 * marked or hidden; find, delimited import/export, and protection round it out.
 * The Forge (Pro) relational builder sits above this free parity layer.
 */

import type { EmberRequest, FieldValue, HearthClient } from "@hearth/core-client";
import { cls, EmberPanel, icon, proBadge, type PreferenceStorage } from "@hearth/design-system";

import {
  COMPUTED_TYPES,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  REPORT_AGGS,
  applyDefaults,
  applyFilterSet,
  buildReport,
  buildQueryRequest,
  computeRow,
  findRows,
  inferReportSpec,
  inferSchema,
  nextAutoIncrement,
  opsForType,
  parseDelimited,
  reportMergeRecords,
  reportToText,
  sortRows,
  toDelimited,
  validateRow,
} from "./core.mjs";
import type { FieldType, FilterSet, Report, ReportAgg, ReportSpec, Row, SortKey } from "./core.mjs";

interface Field {
  id: string;
  name: string;
  datatype: FieldType;
  default?: unknown;
  formula?: string;
  hidden?: boolean;
}

/** An in-memory record, carrying a synthetic id and a saved flag. */
interface Record_ {
  __id: string;
  saved: boolean;
  values: Row;
}

/** Host hooks for the Records editor. */
export interface RecordsOptions {
  bundleId: string;
  tableId?: string;
  onError?: (message: string) => void;
  contactsProvider?: () => {
    fields: Array<{ name: string; datatype: string }>;
    rows: Array<Record<string, string>>;
  };
  /** Publish a report's rows so Writer can merge over them (Mailings source). */
  onPublishReport?: (name: string, records: Array<Record<string, string>>) => void;
  /** Send the current table into a chosen Bundle (Portfolio collect-flow). */
  onAddToBundle?: (payload: { docType: string; title: string; contentBase64: string }) => void;
  /**
   * Where the Form Designer layout is stored. Defaults to `localStorage`; the
   * client shell injects a vault-backed adapter so the layout persists encrypted
   * and travels with sync (P2-CL3), matching Sheets/Writer style sets.
   */
  layoutStorage?: PreferenceStorage;
  /** Starter fields + rows (e.g. from a legacy .wdb import). */
  initialData?: {
    fields: Array<{ name: string; datatype: FieldType; formula?: string; default?: unknown }>;
    rows: Row[];
  };
  /**
   * Per-record key state for the Table view's Key column (host/directory seam).
   * Returns "verified" when the record's contact key is verified against the
   * transparency log, else "not-shared". Absent → every record reads "Not
   * shared" (the honest default; nothing is shared until you seal/link it).
   */
  keyStatus?: (values: Row) => "verified" | "not-shared";
}

type View = "form" | "table";

const STARTER_FIELDS: Array<{ name: string; datatype: FieldType }> = [
  { name: "Name", datatype: "text" },
  { name: "Email", datatype: "email" },
  { name: "Role", datatype: "select" },
];

/** The Records editor. */
export class Records {
  private tableId: string | undefined;
  private fields: Field[] = [];
  private records: Record_[] = [];
  private view: View = "form";
  private current = 0;
  private designMode = false;
  private root: HTMLElement | undefined;
  private ember: EmberPanel<EmberRequest> | undefined;
  private seq = 0;

  // View state.
  private layout = new Map<string, { x: number; y: number }>();
  private images: Array<{ id: string; src: string; x: number; y: number }> = [];
  private marked = new Set<string>();
  private hidden = new Set<string>();
  private showMarkedOnly = false;
  private sortKeys: SortKey[] = [];
  private savedFilters: FilterSet[] = [];
  private activeFilter: FilterSet | null = null;
  private findQuery = "";
  private locked = false;

  constructor(
    private readonly client: HearthClient,
    private readonly options: RecordsOptions,
  ) {
    this.tableId = options.tableId;
  }

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    this.loadLayout();
    if (this.options.initialData && this.fields.length === 0) {
      await this.loadInitialData(this.options.initialData);
      this.rerender();
      return;
    }
    if (this.fields.length === 0) {
      this.fields = STARTER_FIELDS.map((f, i) => ({ id: `seed-${i}`, ...f }));
    }
    await this.loadRows();
    this.rerender();
  }

  /** Load imported fields + rows (e.g. a legacy .wdb), persisting them. */
  private async loadInitialData(data: NonNullable<RecordsOptions["initialData"]>): Promise<void> {
    try {
      const tableId = await this.client.createTable(this.options.bundleId, "Imported");
      this.tableId = tableId;
      this.fields = [];
      for (const field of data.fields) {
        const id = await this.client.addField(tableId, field.name, field.datatype);
        this.fields.push({
          id,
          name: field.name,
          datatype: field.datatype,
          formula: field.formula,
          default: field.default,
        });
      }
      this.records = [];
      for (const values of data.rows) {
        this.seq += 1;
        const record: Record_ = { __id: `imp-${this.seq}`, saved: false, values: { ...values } };
        this.records.push(record);
        await this.persistInsert(record);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** Load persisted rows once into the in-memory model (computed + ids). */
  private async loadRows(): Promise<void> {
    if (!this.tableId || this.tableId.startsWith("seed")) {
      return;
    }
    try {
      const rows = await this.client.queryRows(this.tableId);
      this.records = rows.map((row) => {
        const byId = new Map(row.values.map((v) => [v.field_id, v.value]));
        const values: Row = {};
        for (const field of this.fields) {
          values[field.name] = scalar(byId.get(field.id));
        }
        return { __id: row.id, saved: true, values };
      });
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- the visible record set (filter → find → sort → compute) -------------

  private visibleFields(): Field[] {
    return this.fields.filter((f) => !f.hidden);
  }

  private visibleRecords(): Record_[] {
    let out = this.records.filter((r) => !this.hidden.has(r.__id));
    if (this.showMarkedOnly) {
      out = out.filter((r) => this.marked.has(r.__id));
    }
    let rows = out.map((r) => r.values);
    if (this.activeFilter) {
      rows = applyFilterSet(rows, this.activeFilter, this.fields);
    }
    rows = findRows(rows, this.findQuery);
    rows = sortRows(rows, this.sortKeys);
    // Map sorted/filtered plain rows back to records (by identity).
    const order = new Map(rows.map((row, i) => [row, i]));
    return out
      .filter((r) => order.has(r.values))
      .sort((a, b) => (order.get(a.values) ?? 0) - (order.get(b.values) ?? 0));
  }

  private computed(record: Record_): Row {
    return computeRow(this.fields, record.values);
  }

  // ---- render --------------------------------------------------------------

  private rerender(): void {
    if (!this.root) {
      return;
    }
    const shell = el("div", { class: "hb-records" });
    shell.append(this.renderHeader());
    if (this.findQuery || this.activeFilter) {
      shell.append(this.renderFilterStatus());
    }
    if (this.view === "form") {
      shell.append(this.renderForm());
    } else {
      shell.append(this.renderList());
    }
    shell.append(this.renderForgeHint());
    shell.append(this.renderEmber());
    this.root.replaceChildren(shell);
  }

  /**
   * A calm, in-context preview of the Forge (Pro) relational builder, never a
   * nag. Free Records stay fully usable; this just shows what relations add, with
   * a ghost Pro badge and a dimmed, locked example.
   */
  private renderForgeHint(): HTMLElement {
    const card = el("section", { class: "hb-records__forge", "aria-label": "The Forge (Pro)" });

    const head = el("div", { class: "hb-records__forge-head" });
    const glyph = el("span", { class: "hb-records__forge-glyph" });
    glyph.innerHTML = icon("connections", 20);
    const titleWrap = el("span", { class: "hb-records__forge-title" });
    titleWrap.innerHTML = `The Forge, relational builder ${proBadge({ ghost: true })}`;
    head.append(glyph, titleWrap);

    const note = el(
      "p",
      { class: "hb-records__forge-note" },
      "Relations stay off until you add one, so the novice never sees a schema. Link records across tables with lookups, rollups and joins, no SQL. Your free Records stay fully yours; the Forge adds the deep relational builder when you're ready.",
    );

    // A dimmed, non-interactive sample of a relation (the locked preview).
    const preview = el("div", { class: "hb-records__forge-preview", "aria-hidden": "true" });
    const lock = el("span", { class: "hb-records__forge-lock" });
    lock.innerHTML = icon("lock", 16);
    preview.append(
      lock,
      el("span", { class: "hb-records__forge-rel" }, "Invoices → Clients"),
      el("span", { class: "hb-records__forge-sep" }, "·"),
      el("span", {}, "lookup “Client name”"),
    );

    card.append(head, note, preview);
    return card;
  }

  private renderHeader(): HTMLElement {
    const header = el("div", { class: "hb-records__header" });
    const counter = `${this.fields.length} ${this.fields.length === 1 ? "field" : "fields"} · ${this.records.length} ${this.records.length === 1 ? "record" : "records"}`;
    const title = el(
      "div",
      { class: "hb-records__titles" },
      el("h1", { class: "hb-records__title" }, "Records"),
      el("p", { class: "hb-records__count" }, counter),
    );

    // The "Encrypted on this device" cue, matching Sheets and Calendar.
    const enc = el("span", { class: "hb-records__enc" });
    enc.innerHTML = `${icon("lock", 14)}<span>Encrypted on this device</span>`;

    const segBtn = (label: string, id: "form" | "table"): HTMLElement => {
      const b = el(
        "button",
        { type: "button", role: "tab", "aria-selected": String(this.view === id) },
        label,
      ) as HTMLButtonElement;
      if (this.view === id) {
        b.classList.add("is-active");
      }
      b.addEventListener("click", () => this.switchView(id));
      return b;
    };
    const toggle = el(
      "div",
      { class: cls.segmented, role: "tablist", "aria-label": "View" },
      segBtn("Form", "form"),
      segBtn("Table", "table"),
    );

    const actions = el("div", { class: "hb-records__actions" });
    actions.append(
      this.findControl(),
      button("Filter", () => this.openFilterDialog()),
      button("Sort", () => this.openSortDialog()),
      button("Report", () => this.openReportBuilder()),
      button("Export", () => this.openExport()),
      button("Import", () => this.openCsvImport()),
      button(this.locked ? "Unlock" : "Protect", () => this.toggleLock()),
    );
    if (this.options.onAddToBundle) {
      actions.append(button("Add to Bundle", () => this.addToBundle()));
    }
    if (this.options.contactsProvider) {
      actions.append(button("Link Contacts", () => void this.linkContacts()));
    }
    actions.append(primary("New record", () => this.newRecord()));

    header.append(title, el("div", { class: "hb-records__header-right" }, enc, toggle, actions));
    return header;
  }

  private findControl(): HTMLElement {
    const input = el("input", {
      class: cls.input,
      type: "search",
      placeholder: "Find…",
      "aria-label": "Find records",
    }) as HTMLInputElement;
    input.value = this.findQuery;
    input.addEventListener("input", () => {
      this.findQuery = input.value;
      this.refreshBody();
    });
    return input;
  }

  private renderFilterStatus(): HTMLElement {
    const bar = el("div", { class: "hb-records__filterbar" });
    const removableTag = (label: string, onRemove: () => void): HTMLElement => {
      const tag = el("span", { class: cls.tag }, el("span", {}, label));
      const rm = el("button", {
        class: cls.tagRemove,
        type: "button",
        "aria-label": `Clear ${label}`,
      });
      rm.innerHTML = icon("x", 14);
      rm.addEventListener("click", onRemove);
      tag.append(rm);
      return tag;
    };
    if (this.activeFilter) {
      const label = `Filter: ${this.activeFilter.name ?? `${this.activeFilter.conditions.length} conditions`}`;
      bar.append(
        removableTag(label, () => {
          this.activeFilter = null;
          this.current = 0;
          this.rerender();
        }),
      );
    }
    if (this.findQuery) {
      bar.append(
        removableTag(`Find: “${this.findQuery}”`, () => {
          this.findQuery = "";
          this.rerender();
        }),
      );
    }
    const clear = button("Clear all", () => {
      this.activeFilter = null;
      this.findQuery = "";
      this.current = 0;
      this.rerender();
    });
    bar.append(clear);
    return bar;
  }

  private switchView(view: View): void {
    this.view = view;
    this.designMode = false;
    this.rerender();
  }

  private toggleLock(): void {
    this.locked = !this.locked;
    this.options.onError?.(
      this.locked ? "Records protected, editing is locked." : "Records unlocked.",
    );
    this.rerender();
  }

  /** Re-render just the active view body (keeps focus in toolbar inputs). */
  private refreshBody(): void {
    this.rerender();
  }

  // ---- form view + navigation (AC-WKS-D1/D2) -------------------------------

  private renderForm(): HTMLElement {
    const wrap = el("div", { class: "hb-records__formview" });
    wrap.append(this.renderRecordNav());

    if (this.designMode) {
      wrap.append(this.renderDesigner());
      return wrap;
    }

    const visible = this.visibleRecords();
    const total = visible.length;
    const record = visible[Math.min(this.current, Math.max(0, total - 1))];

    const form = el("form", { class: "hb-records__form", "aria-label": "Record" });
    form.addEventListener("submit", (e) => e.preventDefault());
    const inputs = new Map<string, HTMLInputElement>();
    const computedValues = record ? this.computed(record) : {};

    for (const field of this.visibleFields()) {
      const row = el("div", { class: "hb-records__field" });
      const pos = this.layout.get(field.name);
      if (pos) {
        row.setAttribute("style", `position:absolute; left:${pos.x}px; top:${pos.y}px;`);
      }
      row.append(el("label", { class: "hb-records__field-label" }, field.name));
      const computed = COMPUTED_TYPES.includes(field.datatype);
      const input = el("input", {
        class: field.datatype === "bool" ? cls.checkbox : cls.input,
        type: inputType(field.datatype),
        name: field.name,
      }) as HTMLInputElement;
      const value = computed ? computedValues[field.name] : record?.values[field.name];
      if (field.datatype === "bool") {
        input.checked = value === true;
      } else {
        input.value = value == null ? "" : String(value);
      }
      if (computed || this.locked || !record) {
        input.setAttribute("readonly", "");
        input.setAttribute("disabled", "");
      } else {
        input.addEventListener("change", () => this.editCurrent(field, inputs));
      }
      inputs.set(field.name, input);
      row.append(input);
      if (field.datatype === "formula" && field.formula) {
        row.append(el("span", { class: "hb-records__field-hint" }, `= ${field.formula}`));
      }
      form.append(row);
    }
    if (this.layout.size > 0) {
      form.classList.add("hb-records__form--free");
    }

    const actions = el("div", { class: "hb-records__form-actions" });
    if (record && !this.locked) {
      actions.append(primary("Save record", () => void this.saveCurrent(record, inputs)));
      actions.append(
        button(this.marked.has(record.__id) ? "Unmark" : "Mark", () => this.toggleMark(record)),
      );
      actions.append(button("Hide", () => this.hideRecord(record)));
      actions.append(button("Delete", () => void this.deleteCurrent(record)));
    }
    actions.append(button("Design form", () => this.toggleDesign()));
    actions.append(button("Add field", () => void this.promptAddField()));
    form.append(actions);

    if (record) {
      // Honest persistence status: never imply a sync that hasn't happened.
      const status = record.saved
        ? "Saved on this device"
        : "Unsaved, choose Save record to keep this";
      form.append(el("p", { class: "hb-records__savestate" }, status));
    }

    if (total === 0) {
      form.prepend(
        el("p", { class: "hb-records__empty-cell" }, "No records yet, use New record to add one."),
      );
    }
    wrap.append(form);
    return wrap;
  }

  private renderRecordNav(): HTMLElement {
    const total = this.visibleRecords().length;
    const at = total === 0 ? 0 : Math.min(this.current, total - 1) + 1;
    const nav = el("div", {
      class: "hb-records__nav",
      role: "group",
      "aria-label": "Record navigation",
    });
    const first = navButton("⏮", "First record", () => this.goTo(0));
    const prev = navButton("◀", "Previous record", () => this.goTo(this.current - 1));
    const next = navButton("▶", "Next record", () => this.goTo(this.current + 1));
    const last = navButton("⏭", "Last record", () => this.goTo(total - 1));
    if (at <= 1) {
      first.setAttribute("disabled", "");
      prev.setAttribute("disabled", "");
    }
    if (at >= total) {
      next.setAttribute("disabled", "");
      last.setAttribute("disabled", "");
    }
    const counter = el(
      "span",
      { class: "hb-records__nav-counter", "aria-live": "polite" },
      `${at} of ${total}`,
    );
    nav.append(first, prev, counter, next, last);
    // Keyboard paging: PageUp/PageDown and Ctrl+Arrow.
    nav.tabIndex = 0;
    nav.addEventListener("keydown", (event) => {
      const e = event as KeyboardEvent;
      if (e.key === "PageDown" || (e.ctrlKey && e.key === "ArrowDown")) {
        e.preventDefault();
        this.goTo(this.current + 1);
      } else if (e.key === "PageUp" || (e.ctrlKey && e.key === "ArrowUp")) {
        e.preventDefault();
        this.goTo(this.current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        this.goTo(total - 1);
      }
    });
    return nav;
  }

  private goTo(index: number): void {
    const total = this.visibleRecords().length;
    this.current = Math.max(0, Math.min(index, total - 1));
    this.rerender();
    this.root?.querySelector<HTMLElement>(".hb-records__nav")?.focus();
  }

  /** Capture the current record's edits into the in-memory model. */
  private editCurrent(field: Field, inputs: Map<string, HTMLInputElement>): void {
    const record = this.visibleRecords()[this.current];
    if (!record) {
      return;
    }
    const input = inputs.get(field.name);
    if (!input) {
      return;
    }
    record.values[field.name] = field.datatype === "bool" ? input.checked : input.value;
  }

  private async saveCurrent(record: Record_, inputs: Map<string, HTMLInputElement>): Promise<void> {
    const values: Row = { ...record.values };
    for (const field of this.visibleFields()) {
      if (COMPUTED_TYPES.includes(field.datatype)) {
        continue;
      }
      const input = inputs.get(field.name);
      if (input) {
        values[field.name] = field.datatype === "bool" ? input.checked : input.value;
      }
    }
    const result = validateRow(this.fields, values);
    if (!result.ok) {
      this.options.onError?.(Object.values(result.errors).join("; "));
      return;
    }
    record.values = { ...values, ...result.values };
    // Assign auto-number on first save.
    for (const field of this.fields) {
      if (field.datatype === "auto" && record.values[field.name] == null) {
        record.values[field.name] = nextAutoIncrement(
          this.records.map((r) => r.values),
          field.name,
        );
      }
    }
    if (record.saved) {
      await this.persistUpdate(record);
    } else {
      await this.persistInsert(record);
    }
    this.rerender();
  }

  /**
   * Edit one cell from the List grid (AC-WKS-D4 in-cell editing). Validates the
   * field, recomputes formulas, and persists saved rows; reverts on a bad value.
   */
  private async editListCell(record: Record_, field: Field, raw: string | boolean): Promise<void> {
    if (this.locked || COMPUTED_TYPES.includes(field.datatype)) {
      return;
    }
    const values: Row = { ...record.values, [field.name]: raw };
    const result = validateRow(this.fields, values);
    if (!result.ok) {
      this.options.onError?.(result.errors[field.name] ?? Object.values(result.errors).join("; "));
      this.rerender(); // discard the bad edit, restore the stored value
      return;
    }
    record.values = { ...values, ...result.values };
    for (const f of this.fields) {
      if (f.datatype === "auto" && record.values[f.name] == null) {
        record.values[f.name] = nextAutoIncrement(
          this.records.map((r) => r.values),
          f.name,
        );
      }
    }
    if (record.saved) {
      await this.persistUpdate(record);
    }
    this.rerender();
  }

  /** A typed in-grid editor for one cell, matching the field's datatype. */
  private listCellEditor(record: Record_, field: Field): HTMLElement {
    const raw = record.values[field.name];
    if (field.datatype === "bool") {
      const cb = el("input", {
        type: "checkbox",
        class: "hb-records__listcell-bool",
        "aria-label": field.name,
      }) as HTMLInputElement;
      cb.checked = raw === true || raw === "true";
      cb.addEventListener("change", () => void this.editListCell(record, field, cb.checked));
      return cb;
    }
    const inputType =
      field.datatype === "date"
        ? "date"
        : field.datatype === "time"
          ? "time"
          : field.datatype === "number"
            ? "number"
            : "text";
    const input = el("input", {
      class: "hb-records__listcell",
      type: inputType,
      value: raw == null ? "" : String(raw),
      "aria-label": field.name,
    }) as HTMLInputElement;
    input.addEventListener("change", () => void this.editListCell(record, field, input.value));
    return input;
  }

  /** Delete the current record from the store and the in-memory model. */
  private async deleteCurrent(record: Record_): Promise<void> {
    if (this.locked) {
      return;
    }
    try {
      if (record.saved) {
        await this.client.deleteRow(record.__id);
      }
    } catch (error) {
      this.fail(error);
    }
    this.records = this.records.filter((r) => r !== record);
    this.marked.delete(record.__id);
    this.hidden.delete(record.__id);
    this.current = Math.max(0, this.current - 1);
    this.rerender();
  }

  private newRecord(): void {
    if (this.locked) {
      return;
    }
    this.seq += 1;
    const values = applyDefaults(this.fields, {});
    const record: Record_ = { __id: `new-${this.seq}`, saved: false, values };
    this.records.push(record);
    this.view = "form";
    this.activeFilter = null;
    this.showMarkedOnly = false;
    this.current = this.visibleRecords().findIndex((r) => r.__id === record.__id);
    this.rerender();
  }

  private toggleMark(record: Record_): void {
    if (this.marked.has(record.__id)) {
      this.marked.delete(record.__id);
    } else {
      this.marked.add(record.__id);
    }
    this.rerender();
  }

  private hideRecord(record: Record_): void {
    this.hidden.add(record.__id);
    this.current = Math.max(0, this.current - 1);
    this.rerender();
  }

  private toggleDesign(): void {
    this.designMode = !this.designMode;
    this.rerender();
  }

  // ---- form designer (free tier, AC-WKS-D3) --------------------------------

  private renderDesigner(): HTMLElement {
    const canvas = el("div", { class: "hb-records__designer", "aria-label": "Form designer" });
    const note = el(
      "div",
      { class: "hb-records__designer-note" },
      "Drag fields and labels to arrange your form. Add images. Changes apply to the Form view.",
    );
    canvas.append(note);

    this.visibleFields().forEach((field, i) => {
      const pos = this.layout.get(field.name) ?? { x: 16, y: 48 + i * 56 };
      this.layout.set(field.name, pos);
      const card = el("div", { class: "hb-records__design-field" });
      card.setAttribute("style", `left:${pos.x}px; top:${pos.y}px;`);
      card.append(
        el("span", { class: "hb-records__design-grip" }, "⠿"),
        el("span", {}, field.name),
        el("span", { class: "hb-records__design-type" }, FIELD_TYPE_LABELS[field.datatype]),
      );
      this.makeDraggable(card, (x, y) => {
        this.layout.set(field.name, { x, y });
        this.persistLayout();
      });
      canvas.append(card);
    });

    for (const image of this.images) {
      const node = el("div", { class: "hb-records__design-image" });
      node.setAttribute("style", `left:${image.x}px; top:${image.y}px;`);
      const img = el("img", { src: image.src, alt: "Form image" });
      node.append(img);
      this.makeDraggable(node, (x, y) => {
        image.x = x;
        image.y = y;
        this.persistLayout();
      });
      canvas.append(node);
    }

    const tools = el("div", { class: "hb-records__designer-tools" });
    tools.append(
      button("Add image", () => this.addImage()),
      button("Reset layout", () => {
        this.layout.clear();
        this.images = [];
        this.persistLayout();
        this.rerender();
      }),
      primary("Done", () => this.toggleDesign()),
    );
    canvas.append(tools);
    return canvas;
  }

  // ---- form-layout persistence (per table, AC-WKS-D3) ----------------------

  private layoutStore(): Pick<PreferenceStorage, "getItem" | "setItem"> | null {
    if (this.options.layoutStorage) {
      return this.options.layoutStorage; // vault-backed when the shell injects it
    }
    try {
      return typeof globalThis !== "undefined" && globalThis.localStorage
        ? globalThis.localStorage
        : null;
    } catch {
      return null;
    }
  }

  /** Save the Form Designer layout + images so they persist per table. */
  private persistLayout(): void {
    const store = this.layoutStore();
    if (!store || !this.tableId) {
      return;
    }
    try {
      store.setItem(
        `hb-records-layout:${this.tableId}`,
        JSON.stringify({ layout: [...this.layout], images: this.images }),
      );
    } catch {
      /* storage full or unavailable; the in-session layout still works */
    }
  }

  /** Restore a previously-saved Form Designer layout for this table. */
  private loadLayout(): void {
    const store = this.layoutStore();
    if (!store || !this.tableId) {
      return;
    }
    try {
      const raw = store.getItem(`hb-records-layout:${this.tableId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.layout)) {
        this.layout = new Map(parsed.layout);
      }
      if (Array.isArray(parsed?.images)) {
        this.images = parsed.images;
      }
    } catch {
      /* corrupt entry; fall back to the default stacked layout */
    }
  }

  private addImage(): void {
    const src = typeof prompt === "function" ? prompt("Image URL:", "https://") : null;
    if (!src || src.trim() === "") {
      return;
    }
    this.seq += 1;
    this.images.push({ id: `img-${this.seq}`, src: src.trim(), x: 220, y: 48 });
    this.persistLayout();
    this.rerender();
  }

  /** Pointer-drag a positioned element, reporting its new {x,y} on release. */
  private makeDraggable(node: HTMLElement, onMove: (x: number, y: number) => void): void {
    node.addEventListener("pointerdown", (event) => {
      const e = event as PointerEvent;
      e.preventDefault();
      const parent = node.parentElement?.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = node.offsetLeft;
      const origY = node.offsetTop;
      node.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        const x = Math.max(0, origX + (ev.clientX - startX));
        const y = Math.max(0, origY + (ev.clientY - startY));
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        void parent;
      };
      const up = (ev: PointerEvent): void => {
        node.releasePointerCapture(e.pointerId);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        onMove(node.offsetLeft, node.offsetTop);
        void ev;
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
    });
  }

  // ---- list view (AC-WKS-D6/D9) --------------------------------------------

  private renderList(): HTMLElement {
    const section = el("section", { class: "hb-records__table-wrap", "aria-label": "Records" });

    const bar = el("div", { class: "hb-records__listbar" });
    const markedToggle = el("label", { class: "hb-records__check" });
    const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = this.showMarkedOnly;
    cb.addEventListener("change", () => {
      this.showMarkedOnly = cb.checked;
      this.rerender();
    });
    markedToggle.append(cb, el("span", {}, "Show marked only"));
    bar.append(markedToggle);
    if (this.hidden.size > 0) {
      bar.append(
        button(`Show ${this.hidden.size} hidden`, () => {
          this.hidden.clear();
          this.rerender();
        }),
      );
    }
    section.append(bar);

    const table = el("table", { class: "hb-table hb-records__table" });
    const head = el("tr");
    head.append(el("th", { class: "hb-records__mark-col" }, "★"));
    for (const field of this.visibleFields()) {
      const th = el("th", { class: "hb-records__th" });
      const name = el("button", { class: "hb-records__col-sort", type: "button" });
      const arrow = this.sortArrow(field.name);
      name.append(
        el("span", { class: "hb-records__col-name" }, field.name + arrow),
        el("span", { class: "hb-records__col-type" }, FIELD_TYPE_LABELS[field.datatype]),
      );
      name.addEventListener("click", (event) =>
        this.toggleSort(field.name, (event as MouseEvent).shiftKey),
      );
      const hide = el(
        "button",
        {
          class: "hb-records__col-hide",
          type: "button",
          title: "Hide field",
          "aria-label": `Hide ${field.name}`,
        },
        "×",
      );
      hide.addEventListener("click", () => this.hideField(field));
      th.append(name, hide);
      head.append(th);
    }
    // The Key column: each record's sharing/verification state (v1.0).
    head.append(el("th", { class: "hb-records__key-col" }, "Key"));
    const addCol = el("th", { class: "hb-records__add-col" });
    const addBtn = el(
      "button",
      {
        class: "hb-records__add-col-btn",
        type: "button",
        "aria-label": "Add field",
        title: "Add field",
      },
      "+",
    );
    addBtn.addEventListener("click", () => void this.promptAddField());
    addCol.append(addBtn);
    head.append(addCol);
    table.append(head);

    const visible = this.visibleRecords();
    if (visible.length === 0) {
      const tr = el("tr", { class: "hb-records__empty-row" });
      const td = el(
        "td",
        { class: "hb-records__empty-cell" },
        "No records match, clear the filter, or add a record.",
      );
      td.setAttribute("colspan", String(this.visibleFields().length + 3));
      tr.append(td);
      table.append(tr);
    } else {
      visible.forEach((record, rowIndex) => {
        const computed = this.computed(record);
        const tr = el("tr", { class: this.marked.has(record.__id) ? "is-marked" : "" });
        const star = el(
          "button",
          { class: "hb-records__star", type: "button", "aria-label": "Mark record" },
          this.marked.has(record.__id) ? "★" : "☆",
        );
        star.addEventListener("click", () => this.toggleMark(record));
        tr.append(el("td", { class: "hb-records__mark-col" }, star));
        this.visibleFields().forEach((field, i) => {
          if (i === 0) {
            const text = formatCell(computed[field.name], field.datatype);
            const cell = el("td", { class: "hb-records__name-cell" });
            const open = el(
              "button",
              { class: "hb-records__rowopen", type: "button" },
              text || "(blank)",
            );
            open.addEventListener("click", () => {
              this.view = "form";
              this.current = rowIndex;
              this.rerender();
            });
            cell.append(avatar(text), open);
            tr.append(cell);
          } else if (COMPUTED_TYPES.includes(field.datatype) || this.locked) {
            // Computed and locked cells stay read-only.
            tr.append(el("td", {}, cellNode(computed[field.name], field.datatype)));
          } else {
            // In-cell editing (D4): a typed input writing straight to the model.
            tr.append(el("td", {}, this.listCellEditor(record, field)));
          }
        });
        tr.append(el("td", { class: "hb-records__key-col" }, this.keyCell(computed)));
        tr.append(el("td", {}));
        table.append(tr);
      });
    }
    section.append(table);
    return section;
  }

  private sortArrow(fieldName: string): string {
    const key = this.sortKeys.find((k) => k.field === fieldName);
    if (!key) return "";
    return key.dir === "desc" ? " ▾" : " ▴";
  }

  /** The Key column cell: a sealed "Verified" pill or a muted "Not shared" one.
   *  State comes from the host key-status seam; absent → "Not shared" (honest:
   *  nothing is shared until you seal or link it). */
  private keyCell(values: Row): HTMLElement {
    const status = this.options.keyStatus?.(values) ?? "not-shared";
    if (status === "verified") {
      const pill = el("span", {
        class: "hb-records__key hb-sealed",
        title: "Key verified against the transparency log",
      });
      pill.innerHTML = `${icon("shield", 12)}<span>Verified</span>`;
      return pill;
    }
    return el(
      "span",
      { class: "hb-records__key hb-records__key--off", title: "Not shared yet" },
      "Not shared",
    );
  }

  private toggleSort(fieldName: string, additive: boolean): void {
    const existing = this.sortKeys.find((k) => k.field === fieldName);
    if (!additive) {
      if (existing && this.sortKeys.length === 1) {
        existing.dir = existing.dir === "asc" ? "desc" : "asc";
      } else {
        this.sortKeys = [{ field: fieldName, dir: "asc" }];
      }
    } else if (existing) {
      existing.dir = existing.dir === "asc" ? "desc" : "asc";
    } else {
      this.sortKeys.push({ field: fieldName, dir: "asc" });
    }
    this.rerender();
  }

  private hideField(field: Field): void {
    field.hidden = true;
    this.rerender();
  }

  // ---- saved filters (AC-WKS-D8) -------------------------------------------

  private openFilterDialog(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog",
      role: "dialog",
      "aria-label": "Filter records",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Filter records"));

    const matchSel = el("select", { class: cls.input, "aria-label": "Match" }) as HTMLSelectElement;
    matchSel.append(
      el("option", { value: "all" }, "Match all conditions"),
      el("option", { value: "any" }, "Match any condition"),
    );
    matchSel.value = this.activeFilter?.match ?? "all";
    card.append(labelled("When records", matchSel));

    const condWrap = el("div", { class: "hb-records__conds" });
    const conditions: Array<{
      field: HTMLSelectElement;
      op: HTMLSelectElement;
      value: HTMLInputElement;
    }> = [];
    const addCond = (seed?: { field: string; op: string; value?: unknown }): void => {
      const r = el("div", { class: "hb-records__cond" });
      const fieldSel = el("select", {
        class: cls.input,
        "aria-label": "Field",
      }) as HTMLSelectElement;
      for (const f of this.fields) fieldSel.append(el("option", { value: f.name }, f.name));
      const opSel = el("select", {
        class: cls.input,
        "aria-label": "Operator",
      }) as HTMLSelectElement;
      const valueIn = el("input", {
        class: cls.input,
        "aria-label": "Value",
        placeholder: "value",
      }) as HTMLInputElement;
      const fillOps = (): void => {
        const type = this.fields.find((f) => f.name === fieldSel.value)?.datatype ?? "text";
        opSel.replaceChildren(
          ...opsForType(type).map((o) => el("option", { value: o.id }, o.label)),
        );
      };
      fieldSel.addEventListener("change", fillOps);
      fillOps();
      if (seed) {
        fieldSel.value = seed.field;
        fillOps();
        opSel.value = seed.op;
        valueIn.value = seed.value == null ? "" : String(seed.value);
      }
      const remove = el(
        "button",
        { class: cls.buttonSecondary, type: "button", "aria-label": "Remove" },
        "×",
      );
      remove.addEventListener("click", () => {
        const idx = conditions.findIndex((c) => c.field === fieldSel);
        if (idx >= 0) conditions.splice(idx, 1);
        r.remove();
      });
      r.append(fieldSel, opSel, valueIn, remove);
      condWrap.append(r);
      conditions.push({ field: fieldSel, op: opSel, value: valueIn });
    };
    (
      this.activeFilter?.conditions ?? [{ field: this.fields[0]?.name ?? "", op: "contains" }]
    ).forEach((c) => addCond(c));
    card.append(
      condWrap,
      button("Add condition", () => addCond()),
    );

    if (this.savedFilters.length > 0) {
      const saved = el("div", { class: "hb-records__saved" });
      saved.append(el("span", { class: "hb-records__saved-label" }, "Saved filters:"));
      for (const f of this.savedFilters) {
        saved.append(
          button(f.name ?? "Filter", () => {
            this.activeFilter = f;
            this.current = 0;
            overlay.remove();
            this.rerender();
          }),
        );
      }
      card.append(saved);
    }

    const build = (): FilterSet => ({
      match: matchSel.value as "all" | "any",
      conditions: conditions.map((c) => ({
        field: c.field.value,
        op: c.op.value,
        value: c.value.value,
      })),
    });
    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Cancel", () => overlay.remove()),
      button("Save as…", () => {
        const name = typeof prompt === "function" ? prompt("Name this filter:") : null;
        if (name && name.trim()) {
          const set = { ...build(), name: name.trim() };
          this.savedFilters.push(set);
          this.activeFilter = set;
          this.current = 0;
          overlay.remove();
          this.rerender();
        }
      }),
      primary("Apply", () => {
        this.activeFilter = build();
        this.current = 0;
        overlay.remove();
        this.rerender();
      }),
    );
    card.append(foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  // ---- multi-key sort dialog -----------------------------------------------

  private openSortDialog(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog",
      role: "dialog",
      "aria-label": "Sort records",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Sort by"));
    const wrap = el("div", { class: "hb-records__conds" });
    const keys: Array<{ field: HTMLSelectElement; dir: HTMLSelectElement }> = [];
    const addKey = (seed?: SortKey): void => {
      const r = el("div", { class: "hb-records__cond" });
      const fieldSel = el("select", {
        class: cls.input,
        "aria-label": "Field",
      }) as HTMLSelectElement;
      for (const f of this.fields) fieldSel.append(el("option", { value: f.name }, f.name));
      const dirSel = el("select", {
        class: cls.input,
        "aria-label": "Direction",
      }) as HTMLSelectElement;
      dirSel.append(
        el("option", { value: "asc" }, "A → Z (ascending)"),
        el("option", { value: "desc" }, "Z → A (descending)"),
      );
      if (seed) {
        fieldSel.value = seed.field;
        dirSel.value = seed.dir ?? "asc";
      }
      r.append(fieldSel, dirSel);
      wrap.append(r);
      keys.push({ field: fieldSel, dir: dirSel });
    };
    (this.sortKeys.length
      ? this.sortKeys
      : [{ field: this.fields[0]?.name ?? "", dir: "asc" as const }]
    ).forEach((k) => addKey(k));
    card.append(
      wrap,
      button("Add another sort key", () => addKey()),
    );
    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Clear", () => {
        this.sortKeys = [];
        overlay.remove();
        this.rerender();
      }),
      primary("Apply", () => {
        this.sortKeys = keys.map((k) => ({
          field: k.field.value,
          dir: k.dir.value as "asc" | "desc",
        }));
        overlay.remove();
        this.rerender();
      }),
    );
    card.append(foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  // ---- reports (ReportCreator heir, AC-WKS-D12..D14) -----------------------

  /** All records as plain rows (computed), for a report. */
  private reportRows(): Row[] {
    return this.records.map((r) => this.computed(r));
  }

  private numberFields(): Field[] {
    return this.fields.filter(
      (f) => f.datatype === "number" || f.datatype === "auto" || f.datatype === "formula",
    );
  }

  /** The guided Report creator: "What do you want to total?" + Ember one-liner. */
  private openReportBuilder(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog hb-records__reportdlg",
      role: "dialog",
      "aria-label": "Create a report",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Create a report"));

    const titleIn = el("input", {
      class: cls.input,
      placeholder: "Report title",
    }) as HTMLInputElement;
    titleIn.value = "Report";

    // Ember one-liner.
    const oneLiner = el("input", {
      class: cls.input,
      placeholder: 'Describe it, e.g. "monthly totals by category"',
    }) as HTMLInputElement;
    const emberRow = el("div", { class: "hb-records__cond" });
    emberRow.append(
      oneLiner,
      button("Build from this", () => applyPhrase()),
    );

    // "What do you want to total?", summary rows (field + aggregate).
    const summaryWrap = el("div", { class: "hb-records__conds" });
    const summaries: Array<{ field: HTMLSelectElement; agg: HTMLSelectElement }> = [];
    const addSummary = (seed?: { field: string; agg: string }): void => {
      const r = el("div", { class: "hb-records__cond" });
      const aggSel = el("select", {
        class: cls.input,
        "aria-label": "Aggregate",
      }) as HTMLSelectElement;
      for (const a of REPORT_AGGS) aggSel.append(el("option", { value: a.id }, a.label));
      const fieldSel = el("select", {
        class: cls.input,
        "aria-label": "Field to total",
      }) as HTMLSelectElement;
      for (const f of this.numberFields()) fieldSel.append(el("option", { value: f.name }, f.name));
      if (this.numberFields().length === 0) {
        for (const f of this.fields) fieldSel.append(el("option", { value: f.name }, f.name));
      }
      if (seed) {
        aggSel.value = seed.agg;
        fieldSel.value = seed.field;
      }
      const remove = el(
        "button",
        { class: cls.buttonSecondary, type: "button", "aria-label": "Remove" },
        "×",
      );
      remove.addEventListener("click", () => {
        const i = summaries.findIndex((s) => s.agg === aggSel);
        if (i >= 0) summaries.splice(i, 1);
        r.remove();
      });
      r.append(el("span", { class: "hb-records__cond-of" }, "of"), aggSel, fieldSel, remove);
      summaryWrap.append(r);
      summaries.push({ field: fieldSel, agg: aggSel });
    };
    addSummary();

    // Group by.
    const groupSel = el("select", {
      class: cls.input,
      "aria-label": "Group by",
    }) as HTMLSelectElement;
    groupSel.append(el("option", { value: "" }, "No grouping"));
    for (const f of this.fields) groupSel.append(el("option", { value: f.name }, f.name));

    const useFilter = el("input", { type: "checkbox" }) as HTMLInputElement;
    useFilter.checked = Boolean(this.activeFilter);
    const filterRow = el("label", { class: "hb-records__check" });
    filterRow.append(
      useFilter,
      el(
        "span",
        {},
        this.activeFilter
          ? "Use the current filter"
          : "No filter applied (set one with Filter first)",
      ),
    );

    const applyPhrase = (): void => {
      const spec = inferReportSpec(oneLiner.value, this.fields);
      titleIn.value = spec.title ?? titleIn.value;
      groupSel.value = spec.groupBy ?? "";
      summaryWrap.replaceChildren();
      summaries.length = 0;
      const defs =
        spec.summaries && spec.summaries.length
          ? spec.summaries
          : [{ field: this.numberFields()[0]?.name ?? "", agg: "sum" as const }];
      for (const s of defs) addSummary(s);
    };

    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Cancel", () => overlay.remove()),
      primary("Create report", () => {
        const spec: ReportSpec = {
          title: titleIn.value.trim() || "Report",
          groupBy: groupSel.value || null,
          summaries: summaries.map((s) => ({
            field: s.field.value,
            agg: s.agg.value as ReportAgg,
          })),
          filter: useFilter.checked ? this.activeFilter : null,
          columns: this.dedupe([
            ...(groupSel.value ? [groupSel.value] : []),
            ...summaries.map((s) => s.field.value),
          ]),
          sort: this.sortKeys,
        };
        overlay.remove();
        this.showReport(buildReport(this.reportRows(), spec, this.fields));
      }),
    );

    card.append(
      labelled("Title", titleIn),
      el("p", { class: "hb-records__hint" }, "What do you want to total?"),
      summaryWrap,
      button("Add another total", () => addSummary()),
      labelled("Group by", groupSel),
      filterRow,
      el(
        "p",
        { class: "hb-records__hint" },
        "Or describe it in a line, Ember drafts it on-device:",
      ),
      emberRow,
      foot,
    );
    overlay.append(card);
    document.body.append(overlay);
  }

  private dedupe(list: string[]): string[] {
    return [...new Set(list.filter((s) => s !== ""))];
  }

  /** Render the finished report with print / copy / send-to-letter outputs. */
  private showReport(report: Report): void {
    const overlay = el("div", { class: "hb-records__reportview" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const sheet = el("div", { class: "hb-records__report", role: "document" });

    const tools = el("div", { class: "hb-records__report-tools" });
    tools.append(
      el("h2", { class: "hb-records__report-title" }, report.title),
      button("Print / PDF", () => window.print()),
      button("Copy as text", () => {
        void navigator.clipboard?.writeText(reportToText(report));
        this.options.onError?.("Report copied to the clipboard as text.");
      }),
      this.options.onPublishReport
        ? button("Send to letter", () => {
            this.options.onPublishReport?.(report.title, reportMergeRecords(report));
            this.options.onError?.(`“${report.title}” is now a merge source in Writer.`);
          })
        : el("span"),
      button("Close", () => overlay.remove()),
    );

    const body = el("div", { class: "hb-records__report-body" });
    if (report.grouped && report.groups) {
      for (const group of report.groups) {
        body.append(
          el("div", { class: "hb-records__report-group" }, `${report.groupBy}: ${group.key}`),
        );
        body.append(this.reportTable(report.columns, group.rows, group.summaries));
      }
    } else {
      body.append(this.reportTable(report.columns, report.rows ?? [], []));
    }
    body.append(el("div", { class: "hb-records__report-grand" }, "Grand totals"));
    body.append(this.summaryRow(report.grand));

    sheet.append(tools, body);
    overlay.append(sheet);
    document.body.append(overlay);
  }

  private reportTable(columns: string[], rows: Row[], summaries: Report["grand"]): HTMLElement {
    const table = el("table", { class: "hb-table hb-records__report-table" });
    const head = el("tr");
    for (const c of columns) head.append(el("th", {}, c));
    table.append(head);
    for (const row of rows) {
      const tr = el("tr");
      for (const c of columns) tr.append(el("td", {}, row[c] == null ? "" : String(row[c])));
      table.append(tr);
    }
    if (summaries.length > 0) {
      const tr = el("tr", { class: "hb-records__report-subtotal" });
      const td = el("td", {});
      td.setAttribute("colspan", String(columns.length));
      td.append(this.summaryRow(summaries));
      tr.append(td);
      table.append(tr);
    }
    return table;
  }

  private summaryRow(summaries: Report["grand"]): HTMLElement {
    const wrap = el("div", { class: "hb-records__report-summary" });
    for (const s of summaries) {
      wrap.append(
        el("span", { class: "hb-records__report-stat" }, `${s.label} ${s.field}: ${s.value}`),
      );
    }
    if (summaries.length === 0) {
      wrap.append(el("span", { class: "hb-records__report-stat" }, "-"));
    }
    return wrap;
  }

  // ---- delimited export (AC-WKS-D17) ---------------------------------------

  private openExport(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog",
      role: "dialog",
      "aria-label": "Export records",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Export records"));
    const delimSel = el("select", {
      class: cls.input,
      "aria-label": "Delimiter",
    }) as HTMLSelectElement;
    delimSel.append(
      el("option", { value: "," }, "Comma (.csv)"),
      el("option", { value: "\t" }, "Tab (.tsv)"),
      el("option", { value: ";" }, "Semicolon"),
    );
    const out = el("textarea", {
      class: cls.input,
      rows: "8",
      readonly: "",
    }) as HTMLTextAreaElement;
    const build = (): void => {
      const rows = this.visibleRecords().map((r) => this.computed(r));
      out.value = toDelimited(this.visibleFields(), rows, delimSel.value);
    };
    delimSel.addEventListener("change", build);
    build();
    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Copy", () => {
        out.select();
        void navigator.clipboard?.writeText(out.value);
      }),
      primary("Download", () =>
        this.download(out.value, delimSel.value === "\t" ? "records.tsv" : "records.csv"),
      ),
      button("Close", () => overlay.remove()),
    );
    card.append(labelled("Format", delimSel), out, foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  private download(text: string, filename: string): void {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---- CSV import ----------------------------------------------------------

  private openCsvImport(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog",
      role: "dialog",
      "aria-label": "Import records",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Import delimited data"));
    const delimSel = el("select", {
      class: cls.input,
      "aria-label": "Delimiter",
    }) as HTMLSelectElement;
    delimSel.append(
      el("option", { value: "," }, "Comma"),
      el("option", { value: "\t" }, "Tab"),
      el("option", { value: ";" }, "Semicolon"),
    );
    const area = el("textarea", {
      class: cls.input,
      "aria-label": "Paste data",
      rows: "8",
      placeholder: "Name,Age\nAda,36",
    }) as HTMLTextAreaElement;
    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Cancel", () => overlay.remove()),
      primary("Import", () => {
        overlay.remove();
        void this.importDelimited(area.value, delimSel.value);
      }),
    );
    card.append(
      labelled("Format", delimSel),
      el("p", { class: "hb-records__hint" }, "Fields and types are inferred."),
      area,
      foot,
    );
    overlay.append(card);
    document.body.append(overlay);
  }

  /** Infer the schema and import rows into the in-memory model + store. */
  async importDelimited(text: string, delimiter = ","): Promise<void> {
    try {
      const { header, rows } = parseDelimited(text, delimiter);
      const schema = inferSchema(header, rows);
      const tableId = await this.client.createTable(this.options.bundleId, "Imported");
      this.tableId = tableId;
      this.fields = [];
      for (const field of schema) {
        const id = await this.client.addField(tableId, field.name, field.datatype);
        this.fields.push({ id, name: field.name, datatype: field.datatype });
      }
      this.records = [];
      for (const row of rows) {
        const values: Row = {};
        this.fields.forEach((field, index) => {
          values[field.name] = row[index] ?? null;
        });
        this.seq += 1;
        const record: Record_ = { __id: `imp-${this.seq}`, saved: false, values };
        this.records.push(record);
        await this.persistInsert(record);
      }
      this.view = "table";
      this.rerender();
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- persistence helpers --------------------------------------------------

  /** The persistable (non-formula) field values of a record, as FieldValues. */
  private rowFieldValues(record: Record_): FieldValue[] {
    return this.fields
      .filter((f) => f.datatype !== "formula")
      .map((field) => ({
        field_id: field.id,
        value: toRecordValue(field.datatype, record.values[field.name]),
      }));
  }

  private async persistInsert(record: Record_): Promise<void> {
    try {
      const tableId = await this.ensureTable();
      // The store returns the real row id; adopt it so later edits can update it.
      record.__id = await this.client.insertRow({
        table_id: tableId,
        values: this.rowFieldValues(record),
      });
      record.saved = true;
    } catch (error) {
      this.fail(error);
    }
  }

  /** Persist an edit to an already-saved record (closes the in-memory seam). */
  private async persistUpdate(record: Record_): Promise<void> {
    try {
      await this.client.updateRow({ row_id: record.__id, values: this.rowFieldValues(record) });
    } catch (error) {
      this.fail(error);
    }
  }

  private async linkContacts(): Promise<void> {
    const provider = this.options.contactsProvider;
    if (!provider) {
      return;
    }
    const { fields, rows } = provider();
    try {
      await this.ensureTable();
      const byName = new Map(this.fields.map((f) => [f.name, f]));
      for (const f of fields) {
        if (!byName.has(f.name)) {
          const id = await this.client.addField(
            this.tableId as string,
            f.name,
            f.datatype as FieldType,
          );
          const created: Field = { id, name: f.name, datatype: f.datatype as FieldType };
          this.fields.push(created);
          byName.set(f.name, created);
        }
      }
      for (const row of rows) {
        this.seq += 1;
        const values: Row = {};
        for (const field of this.fields) {
          values[field.name] = row[field.name] ?? null;
        }
        const record: Record_ = { __id: `c-${this.seq}`, saved: false, values };
        this.records.push(record);
        await this.persistInsert(record);
      }
      this.view = "table";
      this.rerender();
    } catch (error) {
      this.fail(error);
    }
  }

  private async promptAddField(): Promise<void> {
    if (this.locked) {
      return;
    }
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-records__dialog",
      role: "dialog",
      "aria-label": "Add field",
    });
    card.append(el("h2", { class: "hb-records__dialog-title" }, "Add field"));
    const nameIn = el("input", { class: cls.input, placeholder: "Field name" }) as HTMLInputElement;
    const typeSel = el("select", { class: cls.input, "aria-label": "Type" }) as HTMLSelectElement;
    for (const t of FIELD_TYPES) typeSel.append(el("option", { value: t }, FIELD_TYPE_LABELS[t]));
    const defaultIn = el("input", {
      class: cls.input,
      placeholder: "Default value (optional)",
    }) as HTMLInputElement;
    const formulaIn = el("input", {
      class: cls.input,
      placeholder: "Formula, e.g. [Price]*[Qty]",
    }) as HTMLInputElement;
    const formulaRow = labelled("Formula", formulaIn);
    const defaultRow = labelled("Default", defaultIn);
    const syncRows = (): void => {
      formulaRow.style.display = typeSel.value === "formula" ? "" : "none";
      defaultRow.style.display =
        typeSel.value === "formula" || typeSel.value === "auto" ? "none" : "";
    };
    typeSel.addEventListener("change", syncRows);
    syncRows();
    const foot = el("div", { class: "hb-records__dialog-foot" });
    foot.append(
      button("Cancel", () => overlay.remove()),
      primary("Add field", () => {
        const name = nameIn.value.trim();
        if (name === "") {
          return;
        }
        overlay.remove();
        void this.addField(
          name,
          typeSel.value as FieldType,
          defaultIn.value.trim() || undefined,
          formulaIn.value.trim() || undefined,
        );
      }),
    );
    card.append(labelled("Name", nameIn), labelled("Type", typeSel), defaultRow, formulaRow, foot);
    overlay.append(card);
    document.body.append(overlay);
    nameIn.focus();
  }

  private async addField(
    name: string,
    datatype: FieldType,
    def?: string,
    formula?: string,
  ): Promise<void> {
    try {
      const tableId = await this.ensureTable();
      const id = await this.client.addField(tableId, name, datatype);
      this.fields.push({ id, name, datatype, default: def, formula });
      this.rerender();
    } catch (error) {
      this.fail(error);
    }
  }

  private async ensureTable(): Promise<string> {
    if (this.tableId === undefined || this.tableId.startsWith("seed")) {
      this.tableId = await this.client.createTable(this.options.bundleId, "Records");
    }
    for (const field of this.fields) {
      if (field.id.startsWith("seed")) {
        field.id = await this.client.addField(this.tableId, field.name, field.datatype);
      }
    }
    return this.tableId;
  }

  // ---- Ember NL query ------------------------------------------------------

  private renderEmber(): HTMLElement {
    if (!this.ember) {
      const schema = (): string => this.fields.map((f) => `${f.name} (${f.datatype})`).join(", ");
      this.ember = new EmberPanel<EmberRequest>({
        run: (req) => this.client.runEmber(req),
        intro: "Ask about your records in plain language, answered on your device.",
        suggestions: [
          {
            label: "Summarise the table",
            build: (effort) => buildQueryRequest("summarise these records", schema(), effort),
          },
          {
            label: "How many records?",
            build: (effort) => buildQueryRequest("how many records are there?", schema(), effort),
          },
        ],
        ask: {
          placeholder: "Ask about your records…",
          build: (text, effort) => buildQueryRequest(text, schema(), effort),
        },
        onError: (message) => this.options.onError?.(message),
      });
    }
    return el("aside", { class: "hb-records__ember", "aria-label": "Ember" }, this.ember.el());
  }

  /** Send the current table (as CSV) into a chosen Bundle (Portfolio S7). */
  private addToBundle(): void {
    const rows = this.records.map((r) => this.computed(r));
    const csv = toDelimited(this.visibleFields(), rows, ",");
    this.options.onAddToBundle?.({
      docType: "record",
      title: "Records",
      contentBase64: btoa(String.fromCharCode(...new TextEncoder().encode(csv))),
    });
  }

  private fail(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error.message : String(error));
  }
}

// ---- helpers ----------------------------------------------------------------

function inputType(type: FieldType): string {
  if (type === "number" || type === "auto") return "number";
  if (type === "date") return "date";
  if (type === "time") return "time";
  if (type === "bool") return "checkbox";
  if (type === "email") return "email";
  return "text";
}

function formatCell(value: unknown, type: FieldType): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (type === "bool") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  return String(value);
}

/** A table cell's content: Status/Select values render as a pill; the rest are
 *  plain text. (Relation values are the linked record's label, shown as text.) */
function cellNode(value: unknown, type: FieldType): Node | string {
  const text = formatCell(value, type);
  if (text !== "" && (type === "status" || type === "select")) {
    return el("span", { class: `hb-records__tag hb-records__tag--${type}` }, text);
  }
  return text;
}

function toRecordValue(type: FieldType, value: unknown): FieldValue["value"] {
  if (value === null || value === undefined || value === "") {
    return "null";
  }
  if (type === "number" || type === "auto") {
    return { number: Number(value) };
  }
  if (type === "bool") {
    return { bool: value === true || value === "true" || value === "yes" };
  }
  return { text: String(value) };
}

function scalar(value: FieldValue["value"] | undefined): unknown {
  if (value === undefined || value === "null") {
    return null;
  }
  if ("text" in value) return value.text;
  if ("number" in value) return value.number;
  if ("integer" in value) return value.integer;
  if ("bool" in value) return value.bool;
  return null;
}

function modalBackdrop(onOutside: () => void): HTMLElement {
  const overlay = el("div", { class: "hb-modal__backdrop hb-records__modal" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) onOutside();
  });
  return overlay;
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "hb-records__dialog-field" });
  wrap.append(el("span", { class: "hb-records__dialog-label" }, label), control);
  return wrap;
}

function button(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.buttonSecondary, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function navButton(glyph: string, label: string, onClick: () => void): HTMLElement {
  const node = el(
    "button",
    { class: "hb-records__nav-btn", type: "button", "aria-label": label, title: label },
    glyph,
  );
  node.addEventListener("click", onClick);
  return node;
}

function primary(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.buttonPrimary, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function avatar(text: string): HTMLElement {
  const initial = text.trim().charAt(0).toUpperCase() || "·";
  return el("span", { class: "hb-records__avatar", "aria-hidden": "true" }, initial);
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
