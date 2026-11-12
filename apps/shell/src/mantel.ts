/**
 * The Mantel, Hearth Suite's unified workspace home and Task Launcher heir.
 *
 * One calm screen (no scroll on desktop): a personalised greeting, universal
 * local search, and the Task Launcher's three faces as tabs, **Tasks**
 * (goal-phrased, each opening the right module with the right template *and*
 * offering a one-line Ember brief), **Programs** (direct quick-create), and
 * **History** (recent Bundles with type, date, and a filter). A browsable,
 * searchable **template gallery** sits one tap away. Plain language throughout;
 * Ember is always optional. Framework-agnostic DOM; logic lives in core.mjs.
 */

import { cls, icon, type IconName } from "@hearth/design-system";

import {
  TASKS,
  friendlyDate,
  rankResults,
  routeForResult,
  searchTemplates,
  templateCategories,
  templatesByCategory,
} from "./core.mjs";
import type { ModuleId, SearchItem, Task, Template } from "./core.mjs";
import type { BundleStatus, MantelSource, RecentBundle } from "./source";

/** Where the user wants to go when opening a result or recent Bundle. */
export interface OpenTarget {
  module: ModuleId;
  bundleId?: string;
  itemId?: string;
}

/** How to start a new piece of work: blank, from a template, or via Ember. */
export interface CreateOptions {
  /** A template id to seed the new document. */
  template?: string;
  /** A one-line Ember brief to draft from (on-device). */
  brief?: string;
  /** A plain-language title for the new Bundle. */
  title?: string;
}

/** Callbacks the host shell supplies to route navigation. */
export interface MantelOptions {
  onOpen: (target: OpenTarget) => void;
  onCreate: (module: ModuleId, opts?: CreateOptions) => void;
  /** Create a fresh, empty Bundle (the "New Bundle" quick action). */
  onNewBundle?: () => void;
  /** The signed-in person's name, woven into the greeting. */
  userName?: string;
}

interface QuickAction {
  glyph: IconName;
  label: string;
  module?: ModuleId;
}

const QUICK_ACTIONS: QuickAction[] = [
  { glyph: "writer", label: "New document", module: "writer" },
  { glyph: "sheets", label: "New sheet", module: "sheets" },
  { glyph: "records", label: "New records", module: "records" },
  { glyph: "bundle", label: "New Bundle" },
];

const STATUS_LABEL: Record<BundleStatus, string> = {
  sealed: "Sealed",
  draft: "Draft",
  saved: "Saved",
};

type Tab = "tasks" | "programs" | "history";

/** The Mantel home surface. */
export class Mantel {
  private items: SearchItem[] = [];
  private recents: RecentBundle[] = [];
  private tab: Tab = "tasks";
  private view: "home" | "templates" = "home";
  private openTask: string | null = null;
  private historyFilter = "";
  private templateCategory = "All";
  private templateQuery = "";
  private root: HTMLElement | undefined;

  constructor(
    private readonly source: MantelSource,
    private readonly options: MantelOptions,
  ) {}

