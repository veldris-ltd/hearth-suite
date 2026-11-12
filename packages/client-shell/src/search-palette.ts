/**
 * The universal search palette, a calm ⌘K command surface over the local index.
 *
 * It ranks documents, Records, and dates with the Mantel's pure `rankResults`
 * logic, groups them by kind, and supports full keyboard navigation. All
 * searching is local; the footer states plainly that nothing leaves the device.
 */

import { icon } from "@hearth/design-system";
import { lookup as lookupWord } from "@hearth/lexicon";
import { rankResults } from "@hearth/shell";
import type { MantelSource, OpenTarget, SearchItem, SearchResult } from "@hearth/shell";

const GROUPS: Array<{ kind: SearchItem["kind"]; label: string; module: OpenTarget["module"] }> = [
  { kind: "document", label: "Documents", module: "writer" },
  { kind: "record", label: "Records", module: "records" },
  { kind: "calendar", label: "Dates", module: "calendar" },
];

const KIND_ICON: Record<SearchItem["kind"], "writer" | "records" | "calendar"> = {
  document: "writer",
  record: "records",
  calendar: "calendar",
};

/** A mounted, toggleable search palette. */
export class SearchPalette {
  private overlay: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private items: SearchItem[] = [];
  private results: SearchResult[] = [];
  private active = 0;
  private query = "";

  constructor(
    private readonly source: MantelSource,
    private readonly onOpen: (target: OpenTarget) => void,
  ) {}

  /** Whether the palette is currently open. */
  get isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Open the palette, loading the local index lazily. */
  async open(): Promise<void> {
    if (this.overlay) {
      this.input?.focus();
      return;
    }
    try {
      this.items = await this.source.searchItems();
    } catch {
      this.items = [];
    }
    this.render();
  }

