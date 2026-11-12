/**
 * The Formula Helper, a plain-language stepper that walks a novice through
 * choosing a function and filling its arguments (the Works "Easy Calc" heir).
 *
 * Step 1: pick a category, then a function (each with a one-line summary).
 * Step 2: fill one box per argument, each prompted in plain words, with a live
 *         preview of the formula. "Insert" hands the finished `=NAME(…)` back to
 *         the editor for the active cell. No jargon, no syntax to memorise.
 */

import { cls } from "@hearth/design-system";

import { FUNCTION_CATALOG } from "./core.mjs";
import type { CatalogCategory, CatalogFunction } from "./core.mjs";

export class FormulaHelper {
  private overlay: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private category: CatalogCategory = FUNCTION_CATALOG[0] as CatalogCategory;

  constructor(private readonly onInsert: (formula: string) => void) {}

  open(): void {
    const overlay = el("div", { class: "hb-modal__backdrop hb-fxhelp" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) this.close();
    });
    const card = el("div", {
      class: "hb-fxhelp__card",
      role: "dialog",
      "aria-label": "Formula Helper",
    });
    const head = el("div", { class: "hb-fxhelp__head" });
    head.append(el("h2", { class: "hb-fxhelp__title" }, "Formula Helper"));
    const close = el(
      "button",
      { class: "hb-fxhelp__close", type: "button", "aria-label": "Close" },
      "×",
    );
    close.addEventListener("click", () => this.close());
    head.append(close);

    this.body = el("div", { class: "hb-fxhelp__body" });
    card.append(head, this.body);
    overlay.append(card);
    document.body.append(overlay);
    this.overlay = overlay;
    this.renderPick();
  }

  private close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  /** Step 1, choose a category and a function. */
  private renderPick(): void {
    if (!this.body) {
      return;
    }
    const wrap = el("div", { class: "hb-fxhelp__pick" });
    const chips = el("div", { class: "hb-fxhelp__chips" });
    for (const cat of FUNCTION_CATALOG) {
      const chip = el(
        "button",
        {
          class: `hb-fxhelp__chip${cat === this.category ? " is-active" : ""}`,
          type: "button",
        },
        cat.category,
      );
      chip.addEventListener("click", () => {
        this.category = cat;
        this.renderPick();
      });
      chips.append(chip);
    }
    const list = el("div", { class: "hb-fxhelp__list" });
    for (const fn of this.category.functions) {
      const item = el("button", { class: "hb-fxhelp__fn", type: "button" });
      item.append(
        el("span", { class: "hb-fxhelp__fn-name" }, fn.signature),
        el("span", { class: "hb-fxhelp__fn-summary" }, fn.summary),
      );
      item.addEventListener("click", () => this.renderFill(fn));
      list.append(item);
    }
    wrap.append(el("p", { class: "hb-fxhelp__lead" }, "What do you want to do?"), chips, list);
    this.body.replaceChildren(wrap);
  }

  /** Step 2, fill the chosen function's arguments. */
  private renderFill(fn: CatalogFunction): void {
    if (!this.body) {
      return;
    }
    const wrap = el("div", { class: "hb-fxhelp__fill" });
    const back = el("button", { class: "hb-fxhelp__back", type: "button" }, "‹ Back");
    back.addEventListener("click", () => this.renderPick());
    wrap.append(
      back,
      el("h3", { class: "hb-fxhelp__fn-title" }, fn.name),
      el("p", { class: "hb-fxhelp__fn-summary" }, fn.summary),
    );

    const inputs: HTMLInputElement[] = [];
    const preview = el("code", { class: "hb-fxhelp__preview" });
    const update = (): void => {
      const filled = inputs.map((i) => i.value.trim()).filter((v) => v !== "");
      preview.textContent = `=${fn.name}(${filled.join(", ")})`;
    };
    if (fn.args.length === 0) {
      preview.textContent = `=${fn.name}()`;
    }
    for (const prompt of fn.args) {
      const field = el("label", { class: "hb-fxhelp__arg" });
      field.append(el("span", { class: "hb-fxhelp__arg-label" }, prompt));
      const input = el("input", { class: cls.input, placeholder: prompt }) as HTMLInputElement;
      input.addEventListener("input", update);
      field.append(input);
      inputs.push(input);
      wrap.append(field);
    }
    update();

    const foot = el("div", { class: "hb-fxhelp__foot" });
    const insert = el(
      "button",
      { class: `${cls.button} hb-fxhelp__primary`, type: "button" },
      "Insert formula",
    );
    insert.addEventListener("click", () => {
      this.onInsert(preview.textContent ?? `=${fn.name}()`);
      this.close();
    });
    foot.append(el("span", { class: "hb-fxhelp__preview-wrap" }, preview), insert);
    wrap.append(foot);
    this.body.replaceChildren(wrap);
    inputs[0]?.focus();
  }
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
