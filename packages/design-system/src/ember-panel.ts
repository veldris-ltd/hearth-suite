/**
 * The shared Ember assistant panel (the v1.0 `ember-panel`). One component mounts
 * into every module via `[data-ember]`: a spark head with an on-device cue, a
 * conversation of bubbles, one-tap suggestion chips, a typing cursor while the
 * on-device model thinks, an effort segmented control with a model-tier note, and
 * a send input row. Modules supply their own suggestions, ask-builder and run fn
 * (so this stays decoupled from the client, it is generic over the request type).
 */

import { icon } from "./icons";
import { resolveEffort, setEffort, type Effort } from "./index";

/** What the on-device model returns. */
export interface EmberRunResult {
  text: string;
  model: string;
  device_local: boolean;
}

/** A one-tap suggestion chip; `build` makes the request for the current effort. */
export interface EmberSuggestion<Req> {
  label: string;
  build: (effort: Effort) => Req;
}

export interface EmberPanelOptions<Req> {
  /** Run a request against the on-device model (e.g. `client.runEmber`). */
  run: (req: Req) => Promise<EmberRunResult>;
  /** The free-form ask row. */
  ask?: { placeholder: string; build: (text: string, effort: Effort) => Req };
  /** One-tap suggestion chips (module-specific). */
  suggestions?: Array<EmberSuggestion<Req>>;
  /** A short intro line shown as Ember's first bubble. */
  intro?: string;
  /** Render responses in monospace (e.g. Sheets formulae). */
  mono?: boolean;
  /** Follow-up action buttons rendered under a response (e.g. "Use this formula"). */
  resultActions?: (result: EmberRunResult) => HTMLElement[];
  /** Surface an error to the host (the panel also shows it inline, calmly). */
  onError?: (message: string) => void;
}

/** Effort → on-device model tier, shown as the model-tier note under the control. */
const EFFORT_MODEL: Record<Effort, string> = { fast: "Phi", balanced: "Phi", thorough: "Nemotron" };
const EFFORT_LABEL: Record<Effort, string> = {
  fast: "Fast",
  balanced: "Balanced",
  thorough: "Thorough",
};
const EFFORTS: Effort[] = ["fast", "balanced", "thorough"];

