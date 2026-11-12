// CalDAV/ICS transport tests (AC-CAL-3/4): the fetch-backed transport and its
// interplay with the calendar core's subscribe/publish, plus HTTP Basic auth.
// A mock fetch stands in for the network (and for the native plugin fetch).

import test from "node:test";
import assert from "node:assert/strict";

import { fetchCalDavTransport, basicAuthHeader } from "../src/caldav.mjs";
import { subscribe, publish, toIcs } from "../../../apps/calendar/src/core.mjs";

const SAMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:evt-1",
  "SUMMARY:Team sync",
  "DTSTART:20260701T090000Z",
  "DTEND:20260701T093000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A fetch double that records calls and replays a scripted response. */
function mockFetch({ status = 200, body = "" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetchImpl, calls };
}

test("basicAuthHeader encodes credentials, and omits when no user", () => {
  assert.deepEqual(basicAuthHeader("alice", "s3cret"), {
    Authorization: `Basic ${Buffer.from("alice:s3cret").toString("base64")}`,
  });
  assert.deepEqual(basicAuthHeader(), {});
  assert.deepEqual(basicAuthHeader("bob"), {
    Authorization: `Basic ${Buffer.from("bob:").toString("base64")}`,
  });
});

test("subscribe fetches and parses ICS via the transport, forwarding auth headers", async () => {
  const { fetchImpl, calls } = mockFetch({ body: SAMPLE_ICS });
  const transport = fetchCalDavTransport(fetchImpl);
  const headers = basicAuthHeader("alice", "pw");
  const events = await subscribe(transport, "https://dav.example.com/cal.ics", headers);

  assert.equal(events.length, 1);
  assert.equal(events[0].summary, "Team sync");
  assert.equal(calls[0].url, "https://dav.example.com/cal.ics");
  assert.equal(calls[0].init.headers.Authorization, headers.Authorization);
});

test("publish serialises events and PUTs them as text/calendar", async () => {
  const { fetchImpl, calls } = mockFetch({ status: 201 });
  const transport = fetchCalDavTransport(fetchImpl);
  const events = [
    {
      id: "x",
      uid: "x",
      summary: "Lunch",
      start: "2026-07-02T12:00:00Z",
      end: "2026-07-02T13:00:00Z",
    },
  ];
  await publish(transport, "https://dav.example.com/cal.ics", events);

  assert.equal(calls[0].init.method, "PUT");
  assert.match(calls[0].init.headers["Content-Type"], /text\/calendar/);
  // The body is the same ICS the core would serialise.
  assert.equal(calls[0].init.body, toIcs(events));
  assert.match(calls[0].init.body, /SUMMARY:Lunch/);
});

test("a non-2xx response surfaces as a thrown error (so the UI can report it)", async () => {
  const { fetchImpl } = mockFetch({ status: 403 });
  const transport = fetchCalDavTransport(fetchImpl);
  await assert.rejects(
    () => subscribe(transport, "https://dav.example.com/cal.ics"),
    /Subscribe failed: 403/,
  );
});