  /** Render The Mantel into `root`. */
  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    this.items = await this.source.searchItems();
    this.recents = await this.source.recentBundles();
    this.paint();
  }

  private paint(): void {
    if (!this.root) {
      return;
    }
    this.root.replaceChildren(this.view === "templates" ? this.renderGallery() : this.renderHome());
  }

  // ---- Home -----------------------------------------------------------------

  private renderHome(): HTMLElement {
    const main = el("main", { class: "hb-mantel" });
    const header = el("header", { class: "hb-mantel__header" });
    header.append(
      el("h1", { class: "hb-mantel__greeting" }, greeting(this.options.userName)),
      el("p", { class: "hb-mantel__subtitle" }, "What do you want to do?"),
    );
    main.append(
      header,
      this.renderSearch(),
      this.renderTabs(),
      this.renderTabPanel(),
      this.renderFooter(),
    );
    return main;
  }

  private renderTabs(): HTMLElement {
    const bar = el("div", { class: "hb-mantel__tabs", role: "tablist", "aria-label": "Start" });
    const tabs: Array<[Tab, string]> = [
      ["tasks", "Tasks"],
      ["programs", "Programs"],
      ["history", "History"],
    ];
    for (const [id, label] of tabs) {
      const tab = el(
        "button",
        { class: cls.tab, type: "button", role: "tab", "aria-selected": String(this.tab === id) },
        label,
      );
      tab.addEventListener("click", () => {
        this.tab = id;
        this.openTask = null;
        this.paint();
      });
      bar.append(tab);
    }
    return bar;
  }

  private renderTabPanel(): HTMLElement {
    const panel = el("div", { class: "hb-mantel__panel", role: "tabpanel" });
    if (this.tab === "tasks") {
      panel.append(this.renderTasks());
    } else if (this.tab === "programs") {
      panel.append(this.renderPrograms());
    } else {
      panel.append(this.renderHistory());
    }
    return panel;
  }

  // ---- Tasks (S2) -----------------------------------------------------------

  private renderTasks(): HTMLElement {
    const wrap = el("section", { class: "hb-mantel__tasks", "aria-label": "Tasks" });
    const grid = el("div", { class: "hb-mantel__task-grid" });
    for (const task of TASKS) {
      grid.append(this.renderTask(task));
    }
    wrap.append(grid);
    const open = this.openTask ? TASKS.find((t) => t.id === this.openTask) : null;
    if (open) {
      wrap.append(this.renderTaskChooser(open));
    }
    return wrap;
  }

  private renderTask(task: Task): HTMLElement {
    const button = el("button", {
      class: `hb-mantel__task${this.openTask === task.id ? " is-open" : ""}`,
      type: "button",
      "aria-expanded": String(this.openTask === task.id),
    });
    const glyph = el("span", { class: "hb-mantel__task-icon" });
    glyph.innerHTML = icon(task.glyph as IconName, 20);
    button.append(glyph, el("span", { class: "hb-mantel__task-label" }, task.label));
    button.addEventListener("click", () => {
      this.openTask = this.openTask === task.id ? null : task.id;
      this.paint();
    });
    return button;
  }

  /** The two-route chooser: a template (guided) or a one-line Ember brief. */
  private renderTaskChooser(task: Task): HTMLElement {
    const card = el("div", { class: `${cls.card} hb-mantel__chooser` });
    card.append(el("div", { class: "hb-mantel__chooser-title" }, task.label));

    const useTemplate = el(
      "button",
      { class: cls.buttonPrimary, type: "button" },
      "Start from a template",
    );
    useTemplate.addEventListener("click", () =>
      this.options.onCreate(task.module, { template: task.template, title: task.label }),
    );

    const emberRow = el("div", { class: "hb-mantel__chooser-ember" });
    const input = el("input", {
      class: cls.input,
      placeholder: `Or tell Ember in a sentence, e.g. "${task.hint}"`,
      "aria-label": `Describe your ${task.label.toLowerCase()} to Ember`,
    }) as HTMLInputElement;
    const go = el("button", { class: cls.buttonSecondary, type: "button" }, "Draft with Ember");
    const submit = (): void => {
      const brief = input.value.trim();
      if (brief !== "") {
        this.options.onCreate(task.module, { brief, title: task.label });
      }
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") submit();
    });
    emberRow.append(input, go);

    card.append(
      useTemplate,
      emberRow,
      el(
        "p",
        { class: "hb-mantel__chooser-note" },
        "Ember is optional, the template works on its own.",
      ),
    );
    return card;
  }

  // ---- Programs (S3) --------------------------------------------------------

  private renderPrograms(): HTMLElement {
    const section = el("section", { class: "hb-mantel__quick", "aria-label": "Programs" });
    for (const action of QUICK_ACTIONS) {
      const button = el("button", { class: "hb-mantel__create", type: "button" });
      const glyph = el("span", { class: "hb-mantel__create-icon" });
      glyph.innerHTML = icon(action.glyph, 22);
      button.append(glyph, el("span", { class: "hb-mantel__create-label" }, action.label));
      button.addEventListener("click", () => {
        if (action.module) {
          this.options.onCreate(action.module);
        } else {
          this.options.onNewBundle?.();
        }
      });
      section.append(button);
    }
    return section;
  }

  // ---- History (S4) ---------------------------------------------------------

  private renderHistory(): HTMLElement {
    const section = el("section", { class: "hb-mantel__recent", "aria-label": "History" });

    const filter = el("input", {
      class: `${cls.input} hb-mantel__history-filter`,
      type: "search",
      placeholder: "Filter recent…",
      "aria-label": "Filter history",
      value: this.historyFilter,
    }) as HTMLInputElement;
    filter.addEventListener("input", () => {
      this.historyFilter = filter.value;
      const list = section.querySelector(".hb-mantel__recent-list, .hb-empty");
      list?.replaceWith(this.renderHistoryList());
    });
    section.append(filter, this.renderHistoryList());
    return section;
  }

  private filteredRecents(): RecentBundle[] {
    const q = this.historyFilter.trim().toLowerCase();
    return q === "" ? this.recents : this.recents.filter((b) => b.title.toLowerCase().includes(q));
  }

  private renderHistoryList(): HTMLElement {
    const list = this.filteredRecents();
    if (list.length === 0) {
      return el(
        "div",
        { class: cls.emptyState },
        el(
          "p",
          { class: "hb-empty__title" },
          this.recents.length === 0 ? "No Bundles yet" : "No matches",
        ),
        el("p", {}, "Create a document, sheet, or record to get started."),
      );
    }
    const ul = el("ul", { class: "hb-mantel__recent-list" });
    for (const bundle of list) {
      ul.append(this.renderBundle(bundle));
    }
    return ul;
  }

  private renderBundle(bundle: RecentBundle): HTMLElement {
    const li = el("li");
    const card = el("button", {
      class: "hb-card hb-mantel__bundle",
      type: "button",
      "aria-label": `Open ${bundle.title}`,
    });
    const top = el("span", { class: "hb-mantel__bundle-top" });
    const glyph = el("span", { class: "hb-mantel__bundle-icon" });
    glyph.innerHTML = icon("bundle", 20);
    top.append(glyph, statusBadge(bundle.status));
    card.append(
      top,
      el("span", { class: "hb-mantel__bundle-title" }, bundle.title),
      el("span", { class: "hb-mantel__bundle-meta" }, metaLine(bundle)),
    );
    card.addEventListener("click", () =>
      this.options.onOpen({ module: "writer", bundleId: bundle.id }),
    );
    li.append(card);
    return li;
  }

  // ---- Search ---------------------------------------------------------------

  private renderSearch(): HTMLElement {
    const wrap = el("div", { class: cls.search, role: "search" });
    const glyph = el("span", { class: "hb-search__icon" });
    glyph.innerHTML = icon("search", 18);
    const input = el("input", {
      type: "search",
      placeholder: "Search documents, data, people, dates…",
      "aria-label": "Universal search",
    }) as HTMLInputElement;
    wrap.append(glyph, input, el("kbd", { class: "hb-search__hint" }, "⌘K"));

    const results = el("ul", { class: "hb-mantel__results", role: "listbox" });
    input.addEventListener("input", () => {
      const ranked = rankResults(input.value, this.items);
      results.replaceChildren(...ranked.map((r) => this.renderResult(r)));
    });
    const section = el("div", { class: "hb-mantel__search" });
    section.append(wrap, results);
    return section;
  }

  private renderResult(item: SearchItem): HTMLElement {
    const li = el("li", { role: "option" });
    const button = el(
      "button",
      { class: cls.menuItem, type: "button" },
      `${item.title}  ·  ${item.kind}`,
    );
    button.addEventListener("click", () =>
      this.options.onOpen({
        module: routeForResult(item),
        bundleId: item.bundleId,
        itemId: item.id,
      }),
    );
    li.append(button);
    return li;
  }

  // ---- Footer + template gallery (S6) --------------------------------------

  private renderFooter(): HTMLElement {
    const footer = el("div", { class: "hb-mantel__footer" });
    const browse = el("button", { class: cls.buttonGhost, type: "button" }, "Browse templates →");
    browse.addEventListener("click", () => {
      this.view = "templates";
      this.paint();
    });
    footer.append(browse, renderAdvanced());
    return footer;
  }

  private renderGallery(): HTMLElement {
    const main = el("main", { class: "hb-mantel hb-gallery" });
    const head = el("div", { class: "hb-gallery__head" });
    const back = el("button", { class: cls.buttonGhost, type: "button" }, "← Back");
    back.addEventListener("click", () => {
      this.view = "home";
      this.paint();
    });
    head.append(back, el("h1", { class: "hb-mantel__greeting" }, "Templates"));
    main.append(head);

    const search = el("div", { class: cls.search, role: "search" });
    const glyph = el("span", { class: "hb-search__icon" });
    glyph.innerHTML = icon("search", 18);
    const input = el("input", {
      type: "search",
      placeholder: "Search templates…",
      "aria-label": "Search templates",
      value: this.templateQuery,
    }) as HTMLInputElement;
    search.append(glyph, input);
    input.addEventListener("input", () => {
      this.templateQuery = input.value;
      this.repaintGalleryGrid(main);
    });
    main.append(search);

    const cats = el("div", { class: "hb-gallery__cats", role: "tablist" });
    for (const category of templateCategories()) {
      const chip = el(
        "button",
        {
          class: `hb-gallery__cat${this.templateCategory === category ? " is-active" : ""}`,
          type: "button",
        },
        category,
      );
      chip.addEventListener("click", () => {
        this.templateCategory = category;
        this.templateQuery = "";
        input.value = "";
        this.paint();
      });
      cats.append(chip);
    }
    main.append(cats, this.renderGalleryGrid());
    return main;
  }

  private repaintGalleryGrid(main: HTMLElement): void {
    main.querySelector(".hb-gallery__grid")?.replaceWith(this.renderGalleryGrid());
  }

  private galleryTemplates(): Template[] {
    if (this.templateQuery.trim() !== "") {
      return searchTemplates(this.templateQuery);
    }
    return templatesByCategory(this.templateCategory);
  }

  private renderGalleryGrid(): HTMLElement {
    const grid = el("div", { class: "hb-gallery__grid" });
    const templates = this.galleryTemplates();
    if (templates.length === 0) {
      grid.append(
        el(
          "div",
          { class: cls.emptyState },
          el("p", { class: "hb-empty__title" }, "No templates match"),
        ),
      );
      return grid;
    }
    for (const template of templates) {
      grid.append(this.renderTemplateCard(template));
    }
    return grid;
  }

  private renderTemplateCard(template: Template): HTMLElement {
    const card = el("div", { class: `${cls.card} hb-gallery__card` });
    const preview = el("div", { class: "hb-gallery__preview", "aria-hidden": "true" });
    for (const line of template.preview) {
      preview.append(el("div", { class: "hb-gallery__preview-line" }, line || " "));
    }
    card.append(
      preview,
      el("div", { class: "hb-gallery__card-name" }, template.name),
      el("div", { class: "hb-gallery__card-cat" }, template.category),
      el("p", { class: "hb-gallery__card-desc" }, template.description),
    );
    const use = el("button", { class: cls.buttonPrimary, type: "button" }, "Use template");
    use.addEventListener("click", () =>
      this.options.onCreate(template.module, { template: template.id, title: template.name }),
    );
    card.append(use);
    return card;
  }
}

