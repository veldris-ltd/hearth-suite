/** Types for the pure desktop-host helpers in `core.mjs`. */

/** Build the JSON request string the core's `call_json` entry point expects. */
export function buildRequest(method: string, params: unknown): string;

/** Unwrap the `{ ok } / { error }` envelope, returning `ok` or throwing `error`. */
export function unwrapEnvelope(response: unknown): unknown;

/** Parse a raw response string and unwrap its envelope. */
export function parseResponse(raw: string): unknown;
