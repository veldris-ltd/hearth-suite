/**
 * Hearth Suite Writer, a block-based word processor.
 *
 * Live styles, real tables, images, and a distraction-free default; an Ember
 * panel (draft / rewrite / summarise / change tone / ask your document); a Seal
 * action with plain-language status; and Compose-from-Data mail-merge. Reads and
 * writes Bundles through the FFI client. The render layer is framework-agnostic
 * DOM; document logic lives in `core.mjs`.
 */

import type { EmberRequest, HearthClient } from "@hearth/core-client";
import {
  cls,
  EmberPanel,
  makeStyleSet,
  resolveEffort,
  saveCustomStyleSet,
  styleSetCss,
  styleSetsFor,
  type Effort,
  type PreferenceStorage,
  type StyleSet,
} from "@hearth/design-system";

import { lookup as lookupWord } from "@hearth/lexicon";

import {
  DEFAULT_AUTOCORRECT,
  autoCorrectWord,
  buildAskRequest,
  documentStats,
  emptyDocument,
  expandSpecials,
  findMatches,
  mergeFields,
  pageGeometry,
  paginate,
  replaceInDoc,
  sealStatusText,
  spansFromHtml,
  spansToHtml,
  toOdfModel,
  toPlainText,
} from "./core.mjs";
import type { Block, PageSetup, RenderedPage, WriterDocument } from "./core.mjs";
import { MailingsDialog, type MergeSource } from "./mailings";
import { ChartDialog } from "./chart-embed";
import { renderChartSvg } from "@hearth/charts";
import type { ChartData, ChartSource, ChartSpec } from "@hearth/charts";

// The CSS Custom Highlight API (used for in-surface find highlighting) isn't in
// every TS DOM lib yet — describe the minimal surface we touch, guarded at use.
type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

/** The payload the host receives when the user exports. */
export interface ExportPayload {
  format: string;
  model: ReturnType<typeof toOdfModel>;
}

/** A collaborator currently present in the document. */
export interface Collaborator {
  name: string;
  /** The paragraph number they're editing, shown as a presence chip. */
  paragraph?: number;
}

/** A point in the document's version timeline. */
export interface Revision {
  /** When it happened, in plain language (e.g. "Now", "11:02 AM", "Yesterday"). */
  at: string;
  /** Who made the change (a name, or "You"). */
  actor: string;
  /** What changed (e.g. "edited ¶3", "created", "live"). */
  label: string;
  /** A sealing milestone, marked distinctly. */
  sealed?: boolean;
  /** Whether this revision can be restored. */
  restorable?: boolean;
}

/** Host-supplied hooks for the editor. */
export interface WriterOptions {
  /** The Bundle this document belongs to (for save/seal). */
  bundleId: string;
  /** Names the user has sealed to, for the plain-language status line. */
  recipientNames?: string[];
  /** Whether this document is sealed (end-to-end encrypted). */
  sealed?: boolean;
  /** Others co-editing right now (empty = just you). */
  collaborators?: Collaborator[];
  /** The version timeline (empty = a fresh, solo document). */
  history?: Revision[];
  /** A starter document (e.g. from a Mantel template). */
  initialDocument?: WriterDocument;
  /** A one-line brief for Ember to draft from on open (on-device). */
  initialBrief?: string;
  /** Records/contacts/sheet rows available to Compose-from-Data. */
  dataProvider?: () => Promise<Array<Record<string, unknown>>>;
  /**
   * Merge data sources for the Mailings flows (letters, envelopes, labels).
   * Each source is a named table of rows from Records, a Sheet, or Contacts.
   * When absent, the Mailings menu falls back to {@link dataProvider} as a
   * single "Contacts" source, or hides if neither is provided.
   */
  mergeSources?: () => Promise<MergeSource[]> | MergeSource[];
  /** Persist a merged set of documents into the Bundle. */
  onCreateDocuments?: (docs: WriterDocument[]) => Promise<void> | void;
  /**
   * Resolve live data for a chart's linked source (the Sheets bridge). When
   * present, embedded charts can be live-linked and refreshed from their source.
   */
  chartDataResolver?: (source: ChartSource) => ChartData | null;
  /** Receive the ODF model + chosen format when the user exports. */
  onExport?: (payload: ExportPayload) => void;
  /**
   * Open the host's Seal flow (recipient picker, key card, confirmation). When
   * provided, the Seal button delegates to it; otherwise Writer seals inline.
   */
  onSeal?: (contentBase64: string) => void;
  /** Open this document in a new window (W28). The button hides when absent. */
  onNewWindow?: () => void;
  /** Send the current document into a chosen Bundle (Portfolio collect-flow). */
  onAddToBundle?: (payload: { docType: string; title: string; contentBase64: string }) => void;
  /**
   * Where custom "Easy Formats" style sets are stored. Defaults to
   * `localStorage`; the client shell injects a vault-backed adapter so style
   * sets persist encrypted and travel with sync (P2-CL3), matching Sheets.
   */
  styleStorage?: PreferenceStorage;
  /** Surface an error to the host. */
  onError?: (message: string) => void;
}

const EMBER_ACTIONS: Array<{
  label: string;
  request: (text: string, effort: Effort) => EmberRequest;
}> = [
  { label: "Draft", request: (t, e) => ember("draft", t, "Draft a relevant section.", e) },
  {
    label: "Rewrite",
    request: (t, e) => ember("rewrite", t, "Rewrite the selection for clarity.", e),
  },
  { label: "Summarise", request: (t, e) => ember("summarize", t, "Summarise this document.", e) },
  { label: "Change tone", request: (t, e) => ember("rewrite", t, "Rewrite in a warmer tone.", e) },
];

function ember(
  task: EmberRequest["task"],
  document: string,
  request: string,
  effort: Effort,
): EmberRequest {
  return { task, document, request, effort };
}

/** A single menu-bar dropdown entry, or `"---"` for a divider. */
type MenuItem = "---" | { label: string; onClick: () => void; checked?: boolean };

/** The Writer editor. */
export class Writer {
  private doc: WriterDocument = emptyDocument();
  private distractionFree = false;
  private surface: HTMLElement | undefined;
  private showHistory = false;
  private rightPanel: HTMLElement | undefined;
  private emberPanel: EmberPanel<EmberRequest> | undefined;
  private effort: Effort = resolveEffort();
  private lastRange: Range | undefined;
  private styleMenuWrap: HTMLElement | undefined;
  private zoom = 100;
  private pageView = false;
  private columns = 1;
  private autocorrectOn = true;
  private autocorrectRules: Record<string, string> = { ...DEFAULT_AUTOCORRECT };
  private statsEl: HTMLElement | undefined;
  private docColumn: HTMLElement | undefined;
  private menuCloses: Array<() => void> = [];
  private menuBarOpen = false;
  private findBarEl: HTMLElement | undefined;
  private findStatusEl: HTMLElement | undefined;
  private findQuery = "";
  private findRanges: Range[] = [];
  private findIndex = 0;
  private pageSetup: PageSetup = { size: "A4", orientation: "portrait", marginMm: 25, fontPt: 11 };
  private headerText = "";
  private footerText = "Page {page} of {pages}";
  private readonly footnotes: Array<{ id: number; text: string }> = [];
  private footnoteSeq = 0;
  private selectedImage: HTMLElement | undefined;

  constructor(
    private readonly client: HearthClient,
    private readonly options: WriterOptions,
  ) {
    if (options.initialDocument) {
      this.doc = options.initialDocument;
    }
  }

  /** The current document model, reflecting any edits made in the surface. */
  document(): WriterDocument {
    this.syncFromDom();
    return this.doc;
  }