/** The plain-language meta line under a Bundle title (type · count · date). */
function metaLine(bundle: RecentBundle): string {
  const count = bundle.documentCount;
  const docs = count === 1 ? "1 document" : `${count} documents`;
  const when = friendlyDate(bundle.updatedAt);
  // History (AC-WKS-S3) wants type + date; the persistent chrome already shows
  // the "On your device" cue, so fall back to it only when no date is known.
  return when ? `Bundle · ${docs} · ${when}` : `Bundle · ${docs} · On your device`;
}

/** A status pill: Sealed uses the seal colour + lock icon + text (never colour alone). */
function statusBadge(status: BundleStatus): HTMLElement {
  if (status === "sealed") {
    const badge = el("span", { class: cls.sealBadge });
    badge.innerHTML = `${icon("lock", 14)}<span>Sealed</span>`;
    return badge;
  }
  return el("span", { class: `${cls.badge} hb-badge--${status}` }, STATUS_LABEL[status]);
}

/** A warm, time-of-day greeting, personalised when a name is known. */
function greeting(userName?: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = userName?.trim();
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`;
}

/** Advanced controls live behind disclosure (progressive depth). */
function renderAdvanced(): HTMLElement {
  const details = el("details", { class: "hb-mantel__advanced" });
  details.append(
    el("summary", {}, "Advanced"),
    el(
      "p",
      { class: "hb-mantel__advanced-body" },
      "Encryption, sync, and relations appear here when you need them.",
    ),
  );
  return details;
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
