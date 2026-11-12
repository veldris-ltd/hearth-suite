// Hearth Suite Calendar & Contacts core tests (AC-CAL-1..4).

import test from "node:test";
import assert from "node:assert/strict";

import {
  toIcs,
  parseIcs,
  toVcard,
  parseVcard,
  dueReminders,
  toSearchItems,
  mapExternalEvent,
  mergeImported,
  resolveConflict,
  visibleEvents,
  oauthSource,
  urlSource,
  subscribe,
  publish,
  monthGrid,
  weekDays,
  addMonths,
  expandRecurrence,
  eventsForDay,
  eventCategories,
  sortTodos,
  dateKey,
  parseSchedulingPhrase,
} from "../src/core.mjs";

test("AC-CAL-1: events persist via iCalendar round-trip and reminders fire", () => {
  const events = [
    {
      uid: "e1",
      summary: "Project review, take 2",
      start: "2026-06-15T09:00:00Z",
      end: "2026-06-15T10:00:00Z",
      reminderMinutes: 15,
    },
  ];
  const parsed = parseIcs(toIcs(events));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].uid, "e1");
  assert.equal(parsed[0].summary, "Project review, take 2");
  assert.equal(parsed[0].start, "2026-06-15T09:00:00Z");
  assert.equal(parsed[0].reminderMinutes, 15);

  // Reminder fires 15 minutes before the start, not before or after.
  assert.equal(dueReminders(events, "2026-06-15T08:50:00Z").length, 1);
  assert.equal(dueReminders(events, "2026-06-15T08:40:00Z").length, 0);
  assert.equal(dueReminders(events, "2026-06-15T09:05:00Z").length, 0);
});

test("AC-CAL-1: contacts round-trip via vCard", () => {
  const contacts = [
    { uid: "c1", name: "Maria Lopez", email: "maria@example.com", phone: "+1 555 0100" },
  ];
  const parsed = parseVcard(toVcard(contacts));
  assert.deepEqual(parsed, contacts);
});

test("AC-CAL-2: CalDAV subscribe and publish both directions", async () => {
  const store = { body: "" };
  const transport = {
    get: async () => toIcs([{ uid: "s1", summary: "Subscribed", start: "2026-07-01T12:00:00Z" }]),
    put: async (_url, body) => {
      store.body = body;
    },
  };

  const subscribed = await subscribe(transport, "https://dav.example/cal");
  assert.equal(subscribed[0].summary, "Subscribed");

  await publish(transport, "https://dav.example/cal", [
    { uid: "p1", summary: "Published", start: "2026-07-02T12:00:00Z" },
  ]);
  assert.ok(store.body.includes("SUMMARY:Published"));
  assert.equal(parseIcs(store.body)[0].uid, "p1");
});

test("AC-CAL-3: external providers map correctly and sources toggle independently", () => {
  const google = mapExternalEvent(
    "google",
    { id: "g1", summary: "Standup", start: { dateTime: "2026-06-20T09:00:00Z" } },
    "src-google",
  );
  assert.equal(google.uid, "g1");
  assert.equal(google.summary, "Standup");
  assert.equal(google.source, "src-google");

  const outlook = mapExternalEvent(
    "outlook",
    { id: "o1", subject: "1:1", start: { dateTime: "2026-06-21T09:00:00Z" } },
    "src-outlook",
  );
  assert.equal(outlook.summary, "1:1");

  // Per-source on/off.
  const sources = [
    {
      id: "src-google",
      name: "Google",
      auth: { type: "oauth", provider: "google", accessToken: "t" },
      enabled: true,
      mode: "import",
    },
    {
      id: "src-outlook",
      name: "Outlook",
      auth: { type: "oauth", provider: "outlook", accessToken: "t" },
      enabled: false,
      mode: "import",
    },
  ];
  const native = { uid: "n1", summary: "Native", start: "2026-06-22T09:00:00Z" };
  const visible = visibleEvents([native, google, outlook], sources);
  assert.deepEqual(visible.map((e) => e.uid).sort(), ["g1", "n1"]);
});