  /** Close and tear down the palette. */
  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.input = null;
    this.list = null;
  }

  private render(): void {
    const input = el("input", {
      class: "hb-palette__input",
      type: "search",
      placeholder: "Search documents, data, people, dates…",
      "aria-label": "Universal search",
      autocomplete: "off",
    }) as HTMLInputElement;
    const glyph = el("span", { class: "hb-palette__search-icon" });
    glyph.innerHTML = icon("search", 20);
    const scope = el("span", { class: "hb-palette__scope" }, "all");
    const head = el("div", { class: "hb-palette__head" }, glyph, input, scope);

    const list = el("div", { class: "hb-palette__list", role: "listbox" });

    const footer = el("div", { class: "hb-palette__footer" });
    footer.append(
      hint("↑↓", "navigate"),
      hint("↵", "open"),
      hint("esc", "close"),
      el("span", { class: "hb-palette__device" }, "✧ Nothing leaves this device"),
    );

    const panel = el(
      "div",
      { class: "hb-palette", role: "dialog", "aria-modal": "true", "aria-label": "Search" },
      head,
      list,
      footer,
    );
    const overlay = el("div", { class: "hb-palette__backdrop" }, panel);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    input.addEventListener("input", () => this.refresh());
    input.addEventListener("keydown", (event) => this.onKeydown(event));

    document.body.append(overlay);
    this.overlay = overlay;
    this.input = input;
    this.list = list;
    input.focus();
    this.refresh();
  }

  private refresh(): void {
    const query = this.input?.value ?? "";
    this.query = query.trim();
    this.results = rankResults(query, this.items);
    this.active = 0;
    this.paint(query.trim() === "");
  }

  private paint(idle: boolean): void {
    if (!this.list) {
      return;
    }
    if (idle) {
      this.list.replaceChildren(
        el(
          "p",
          { class: "hb-palette__hint-empty" },
          "Search across your documents, Records, and dates, all indexed locally.",
        ),
      );
      return;
    }
    const sections: HTMLElement[] = [];
    const dict = this.buildDictSection();
    if (dict) {
      sections.push(dict);
    }
    let flatIndex = 0;
    for (const group of GROUPS) {
      const inGroup = this.results.filter((r) => r.kind === group.kind);
      if (inGroup.length === 0) {
        continue;
      }
      const section = el("div", { class: "hb-palette__group" });
      const gl = el("div", { class: "hb-palette__group-label" });
      gl.innerHTML = `${icon(KIND_ICON[group.kind], 14)}<span>${group.label}</span>`;
      section.append(gl);
      for (const result of inGroup) {
        section.append(this.renderResult(result, flatIndex, group.module));
        flatIndex += 1;
      }
      sections.push(section);
    }
    if (sections.length === 0) {
      this.list.replaceChildren(
        el("p", { class: "hb-palette__hint-empty" }, "No matches on this device."),
      );
      return;
    }
    this.list.replaceChildren(...sections);
    this.highlight();
  }

  /** A local dictionary/thesaurus entry for a single-word query (Mantel utility). */
  private buildDictSection(): HTMLElement | null {
    if (this.query === "" || /\s/.test(this.query)) {
      return null;
    }
    const entry = lookupWord(this.query);
    if (!entry) {
      return null;
    }
    const section = el("div", { class: "hb-palette__group" });
    const gl = el("div", { class: "hb-palette__group-label" });
    gl.innerHTML = `${icon("search", 14)}<span>Dictionary</span>`;
    section.append(gl);
    const body = el("div", { class: "hb-palette__dict" });
    body.append(
      el(
        "div",
        { class: "hb-palette__dict-word" },
        entry.pos ? `${entry.word} · ${entry.pos}` : entry.word,
      ),
    );
    if (entry.definitions[0]) {
      body.append(el("div", { class: "hb-palette__dict-def" }, entry.definitions[0]));
    }
    if (entry.synonyms.length > 0) {
      body.append(
        el(
          "div",
          { class: "hb-palette__dict-syn" },
          `Synonyms: ${entry.synonyms.slice(0, 6).join(", ")}`,
        ),
      );
    }
    section.append(body);
    return section;
  }

  private renderResult(
    result: SearchResult,
    index: number,
    module: OpenTarget["module"],
  ): HTMLElement {
    const row = el("button", {
      class: "hb-palette__result",
      type: "button",
      role: "option",
      "data-index": String(index),
    });
    const ic = el("span", { class: "hb-palette__result-icon" });
    ic.innerHTML = icon(KIND_ICON[result.kind], 18);
    const body = el("div", { class: "hb-palette__result-body" });
    body.append(el("div", { class: "hb-palette__result-title" }, result.title));
    if (result.snippet) {
      body.append(el("div", { class: "hb-palette__result-snippet" }, result.snippet));
    }
    const enter = el("span", { class: "hb-palette__result-enter" }, "↵");
    row.append(ic, body, enter);
    row.addEventListener("click", () => this.choose(result, module));
    row.addEventListener("mousemove", () => {
      this.active = index;
      this.highlight();
    });
    return row;
  }

  private rows(): HTMLElement[] {
    return this.list ? [...this.list.querySelectorAll<HTMLElement>(".hb-palette__result")] : [];
  }

  private highlight(): void {
    const rows = this.rows();
    rows.forEach((row, i) => {
      const on = i === this.active;
      row.classList.toggle("is-active", on);
      if (on) {
        row.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.active = Math.min(this.active + 1, Math.max(rows.length - 1, 0));
      this.highlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.active = Math.max(this.active - 1, 0);
      this.highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      rows[this.active]?.click();
    }
  }

  private choose(result: SearchResult, module: OpenTarget["module"]): void {
    this.close();
    this.onOpen({
      module: result.module ?? module,
      bundleId: result.bundleId,
      itemId: result.id,
    });
  }
}

function hint(keys: string, label: string): HTMLElement {
  return el("span", { class: "hb-palette__hint" }, el("kbd", {}, keys), el("span", {}, label));
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
