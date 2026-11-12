/**
 * Hearth Suite Ops, the infrastructure console (diagram 03b), reframed to the v1.0
 * design.
 *
 * A framework-agnostic DOM panel for Veldris operators. The sidebar shows the
 * six Ops areas the operator's role can see, with a theme toggle pinned to the
 * footer; mutating controls render only when the role may use them (mirroring
 * the server policy via `core.mjs`). The server re-checks every call. The whole
 * console manages infrastructure only, it never sees customer content (the API
 * client guards every response, AC-ADMIN-4).
 */

import { cls, icon, resolveTheme, setTheme } from "@hearth/design-system";
import type { Theme } from "@hearth/design-system";

import type { AdminApi, Session } from "./api";
import { ROLE_LABELS, canPerform, sparklinePath, visibleModules } from "./core.mjs";
import type { Role } from "./core.mjs";

type ModuleId = "dashboard" | "relay" | "release" | "keydir" | "audit" | "access";

/** The mounted Hearth Suite Ops console. */
export class AdminPanel {
  private readonly content: HTMLElement;
  private readonly navButtons = new Map<ModuleId, HTMLElement>();
  private active: ModuleId = "dashboard";

  constructor(
    private readonly api: AdminApi,
    private readonly session: Session,
    root: HTMLElement,
  ) {
    // Brand lockup: Hearth Suite Ops over the operating company.
    const brand = el("div", { class: "hb-ops__brand" });
    brand.innerHTML = `${icon("flame", 24)}<span class="hb-ops__brand-text"><strong>Hearth Suite Ops</strong><small>Veldris Ltd.</small></span>`;

    // Nav: the six v1.0 areas, role-scoped.
    const nav = el("nav", { class: "hb-ops__nav", "aria-label": "Hearth Suite Ops" });
    for (const module of visibleModules(this.session.role)) {
      const id = module.id as ModuleId;
      const b = el("button", { class: "hb-ops__nav-item", type: "button" });
      b.innerHTML = `${icon(NAV_ICON[id], 18)}<span>${module.label}</span>`;
      b.addEventListener("click", () => void this.show(id, module.mutable));
      this.navButtons.set(id, b);
      nav.append(b);
    }

    // Footer: operator identity + a working theme toggle.
    const role = ROLE_LABELS[this.session.role]?.label ?? this.session.role;
    const who = el(
      "div",
      { class: "hb-ops__who" },
      el("span", { class: "hb-ops__who-name" }, this.session.operator),
      el("span", { class: "hb-ops__who-role" }, role),
    );
    const footer = el("div", { class: "hb-ops__footer" }, who, this.themeToggle());

    const sidebar = el("aside", { class: "hb-ops__sidebar" }, brand, nav, footer);
    // The main landmark and skip-to-content target (P2-Q1).
    this.content = el("section", {
      class: "hb-ops__content",
      id: "hb-main",
      role: "main",
      tabindex: "-1",
      "aria-live": "polite",
    });
    root.replaceChildren(el("div", { class: "hb-ops" }, sidebar, this.content));
  }

  /** Mount and show the Dashboard. */
  mount(): void {
    void this.show("dashboard", false);
  }

  /** A sidebar-footer light/dark toggle (reuses resolveTheme/setTheme). */
  private themeToggle(): HTMLElement {
    const btn = el("button", { class: "hb-ops__theme", type: "button" });
    const paint = (theme: Theme): void => {
      const next = theme === "dark" ? "light" : "dark";
      btn.innerHTML = `${icon(theme === "dark" ? "sun" : "moon", 16)}<span>${next === "dark" ? "Dark" : "Light"} theme</span>`;
      btn.setAttribute("aria-label", `Switch to ${next} theme`);
    };
    paint(resolveTheme());
    btn.addEventListener("click", () => {
      const next: Theme = resolveTheme() === "dark" ? "light" : "dark";
      setTheme(next);
      paint(next);
    });
    return btn;
  }