test("AC-CAL-4: two-way conflict handling is deterministic; one-way loses no data", () => {
  const local = {
    uid: "x",
    summary: "local",
    start: "2026-06-01T00:00:00Z",
    lastModified: "2026-06-02T00:00:00Z",
  };
  const remote = {
    uid: "x",
    summary: "remote",
    start: "2026-06-01T00:00:00Z",
    lastModified: "2026-06-03T00:00:00Z",
  };
  assert.equal(resolveConflict(local, remote).summary, "remote"); // remote newer
  assert.equal(
    resolveConflict(remote, { ...local, lastModified: "2026-06-04T00:00:00Z" }).summary,
    "local",
  );
  // Tie -> remote (server authoritative), always the same answer.
  const tie = resolveConflict({ ...local, lastModified: "t" }, { ...remote, lastModified: "t" });
  assert.equal(tie.summary, "remote");

  // One-way import: native A kept, imported B updated, C added, no loss.
  const localEvents = [
    { uid: "A", summary: "native", start: "2026-06-01T00:00:00Z" },
    { uid: "B", summary: "old", start: "2026-06-02T00:00:00Z", source: "ics" },
  ];
  const imported = [
    { uid: "B", summary: "new", start: "2026-06-02T00:00:00Z", source: "ics" },
    { uid: "C", summary: "added", start: "2026-06-03T00:00:00Z", source: "ics" },
  ];
  const merged = mergeImported(localEvents, imported);
  assert.deepEqual(merged.map((e) => e.uid).sort(), ["A", "B", "C"]);
  assert.equal(merged.find((e) => e.uid === "B").summary, "new");
});

test("auth never stores a provider password; Mantel search is fed", () => {
  const src = oauthSource("s1", "Google", "google", "ya29.token");
  const serialized = JSON.stringify(src);
  assert.ok(!serialized.toLowerCase().includes("password"));
  assert.equal(src.auth.type, "oauth");
  assert.equal(urlSource("s2", "ICS", "https://x/cal.ics").auth.type, "url");

  const items = toSearchItems(
    [{ uid: "e1", summary: "Review", start: "2026-06-15T09:00:00Z" }],
    [{ uid: "c1", name: "Maria" }],
  );
  assert.deepEqual(
    items.map((i) => i.kind),
    ["calendar", "record"],
  );
});

// ---- PW-2.8: views, recurrence, todos, ICS extensions (C1/C3/C7/C10) ------

test("C1: month grid and week helpers", () => {
  const weeks = monthGrid(2026, 6); // June 2026
  assert.equal(weeks[0][0], "2026-05-31"); // Sunday before the 1st
  assert.ok(weeks.flat().includes("2026-06-15"));
  assert.equal(weeks[0].length, 7);
  assert.deepEqual(weekDays("2026-06-15")[0], "2026-06-14"); // week starts Sunday
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); // day clamps to month end
});

test("C3: recurrence expands daily/weekly/monthly/yearly within a range", () => {
  const weekly = {
    uid: "w1",
    summary: "Standup",
    start: "2026-06-01T09:00:00Z",
    end: "2026-06-01T09:15:00Z",
    recurrence: { freq: "weekly" },
  };
  const inJune = expandRecurrence(weekly, "2026-06-01", "2026-06-30");
  assert.deepEqual(
    inJune.map((e) => dateKey(e.start)),
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"],
  );
  // Occurrence keeps its time and gets a distinct instance uid.
  assert.equal(inJune[1].uid, "w1#2026-06-08");
  assert.equal(inJune[1].start, "2026-06-08T09:00:00Z");

  // Yearly birthday shows in any later year.
  const bday = {
    uid: "b1",
    summary: "Maria",
    start: "2026-03-10",
    allDay: true,
    recurrence: { freq: "yearly" },
  };
  assert.deepEqual(
    expandRecurrence(bday, "2030-01-01", "2030-12-31").map((e) => e.start),
    ["2030-03-10"],
  );

  // Count / interval bound the series.
  const limited = {
    uid: "l1",
    summary: "x",
    start: "2026-06-01",
    allDay: true,
    recurrence: { freq: "daily", interval: 2, count: 3 },
  };
  assert.deepEqual(
    expandRecurrence(limited, "2026-06-01", "2026-12-31").map((e) => e.start),
    ["2026-06-01", "2026-06-03", "2026-06-05"],
  );
});

