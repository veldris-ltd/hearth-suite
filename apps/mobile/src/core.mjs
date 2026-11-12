/**
 * Pure mobile-client logic, no DOM, no Capacitor, unit-tested under
 * `node:test`. This is the substance of the mobile acceptance criteria that can
 * be verified without a device: model-tier selection under memory constraints
 * (AC-MOB-2), the Wi-Fi + consent download gate (AC-MOB-2), the biometric-unlock
 * state machine (AC-MOB-3), and the offline-parity capability set (AC-MOB-1).
 */

// ---- transport envelope (shared shape with the desktop client) --------------

/**
 * Build the JSON request string the core's `call_json` entry point expects.
 * @param {string} method
 * @param {unknown} params
 * @returns {string}
 */
export function buildRequest(method, params) {
  return JSON.stringify({ method, params: params ?? {} });
}

/**
 * Unwrap the `{ ok } / { error }` envelope: return `ok`, or throw `error`.
 * @param {unknown} response
 * @returns {unknown}
 */
export function unwrapEnvelope(response) {
  if (response !== null && typeof response === "object") {
    if ("ok" in response) {
      return /** @type {{ ok: unknown }} */ (response).ok;
    }
    if ("error" in response) {
      throw new Error(String(/** @type {{ error: unknown }} */ (response).error));
    }
  }
  throw new Error("malformed core response");
}

/**
 * Parse a raw response string and unwrap its envelope.
 * @param {string} raw
 * @returns {unknown}
 */
export function parseResponse(raw) {
  return unwrapEnvelope(JSON.parse(raw));
}

// ---- Ember model tier (AC-MOB-2) --------------------------------------------

/**
 * Choose which on-device Ember tier to run.
 *
 * The default is always the smallest viable (mobile-default) tier, so a fresh
 * install stays within memory constraints. A heavier tier is used only when the
 * user has opted in (`allowHeavy`) AND the device actually has the RAM for it.
 *
 * @param {ReadonlyArray<{ id: string, min_ram_mb: number, mobile_default: boolean }>} tiers
 * @param {{ ramMb?: number, allowHeavy?: boolean }} [options]
 * @returns {string | undefined} the chosen tier id, or undefined if no tiers.
 */
export function chooseTier(tiers, options = {}) {
  const { ramMb = 0, allowHeavy = false } = options;
  const fallback = tiers.find((t) => t.mobile_default) ?? tiers[0];
  if (!allowHeavy) {
    return fallback?.id;
  }
  const affordable = tiers.filter((t) => t.min_ram_mb <= ramMb);
  if (affordable.length === 0) {
    return fallback?.id;
  }
  const best = affordable.reduce((a, b) => (b.min_ram_mb > a.min_ram_mb ? b : a));
  return best.id;
}

/**
 * Whether model weights may be downloaded now: only on Wi-Fi, and only with the
 * user's explicit consent (never on metered/cellular, never silently).
 *
 * @param {{ network?: string, consented?: boolean }} status
 * @returns {boolean}
 */
export function canDownloadWeights(status) {
  return status.network === "wifi" && status.consented === true;
}

// ---- biometric unlock (AC-MOB-3) --------------------------------------------

/** The states of the identity-vault unlock gate. */
export const UNLOCK_STATES = Object.freeze({
  LOCKED: "locked",
  UNLOCKING: "unlocking",
  UNLOCKED: "unlocked",
  ERROR: "error",
});

/**
 * The unlock-gate transition function. The private key is reachable only in the
 * `unlocked` state, which is only ever entered via a `success` event from a
 * biometric prompt.
 *
 * @param {string} state
 * @param {string} event - "request" | "success" | "failure" | "lock"
 * @returns {string} the next state
 */
export function nextUnlockState(state, event) {
  switch (state) {
    case UNLOCK_STATES.LOCKED:
    case UNLOCK_STATES.ERROR:
      return event === "request" ? UNLOCK_STATES.UNLOCKING : state;
    case UNLOCK_STATES.UNLOCKING:
      if (event === "success") return UNLOCK_STATES.UNLOCKED;
      if (event === "failure") return UNLOCK_STATES.ERROR;
      return state;
    case UNLOCK_STATES.UNLOCKED:
      return event === "lock" ? UNLOCK_STATES.LOCKED : state;
    default:
      return state;
  }
}

// ---- offline parity (AC-MOB-1) ----------------------------------------------

/**
 * Every core operation the mobile client uses works fully offline, there is no
 * network-only method in the surface, so editing and Seal reach desktop parity
 * without connectivity. (Opt-in sync, when enabled, layers on top.)
 */
export const OFFLINE_METHODS = Object.freeze([
  "create_bundle",
  "list_bundles",
  "list_tables",
  "save_document",
  "open_document",
  "identity_public",
  "seal",
  "unseal",
  "verify",
  "run_ember",
  "ember_tiers",
  "create_table",
  "add_field",
  "insert_row",
  "query_rows",
  "set_sync_enabled",
  "sync_status",
]);

/**
 * Whether a core method is usable offline.
 * @param {string} method
 * @returns {boolean}
 */
export function isOfflineCapable(method) {
  return OFFLINE_METHODS.includes(method);
}
