/**
 * Pure Admin Control Panel client logic, no DOM, no network, unit-tested.
 *
 * Mirrors the server-side policy in `crates/admin-core` so the UI can hide what
 * an operator may not do, drives the WebAuthn sign-in ceremony (AC-ADMIN-3), and
 * provides a defensive content-redaction guard (AC-ADMIN-4). The server remains
 * the source of truth and re-checks every action; this is convenience + defense
 * in depth.
 */

// ---- WebAuthn sign-in ceremony (AC-ADMIN-3) ---------------------------------

/** States of the admin authentication ceremony. */
export const AUTH_STATES = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
  CHALLENGED: "challenged",
  AUTHENTICATED: "authenticated",
  FAILED: "failed",
});

/**
 * Authentication state machine. The only path into `authenticated` is a
 * successful WebAuthn assertion (`assert_success`) after a server challenge.
 *
 * @param {string} state
 * @param {string} event - "begin" | "assert_success" | "assert_failure" | "logout"
 * @returns {string}
 */
export function nextAuthState(state, event) {
  switch (state) {
    case AUTH_STATES.UNAUTHENTICATED:
    case AUTH_STATES.FAILED:
      return event === "begin" ? AUTH_STATES.CHALLENGED : state;
    case AUTH_STATES.CHALLENGED:
      if (event === "assert_success") return AUTH_STATES.AUTHENTICATED;
      if (event === "assert_failure") return AUTH_STATES.FAILED;
      return state;
    case AUTH_STATES.AUTHENTICATED:
      return event === "logout" ? AUTH_STATES.UNAUTHENTICATED : state;
    default:
      return state;
  }
}

// ---- RBAC mirror (AC-ADMIN-1, 6) --------------------------------------------

/** Read-only actions available to every authenticated operator. */
const READ_ACTIONS = ["view_observability", "view_audit_log", "view_transparency_log"];

/** Role → permitted actions (mirrors crates/admin-core::rbac). */
const POLICY = Object.freeze({
  read_only: READ_ACTIONS,
  relay_operator: [...READ_ACTIONS, "manage_relay_quota", "manage_blob_lifecycle"],
  release_manager: [...READ_ACTIONS, "sign_release", "publish_release", "promote_channel"],
  key_officer: [...READ_ACTIONS, "publish_key", "revoke_key"],
  owner: ["*"],
});

/** The least-privileged role a new operator receives (AC-ADMIN-6). */
export const DEFAULT_ROLE = "read_only";

/** The Hearth Suite Ops console nav, in v1.0 order, with the mutating actions each
 *  exposes. The Dashboard folds in the service-health overview; Access & roles
 *  is owner-only to mutate (gated by the implicit owner "*"). */
export const MODULES = Object.freeze([
  { id: "dashboard", label: "Dashboard", actions: [] },
  { id: "relay", label: "Sync relay", actions: ["manage_relay_quota", "manage_blob_lifecycle"] },
  {
    id: "release",
    label: "Releases",
    actions: ["sign_release", "publish_release", "promote_channel"],
  },
  { id: "keydir", label: "Key directory", actions: ["publish_key", "revoke_key"] },
  { id: "audit", label: "Audit log", actions: [] },
  { id: "access", label: "Access & roles", actions: ["manage_operators"] },
]);

/** Plain-language role names and one-line summaries for the Access & roles view.
 *  Presentational only; the authoritative policy is {@link POLICY}/{@link canPerform}. */
export const ROLE_LABELS = Object.freeze({
  owner: { label: "Owner", summary: "Full control, including access and roles." },
  relay_operator: {
    label: "Relay operator",
    summary: "Manage the sync relay: quotas and blob lifecycle.",
  },
  release_manager: { label: "Release manager", summary: "Sign, publish and promote releases." },
  key_officer: { label: "Key officer", summary: "Publish and revoke directory keys." },
  read_only: {
    label: "Read-only",
    summary: "View dashboards, the audit log and the transparency log.",
  },
});

/**
 * Whether a role may perform an action (mirror of the server policy).
 * @param {string} role
 * @param {string} action
 * @returns {boolean}
 */
export function canPerform(role, action) {
  if (role === "owner") return true;
  const allowed = POLICY[role];
  return Array.isArray(allowed) && allowed.includes(action);
}

/**
 * The modules visible to a role, each flagged with whether the role may mutate.
 * Every authenticated operator can view every module; mutation is role-gated.
 * @param {string} role
 * @returns {Array<{ id: string, label: string, mutable: boolean }>}
 */
export function visibleModules(role) {
  return MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    mutable: m.actions.some((a) => canPerform(role, a)) || role === "owner",
  }));
}

// ---- sparkline geometry (Dashboard, DSG-A1) --------------------------------

/**
 * Build an SVG polyline `d` from a numeric series, normalised to fill a box.
 * Pure geometry, no DOM. Empty series → "" (caller hides the sparkline); a
 * single point draws a flat mid-line. Never fabricates data, it only plots what
 * it is given.
 *
 * @param {number[]} values
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function sparklinePath(values, width = 100, height = 28) {
  const v = (values ?? []).filter((n) => typeof n === "number" && Number.isFinite(n));
  if (v.length === 0) return "";
  if (v.length === 1) {
    const y = (height / 2).toFixed(2);
    return `M 0,${y} L ${width},${y}`;
  }
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const step = width / (v.length - 1);
  return v
    .map((n, i) => {
      const x = (i * step).toFixed(2);
      const y = (height - ((n - min) / span) * height).toFixed(2);
      return `${i === 0 ? "M" : "L"} ${x},${y}`;
    })
    .join(" ");
}

// ---- content-redaction guard (AC-ADMIN-4) -----------------------------------

/** Field-name substrings that must never appear in a panel view model. */
export const FORBIDDEN_CONTENT_KEYS = Object.freeze([
  "content",
  "plaintext",
  "cleartext",
  "document",
  "body",
  "message",
  "attachment",
  "filename",
  "subject",
  "note",
  "text",
  "payload",
]);

/**
 * Throw if `value` (a view model from the API) contains any field whose name
 * hints at user content, defense in depth against a server bug ever shipping
 * document content to the panel.
 *
 * @param {unknown} value
 * @returns {void}
 */
export function assertNoUserContent(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoUserContent(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      const bad = FORBIDDEN_CONTENT_KEYS.find((needle) => lower.includes(needle));
      if (bad) {
        throw new Error(`refusing to display field that may carry user content: ${bad}`);
      }
      assertNoUserContent(child);
    }
  }
}
