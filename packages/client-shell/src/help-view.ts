/**
 * The Help index (AC-WKS-G4), task-oriented, searchable, offline.
 *
 * A plain-language index of "how do I…" tasks with instant local search, grouped
 * by module. At the top, an Ember box answers questions FROM the local help
 * corpus (nothing leaves the device). No videos, no account.
 */

import type { HearthClient } from "@hearth/core-client";
import { cls, resolveEffort, type Effort } from "@hearth/design-system";
import { HELP_TOPICS, buildHelpRequest, searchHelp } from "@hearth/help";
import type { HelpTopic } from "@hearth/help";

const MODULE_LABEL: Record<string, string> = {
  writer: "Writer",
  sheets: "Sheets",
  records: "Records",
  calendar: "Calendar",
  general: "Getting around",
};

/** The searchable Help surface. */
export class HelpView {
  private overlay: HTMLElement | null = null;
  private listHost: HTMLElement | null = null;
  private effort: Effort = resolveEffort();

  constructor(private readonly client: HearthClient) {}

  /** Open the Help index, optionally focused on a module's topics. */
  open(focusModule?: string): void {
    const overlay = el("div", { class: "hb-modal__backdrop hb-help" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) this.close();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.close();
    };
    document.addEventListener("keydown", onKey);
    this.onKey = onKey;

    const card = el("div", { class: "hb-help__card", role: "dialog", "aria-label": "Help" });
    const head = el("div", { class: "hb-help__head" });
    head.append(el("h2", { class: "hb-help__title" }, "Help"));
    const close = el(
      "button",
      { class: "hb-help__close", type: "button", "aria-label": "Close" },
      "×",
    );
    close.addEventListener("click", () => this.close());
    head.append(close);

    // Ember "how do I…" box.
    const ember = el("div", { class: "hb-help__ember" });
    const ask = el("input", {
      class: cls.input,
      type: "search",
      placeholder: "Ask “how do I…?”, answered on your device",
      "aria-label": "Ask the assistant",
    }) as HTMLInputElement;
    const answer = el("div", { class: "hb-help__answer" });
    ask.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter" && ask.value.trim() !== "") {
        void this.askEmber(ask.value.trim(), answer);
      }
    });
    ember.append(ask, answer);

    // Search the index.
    const search = el("input", {
      class: cls.input,
      type: "search",
      placeholder: "Search help",
      "aria-label": "Search help",
    }) as HTMLInputElement;
    this.listHost = el("div", { class: "hb-help__list" });
    search.addEventListener("input", () => this.renderList(searchHelp(search.value)));

    card.append(head, ember, search, this.listHost);
    overlay.append(card);
    document.body.append(overlay);
    this.overlay = overlay;

    const initial = focusModule
      ? HELP_TOPICS.filter((t) => t.module === focusModule || t.module === "general")
      : HELP_TOPICS;
    this.renderList(initial);
    ask.focus();
  }

  private onKey: ((event: KeyboardEvent) => void) | null = null;

  private close(): void {
    if (this.onKey) {
      document.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
    this.overlay?.remove();
    this.overlay = null;
  }

  /** Render topics grouped by module, each expandable to its answer. */
  private renderList(topics: HelpTopic[]): void {
    if (!this.listHost) {
      return;
    }
    this.listHost.replaceChildren();
    if (topics.length === 0) {
      this.listHost.append(
        el("p", { class: "hb-help__empty" }, "No matching help, try the assistant above."),
      );
      return;
    }
    const order = ["writer", "sheets", "records", "calendar", "general"];
    for (const module of order) {
      const group = topics.filter((t) => t.module === module);
      if (group.length === 0) {
        continue;
      }
      this.listHost.append(el("div", { class: "hb-help__group" }, MODULE_LABEL[module] ?? module));
      for (const topic of group) {
        const item = el("details", { class: "hb-help__topic" });
        item.append(el("summary", { class: "hb-help__task" }, topic.task));
        item.append(el("p", { class: "hb-help__detail" }, topic.answer));
        this.listHost.append(item);
      }
    }
  }

  private async askEmber(question: string, host: HTMLElement): Promise<void> {
    host.replaceChildren(el("p", { class: "hb-help__thinking" }, "Answering on your device…"));
    try {
      const response = await this.client.runEmber(
        buildHelpRequest(question, HELP_TOPICS, this.effort),
      );
      host.replaceChildren(
        el("p", { class: "hb-help__reply" }, response.text),
        el("p", { class: cls.badge }, "On-device · from Hearth Suite's help"),
      );
    } catch {
      host.replaceChildren(
        el("p", { class: "hb-help__reply" }, "Couldn't answer just now, try the topics below."),
      );
    }
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
