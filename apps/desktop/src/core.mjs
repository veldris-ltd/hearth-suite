/**
 * Pure host helpers for the desktop client, no DOM and no Tauri imports, so
 * they unit-test under `node:test` like every other module's `core.mjs`.
 *
 * These cover the seam between the typed `HearthClient` and the native core: the
 * request the transport sends, and the `{ ok } / { error }` envelope it gets back
 * (the same envelope produced by `hearth_ffi::call_json`).
 */

/**
 * Build the JSON request string the core's `call_json` entry point expects.
 *
 * @param {string} method
 * @param {unknown} params
 * @returns {string}
 */
export function buildRequest(method, params) {
  return JSON.stringify({ method, params: params ?? {} });
}

/**
 * Unwrap the core's response envelope: return the `ok` payload, or throw with
 * the `error` message. A malformed envelope is itself an error.
 *
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
 * Parse a raw response string and unwrap its envelope in one step.
 *
 * @param {string} raw
 * @returns {unknown}
 */
export function parseResponse(raw) {
  return unwrapEnvelope(JSON.parse(raw));
}