  private async show(module: ModuleId, mutable: boolean): Promise<void> {
    this.active = module;
    for (const [id, b] of this.navButtons) b.classList.toggle("is-active", id === module);
    try {
      switch (module) {
        case "dashboard":
          this.render("Dashboard", await this.renderDashboard());
          break;
        case "relay":
          this.render("Sync relay", await this.renderRelay(mutable));
          break;
        case "release":
          this.render("Releases", await this.renderReleases(mutable));
          break;
        case "keydir":
          this.render("Key directory", await this.renderKeydir(mutable));
          break;
        case "audit":
          this.render("Audit log", await this.renderAudit());
          break;
        case "access":
          this.render("Access & roles", await this.renderAccess(mutable));
          break;
      }
    } catch (error) {
      this.render(
        "Something went wrong",
        el("p", { role: "alert" }, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private render(title: string, body: HTMLElement): void {
    this.content.replaceChildren(el("h1", { class: "hb-ops__title" }, title), body);
  }

  // ---- Dashboard ------------------------------------------------------------

  private async renderDashboard(): Promise<HTMLElement> {
    const snap = await this.api.dashboard();
    const wrap = el("div", { class: "hb-ops__dash" });

    // The reassurance that anchors the whole console.
    const banner = el("div", { class: "hb-ops__banner", role: "note" });
    banner.innerHTML = `${icon("lock", 18)}<div class="hb-ops__banner-body"><strong>Zero content visibility</strong><span>This console manages infrastructure only. No operator, not even Veldris, can read customer documents. They stay sealed end to end on people's own devices.</span></div>`;
    wrap.append(banner);

    // Four stat cards with sparklines.
    const stats = el("div", { class: "hb-ops__stats" });
    for (const stat of snap.stats) {
      stats.append(statCard(stat));
    }
    wrap.append(stats);

    // Service-health and recent alerts, side by side.
    const grid = el("div", { class: "hb-ops__panels" });

    const healthCard = el("div", { class: "hb-ops__card" });
    healthCard.append(el("h2", { class: "hb-ops__card-title" }, "Service health"));
    const healthList = el("ul", { class: "hb-ops__services" });
    for (const svc of snap.services) {
      const li = el("li", { class: "hb-ops__service" });
      const dot = el("span", {
        class: `hb-ops__dot ${svc.healthy ? "is-ok" : "is-bad"}`,
        "aria-hidden": "true",
      });
      li.append(
        el("span", { class: "hb-ops__service-name" }, dot, svc.name),
        el("span", { class: "hb-ops__service-p99" }, `p99 ${svc.p99_ms} ms`),
      );
      healthList.append(li);
    }
    healthCard.append(healthList);

    const alertsCard = el("div", { class: "hb-ops__card" });
    alertsCard.append(el("h2", { class: "hb-ops__card-title" }, "Recent alerts"));
    if (snap.alerts.length === 0) {
      alertsCard.append(
        el("p", { class: "hb-ops__muted" }, "Nothing to report. All services nominal."),
      );
    } else {
      const alertList = el("ul", { class: "hb-ops__alerts" });
      for (const alert of snap.alerts) {
        const li = el("li", { class: `hb-ops__alert is-${alert.severity}` });
        li.append(
          el("span", { class: "hb-ops__alert-icon", "aria-hidden": "true" }),
          el("span", { class: "hb-ops__alert-detail" }, alert.detail),
          el("time", { class: "hb-ops__alert-at" }, formatWhen(alert.at)),
        );
        alertList.append(li);
      }
      alertsCard.append(alertList);
    }

    grid.append(healthCard, alertsCard);
    wrap.append(grid);
    return wrap;
  }

  // ---- Sync relay -----------------------------------------------------------

  private async renderRelay(mutable: boolean): Promise<HTMLElement> {
    const [quota, blobs] = await Promise.all([this.api.relayQuota(), this.api.relayBlobs()]);
    const usedBytes = blobs.reduce((n, b) => n + b.size_bytes, 0);
    const wrap = el("div", { class: "hb-ops__stack" });

    const meters = el("div", { class: "hb-ops__card" });
    meters.append(el("h2", { class: "hb-ops__card-title" }, "Capacity"));
    meters.append(
      quotaMeter("Blobs stored", blobs.length, quota.max_blobs),
      quotaMeter("Ciphertext stored", usedBytes, quota.max_bytes, formatBytes),
    );
    wrap.append(meters);

    const blobsCard = el("div", { class: "hb-ops__card" });
    const head = el(
      "div",
      { class: "hb-ops__card-head" },
      el("h2", { class: "hb-ops__card-title" }, "Stored blobs"),
    );
    if (mutable) {
      head.append(
        actionButton("Reclaim expired", async () => {
          await this.api.reclaimExpired();
          await this.show("relay", true);
        }),
      );
    }
    blobsCard.append(
      head,
      table(
        ["Blob", "Bytes", "TTL", "State"],
        blobs.map((b) => [b.id, formatBytes(b.size_bytes), `${b.ttl_seconds}s`, stateTag(b.state)]),
      ),
    );
    wrap.append(blobsCard);
    return wrap;
  }

  // ---- Releases -------------------------------------------------------------

  private async renderReleases(mutable: boolean): Promise<HTMLElement> {
    const releases = await this.api.releases();
    const latest = (channel: "stable" | "beta"): number | undefined =>
      releases
        .filter((r) => r.channel === channel)
        .map((r) => r.version)
        .sort((a, b) => b - a)[0];
    const wrap = el("div", { class: "hb-ops__stack" });

    const channels = el("div", { class: "hb-ops__channels" });
    for (const channel of ["stable", "beta"] as const) {
      const card = el("div", { class: `hb-ops__channel hb-ops__channel--${channel}` });
      const v = latest(channel);
      card.append(
        el("div", { class: "hb-ops__channel-name" }, channel === "stable" ? "Stable" : "Beta"),
        el("div", { class: "hb-ops__channel-version" }, v ? `v${v}` : "none yet"),
      );
      const attest = el("div", { class: "hb-ops__attest" });
      attest.innerHTML = `${icon("shield", 14)}<span>Signed &amp; attested (TUF + ML-DSA)</span>`;
      card.append(attest);
      channels.append(card);
    }
    wrap.append(channels);

    const listCard = el("div", { class: "hb-ops__card" });
    listCard.append(el("h2", { class: "hb-ops__card-title" }, "All releases"));
    listCard.append(
      table(
        ["Version", "Channel", ""],
        releases
          .slice()
          .sort((a, b) => b.version - a.version)
          .map((r) => {
            const promote =
              mutable && r.channel === "beta"
                ? actionButton("Promote to stable", async () => {
                    await this.api.promoteRelease(r.version);
                    await this.show("release", true);
                  })
                : "";
            return [`v${r.version}`, channelTag(r.channel), promote];
          }),
      ),
    );
    wrap.append(listCard);
    return wrap;
  }

  // ---- Key directory --------------------------------------------------------

  private async renderKeydir(mutable: boolean): Promise<HTMLElement> {
    const events = await this.api.transparencyLog();
    const wrap = el("div", { class: "hb-ops__stack" });

    const banner = el("div", { class: "hb-ops__immutable", role: "note" });
    banner.innerHTML = `${icon("shield", 16)}<span>Append-only transparency log. Entries are never edited or removed, only added, so a swapped key can't be hidden.</span>`;
    wrap.append(banner);

    const logCard = el("div", { class: "hb-ops__card" });
    logCard.append(el("h2", { class: "hb-ops__card-title" }, "Transparency log"));
    const list = el("ol", { class: "hb-ops__log" });
    for (const e of events) {
      const li = el("li", { class: "hb-ops__log-entry" });
      const g = el("span", { class: `hb-ops__log-op is-${e.op}` });
      g.innerHTML = icon(e.op === "publish" ? "key" : "alert", 14);
      const body = el(
        "div",
        { class: "hb-ops__log-body" },
        el(
          "div",
          { class: "hb-ops__log-line" },
          `${e.op === "publish" ? "Key published" : "Key revoked"} · ${e.key_id}`,
        ),
        el("div", { class: "hb-ops__log-hash" }, `sha256 ${e.pubkey_sha256.slice(0, 16)}…`),
      );
      li.append(el("span", { class: "hb-ops__log-seq" }, `#${e.seq}`), g, body);
      if (mutable && e.op === "publish") {
        li.append(
          actionButton("Revoke", async () => {
            await this.api.revokeKey(e.key_id);
            await this.show("keydir", true);
          }),
        );
      }
      list.append(li);
    }
    logCard.append(list);
    wrap.append(logCard);
    return wrap;
  }

  // ---- Audit log ------------------------------------------------------------

  private async renderAudit(): Promise<HTMLElement> {
    const rows = await this.api.auditLog();
    const wrap = el("div", { class: "hb-ops__stack" });
    const banner = el("div", { class: "hb-ops__immutable", role: "note" });
    banner.innerHTML = `${icon("lock", 16)}<span>Immutable, hash-chained audit log. Every operator action is recorded and cannot be altered after the fact.</span>`;
    wrap.append(banner);
    const card = el("div", { class: "hb-ops__card" });
    card.append(
      table(
        ["#", "When", "Actor", "Action", "Target", "Outcome"],
        rows.map((e) => [
          String(e.seq),
          formatWhen(e.at),
          e.actor,
          e.action,
          e.target,
          outcomeTag(e.outcome),
        ]),
      ),
    );
    wrap.append(card);
    return wrap;
  }

  // ---- Access & roles -------------------------------------------------------

  private async renderAccess(mutable: boolean): Promise<HTMLElement> {
    const operators = await this.api.operators();
    const wrap = el("div", { class: "hb-ops__stack" });

    // WebAuthn-required card.
    const auth = el("div", { class: "hb-ops__card hb-ops__authcard" });
    const authHead = el("div", { class: "hb-ops__authcard-head" });
    authHead.innerHTML = `${icon("shield", 18)}<strong>Hardware sign-in required</strong>`;
    auth.append(
      authHead,
      el(
        "p",
        { class: "hb-ops__muted" },
        "Every operator signs in with a hardware security key (WebAuthn). Passwords alone never grant access to Hearth Suite Ops.",
      ),
    );
    wrap.append(auth);

    // Roles card.
    const rolesCard = el("div", { class: "hb-ops__card" });
    rolesCard.append(el("h2", { class: "hb-ops__card-title" }, "Roles"));
    const roleList = el("ul", { class: "hb-ops__roles" });
    for (const role of Object.keys(ROLE_LABELS) as Role[]) {
      const info = ROLE_LABELS[role];
      const li = el(
        "li",
        { class: "hb-ops__role" },
        el("span", { class: "hb-ops__role-name" }, info.label),
        el("span", { class: "hb-ops__role-summary" }, info.summary),
      );
      if (role === this.session.role) {
        li.append(el("span", { class: `${cls.badge} hb-ops__role-you` }, "You"));
      }
      roleList.append(li);
    }
    rolesCard.append(roleList);
    wrap.append(rolesCard);

    // Operators table, with Invite gated to the policy.
    const opsCard = el("div", { class: "hb-ops__card" });
    const head = el(
      "div",
      { class: "hb-ops__card-head" },
      el("h2", { class: "hb-ops__card-title" }, "Operators"),
    );
    if (mutable && canPerform(this.session.role, "manage_operators")) {
      const invite = el("button", { class: cls.buttonPrimary, type: "button" });
      invite.innerHTML = `${icon("plus", 16)}<span>Invite operator</span>`;
      // Inviting opens the hardware-enrolment ceremony on the server; surfaced
      // as a calm note here rather than a fake form (no enrolment seam yet).
      invite.addEventListener("click", () =>
        this.render(
          "Access & roles",
          inviteNote(() => void this.show("access", mutable)),
        ),
      );
      head.append(invite);
    }
    opsCard.append(
      head,
      table(
        ["Operator", "Role", "Enrolled", "Last active"],
        operators.map((o) => [
          o.operator,
          ROLE_LABELS[o.role]?.label ?? o.role,
          formatDate(o.enrolled_at),
          formatWhen(o.last_active),
        ]),
      ),
    );
    wrap.append(opsCard);
    return wrap;
  }
}

// ---- view helpers -----------------------------------------------------------

const NAV_ICON: Record<ModuleId, Parameters<typeof icon>[0]> = {
  dashboard: "home",
  relay: "connections",
  release: "shield",
  keydir: "key",
  audit: "clock",
  access: "user",
};

function statCard(stat: {
  label: string;
  value: string;
  delta?: string;
  series: number[];
  tone?: "ok" | "warn" | "bad";
}): HTMLElement {
  const card = el("div", { class: "hb-ops__stat" });
  card.append(el("div", { class: "hb-ops__stat-label" }, stat.label));
  const valueRow = el("div", { class: "hb-ops__stat-value" }, stat.value);
  if (stat.delta) {
    valueRow.append(el("span", { class: "hb-ops__stat-delta" }, stat.delta));
  }
  card.append(valueRow, sparkline(stat.series, stat.tone));
  return card;
}

function sparkline(series: number[], tone: "ok" | "warn" | "bad" = "ok"): HTMLElement {
  const d = sparklinePath(series, 100, 28);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg") as unknown as HTMLElement;
  svg.setAttribute("viewBox", "0 0 100 28");
  svg.setAttribute("class", `hb-ops__spark hb-ops__spark--${tone}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  if (d) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    svg.append(path);
  }
  return svg;
}

function quotaMeter(
  label: string,
  used: number,
  max: number,
  fmt: (n: number) => string = String,
): HTMLElement {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const wrap = el("div", { class: "hb-ops__meter" });
  wrap.append(
    el(
      "div",
      { class: "hb-ops__meter-head" },
      el("span", {}, label),
      el("span", { class: "hb-ops__meter-figure" }, `${fmt(used)} / ${fmt(max)} (${pct}%)`),
    ),
  );
  const track = el("div", { class: "hb-ops__meter-track" });
  const fill = el("div", {
    class: `hb-ops__meter-fill ${pct >= 90 ? "is-bad" : pct >= 70 ? "is-warn" : "is-ok"}`,
  });
  fill.setAttribute("style", `inline-size:${pct}%`);
  track.append(fill);
  wrap.append(track);
  return wrap;
}

function inviteNote(onBack: () => void): HTMLElement {
  const wrap = el("div", { class: "hb-ops__stack" });
  const card = el("div", { class: "hb-ops__card" });
  card.append(
    el("h2", { class: "hb-ops__card-title" }, "Invite an operator"),
    el(
      "p",
      { class: "hb-ops__muted" },
      "New operators are enrolled through the hardware-key ceremony on the server, and start with the least-privileged Read-only role. Promote them once their key is registered.",
    ),
  );
  card.append(actionButton("Back to operators", async () => onBack()));
  wrap.append(card);
  return wrap;
}

function stateTag(state: string): HTMLElement {
  return el("span", { class: `hb-ops__tag hb-ops__tag--${state}` }, state);
}
function channelTag(channel: string): HTMLElement {
  return el("span", { class: `hb-ops__tag hb-ops__tag--${channel}` }, channel);
}
function outcomeTag(outcome: string): HTMLElement {
  return el("span", { class: `hb-ops__tag hb-ops__tag--${outcome}` }, outcome);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function formatWhen(at: number): string {
  const ms = at < 1e12 ? at * 1000 : at;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(at);
  }
}
function formatDate(at: number): string {
  const ms = at < 1e12 ? at * 1000 : at;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return String(at);
  }
}

// ---- DOM helpers ------------------------------------------------------------

function table(headers: string[], rows: Array<Array<string | HTMLElement>>): HTMLElement {
  const t = el("table", { class: cls.table });
  const head = el("tr");
  for (const h of headers) {
    head.append(el("th", {}, h));
  }
  t.append(head);
  for (const row of rows) {
    const tr = el("tr");
    for (const cell of row) {
      tr.append(el("td", {}, cell));
    }
    t.append(tr);
  }
  return t;
}

function actionButton(label: string, onClick: () => Promise<void>): HTMLElement {
  const node = el("button", { class: cls.button, type: "button" }, label);
  node.addEventListener("click", () => void onClick());
  return node;
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