  /**
   * Read the contenteditable surface back into the document model, so Ember,
   * Compose-from-Data, Seal, and export all operate on the user's live edits.
   */
  private syncFromDom(): void {
    if (!this.surface) {
      return;
    }
    const blocks: Block[] = [];
    for (const node of Array.from(this.surface.children)) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        blocks.push({
          kind: "heading",
          level: Number(tag.slice(1)),
          spans: spansFromHtml(node.innerHTML),
        });
      } else if (tag === "table") {
        const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => spansFromHtml(td.innerHTML)),
        );
        blocks.push({ kind: "table", rows });
      } else if (tag === "img") {
        blocks.push({
          kind: "image",
          src: node.getAttribute("src") ?? "",
          alt: node.getAttribute("alt") ?? "",
        });
      } else if (tag === "figure" && node.hasAttribute("data-chart")) {
        try {
          blocks.push({ kind: "chart", spec: JSON.parse(node.getAttribute("data-chart") ?? "{}") });
        } catch {
          // Skip a malformed chart figure rather than losing the whole sync.
        }
      } else {
        blocks.push({ kind: "paragraph", spans: spansFromHtml(node.innerHTML) });
      }
    }
    if (blocks.length > 0) {
      this.doc = { ...this.doc, blocks };
    }
  }

  /** Render the editor into `root`. */
  mount(root: HTMLElement): void {
    const shell = el("div", { class: "hb-writer" });
    if (this.distractionFree) {
      shell.classList.add("hb-writer--focus");
    }
    this.rightPanel = this.renderRightPanel();
    shell.append(this.renderToolbar(shell), this.renderDoc(), this.rightPanel, this.renderSeal());
    root.replaceChildren(shell);
    // Dismiss any open menu when the user mouses down outside the menu bar.
    document.addEventListener("mousedown", (event) => {
      if (this.menuBarOpen && !(event.target as HTMLElement)?.closest?.(".hb-writer__menubar")) {
        this.closeMenus();
      }
    });
    if (this.options.initialBrief) {
      void this.draftFromBrief(this.options.initialBrief);
    }
  }

  /** Draft the document from a one-line brief, on-device (Mantel Ember route). */
  private async draftFromBrief(brief: string): Promise<void> {
    if (!this.surface) {
      return;
    }
    this.surface.replaceChildren(renderBlock(para("Drafting with Ember, on your device…")));
    try {
      const response = await this.client.runEmber({
        task: "draft",
        document: "",
        request: `Draft this for me: ${brief}`,
        effort: this.effort,
      });
      const lines = response.text.split(/\n+/).filter((l) => l.trim() !== "");
      const blocks = (lines.length > 0 ? lines : [response.text]).map((line) => para(line));
      this.doc = { ...this.doc, blocks };
      this.surface.replaceChildren(...blocks.map(renderBlock));
    } catch (error) {
      this.fail(error);
    }
  }

  private isSealed(): boolean {
    return this.options.sealed ?? (this.options.recipientNames ?? []).length > 0;
  }

  /** The document column: presence, status meta, find bar, surface, status bar. */
  private renderDoc(): HTMLElement {
    const doc = el(
      "div",
      { class: `hb-writer__doc${this.pageView ? " hb-writer__doc--page" : ""}` },
      this.renderPresence(),
      this.renderMeta(),
      this.renderFindBar(),
      this.renderSurface(),
      this.renderStatsBar(),
    );
    this.docColumn = doc;
    return doc;
  }

  /** A live word/character/paragraph status bar (W16). */
  private renderStatsBar(): HTMLElement {
    const bar = el("div", { class: "hb-writer__stats", role: "status" });
    this.statsEl = bar;
    this.updateStats();
    return bar;
  }

  private updateStats(): void {
    if (!this.statsEl) {
      return;
    }
    this.syncFromDom();
    const s = documentStats(this.doc);
    this.statsEl.textContent = `${s.words} words · ${s.characters} characters · ${s.paragraphs} paragraphs`;
  }

  /** Collaboration presence: who's here, and the always-on encryption cue. */
  private renderPresence(): HTMLElement {
    const bar = el("div", { class: "hb-writer__presence" });
    const left = el("div", { class: "hb-writer__presence-who" });
    const collaborators = this.options.collaborators ?? [];

    const stack = el("div", { class: cls.avatarStack });
    stack.append(presenceAvatar("You", true));
    for (const person of collaborators) {
      stack.append(presenceAvatar(person.name, false));
    }
    left.append(stack);

    const [first] = collaborators;
    if (!first) {
      left.append(el("span", { class: "hb-writer__presence-text" }, "Just you"));
    } else {
      left.append(el("span", { class: "hb-writer__presence-text" }, `${first.name} is editing`));
      if (first.paragraph !== undefined) {
        left.append(
          el("span", { class: "hb-writer__presence-chip" }, `${first.name} · ¶${first.paragraph}`),
        );
      }
    }

    const e2e = el("span", { class: cls.sealedChip });
    e2e.innerHTML = `${shield(16)}<span>Co-edit is end-to-end encrypted</span>`;
    bar.append(left, e2e);
    return bar;
  }

  /** The plain-language document status line under the title. */
  private renderMeta(): HTMLElement {
    const where = this.isSealed() ? "synced encrypted" : "saved on this device";
    return el("p", { class: "hb-writer__doc-meta" }, `Edited just now · ${where}`);
  }

  private renderRightPanel(): HTMLElement {
    return this.showHistory ? this.renderHistory() : this.renderEmberPanel();
  }

  private toggleHistory(): void {
    this.showHistory = !this.showHistory;
    const next = this.renderRightPanel();
    this.rightPanel?.replaceWith(next);
    this.rightPanel = next;
  }

  // ---- Version history (CRDT-backed, conflict-free) ------------------------

  private renderHistory(): HTMLElement {
    const panel = el("aside", { class: "hb-writer__history", "aria-label": "Version history" });
    const head = el("div", { class: "hb-writer__history-head" });
    head.append(el("span", { class: "hb-writer__history-title" }, "Version history"));
    const close = el("button", {
      class: "hb-writer__history-close",
      type: "button",
      "aria-label": "Close version history",
    });
    close.textContent = "×";
    close.addEventListener("click", () => this.toggleHistory());
    head.append(close);
    panel.append(head);

    const revisions = this.history();
    const timeline = el("ol", { class: "hb-writer__timeline" });
    for (const rev of revisions) {
      timeline.append(this.renderRevision(rev));
    }
    panel.append(timeline);

    const note = el("div", { class: "hb-writer__history-note" });
    note.textContent =
      "Conflict-free by design: two people can edit the same line and both changes survive.";
    panel.append(note);
    return panel;
  }

  /** The timeline, defaulting to a calm solo history for a fresh document. */
  private history(): Revision[] {
    if (this.options.history && this.options.history.length > 0) {
      return this.options.history;
    }
    return [
      { at: "Now", actor: "You", label: "editing · live" },
      { at: "Just now", actor: "You", label: "created", restorable: false },
    ];
  }

  private renderRevision(rev: Revision): HTMLElement {
    const item = el("li", { class: `hb-writer__rev${rev.sealed ? " is-sealed" : ""}` });
    item.append(el("span", { class: "hb-writer__rev-dot" }));
    const body = el("div", { class: "hb-writer__rev-body" });
    body.append(el("div", { class: "hb-writer__rev-at" }, rev.at));
    const line = el("div", { class: "hb-writer__rev-line" });
    if (rev.sealed) {
      line.innerHTML = `${shield(14)}<span>${rev.actor} · ${rev.label}</span>`;
    } else {
      line.append(
        presenceAvatar(rev.actor, rev.actor === "You"),
        el("span", {}, `${rev.actor} · ${rev.label}`),
      );
    }
    body.append(line);
    if (rev.restorable) {
      const restore = el("button", { class: cls.buttonGhost, type: "button" }, "Restore");
      body.append(restore);
    }
    item.append(body);
    return item;
  }

  /**
   * The editor chrome: an industry-standard menu bar (File · Edit · View ·
   * Insert · Format · Tools) stacked above a single formatting ribbon. The
   * ribbon holds only character- and paragraph-level formatting (the controls a
   * writer reaches for constantly); every command action lives in the menus.
   */
  private renderToolbar(shell: HTMLElement): HTMLElement {
    const wrap = el("div", { class: "hb-writer__toolbar" });
    wrap.append(this.renderMenuBar(shell), this.renderRibbon());
    return wrap;
  }

  /** The standard menu bar above the ribbon. */
  private renderMenuBar(shell: HTMLElement): HTMLElement {
    this.menuCloses = [];
    const bar = el("div", { class: "hb-writer__menubar", role: "menubar" });

    const fileItems: MenuItem[] = [];
    if (this.options.onNewWindow) {
      fileItems.push({ label: "New window", onClick: () => this.options.onNewWindow?.() });
      fileItems.push("---");
    }
    if (this.options.onAddToBundle) {
      fileItems.push({ label: "Add to Bundle…", onClick: () => this.addToBundle() });
      fileItems.push("---");
    }
    fileItems.push({ label: "Print preview…", onClick: () => this.openPrintPreview() });
    fileItems.push("---");
    fileItems.push({ label: "Export as ODF", onClick: () => this.exportAs("odf") });
    fileItems.push({ label: "Export as Word (.docx)", onClick: () => this.exportAs("docx") });
    fileItems.push({ label: "Export as PDF", onClick: () => this.exportAs("pdf") });

    bar.append(
      this.menu("File", () => fileItems),
      this.menu("Edit", () => [{ label: "Find & Replace…", onClick: () => this.toggleFind() }]),
      this.menu("View", () => [
        { label: "Page view", checked: this.pageView, onClick: () => this.toggleView() },
        "---",
        { label: "Zoom to 75%", checked: this.zoom === 75, onClick: () => this.setZoom(75) },
        { label: "Zoom to 100%", checked: this.zoom === 100, onClick: () => this.setZoom(100) },
        { label: "Zoom to 125%", checked: this.zoom === 125, onClick: () => this.setZoom(125) },
        { label: "Zoom to 150%", checked: this.zoom === 150, onClick: () => this.setZoom(150) },
        "---",
        {
          label: "Focus mode",
          checked: this.distractionFree,
          onClick: () => this.toggleFocus(shell),
        },
        {
          label: "Version history",
          checked: this.showHistory,
          onClick: () => this.toggleHistory(),
        },
      ]),
      this.menu("Insert", () => [
        { label: "Link…", onClick: () => this.insertLink() },
        { label: "Table", onClick: () => this.insertTable() },
        { label: "Image…", onClick: () => this.insertImage() },
        { label: "Chart…", onClick: () => this.openChartDialog() },
        { label: "Refresh charts from source", onClick: () => this.refreshCharts() },
        { label: "Shape", onClick: () => this.insertShape() },
        { label: "Display text…", onClick: () => this.insertDisplayText() },
        { label: "Footnote", onClick: () => this.insertFootnote() },
        { label: "Margin note", onClick: () => this.addMarginNote() },
      ]),
      this.menu("Format", () => [
        { label: "Borders & shading", onClick: () => this.applyBlockBorders() },
        { label: "Wrap text around image", onClick: () => this.cycleImageWrap() },
      ]),
      this.menu("Mailings", () => {
        const items: MenuItem[] = [];
        if (this.hasMerge()) {
          items.push(
            { label: "Insert merge field…", onClick: () => void this.insertMergeField() },
            "---",
          );
        }
        items.push(
          { label: "Mail merge letters…", onClick: () => void this.openMailings("letters") },
          { label: "Envelopes…", onClick: () => void this.openMailings("envelopes") },
          { label: "Labels…", onClick: () => void this.openMailings("labels") },
        );
        return items;
      }),
      this.menu("Tools", () => [
        { label: "Define / Thesaurus…", onClick: () => this.openDefine() },
        {
          label: "AutoCorrect while typing",
          checked: this.autocorrectOn,
          onClick: () => this.toggleAutoCorrect(),
        },
        { label: "Edit AutoCorrect rules…", onClick: () => this.editAutoCorrectRules() },
      ]),
    );
    return bar;
  }

  /** The single formatting ribbon: character + paragraph controls only. */
  private renderRibbon(): HTMLElement {
    const bar = el("div", {
      class: "hb-writer__ribbon",
      role: "toolbar",
      "aria-label": "Formatting",
    });
    const cmd = (command: string, value?: string) => () =>
      document.execCommand(command, false, value);

    // Character formatting (W2).
    const fontSelect = select("Font", ["Default", "Literata", "Spline Sans"], (v) =>
      document.execCommand("fontName", false, v === "Default" ? "inherit" : v),
    );
    const sizeSelect = select("Size", ["Small", "Normal", "Large", "Huge"], (v) =>
      document.execCommand(
        "fontSize",
        false,
        { Small: "2", Normal: "3", Large: "5", Huge: "6" }[v] ?? "3",
      ),
    );
    const colour = el("input", {
      class: "hb-writer__colour",
      type: "color",
      value: "#9c4413",
      "aria-label": "Text colour",
      title: "Text colour",
    }) as HTMLInputElement;
    colour.addEventListener("input", () => document.execCommand("foreColor", false, colour.value));

    // Paragraph (W3) + lists (W5) + columns (W8).
    const lineSpacing = select("Spacing", ["1.0", "1.15", "1.5", "2.0"], (v) =>
      this.setLineSpacing(v),
    );
    const columnsSelect = select("Columns", ["1 column", "2 columns", "3 columns"], (v) =>
      this.setColumns(Number(v.charAt(0))),
    );

    bar.append(
      this.renderStyles(),
      sep(),
      iconButton("B", "Bold", cmd("bold"), "hb-writer__b"),
      iconButton("I", "Italic", cmd("italic"), "hb-writer__i"),
      iconButton("U", "Underline", cmd("underline"), "hb-writer__u"),
      iconButton("S", "Strikethrough", cmd("strikeThrough"), "hb-writer__s"),
      iconButton("x²", "Superscript", cmd("superscript")),
      iconButton("x₂", "Subscript", cmd("subscript")),
      fontSelect,
      sizeSelect,
      colour,
      sep(),
      iconButton("⯇", "Align left", cmd("justifyLeft")),
      iconButton("≡", "Align centre", cmd("justifyCenter")),
      iconButton("⯈", "Align right", cmd("justifyRight")),
      iconButton("⯌", "Justify", cmd("justifyFull")),
      iconButton("⇥", "Indent", cmd("indent")),
      iconButton("⇤", "Outdent", cmd("outdent")),
      iconButton("•", "Bullets", cmd("insertUnorderedList")),
      iconButton("1.", "Numbering", cmd("insertOrderedList")),
      lineSpacing,
      sep(),
      columnsSelect,
    );
    return bar;
  }

  /**
   * Build one menu-bar dropdown. Items are computed lazily on each open so
   * checkmarks reflect live state. The button and items act on `mousedown` with
   * `preventDefault`, so the contenteditable keeps focus and selection, letting
   * Insert/Format commands operate on the user's current selection.
   */
  private menu(label: string, items: () => MenuItem[]): HTMLElement {
    const wrap = el("div", { class: "hb-writer__menu" });
    const btn = el("button", {
      class: "hb-writer__menu-btn",
      type: "button",
      "aria-haspopup": "true",
      "aria-expanded": "false",
    });
    btn.textContent = label;
    const pop = el("div", { class: "hb-writer__menu-pop", role: "menu", hidden: "" });

    const close = (): void => {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      wrap.classList.remove("is-open");
    };
    this.menuCloses.push(close);

    const open = (): void => {
      pop.replaceChildren();
      for (const item of items()) {
        if (item === "---") {
          pop.append(el("div", { class: "hb-writer__menu-sep" }));
          continue;
        }
        const mi = el("button", {
          class: "hb-writer__menu-item",
          type: "button",
          role: "menuitem",
        });
        if (item.checked) {
          mi.classList.add("is-checked");
        }
        mi.append(el("span", { class: "hb-writer__menu-check" }, item.checked ? "✓" : ""));
        mi.append(el("span", { class: "hb-writer__menu-label" }, item.label));
        mi.addEventListener("mousedown", (event) => {
          event.preventDefault();
          close();
          item.onClick();
        });
        pop.append(mi);
      }
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("is-open");
      this.menuBarOpen = true;
    };

    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const wasOpen = !pop.hidden;
      this.closeMenus();
      if (!wasOpen) {
        open();
      }
    });
    btn.addEventListener("mouseenter", () => {
      // Once a menu is open, hovering a sibling switches to it (standard behaviour).
      if (this.menuBarOpen && pop.hidden) {
        this.closeMenus();
        open();
      }
    });
    wrap.append(btn, pop);
    return wrap;
  }

  /** Close every open menu dropdown. */
  private closeMenus(): void {
    for (const close of this.menuCloses) {
      close();
    }
    this.menuBarOpen = false;
  }

  private toggleFocus(shell: HTMLElement): void {
    this.distractionFree = !this.distractionFree;
    shell.classList.toggle("hb-writer--focus", this.distractionFree);
  }

  private toggleAutoCorrect(): void {
    this.autocorrectOn = !this.autocorrectOn;
  }

  /**
   * Edit the AutoCorrect rule list — add, change, or remove rules (W18). Rules
   * are plain "type this → get that" pairs; changes apply immediately to typing.
   */
  private editAutoCorrectRules(): void {
    const overlay = el("div", { class: "hb-print__backdrop" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const panel = el("div", {
      class: "hb-writer__rules",
      role: "dialog",
      "aria-label": "AutoCorrect rules",
    });
    panel.append(
      el("h2", { class: "hb-writer__rules-title" }, "AutoCorrect rules"),
      el(
        "p",
        { class: "hb-writer__rules-hint" },
        "Type the word on the left and Writer swaps in the word on the right.",
      ),
    );
    const list = el("div", { class: "hb-writer__rules-list" });
    const rows = Object.entries(this.autocorrectRules).map(([from, to]) => ({ from, to }));

    const commit = (): void => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const from = row.from.trim().toLowerCase();
        if (from !== "" && row.to !== "") {
          next[from] = row.to;
        }
      }
      this.autocorrectRules = next;
    };

    const renderRows = (): void => {
      list.replaceChildren();
      rows.forEach((row, index) => {
        const r = el("div", { class: "hb-writer__rules-row" });
        const from = el("input", {
          class: cls.input,
          value: row.from,
          placeholder: "teh",
          "aria-label": "Replace",
        }) as HTMLInputElement;
        from.addEventListener("input", () => {
          row.from = from.value;
          commit();
        });
        const to = el("input", {
          class: cls.input,
          value: row.to,
          placeholder: "the",
          "aria-label": "With",
        }) as HTMLInputElement;
        to.addEventListener("input", () => {
          row.to = to.value;
          commit();
        });
        const del = el(
          "button",
          { class: cls.buttonGhost, type: "button", "aria-label": "Remove rule" },
          "Remove",
        );
        del.addEventListener("click", () => {
          rows.splice(index, 1);
          commit();
          renderRows();
        });
        r.append(from, el("span", { class: "hb-writer__rules-arrow" }, "→"), to, del);
        list.append(r);
      });
    };
    renderRows();

    const add = el("button", { class: cls.buttonSecondary, type: "button" }, "Add a rule");
    add.addEventListener("click", () => {
      rows.push({ from: "", to: "" });
      renderRows();
    });
    const done = el("button", { class: cls.buttonPrimary, type: "button" }, "Done");
    done.addEventListener("click", () => {
      commit();
      overlay.remove();
    });

    panel.append(list, el("div", { class: "hb-writer__rules-actions" }, add, done));
    overlay.append(panel);
    document.body.append(overlay);
  }

  private renderSurface(): HTMLElement {
    const surface = el("article", {
      class: "hb-writer__surface",
      contenteditable: "true",
      "aria-label": "Document",
    });
    for (const block of this.doc.blocks) {
      surface.append(renderBlock(block));
    }
    // Remember the last selection inside the surface so the Styles gallery can
    // apply to (or capture from) it even after the toolbar takes focus.
    const capture = (): void => {
      const sel = typeof getSelection === "function" ? getSelection() : null;
      if (sel && sel.rangeCount > 0 && surface.contains(sel.anchorNode)) {
        this.lastRange = sel.getRangeAt(0).cloneRange();
      }
    };
    surface.addEventListener("keyup", capture);
    surface.addEventListener("mouseup", capture);
    surface.addEventListener("focus", capture);
    surface.addEventListener("input", () => this.updateStats());
    surface.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      this.selectedImage = target?.tagName === "IMG" ? target : undefined;
    });
    // AutoCorrect on word boundary (space), W18; respects the on/off toggle.
    surface.addEventListener("keydown", (event) => {
      if (this.autocorrectOn && (event as KeyboardEvent).key === " ") {
        this.maybeAutoCorrect();
      }
    });
    this.surface = surface;
    return surface;
  }

  /** Correct the word just before the caret when a boundary is typed (W18). */
  private maybeAutoCorrect(): void {
    const sel = typeof getSelection === "function" ? getSelection() : null;
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || typeof node.textContent !== "string") {
      return;
    }
    const text = node.textContent;
    const caret = range.startOffset;
    let start = caret;
    while (start > 0 && /[^\s]/.test(text[start - 1] ?? "")) {
      start -= 1;
    }
    const word = text.slice(start, caret);
    const corrected = autoCorrectWord(word, this.autocorrectRules);
    if (corrected !== word) {
      node.textContent = text.slice(0, start) + corrected + text.slice(caret);
      const r = document.createRange();
      const offset = start + corrected.length;
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  // ---- Layout & view controls (W3, W6, W8, W30) ---------------------------

  private setLineSpacing(value: string): void {
    if (this.surface) {
      this.surface.style.lineHeight = value;
    }
  }

  private setColumns(n: number): void {
    this.columns = n;
    if (this.surface) {
      this.surface.style.columnCount = n > 1 ? String(n) : "";
      this.surface.style.columnGap = n > 1 ? "var(--hb-space-8)" : "";
    }
  }

  private setZoom(pct: number): void {
    this.zoom = pct;
    this.surface?.style.setProperty("zoom", String(pct / 100));
  }

  private toggleView(): void {
    this.pageView = !this.pageView;
    this.docColumn?.classList.toggle("hb-writer__doc--page", this.pageView);
  }

  /** Box the current block with a border and a soft shading (W6). */
  private applyBlockBorders(): void {
    const block = this.blockOf(this.lastRange?.startContainer ?? this.surface?.firstChild);
    if (!block) {
      return;
    }
    const on = block.classList.toggle("hb-writer__boxed");
    block.style.removeProperty("padding");
    if (on) {
      block.style.padding = "var(--hb-space-3)";
    }
  }

  // ---- Insertions (W22 links, W12 shapes/notes) ----------------------------

  private insertLink(): void {
    const url = typeof prompt === "function" ? prompt("Link to (URL):", "https://") : null;
    if (!url || url.trim() === "") {
      return;
    }
    this.surface?.focus();
    if (this.lastRange && getSelection) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.lastRange);
    }
    document.execCommand("createLink", false, url.trim());
  }

  /** Insert a simple shape (display-object, W12). */
  private insertShape(): void {
    const svg =
      '<svg class="hb-writer__shape" viewBox="0 0 120 60" width="120" height="60" ' +
      'role="img" aria-label="Shape"><rect x="2" y="2" width="116" height="56" rx="10" ' +
      'fill="var(--hb-color-surface-sunken)" stroke="var(--hb-color-primary)" stroke-width="2"/></svg>';
    this.surface?.focus();
    document.execCommand("insertHTML", false, `${svg}&nbsp;`);
  }

  /**
   * Insert a styled display headline (the WordArt heir, W12): editable display
   * text in the brand display face, sized big and accented. It is a normal
   * inline element, so it can be placed, moved (cut/paste), and resized via the
   * Size control like any selection — no OLE, no platform engine.
   */
  private insertDisplayText(): void {
    const text = typeof prompt === "function" ? prompt("Display text:", "Headline") : null;
    if (!text || text.trim() === "") {
      return;
    }
    this.surface?.focus();
    if (this.lastRange && getSelection) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.lastRange);
    }
    const safe = text.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    document.execCommand(
      "insertHTML",
      false,
      `<span class="hb-writer__display" data-hb-display="1">${safe}</span>&nbsp;`,
    );
  }

  /** Attach a margin note / comment to the selection (Note-It heir, W12). */
  private addMarginNote(): void {
    const note = typeof prompt === "function" ? prompt("Note on this passage:") : null;
    if (!note || note.trim() === "") {
      return;
    }
    this.surface?.focus();
    if (this.lastRange && getSelection) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.lastRange);
    }
    const safe = note.trim().replace(/"/g, "&quot;");
    document.execCommand(
      "insertHTML",
      false,
      `<mark class="hb-writer__note" title="${safe}" data-note="${safe}">` +
        `${getSelection()?.toString() || "noted"}</mark>`,
    );
  }

  // ---- Find & Replace (W17) ------------------------------------------------

  private renderFindBar(): HTMLElement {
    const bar = el("div", { class: "hb-writer__find", hidden: "" });
    const find = el("input", {
      class: cls.input,
      placeholder: "Find (use \\t, ¶ for tab/return)…",
      "aria-label": "Find",
    }) as HTMLInputElement;
    const replace = el("input", {
      class: cls.input,
      placeholder: "Replace with…",
      "aria-label": "Replace with",
    }) as HTMLInputElement;
    const status = el("span", { class: "hb-writer__find-status" });
    this.findStatusEl = status;
    // Re-find as the query is typed: highlight every match in the surface and
    // show "N of M" (W17). Recompute against the live DOM after a sync.
    const refind = (): void => {
      this.syncFromDom();
      this.findQuery = find.value;
      this.findIndex = 0;
      this.refreshFind();
      this.stepFind(0); // scroll to / select the first match if any
    };
    find.addEventListener("input", refind);
    const prev = button("‹ Prev", () => this.stepFind(-1));
    const next = button("Next ›", () => this.stepFind(1));
    // Replace either the first match (singly) or every match (all), W17.
    const doReplace = (limit?: number): void => {
      this.syncFromDom();
      const result = replaceInDoc(this.doc, find.value, replace.value, limit ? { limit } : {});
      this.doc = result.doc;
      if (this.surface) {
        this.surface.replaceChildren(...this.doc.blocks.map(renderBlock));
      }
      this.updateStats();
      if (result.count === 0) {
        status.textContent = "No matches";
        return;
      }
      // Re-find over the freshly rendered surface so the remaining matches
      // stay highlighted and the count is accurate.
      this.findIndex = 0;
      this.refreshFind();
      const left = this.findRanges.length;
      status.textContent = `Replaced ${result.count}` + (left > 0 ? ` · ${left} left` : "");
    };
    const replaceOne = button("Replace", () => doReplace(1));
    const replaceBtn = button("Replace all", () => doReplace());
    const close = el("button", {
      class: "hb-writer__find-close",
      type: "button",
      "aria-label": "Close find",
    });
    close.textContent = "×";
    close.addEventListener("click", () => {
      bar.setAttribute("hidden", "");
      this.clearFindHighlight();
    });
    bar.append(find, replace, prev, next, replaceOne, replaceBtn, status, close);
    this.findBarEl = bar;
    return bar;
  }

  private toggleFind(): void {
    if (!this.findBarEl) {
      return;
    }
    const hidden = this.findBarEl.hasAttribute("hidden");
    if (hidden) {
      this.findBarEl.removeAttribute("hidden");
      this.findBarEl.querySelector("input")?.focus();
    } else {
      this.findBarEl.setAttribute("hidden", "");
      this.clearFindHighlight();
    }
  }

  // ---- in-surface find highlight + step-through (W17) -----------------------

  /** Recompute the match ranges for the current query and repaint highlights. */
  private refreshFind(): void {
    this.findRanges = this.computeFindRanges(this.findQuery);
    if (this.findIndex >= this.findRanges.length) {
      this.findIndex = 0;
    }
    this.applyFindHighlight();
    this.updateFindStatus();
  }

  /** Move to the next/previous (or current, delta 0) match and reveal it. */
  private stepFind(delta: number): void {
    if (this.findRanges.length === 0) {
      this.updateFindStatus();
      return;
    }
    const count = this.findRanges.length;
    this.findIndex = (((this.findIndex + delta) % count) + count) % count;
    this.applyFindHighlight();
    const range = this.findRanges[this.findIndex];
    if (range) {
      const selection = typeof getSelection === "function" ? getSelection() : null;
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
      }
      const anchor =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      anchor?.scrollIntoView({ block: "center", inline: "nearest" });
    }
    this.updateFindStatus();
  }

  /** Walk the surface's text nodes and map every match to a DOM Range. */
  private computeFindRanges(query: string): Range[] {
    const surface = this.surface;
    if (!surface || query === "" || typeof document === "undefined") {
      return [];
    }
    const span = expandSpecials(query).length;
    if (span === 0) {
      return [];
    }
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    const starts: number[] = [];
    let full = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      starts.push(full.length);
      nodes.push(node as Text);
      full += (node as Text).data;
    }
    const locate = (global: number): { node: Text; offset: number } | null => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const start = starts[i];
        if (node === undefined || start === undefined) {
          continue;
        }
        if (global < start + node.data.length || i === nodes.length - 1) {
          return { node, offset: Math.min(global - start, node.data.length) };
        }
      }
      return null;
    };
    const ranges: Range[] = [];
    for (const at of findMatches(full, query)) {
      const from = locate(at);
      const to = locate(at + span);
      if (!from || !to) {
        continue;
      }
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      ranges.push(range);
    }
    return ranges;
  }

  /** Paint all matches (and the current one) via the CSS Custom Highlight API. */
  private applyFindHighlight(): void {
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
    if (!registry || !Ctor) {
      return; // Selection-only fallback (stepFind still selects the match).
    }
    if (this.findRanges.length === 0) {
      registry.delete("hb-find");
      registry.delete("hb-find-current");
      return;
    }
    registry.set("hb-find", new Ctor(...this.findRanges));
    const current = this.findRanges[this.findIndex];
    if (current) {
      registry.set("hb-find-current", new Ctor(current));
    } else {
      registry.delete("hb-find-current");
    }
  }

  private clearFindHighlight(): void {
    this.findRanges = [];
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    registry?.delete("hb-find");
    registry?.delete("hb-find-current");
  }

  private updateFindStatus(): void {
    if (!this.findStatusEl) {
      return;
    }
    if (this.findQuery === "") {
      this.findStatusEl.textContent = "";
      return;
    }
    const total = this.findRanges.length;
    this.findStatusEl.textContent =
      total === 0 ? "No matches" : `${this.findIndex + 1} of ${total}`;
  }

  // ---- Footnotes (W21) -----------------------------------------------------

  private insertFootnote(): void {
    const text = typeof prompt === "function" ? prompt("Footnote text:") : null;
    if (!text || text.trim() === "") {
      return;
    }
    this.footnoteSeq += 1;
    const id = this.footnoteSeq;
    this.footnotes.push({ id, text: text.trim() });
    this.surface?.focus();
    if (this.lastRange && getSelection) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.lastRange);
    }
    document.execCommand(
      "insertHTML",
      false,
      `<sup class="hb-writer__fnref" data-fn="${id}">[${id}]</sup>`,
    );
    this.updateStats();
  }

  // ---- Image text wrap (W11) -----------------------------------------------

  private cycleImageWrap(): void {
    const img =
      this.selectedImage ?? (this.surface?.querySelector("img") as HTMLElement | null) ?? undefined;
    if (!img) {
      return;
    }
    const order = ["none", "left", "right"];
    const current = img.getAttribute("data-wrap") ?? "none";
    const next = order[(order.indexOf(current) + 1) % order.length] ?? "none";
    img.setAttribute("data-wrap", next);
    img.classList.remove("hb-writer__wrap-left", "hb-writer__wrap-right");
    if (next === "left") img.classList.add("hb-writer__wrap-left");
    if (next === "right") img.classList.add("hb-writer__wrap-right");
  }

  // ---- Print-faithful preview & page setup (W9, W10) -----------------------

  /** Sync the DOM, then attach footnote refs to the blocks that carry markers. */
  private docForPrint(): { doc: WriterDocument; footnotes: Record<number, string> } {
    this.syncFromDom();
    const map: Record<number, string> = {};
    for (const fn of this.footnotes) {
      map[fn.id] = fn.text;
    }
    const blocks = this.doc.blocks.map((block) => {
      if (block.kind !== "paragraph" && block.kind !== "heading") {
        return block;
      }
      const text = block.spans.map((s) => s.text).join("");
      const refs = this.footnotes.filter((fn) => text.includes(`[${fn.id}]`)).map((fn) => fn.id);
      return refs.length > 0 ? { ...block, footnoteRefs: refs } : block;
    });
    return { doc: { ...this.doc, blocks }, footnotes: map };
  }

  private openPrintPreview(): void {
    const overlay = el("div", { class: "hb-print__backdrop" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const panel = el("div", { class: "hb-print", role: "dialog", "aria-label": "Print preview" });
    const pages = el("div", { class: "hb-print__pages" });

    const renderPages = (): void => {
      const { doc, footnotes } = this.docForPrint();
      const geo = pageGeometry(this.pageSetup);
      const rendered = paginate(doc, geo, {
        header: this.headerText,
        footer: this.footerText,
        footnotes,
        dateLabel: dateLabel(),
      });
      pages.replaceChildren(...rendered.map((p) => this.renderPrintPage(p, geo)));
    };

    panel.append(this.renderPageSetup(renderPages), pages);
    overlay.append(panel);
    document.body.append(overlay);
    renderPages();
  }

  private renderPageSetup(onChange: () => void): HTMLElement {
    const bar = el("div", { class: "hb-print__setup" });
    const sizeSel = select("Page size", ["A4", "Letter", "Legal"], (v) => {
      this.pageSetup.size = v as PageSetup["size"];
      onChange();
    });
    const orient = select("Orientation", ["Portrait", "Landscape"], (v) => {
      this.pageSetup.orientation = v.toLowerCase() as PageSetup["orientation"];
      onChange();
    });
    const margin = select("Margins", ["Narrow", "Normal", "Wide"], (v) => {
      this.pageSetup.marginMm = { Narrow: 15, Normal: 25, Wide: 38 }[v] ?? 25;
      onChange();
    });
    const header = el("input", {
      class: cls.input,
      placeholder: "Header (use {date})",
      value: this.headerText,
      "aria-label": "Header",
    }) as HTMLInputElement;
    header.addEventListener("input", () => {
      this.headerText = header.value;
      onChange();
    });
    const footer = el("input", {
      class: cls.input,
      placeholder: "Footer (use {page} of {pages})",
      value: this.footerText,
      "aria-label": "Footer",
    }) as HTMLInputElement;
    footer.addEventListener("input", () => {
      this.footerText = footer.value;
      onChange();
    });
    const printBtn = el("button", { class: cls.buttonPrimary, type: "button" }, "Print");
    printBtn.addEventListener("click", () => {
      if (typeof print === "function") print();
    });
    const close = el("button", { class: cls.buttonGhost, type: "button" }, "Close");
    close.addEventListener("click", () => bar.closest(".hb-print__backdrop")?.remove());
    bar.append(sizeSel, orient, margin, header, footer, printBtn, close);
    return bar;
  }

  private renderPrintPage(page: RenderedPage, geo: ReturnType<typeof pageGeometry>): HTMLElement {
    const ratio = geo.heightMm / geo.widthMm;
    const sheet = el("div", { class: "hb-print__page" });
    sheet.style.setProperty("--hb-page-ratio", String(ratio));
    sheet.style.setProperty(
      "--hb-page-margin",
      `${((geo.marginMm / geo.widthMm) * 100).toFixed(2)}%`,
    );
    if (page.header) {
      sheet.append(el("div", { class: "hb-print__header" }, page.header));
    }
    const body = el("div", { class: "hb-print__body" });
    for (const block of page.blocks) {
      body.append(renderBlock(block));
    }
    sheet.append(body);
    if (page.footnotes.length > 0) {
      const notes = el("div", { class: "hb-print__footnotes" });
      for (const fn of page.footnotes) {
        notes.append(el("div", { class: "hb-print__footnote" }, `[${fn.id}] ${fn.text}`));
      }
      sheet.append(notes);
    }
    sheet.append(el("div", { class: "hb-print__footer" }, page.footer || `${page.pageNumber}`));
    return sheet;
  }

  /** The direct child block of the surface that contains `node`. */
  private blockOf(node: Node | null | undefined): HTMLElement | undefined {
    let el: Node | null = node ?? null;
    while (el && el.parentNode !== this.surface) {
      el = el.parentNode;
    }
    return el instanceof HTMLElement
      ? el
      : ((this.surface?.firstElementChild as HTMLElement | null) ?? undefined);
  }

  /** Apply a style set in one tap: a run for char sets, the block otherwise. */
  private applyStyleSet(set: StyleSet): void {
    if (!this.surface) {
      return;
    }
    const css = styleSetCss(set);
    const range = this.lastRange;
    if (
      set.kind === "char" &&
      range &&
      !range.collapsed &&
      this.surface.contains(range.commonAncestorContainer)
    ) {
      const span = document.createElement("span");
      span.setAttribute("style", css);
      span.setAttribute("data-hb-style", set.id);
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch {
        /* selection spanned block boundaries, fall back to the block */
        this.applyToBlock(range.startContainer, css, set.id);
      }
    } else {
      this.applyToBlock(range?.startContainer ?? this.surface.firstChild, css, set.id);
    }
  }

  private applyToBlock(node: Node | null | undefined, css: string, id: string): void {
    const block = this.blockOf(node);
    if (block) {
      block.setAttribute("style", css);
      block.setAttribute("data-hb-style", id);
    }
  }

  /** Capture the look at the current selection as a new, named style set. */
  private saveLookAsStyle(): void {
    if (!this.surface || typeof getComputedStyle !== "function") {
      return;
    }
    const range = this.lastRange;
    const node = range
      ? range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as Element)
      : this.surface.firstElementChild;
    if (!node) {
      return;
    }
    const cs = getComputedStyle(node);
    const css = [
      `font-family: ${cs.fontFamily}`,
      `font-size: ${cs.fontSize}`,
      `font-weight: ${cs.fontWeight}`,
      `font-style: ${cs.fontStyle}`,
      `text-decoration-line: ${cs.textDecorationLine}`,
      `color: ${cs.color}`,
      `text-align: ${cs.textAlign}`,
    ].join("; ");
    const name =
      typeof prompt === "function" ? prompt("Save this look as a style, name it:") : null;
    if (!name || name.trim() === "") {
      return;
    }
    const kind = range && !range.collapsed ? "char" : "block";
    const set = makeStyleSet({ name, scope: "writer", kind, css });
    saveCustomStyleSet(this.options.bundleId, set, this.options.styleStorage);
    this.refreshStyleMenu();
  }

  // ---- Style sets gallery ("Easy Formats" heir, AC-WKS-W4) -----------------

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
    for (const set of styleSetsFor(this.options.bundleId, "writer", this.options.styleStorage)) {
      const item = el("button", {
        class: "hb-stylemenu__item",
        type: "button",
        role: "menuitem",
        title: `Apply ${set.name}`,
      });
      const preview = el("span", { class: "hb-stylemenu__preview" }, set.name);
      preview.setAttribute("style", styleSetCss(set));
      item.append(preview);
      if (!set.builtin) {
        item.append(el("span", { class: "hb-stylemenu__tag" }, "Yours"));
      }
      item.addEventListener("click", () => {
        this.applyStyleSet(set);
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
      this.saveLookAsStyle();
    });
    pop.append(save);
    return pop;
  }

  private refreshStyleMenu(): void {
    const old = this.styleMenuWrap?.querySelector(".hb-stylemenu__pop");
    if (old) {
      old.replaceWith(this.buildStylePop());
    }
  }

  private closeStyleMenu(): void {
    this.styleMenuWrap?.classList.remove("is-open");
    this.styleMenuWrap?.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
  }

  // ---- Dictionary & thesaurus (offline, AC-WKS-W14/W15) --------------------

  /** Look up the selected word (or the word under the caret), fully offline. */
  private openDefine(): void {
    const { word, range } = this.wordFromSelection();
    const card = el("aside", { class: "hb-define", role: "dialog", "aria-label": "Dictionary" });
    const close = el("button", {
      class: "hb-define__close",
      type: "button",
      "aria-label": "Close",
    });
    close.textContent = "×";
    close.addEventListener("click", () => card.remove());

    if (!word) {
      card.append(close, el("p", { class: "hb-define__empty" }, "Select a word to look it up."));
      this.mountDefine(card);
      return;
    }

    const entry = lookupWord(word);
    const head = el("div", { class: "hb-define__head" });
    head.append(
      el("span", { class: "hb-define__word" }, entry?.word ?? word),
      entry?.pos ? el("span", { class: "hb-define__pos" }, entry.pos) : el("span"),
      close,
    );
    card.append(head);

    if (!entry) {
      card.append(
        el("p", { class: "hb-define__empty" }, `No offline entry for "${word}" yet.`),
        el(
          "p",
          { class: "hb-define__note" },
          "The full dictionary loads on this device, never online.",
        ),
      );
      this.mountDefine(card);
      return;
    }

    const defs = el("ol", { class: "hb-define__defs" });
    for (const def of entry.definitions) {
      defs.append(el("li", {}, def));
    }
    card.append(defs);

    if (entry.synonyms.length > 0) {
      card.append(el("div", { class: "hb-define__label" }, "Synonyms, tap to replace"));
      const chips = el("div", { class: "hb-define__chips" });
      for (const syn of entry.synonyms) {
        const chip = el("button", { class: "hb-define__chip", type: "button" }, syn);
        chip.addEventListener("click", () => {
          this.replaceWord(range, syn);
          card.remove();
        });
        chips.append(chip);
      }
      card.append(chips);
    }
    if (entry.antonyms.length > 0) {
      card.append(
        el("div", { class: "hb-define__label" }, "Opposites"),
        el(
          "div",
          { class: "hb-define__chips hb-define__chips--muted" },
          ...entry.antonyms.map((a) =>
            el("span", { class: "hb-define__chip hb-define__chip--static" }, a),
          ),
        ),
      );
    }

    // (c) Optional Ember elaboration, stays on this device.
    const out = el("div", { class: "hb-define__ember" });
    const ask = button("Ask Ember to explain", () => {
      out.replaceChildren(el("p", { class: cls.badge }, "Thinking on-device…"));
      void this.runEmber(
        {
          task: "query",
          document: entry.definitions.join(" "),
          request: `Explain "${entry.word}" in one simple sentence.`,
          effort: this.effort,
        },
        out,
      );
    });
    card.append(ask, out);
    this.mountDefine(card);
  }

  /** The word at the selection, with a range that can replace it in place. */
  private wordFromSelection(): { word: string; range: Range | undefined } {
    const range = this.lastRange;
    if (!range || !this.surface || !this.surface.contains(range.commonAncestorContainer)) {
      return { word: "", range: undefined };
    }
    const text = range.toString().trim();
    if (text !== "") {
      return { word: text.split(/\s+/)[0] ?? "", range: range.cloneRange() };
    }
    // Collapsed caret: expand to the surrounding word.
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || typeof node.textContent !== "string") {
      return { word: "", range: undefined };
    }
    const s = node.textContent;
    let a = range.startOffset;
    let b = range.startOffset;
    while (a > 0 && /[\w'-]/.test(s[a - 1] ?? "")) a -= 1;
    while (b < s.length && /[\w'-]/.test(s[b] ?? "")) b += 1;
    if (a === b) {
      return { word: "", range: undefined };
    }
    const wordRange = document.createRange();
    wordRange.setStart(node, a);
    wordRange.setEnd(node, b);
    return { word: s.slice(a, b), range: wordRange };
  }

  /** Replace the looked-up word in place with a chosen synonym. */
  private replaceWord(range: Range | undefined, replacement: string): void {
    if (!range || !this.surface || !this.surface.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    this.lastRange = undefined;
  }

  private mountDefine(card: HTMLElement): void {
    const host = this.surface?.parentElement;
    if (!host) {
      return;
    }
    host.querySelector(".hb-define")?.remove();
    host.prepend(card);
  }

  // ---- Ember panel (AC-WRITER-3) -------------------------------------------

  /** Mount the shared Ember panel with Writer's suggestions + ask. Cached so the
   *  conversation survives toggling between Ember and version history. */
  private renderEmberPanel(): HTMLElement {
    if (!this.emberPanel) {
      this.emberPanel = new EmberPanel<EmberRequest>({
        run: (req) => this.client.runEmber(req),
        intro:
          "I can draft, rewrite, summarise, or answer questions about this document, all on your device.",
        suggestions: EMBER_ACTIONS.map((action) => ({
          label: action.label,
          build: (effort) => action.request(toPlainText(this.document()), effort),
        })),
        ask: {
          placeholder: "Ask your document…",
          build: (text, effort) => buildAskRequest(this.document(), text, effort),
        },
        onError: (message) => this.options.onError?.(message),
      });
    }
    return el("div", { class: "hb-writer__ember" }, this.emberPanel.el());
  }

  private async runEmber(request: EmberRequest, output: HTMLElement): Promise<void> {
    try {
      const response = await this.client.runEmber(request);
      output.replaceChildren(
        el("p", { class: "hb-writer__ember-text" }, response.text),
        el("p", { class: cls.badge }, `On-device · ${response.model}`),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- Seal (AC-UX-SEAL-2) -------------------------------------------------

  private renderSeal(): HTMLElement {
    const footer = el("footer", { class: "hb-writer__seal" });
    const status = el("span", {}, sealStatusText(this.options.recipientNames ?? []));
    const onSeal = this.options.onSeal;
    footer.append(
      button("Seal", () => {
        if (onSeal) {
          onSeal(encodePlain(this.document()));
        } else {
          void this.seal(status);
        }
      }),
      status,
    );
    return footer;
  }

  private async seal(status: HTMLElement): Promise<void> {
    try {
      const recipients = this.options.recipientNames ?? [];
      // The recipient public keys would come from the contact picker; the
      // status line always reads in plain language, never crypto jargon.
      await this.client.seal({
        content_base64: encodePlain(this.document()),
        recipient_public_keys: [],
      });
      status.textContent = sealStatusText(recipients);
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- Mailings: merge, envelopes & labels (AC-WKS-W19 / W20) --------------

  /** Whether any merge data source is available. */
  private hasMerge(): boolean {
    return !!(this.options.mergeSources || this.options.dataProvider);
  }

  /**
   * Resolve merge sources. Prefers the rich {@link WriterOptions.mergeSources}
   * (named Records/Sheets/Contacts tables); falls back to the legacy
   * {@link WriterOptions.dataProvider} as a single "Contacts" source.
   */
  private async resolveSources(): Promise<MergeSource[]> {
    if (this.options.mergeSources) {
      return this.options.mergeSources();
    }
    if (this.options.dataProvider) {
      const records = await this.options.dataProvider();
      return [{ id: "contacts", label: "Contacts", kind: "contacts", records }];
    }
    return [];
  }

  /** Open the Mailings dialog in the chosen mode. */
  private async openMailings(mode: "letters" | "envelopes" | "labels"): Promise<void> {
    const dialog = new MailingsDialog({
      document: () => this.document(),
      sources: () => this.resolveSources(),
      onCreateDocuments: (docs) => this.saveMergedDocs(docs),
      onError: (message) => this.options.onError?.(message),
    });
    if (mode === "letters") await dialog.openLetters();
    else if (mode === "envelopes") await dialog.openEnvelopes();
    else await dialog.openLabels();
  }

  /** Persist a merged set of documents into the Bundle. */
  private async saveMergedDocs(docs: WriterDocument[]): Promise<void> {
    if (this.options.onCreateDocuments) {
      await this.options.onCreateDocuments(docs);
      return;
    }
    for (const generated of docs) {
      await this.client.saveDocument({
        bundle_id: this.options.bundleId,
        doc_type: "writer",
        content_base64: encodePlain(generated),
      });
    }
  }

  /**
   * Insert a `{{field}}` placeholder at the caret. Fields are the union of
   * column names across the merge sources; the user picks one from a small list.
   */
  private async insertMergeField(): Promise<void> {
    const sources = await this.resolveSources();
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      for (const record of source.records.slice(0, 1)) {
        for (const key of Object.keys(record)) {
          if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
          }
        }
      }
    }
    if (keys.length === 0) {
      this.options.onError?.("No merge fields yet, choose a data source with at least one record.");
      return;
    }
    const usedFields = new Set(mergeFields(this.document()));
    this.openFieldPicker(keys, usedFields);
  }

  /** A tiny picker listing merge fields; clicking one inserts it at the caret. */
  private openFieldPicker(keys: string[], used: Set<string>): void {
    const overlay = el("div", { class: "hb-modal__backdrop hb-fieldpick" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const card = el("div", {
      class: "hb-fieldpick__card",
      role: "dialog",
      "aria-label": "Insert merge field",
    });
    card.append(el("h2", { class: "hb-fieldpick__title" }, "Insert merge field"));
    const list = el("div", { class: "hb-fieldpick__list" });
    for (const key of keys) {
      const item = el(
        "button",
        { class: `hb-fieldpick__item${used.has(key) ? " is-used" : ""}`, type: "button" },
        `{{${key}}}`,
      );
      item.addEventListener("click", () => {
        overlay.remove();
        this.insertFieldToken(key);
      });
      list.append(item);
    }
    card.append(list);
    overlay.append(card);
    document.body.append(overlay);
  }

  /** Drop a `{{field}}` token at the saved caret position. */
  private insertFieldToken(key: string): void {
    this.surface?.focus();
    if (this.lastRange && getSelection) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.lastRange);
    }
    document.execCommand("insertText", false, `{{${key}}}`);
    this.syncFromDom();
  }

  // ---- export (AC-WRITER-4) ------------------------------------------------

  private exportAs(format: string): void {
    // Map the live document to the shared ODF model and hand it to the host,
    // which produces ODF/.docx bytes via the odf-io core (FFI) or PDF via print.
    this.options.onExport?.({ format, model: toOdfModel(this.document()) });
  }

  /** Send the current document into a chosen Bundle (Portfolio collect-flow). */
  private addToBundle(): void {
    const doc = this.document();
    this.options.onAddToBundle?.({
      docType: "writer",
      title: doc.title || "Document",
      contentBase64: encodePlain(doc),
    });
  }

  // ---- editing helpers -----------------------------------------------------

  private insertTable(): void {
    this.doc.blocks.push({
      kind: "table",
      rows: [
        [[{ text: "" }], [{ text: "" }]],
        [[{ text: "" }], [{ text: "" }]],
      ],
    });
  }

  private insertImage(): void {
    this.doc.blocks.push({ kind: "image", src: "", alt: "" });
  }

  // ---- charts (embeddable, live-linked, AC-WKS-X7) ------------------------

  /** Open the Insert Chart dialog (paste data or live-link a sheet range). */
  private openChartDialog(): void {
    new ChartDialog({
      bundleId: this.options.bundleId,
      resolver: this.options.chartDataResolver,
      onInsert: (spec) => this.insertChart(spec),
    }).open();
  }

  /** Insert a chart object as a new block after the current selection. */
  private insertChart(spec: ChartSpec): void {
    this.syncFromDom();
    this.doc = { ...this.doc, blocks: [...this.doc.blocks, { kind: "chart", spec }] };
    if (this.surface) {
      this.surface.append(renderBlock({ kind: "chart", spec }));
    }
  }

  /**
   * Re-pull every live-linked chart's data from its source and re-render it, so
   * embedded charts reflect the latest source data (AC-WKS-X7).
   */
  private refreshCharts(): void {
    const resolver = this.options.chartDataResolver;
    if (!resolver || !this.surface) {
      return;
    }
    let refreshed = 0;
    for (const node of Array.from(this.surface.querySelectorAll("figure[data-chart]"))) {
      let spec: ChartSpec;
      try {
        spec = JSON.parse(node.getAttribute("data-chart") ?? "{}") as ChartSpec;
      } catch {
        continue;
      }
      if (!spec.source) {
        continue;
      }
      const data = resolver(spec.source);
      if (data) {
        spec.categories = data.categories;
        spec.series = data.series;
        node.setAttribute("data-chart", JSON.stringify(spec));
        node.innerHTML = renderChartSvg(spec, { width: 440, height: 260 });
        refreshed += 1;
      }
    }
    this.syncFromDom();
    if (refreshed === 0) {
      this.options.onError?.("No live-linked charts to refresh.");
    }
  }

  private fail(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error.message : String(error));
  }
}

// ---- DOM helpers ------------------------------------------------------------

function renderBlock(block: WriterDocument["blocks"][number]): HTMLElement {
  if (block.kind === "heading") {
    return richElement(`h${block.level}`, block.spans);
  }
  if (block.kind === "table") {
    const table = el("table", { class: cls.table });
    for (const row of block.rows) {
      const tr = el("tr");
      for (const cell of row) {
        tr.append(richElement("td", cell));
      }
      table.append(tr);
    }
    return table;
  }
  if (block.kind === "image") {
    return el("img", { src: block.src, alt: block.alt ?? "" });
  }
  if (block.kind === "chart") {
    return renderChartFigure(block.spec as ChartSpec);
  }
  return richElement("p", block.spans);
}

/**
 * Render an embedded chart as a non-editable `<figure>` carrying its spec in a
 * `data-chart` attribute, so it round-trips losslessly through `syncFromDom`.
 */
function renderChartFigure(spec: ChartSpec): HTMLElement {
  const fig = el("figure", {
    class: "hb-writer__chart",
    contenteditable: "false",
    "data-chart": JSON.stringify(spec),
  });
  fig.innerHTML = renderChartSvg(spec, { width: 440, height: 260 });
  return fig;
}

/**
 * Build a block element whose inner HTML carries the spans' rich inline
 * formatting (the lossless inverse of `spansFromHtml`, which `syncFromDom`
 * uses to read it back). An empty span list still yields a `<br>` so the line
 * stays selectable and editable in the contenteditable surface.
 */
function richElement(tag: string, spans: Array<{ text: string }>): HTMLElement {
  const node = el(tag);
  const html = spansToHtml(spans as Parameters<typeof spansToHtml>[0]);
  node.innerHTML = html === "" ? "<br>" : html;
  return node;
}

function encodePlain(doc: WriterDocument): string {
  // Placeholder content encoding (UTF-8 safe); real save serialises the ODF
  // bytes via FFI.
  const bytes = new TextEncoder().encode(toPlainText(doc));
  return btoa(String.fromCharCode(...bytes));
}

function button(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.button, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

/** A compact formatting button that keeps the surface selection (mousedown). */
function iconButton(label: string, title: string, onClick: () => void, extra = ""): HTMLElement {
  const node = el(
    "button",
    {
      class: `${cls.button} hb-writer__tool ${extra}`.trim(),
      type: "button",
      title,
      "aria-label": title,
    },
    label,
  );
  // Act on mousedown and prevent default so the contenteditable keeps its
  // selection (execCommand needs it) instead of the button stealing focus.
  node.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onClick();
  });
  return node;
}

/** A toolbar dropdown: a placeholder label then options; calls back on change. */
function select(
  label: string,
  options: string[],
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = el("select", { class: cls.select, "aria-label": label }) as HTMLSelectElement;
  node.append(el("option", { value: "", disabled: "", selected: "" }, label));
  for (const option of options) {
    node.append(el("option", { value: option }, option));
  }
  node.addEventListener("change", () => {
    if (node.value !== "") {
      onChange(node.value);
    }
  });
  return node;
}

/** A thin visual separator between toolbar groups. */
function sep(): HTMLElement {
  return el("span", { class: "hb-writer__sep", "aria-hidden": "true" });
}

/** A human date label for the {date} header/footer token. */
function dateLabel(): string {
  try {
    return new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** A body paragraph block from plain text. */
function para(text: string): WriterDocument["blocks"][number] {
  return { kind: "paragraph", style: "body", spans: [{ text }] };
}

/** A small presence avatar (first initial); "you" is tinted with the brand. */
function presenceAvatar(name: string, isYou: boolean): HTMLElement {
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  return el(
    "span",
    {
      class: `hb-avatar hb-avatar--sm${isYou ? "" : " hb-avatar--seal"}`,
      title: name,
      "aria-hidden": "true",
    },
    initial,
  );
}

/** An inline shield glyph for the end-to-end-encryption cue. */
function shield(size: number): string {
  return (
    `<svg class="hb-writer__shield" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true"><path fill="currentColor" d="M12 2l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V5z"/>` +
    `<path fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" d="M8.5 12l2.3 2.3L15.5 9.5"/></svg>`
  );
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