function elem(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The shared Ember panel. Construct once per module mount; insert `el()`. */
export class EmberPanel<Req> {
  private readonly root: HTMLElement;
  private readonly msgs: HTMLElement;
  private readonly tierNote: HTMLElement;
  private effortValue: Effort = resolveEffort();
  private busy = false;

  constructor(private readonly options: EmberPanelOptions<Req>) {
    this.root = elem("section", "hb-ember");
    this.root.setAttribute("aria-label", "Ember");
    this.root.setAttribute("data-ember", "");

    const head = elem("div", "hb-ember__head");
    const spark = elem("div", "hb-ember__spark");
    spark.innerHTML = icon("ember", 20);
    const title = elem("div", "hb-ember__title", "Ember");
    title.append(elem("small", undefined, "Assistant · on your device"));
    const chip = elem("span", "hb-ondevice");
    chip.innerHTML = `${icon("lock", 14)}<span>Nothing leaves this device</span>`;
    head.append(spark, title, chip);

    this.msgs = elem("div", "hb-ember__msgs");
    if (options.intro) {
      this.addBubble(options.intro, "ember");
    }
    if (options.suggestions?.length) {
      this.msgs.append(this.renderSuggestions());
    }

    const foot = elem("div", "hb-ember__foot");
    const meta = elem("div", "hb-ember__meta");
    meta.append(this.renderEffort());
    this.tierNote = elem("span", "hb-ember__tier", this.tierText());
    meta.append(this.tierNote);
    foot.append(meta);
    if (options.ask) {
      foot.append(this.renderInputRow(options.ask));
    }

    this.root.append(head, this.msgs, foot);
  }

  /** The panel root element to mount into a module. */
  el(): HTMLElement {
    return this.root;
  }

  /** The currently selected effort. */
  effort(): Effort {
    return this.effortValue;
  }

  private tierText(): string {
    return `${EFFORT_MODEL[this.effortValue]} · ${this.effortValue}`;
  }

  private renderEffort(): HTMLElement {
    const seg = elem("div", "hb-segmented");
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "Ember effort");
    for (const value of EFFORTS) {
      const b = elem(
        "button",
        value === this.effortValue ? "is-active" : undefined,
        EFFORT_LABEL[value],
      );
      b.setAttribute("type", "button");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(value === this.effortValue));
      b.addEventListener("click", () => {
        this.effortValue = value;
        setEffort(value);
        for (const sib of Array.from(seg.children)) {
          sib.classList.toggle("is-active", sib === b);
          sib.setAttribute("aria-selected", String(sib === b));
        }
        this.tierNote.textContent = this.tierText();
      });
      seg.append(b);
    }
    return seg;
  }

  private renderSuggestions(): HTMLElement {
    const wrap = elem("div", "hb-ember__suggestions");
    for (const s of this.options.suggestions ?? []) {
      const chip = elem("button", "hb-ember__chip", s.label);
      chip.setAttribute("type", "button");
      chip.addEventListener("click", () => void this.send(s.label, s.build(this.effortValue)));
      wrap.append(chip);
    }
    return wrap;
  }

  private renderInputRow(ask: {
    placeholder: string;
    build: (t: string, e: Effort) => Req;
  }): HTMLElement {
    const row = elem("div", "hb-ember__input-row");
    const input = elem("input", "hb-input") as HTMLInputElement;
    input.placeholder = ask.placeholder;
    const submit = (): void => {
      const text = input.value.trim();
      if (text === "" || this.busy) {
        return;
      }
      input.value = "";
      void this.send(text, ask.build(text, this.effortValue));
    };
    input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        submit();
      }
    });
    const send = elem("button", "hb-btn hb-btn--primary hb-btn--icon");
    send.setAttribute("type", "button");
    send.setAttribute("aria-label", "Ask Ember");
    send.innerHTML = icon("send", 18);
    send.addEventListener("click", submit);
    row.append(input, send);
    return row;
  }

  private addBubble(text: string, who: "ember" | "user"): HTMLElement {
    const msg = elem("div", "hb-ember__msg");
    let klass = "hb-ember__bubble";
    if (who === "user") {
      klass += " hb-ember__bubble--user";
    } else if (this.options.mono) {
      klass += " hb-ember__bubble--mono";
    }
    const bubble = elem("div", klass, text);
    msg.append(bubble);
    this.msgs.append(msg);
    this.msgs.scrollTop = this.msgs.scrollHeight;
    return msg;
  }

  private async send(userLabel: string, request: Req): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.addBubble(userLabel, "user");

    const pending = elem("div", "hb-ember__msg");
    const pendingBubble = elem("div", "hb-ember__bubble");
    pendingBubble.append(elem("span", "hb-ember__cursor"));
    pending.append(pendingBubble);
    this.msgs.append(pending);
    this.msgs.scrollTop = this.msgs.scrollHeight;

    try {
      const result = await this.options.run(request);
      pending.remove();
      const msg = this.addBubble(result.text, "ember");
      const actions = this.options.resultActions?.(result) ?? [];
      if (actions.length > 0) {
        const wrap = elem("div", "hb-ember__actions");
        wrap.append(...actions);
        msg.append(wrap);
      }
      msg.append(
        elem(
          "div",
          "hb-ember__tier",
          `${result.device_local ? "On-device" : "Remote"} · ${result.model}`,
        ),
      );
    } catch (error) {
      pending.remove();
      const message = error instanceof Error ? error.message : String(error);
      this.addBubble(`Sorry, ${message}`, "ember");
      this.options.onError?.(message);
    } finally {
      this.busy = false;
    }
  }
}
