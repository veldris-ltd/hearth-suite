/** The minimal transport the calendar core consumes. */
export interface CalDavTransport {
  get(url: string, headers?: Record<string, string>): Promise<string>;
  put(url: string, body: string, headers?: Record<string, string>): Promise<void>;
}

/** A `fetch`-shaped function (the global, or a native plugin's equivalent). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function basicAuthHeader(user?: string, pass?: string): Record<string, string>;
export function fetchCalDavTransport(fetchImpl: FetchLike): CalDavTransport;
