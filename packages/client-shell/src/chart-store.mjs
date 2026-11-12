// Persist a Sheets->Writer chart live-link across reloads and Bundles (P2-CL2,
// seam #5). A chart-source entry is stored as a "chart" vault document whose
// body is `{ key, data }` (key = bundle::sheet::range). The host writes one when
// Sheets publishes chart data, and hydrates the in-session bridge from these
// documents on workspace mount, so a live-linked chart re-resolves after a
// reload and when opened from a different Bundle, instead of relying on an
// in-memory map. This module is the pure (de)serialisation, unit-tested; the
// host wraps it with base64 and the vault document API.

/**
 * Serialise a chart-source entry for a "chart" document body.
 * @param {string} key
 * @param {unknown} data
 * @returns {string}
 */
export function serializeChartEntry(key, data) {
  return JSON.stringify({ key, data });
}

/**
 * Parse a "chart" document body into `{ key, data }`, or null if malformed.
 * @param {string} json
 * @returns {{ key: string, data: unknown } | null}
 */
export function parseChartEntry(json) {
  try {
    const obj = JSON.parse(String(json));
    if (obj && typeof obj.key === "string" && obj.data !== undefined && obj.data !== null) {
      return { key: obj.key, data: obj.data };
    }
  } catch {
    return null;
  }
  return null;
}
