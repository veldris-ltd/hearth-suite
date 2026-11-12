/**
 * First-time coach panels (AC-WKS-G4).
 *
 * A short, friendly card shown the first time you open a module, three plain-
 * language tips. "Got it" dismisses it forever in one tap (a per-module flag);
 * "More help" opens the searchable help index. Non-modal: it floats in the
 * corner so it never blocks the work. The dismiss flag persists through the
 * injected store — the client shell passes the vault-backed preference store so
 * "dismissed forever" travels with sync, not just this device.
 */

import { coachDismissed, coachFor, dismissCoach } from "@hearth/help";
import type { PreferenceStorage } from "@hearth/design-system";

/**
 * Show the first-time coach for a module, if it hasn't been dismissed. Returns
 * the node (already appended to `document.body`) or null when nothing to show.
 */
export function showCoach(
  module: string,
  onMoreHelp?: () => void,
  storage?: PreferenceStorage,
): HTMLElement | null {
  if (coachDismissed(module, storage)) {
    return null;
  }
  const content = coachFor(module);
  if (!content) {
    return null;
  }

  const card = el("div", { class: "hb-coach", role: "note", "aria-label": content.title });
  const head = el("div", { class: "hb-coach__head" });
  head.append(el("strong", { class: "hb-coach__title" }, content.title));
  const close = el(
    "button",
    { class: "hb-coach__close", type: "button", "aria-label": "Dismiss" },
    "×",
  );
  close.addEventListener("click", () => {
    dismissCoach(module, storage);
    card.remove();
  });
  head.append(close);

  const list = el("ul", { class: "hb-coach__tips" });
  for (const tip of content.tips) {
    list.append(el("li", {}, tip));
  }

  const foot = el("div", { class: "hb-coach__foot" });
  if (onMoreHelp) {
    const more = el("button", { class: "hb-btn hb-coach__more", type: "button" }, "More help");
    more.addEventListener("click", () => onMoreHelp());
    foot.append(more);
  }
  const got = el("button", { class: "hb-btn hb-btn--primary", type: "button" }, "Got it");
  got.addEventListener("click", () => {
    dismissCoach(module, storage);
    card.remove();
  });
  foot.append(got);

  card.append(head, el("p", { class: "hb-coach__lead" }, content.lead), list, foot);
  document.body.append(card);
  return card;
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
