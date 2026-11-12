/**
 * Hearth Suite Contacts, the local-first Address Book surface.
 *
 * Lists, adds, and imports/exports contacts; the same records feed Writer merge,
 * Records links, and Calendar birthday/anniversary auto-events with no re-entry
 * (AC-WKS-S10). Persistence goes through the injected `storage` (the client shell
 * passes the vault-backed preference store, so the address book is encrypted at
 * rest and travels with sync, PW-1.3); without one it falls back to localStorage.
 * Plain language throughout.
 */

import { cls, icon } from "@hearth/design-system";
import {
  loadContacts,
  parseVcard,
  removeContact,
  saveContacts,
  toVcard,
  upsertContact,
  type Contact,
  type ContactStorage,
} from "@hearth/contacts";

import { toast } from "./toast";

/** The Contacts surface. */
export class ContactsView {
  private root: HTMLElement | undefined;

  /** @param storage where the address book persists (vault-backed when provided). */
  constructor(private readonly storage?: ContactStorage) {}

  /** Render the address book into `root`. */
  mount(root: HTMLElement): void {
    this.root = root;
    this.paint();
  }

  private contacts(): Contact[] {
    return loadContacts(this.storage).sort((a, b) => a.name.localeCompare(b.name));
  }

  private paint(): void {
    if (!this.root) {
      return;
    }
    const list = this.contacts();
    const main = el("section", { class: "hb-contacts" });

    // Header
    const head = el("div", { class: "hb-contacts__header" });
    const titles = el(
      "div",
      {},
      el("h1", { class: "hb-contacts__title" }, "Contacts"),
      el(
        "p",
        { class: "hb-contacts__meta" },
        `${list.length} ${list.length === 1 ? "person" : "people"} · shared with Writer, Records & Calendar`,
      ),
    );
    const actions = el(
      "div",
      { class: "hb-contacts__actions" },
      this.importButton(),
      el("button", { class: cls.buttonSecondary, type: "button" }, "Export vCard"),
    );
    (actions.lastElementChild as HTMLButtonElement)?.addEventListener("click", () =>
      this.exportVcard(),
    );
    head.append(titles, actions);
    main.append(head);

    // Body: add form + list
    main.append(
      el("div", { class: "hb-contacts__grid" }, this.renderForm(), this.renderList(list)),
    );
    this.root.replaceChildren(main);
  }

  private renderForm(): HTMLElement {
    const form = el("form", {
      class: `${cls.card} hb-contacts__form`,
      "aria-label": "Add a contact",
    });
    const field = (type = "text"): HTMLInputElement =>
      el("input", { class: cls.input, type }) as HTMLInputElement;
    const labelled = (label: string, input: HTMLInputElement): HTMLElement =>
      el("label", { class: "hb-contacts__field" }, el("span", {}, label), input);

    const name = field();
    const email = field("email");
    const phone = field("tel");
    const organization = field();
    const birthday = field("date");
    const anniversary = field("date");

    form.append(
      el("div", { class: "hb-contacts__form-title" }, "Add a contact"),
      labelled("Name", name),
      labelled("Email", email),
      labelled("Phone", phone),
      labelled("Organisation", organization),
      labelled("Birthday", birthday),
      labelled("Anniversary", anniversary),
      el("button", { class: cls.buttonPrimary, type: "submit" }, "Add contact"),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (name.value.trim() === "") {
        return;
      }
      upsertContact(
        {
          name: name.value.trim(),
          emails: email.value.trim() ? [email.value.trim()] : [],
          phones: phone.value.trim() ? [phone.value.trim()] : [],
          organization: organization.value.trim(),
          birthday: birthday.value,
          anniversary: anniversary.value,
        },
        this.storage,
      );
      this.paint();
    });
    return form;
  }

  private renderList(list: Contact[]): HTMLElement {
    const wrap = el("div", { class: "hb-contacts__list" });
    if (list.length === 0) {
      wrap.append(
        el(
          "div",
          { class: cls.emptyState },
          el("p", { class: "hb-empty__title" }, "No contacts yet"),
          el(
            "p",
            {},
            "Add someone, or import a vCard. Birthdays appear in your Calendar automatically.",
          ),
        ),
      );
      return wrap;
    }
    for (const contact of list) {
      const card = el("div", { class: `${cls.card} hb-contacts__card` });
      const avatar = el("span", { class: cls.avatar }, initial(contact.name));
      const body = el("div", { class: "hb-contacts__card-body" });
      body.append(el("div", { class: "hb-contacts__name" }, contact.name));
      const meta = [contact.emails[0], contact.phones[0], contact.organization]
        .filter(Boolean)
        .join(" · ");
      if (meta) {
        body.append(el("div", { class: "hb-contacts__sub" }, meta));
      }
      const tags = el("div", { class: "hb-contacts__tags" });
      if (contact.birthday) {
        tags.append(el("span", { class: cls.badge }, `🎂 ${contact.birthday}`));
      }
      if (contact.anniversary) {
        tags.append(el("span", { class: cls.badge }, `💍 ${contact.anniversary}`));
      }
      if (tags.childElementCount > 0) {
        body.append(tags);
      }
      const remove = el("button", {
        class: "hb-contacts__remove",
        type: "button",
        "aria-label": `Remove ${contact.name}`,
        title: "Remove",
      });
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        removeContact(contact.id, this.storage);
        this.paint();
      });
      card.append(avatar, body, remove);
      wrap.append(card);
    }
    return wrap;
  }

  private importButton(): HTMLElement {
    const label = el("label", { class: `${cls.buttonSecondary} hb-contacts__import` });
    label.append(iconText("contact", "Import vCard"));
    const input = el("input", {
      type: "file",
      accept: ".vcf,text/vcard",
      class: "hb-contacts__file",
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void file.text().then((text) => {
        const incoming = parseVcard(text);
        if (incoming.length > 0) {
          saveContacts([...loadContacts(this.storage), ...incoming], this.storage);
          this.paint();
        }
      });
    });
    label.append(input);
    return label;
  }

  private exportVcard(): void {
    const text = toVcard(this.contacts());
    if (typeof URL === "undefined" || typeof Blob === "undefined") {
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: "text/vcard" }));
    const a = el("a", { href: url, download: "hearth-contacts.vcf" }) as HTMLAnchorElement;
    a.click();
    URL.revokeObjectURL(url);
    toast("Contacts exported.", { variant: "success" });
  }
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "·";
}
function iconText(name: Parameters<typeof icon>[0], text: string): HTMLElement {
  const span = el("span", { class: "hb-icon-text" });
  span.innerHTML = `${icon(name, 18)}<span>${text}</span>`;
  return span;
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
