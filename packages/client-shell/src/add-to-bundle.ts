/**
 * The Portfolio collect-flow (AC-WKS-S7): "Add to Bundle…".
 *
 * From any module, the current document is sent into a chosen Bundle, pick an
 * existing one or make a new one. The Bundle is the container we already have;
 * this is the Works Portfolio reborn. The dialog is host-side so every editor
 * can reuse it through a single `onAddToBundle` hook. It uses the design-system
 * structured modal (head/body/foot) and shows a skeleton while Bundles load.
 */

import type { DocType, HearthClient } from "@hearth/core-client";

/** What an editor hands over when the user picks "Add to Bundle…". */
export interface CollectPayload {
  docType: DocType;
  title: string;
  contentBase64: string;
}

/** Open the bundle picker and save the payload into the chosen Bundle. */
export async function openAddToBundle(
  client: HearthClient,
  payload: CollectPayload,
  onDone?: (bundleId: string) => void,
  onError?: (message: string) => void,
): Promise<void> {
  const overlay = el("div", { class: "hb-modal__backdrop hb-collect" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  const card = el("div", {
    class: "hb-modal hb-collect__card",
    role: "dialog",
    "aria-label": "Add to Bundle",
  });
  const head = el(
    "div",
    { class: "hb-modal__head" },
    el("h2", { class: "hb-modal__title" }, "Add to Bundle"),
  );
  const body = el("div", { class: "hb-modal__body" });
  body.append(el("p", { class: "hb-collect__lead" }, `Send “${payload.title}” into a Bundle.`));

  const list = el("div", { class: "hb-collect__list" });
  // Skeleton placeholders while we fetch the Bundle list.
  for (let i = 0; i < 3; i += 1)
    list.append(el("div", { class: "hb-skeleton hb-collect__skeleton" }));
  body.append(list);

  const save = async (bundleId: string): Promise<void> => {
    try {
      await client.saveDocument({
        bundle_id: bundleId,
        doc_type: payload.docType,
        content_base64: payload.contentBase64,
        title: payload.title,
      });
      overlay.remove();
      onDone?.(bundleId);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  };

  const nameIn = el("input", {
    class: "hb-input",
    placeholder: "New Bundle name",
  }) as HTMLInputElement;
  const newBtn = el("button", { class: "hb-btn hb-btn--primary", type: "button" }, "Create & add");
  newBtn.addEventListener("click", () => {
    const name = nameIn.value.trim();
    if (name === "") {
      return;
    }
    void (async () => {
      try {
        const bundle = await client.createBundle({ title: name });
        await save(bundle.id);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  body.append(el("div", { class: "hb-collect__new" }, nameIn, newBtn));

  const cancel = el("button", { class: "hb-btn hb-btn--quiet", type: "button" }, "Cancel");
  cancel.addEventListener("click", () => overlay.remove());
  const foot = el("div", { class: "hb-modal__foot" }, cancel);

  card.append(head, body, foot);
  overlay.append(card);
  document.body.append(overlay);

  // Load the Bundles, then swap the skeleton for the real picker.
  let bundles: Array<{ id: string; title: string }> = [];
  try {
    bundles = (await client.listBundles()).map((b) => ({ id: b.id, title: b.title }));
  } catch {
    bundles = [];
  }
  list.replaceChildren();
  if (bundles.length === 0) {
    list.append(el("p", { class: "hb-collect__lead" }, "No Bundles yet, make one below."));
  }
  for (const bundle of bundles) {
    const item = el(
      "button",
      { class: "hb-collect__item", type: "button" },
      el("span", {}, bundle.title),
    );
    item.addEventListener("click", () => void save(bundle.id));
    list.append(item);
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
