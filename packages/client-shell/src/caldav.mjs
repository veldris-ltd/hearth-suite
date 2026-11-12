/**
 * CalDAV / ICS transports for the Calendar's "Subscriptions" (AC-CAL-3/4).
 *
 * The calendar core speaks to an injected `CalDavTransport` ({ get, put }); this
 * module builds one over a `fetch`-compatible function. The default uses the
 * platform `fetch`, which is subject to CORS — fine for same-origin/permissive
 * ICS feeds. The desktop and mobile entries pass a *native* fetch (Tauri/Capacitor
 * HTTP plugins) so cross-origin CalDAV servers work off the web sandbox.
 *
 * Per-source HTTP Basic credentials are passed as request headers by the
 * Calendar (see `basicAuthHeader`), so one shared transport serves many feeds.
 */

/* global btoa */

/** An `Authorization: Basic` header for HTTP Basic auth, or `{}` when no user. */
export function basicAuthHeader(user, pass) {
  if (!user) {
    return {};
  }
  // `btoa` is a global in browsers and Node ≥16 (where the tests run).
  return { Authorization: `Basic ${btoa(`${user}:${pass ?? ""}`)}` };
}

/**
 * A CalDAV/ICS transport over a `fetch`-like function. GET returns the calendar
 * body; PUT writes it back as `text/calendar`. Non-2xx responses throw.
 */
export function fetchCalDavTransport(fetchImpl) {
  return {
    async get(url, headers) {
      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`Subscribe failed: ${response.status} for ${url}`);
      }
      return response.text();
    },
    async put(url, body, headers) {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { "Content-Type": "text/calendar; charset=utf-8", ...headers },
        body,
      });
      if (!response.ok) {
        throw new Error(`Publish failed: ${response.status} for ${url}`);
      }
    },
  };
}