test("C2: monthly recurrence on the 31st clamps but does not drift", () => {
  // "Pay rent on the 31st": Feb clamps to 28, but March RECOVERS to the 31st —
  // the day must not stick at 28 for the rest of the year (anchored to start).
  const rent = {
    uid: "r1",
    summary: "Rent",
    start: "2026-01-31",
    allDay: true,
    recurrence: { freq: "monthly" },
  };
  assert.deepEqual(
    expandRecurrence(rent, "2026-01-01", "2026-06-30").map((e) => e.start),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"],
  );
  // Yearly on Feb 29 (leap day): non-leap years clamp to Feb 28, the next leap
  // year recovers Feb 29 — proving yearly anchors to the start too.
  const leap = {
    uid: "f1",
    summary: "Leapling",
    start: "2024-02-29",
    allDay: true,
    recurrence: { freq: "yearly" },
  };
  assert.deepEqual(
    expandRecurrence(leap, "2024-01-01", "2028-12-31").map((e) => e.start),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
});

test("C2: eventsForDay collects occurrences; categories are distinct", () => {
  const events = [
    {
      uid: "a",
      summary: "A",
      start: "2026-06-15T10:00:00Z",
      category: "Work",
      recurrence: { freq: "daily" },
    },
    { uid: "b", summary: "B", start: "2026-06-15", allDay: true, category: "Personal" },
    { uid: "c", summary: "C", start: "2026-06-16T10:00:00Z", category: "Work" },
  ];
  assert.equal(eventsForDay(events, "2026-06-15").length, 2);
  assert.deepEqual(eventCategories(events), ["Personal", "Work"]);
});

test("C7: to-dos sort undone-first, then by due date, then title", () => {
  const sorted = sortTodos([
    { id: "1", title: "done thing", done: true, due: "2026-06-01" },
    { id: "2", title: "later", done: false, due: "2026-06-10" },
    { id: "3", title: "soon", done: false, due: "2026-06-05" },
    { id: "4", title: "no due", done: false },
  ]);
  assert.deepEqual(
    sorted.map((t) => t.id),
    ["3", "2", "4", "1"],
  );
});

test("C10: ICS round-trips all-day, category, calendar, and recurrence", () => {
  const events = [
    {
      uid: "h1",
      summary: "Holiday",
      start: "2026-12-25",
      allDay: true,
      category: "Personal",
      calendarId: "home",
      recurrence: { freq: "yearly", interval: 1 },
    },
  ];
  const back = parseIcs(toIcs(events))[0];
  assert.equal(back.start, "2026-12-25");
  assert.equal(back.allDay, true);
  assert.equal(back.category, "Personal");
  assert.equal(back.calendarId, "home");
  assert.deepEqual(back.recurrence, { freq: "yearly" });
});

// DSG-S8: natural-language scheduling parses to a confirmable proposed event.
const NOW = "2026-06-09T09:00:00Z"; // a Tuesday

test("S8: 'next Tuesday at noon' proposes a timed event a week out", () => {
  const p = parseSchedulingPhrase("lunch with Sam next Tuesday at noon", NOW);
  assert.ok(p, "should parse");
  assert.equal(p.summary, "Lunch with Sam");
  assert.equal(p.start, "2026-06-16T12:00:00Z");
  assert.equal(p.end, "2026-06-16T13:00:00Z"); // defaults to 1 hour
  assert.equal(p.allDay, undefined);
});

test("S8: tomorrow / today / bare weekday resolve relative to nowIso", () => {
  assert.equal(parseSchedulingPhrase("call Bob friday at 9am", NOW).start, "2026-06-12T09:00:00Z");
  assert.equal(parseSchedulingPhrase("call Bob friday at 9am", NOW).summary, "Call Bob");
  assert.equal(parseSchedulingPhrase("today at 3pm standup", NOW).start, "2026-06-09T15:00:00Z");
  assert.equal(
    parseSchedulingPhrase("this wednesday at 15:30 review", NOW).start,
    "2026-06-10T15:30:00Z",
  );
});

test("S8: a date with no time proposes an all-day event", () => {
  const p = parseSchedulingPhrase("dentist tomorrow", NOW);
  assert.equal(p.start, "2026-06-10");
  assert.equal(p.allDay, true);
  assert.equal(p.end, undefined);
  assert.equal(p.summary, "Dentist");
});

test("S8: questions and availability look-ups are NOT scheduling (return null)", () => {
  assert.equal(parseSchedulingPhrase("what's on next week?", NOW), null);
  assert.equal(parseSchedulingPhrase("find an hour with Maria next week", NOW), null);
  assert.equal(parseSchedulingPhrase("which mornings are free this week?", NOW), null);
  assert.equal(parseSchedulingPhrase("just some text with no date", NOW), null);
});

test("S8: 'schedule'/'add' verbs and articles are stripped from the title", () => {
  assert.equal(
    parseSchedulingPhrase("schedule a meeting with Bob tomorrow at 2pm", NOW).summary,
    "Meeting with Bob",
  );
  assert.equal(parseSchedulingPhrase("add gym today at 6am", NOW).summary, "Gym");
});
