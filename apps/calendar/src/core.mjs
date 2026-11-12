// Hearth Suite Calendar & Contacts core: iCalendar (VEVENT) and vCard (VCARD)
// read/write, reminders, the Pro import extension (provider mapping, per-source
// toggle, one-way merge, two-way conflict handling), and CalDAV/CardDAV
// subscribe + publish over an injected transport. No DOM, no real network, all
// unit-tested. Persistence (encrypted at rest) is the `store` crate via FFI.

// ---- iCalendar (RFC 5545 subset) -------------------------------------------

function icsDate(iso) {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsDateOnly(iso) {
  return String(iso).slice(0, 10).replace(/-/g, "");
}

function parseIcsDate(value) {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(v);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  }
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d) {
    return `${d[1]}-${d[2]}-${d[3]}`;
  }
  return value;
}

/** Serialise events to an iCalendar document (for publish/export). */
export function toIcs(events) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Veldris Ltd//Hearth Suite//EN"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `SUMMARY:${escapeText(event.summary)}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(event.start)}`);
      if (event.end) {
        lines.push(`DTEND;VALUE=DATE:${icsDateOnly(event.end)}`);
      }
    } else {
      lines.push(`DTSTART:${icsDate(event.start)}`);
      if (event.end) {
        lines.push(`DTEND:${icsDate(event.end)}`);
      }
    }
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.category) {
      lines.push(`CATEGORIES:${escapeText(event.category)}`);
    }
    if (event.calendarId) {
      lines.push(`X-HEARTH-CALENDAR:${escapeText(event.calendarId)}`);
    }
    if (event.recurrence && event.recurrence.freq) {
      lines.push(`RRULE:${recurrenceToRrule(event.recurrence)}`);
    }
    if (event.lastModified) {
      lines.push(`LAST-MODIFIED:${icsDate(event.lastModified)}`);
    }
    if (typeof event.reminderMinutes === "number") {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `TRIGGER:-PT${event.reminderMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Parse an iCalendar document into events (for subscribe/import). */
export function parseIcs(text) {
  const events = [];
  let current = null;
  let inAlarm = false;
  for (const line of unfold(text)) {
    const [rawKey, ...rest] = line.split(":");
    const parts = rawKey.split(";");
    const key = parts[0].toUpperCase();
    const params = parts.slice(1);
    const value = rest.join(":");
    if (key === "BEGIN" && value === "VEVENT") {
      current = { uid: "", summary: "", start: "" };
    } else if (key === "END" && value === "VEVENT") {
      if (current) {
        events.push(current);
      }
      current = null;
    } else if (key === "BEGIN" && value === "VALARM") {
      inAlarm = true;
    } else if (key === "END" && value === "VALARM") {
      inAlarm = false;
    } else if (current) {
      applyProperty(current, key, value, inAlarm, params);
    }
  }
  return events;
}

function applyProperty(event, key, value, inAlarm, params = []) {
  if (inAlarm && key === "TRIGGER") {
    const m = /-PT(\d+)M/.exec(value);
    if (m) {
      event.reminderMinutes = Number(m[1]);
    }
    return;
  }
  const isDateOnly = params.some((p) => p.toUpperCase() === "VALUE=DATE");
  switch (key) {
    case "UID":
      event.uid = value;
      break;
    case "SUMMARY":
      event.summary = unescapeText(value);
      break;
    case "DESCRIPTION":
      event.description = unescapeText(value);
      break;
    case "CATEGORIES":
      event.category = unescapeText(value);
      break;
    case "X-HEARTH-CALENDAR":
      event.calendarId = unescapeText(value);
      break;
    case "RRULE": {
      const rec = parseRrule(value);
      if (rec) event.recurrence = rec;
      break;
    }
    case "DTSTART":
      event.start = parseIcsDate(value);
      if (isDateOnly) event.allDay = true;
      break;
    case "DTEND":
      event.end = parseIcsDate(value);
      break;
    case "LAST-MODIFIED":
      event.lastModified = parseIcsDate(value);
      break;
    default:
      break;
  }
}

// ---- vCard (RFC 6350 subset) -----------------------------------------------

/** Serialise contacts to vCard. */
export function toVcard(contacts) {
  const lines = [];
  for (const contact of contacts) {
    lines.push(
      "BEGIN:VCARD",
      "VERSION:4.0",
      `UID:${contact.uid}`,
      `FN:${escapeText(contact.name)}`,
    );
    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }
    if (contact.phone) {
      lines.push(`TEL:${contact.phone}`);
    }
    lines.push("END:VCARD");
  }
  return lines.join("\r\n");
}

/** Parse vCard text into contacts. */
export function parseVcard(text) {
  const contacts = [];
  let current = null;
  for (const line of unfold(text)) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.split(";")[0].toUpperCase();
    const value = rest.join(":");
    if (key === "BEGIN" && value === "VCARD") {
      current = { uid: "", name: "" };
    } else if (key === "END" && value === "VCARD") {
      if (current) {
        contacts.push(current);
      }
      current = null;
    } else if (current) {
      if (key === "UID") current.uid = value;
      else if (key === "FN") current.name = unescapeText(value);
      else if (key === "EMAIL") current.email = value;
      else if (key === "TEL") current.phone = value;
    }
  }
  return contacts;
}

// ---- reminders (AC-CAL-1) --------------------------------------------------

/** Events whose reminder time has arrived but which haven't started yet. */
export function dueReminders(events, nowIso) {
  const now = Date.parse(nowIso);
  return events.filter((event) => {
    if (typeof event.reminderMinutes !== "number") {
      return false;
    }
    const start = Date.parse(event.start);
    const remindAt = start - event.reminderMinutes * 60_000;
    return remindAt <= now && now < start;
  });
}

// ---- Mantel search integration ---------------------------------------------

/** Map events and contacts into Mantel search items. */
export function toSearchItems(events, contacts) {
  const eventItems = events.map((event) => ({
    id: event.uid,
    kind: "calendar",
    title: event.summary,
    module: "calendar",
  }));
  const contactItems = contacts.map((contact) => ({
    id: contact.uid,
    kind: "record",
    title: contact.name,
    module: "records",
  }));
  return [...eventItems, ...contactItems];
}

// ---- Pro: import extension --------------------------------------------------

/** Map a provider's native event shape to a Hearth Suite event. */
export function mapExternalEvent(provider, raw, sourceId) {
  if (provider === "google") {
    return {
      uid: String(raw.id),
      summary: raw.summary ?? "",
      start: raw.start?.dateTime ?? raw.start?.date ?? "",
      end: raw.end?.dateTime ?? raw.end?.date,
      source: sourceId,
    };
  }
  if (provider === "outlook") {
    return {
      uid: String(raw.id),
      summary: raw.subject ?? "",
      start: raw.start?.dateTime ?? "",
      end: raw.end?.dateTime,
      source: sourceId,
    };
  }
  // ICS / iCloud / generic CalDAV already parse to Hearth Suite events.
  return { ...raw, source: sourceId };
}

/**
 * One-way import merge: imported events replace same-`uid` copies and add new
 * ones; events from other sources are preserved (no data loss).
 */
export function mergeImported(localEvents, importedEvents) {
  const byUid = new Map(localEvents.map((event) => [event.uid, event]));
  for (const event of importedEvents) {
    byUid.set(event.uid, event);
  }
  return [...byUid.values()];
}

/**
 * Two-way conflict resolution: the most recently modified side wins; ties go to
 * the remote (server-authoritative). Always deterministic.
 */
export function resolveConflict(local, remote) {
  const localTime = Date.parse(local.lastModified ?? "");
  const remoteTime = Date.parse(remote.lastModified ?? "");
  if (Number.isNaN(localTime) && Number.isNaN(remoteTime)) {
    return remote;
  }
  if (Number.isNaN(remoteTime)) {
    return local;
  }
  if (Number.isNaN(localTime)) {
    return remote;
  }
  return localTime > remoteTime ? local : remote;
}

/**
 * Keep only events from enabled sources. Native events have no source; Contacts
 * birthday/anniversary auto-events ("contacts") are a built-in, always-on layer.
 */
export function visibleEvents(events, sources) {
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  return events.filter(
    (event) =>
      event.source === undefined || event.source === "contacts" || enabled.has(event.source),
  );
}

/** Build an import source from an OAuth connection (no password is ever held). */
export function oauthSource(id, name, provider, accessToken, mode = "import") {
  return { id, name, auth: { type: "oauth", provider, accessToken }, enabled: true, mode };
}

/** Build an import source from an ICS/CalDAV URL. */
export function urlSource(id, name, url, mode = "import", user, pass) {
  const auth = { type: "url", url };
  if (user) {
    auth.user = user;
    auth.pass = pass ?? "";
  }
  return { id, name, auth, enabled: true, mode };
}

// ---- CalDAV / CardDAV over an injected transport (AC-CAL-2) -----------------

/** Subscribe: fetch and parse a calendar's ICS via the transport. */
export async function subscribe(transport, url, headers) {
  return parseIcs(await transport.get(url, headers));
}

/** Publish: serialise events and write them back via the transport. */
export async function publish(transport, url, events, headers) {
  await transport.put(url, toIcs(events), headers);
}

// ---- date + view helpers (day/week/month, AC-WKS-C1) ----------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** The YYYY-MM-DD date key of an ISO datetime or date string. */
export function dateKey(iso) {
  return String(iso ?? "").slice(0, 10);
}

function keyToUtc(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function utcToKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Add `n` days to a date key. */
export function addDays(key, n) {
  return utcToKey(keyToUtc(key) + n * 86400000);
}
/** Add `n` months to a date key, clamping the day to the target month length. */
export function addMonths(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad2(nm + 1)}-${pad2(Math.min(d, dim))}`;
}
/** The weekday (0=Sun..6=Sat) of a date key. */
export function weekday(key) {
  return new Date(keyToUtc(key)).getUTCDay();
}
/** The Sunday- (or weekStartsOn-) aligned start of the week containing `key`. */
export function startOfWeek(key, weekStartsOn = 0) {
  const diff = (weekday(key) - weekStartsOn + 7) % 7;
  return addDays(key, -diff);
}
/** The 7 date keys of the week containing `key`. */
export function weekDays(key, weekStartsOn = 0) {
  const start = startOfWeek(key, weekStartsOn);
  return Array.from({ length: 7 }, (_v, i) => addDays(start, i));
}
/** A month as weeks of 7 date keys (with leading/trailing days), 1-based month. */
export function monthGrid(year, month, weekStartsOn = 0) {
  const firstKey = `${year}-${pad2(month)}-01`;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (weekday(firstKey) - weekStartsOn + 7) % 7;
  const weeksCount = Math.ceil((lead + dim) / 7);
  const gridStart = startOfWeek(firstKey, weekStartsOn);
  const weeks = [];
  for (let w = 0; w < weeksCount; w += 1) {
    weeks.push(Array.from({ length: 7 }, (_v, i) => addDays(gridStart, w * 7 + i)));
  }
  return weeks;
}
/** The 24 hour labels of a day. */
export function hoursOfDay() {
  return Array.from({ length: 24 }, (_v, i) => i);
}

// ---- recurrence (AC-WKS-C3) ------------------------------------------------

function isoFromMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function eventDurationMs(event) {
  if (!event.end) return 0;
  return Math.max(0, Date.parse(event.end) - Date.parse(event.start));
}
function shiftEvent(event, newKey, durMs, index) {
  const out = { ...event };
  if (event.allDay) {
    out.start = newKey;
    if (event.end)
      out.end = dateKey(event.end) === dateKey(event.start) ? newKey : addDays(newKey, 1);
  } else {
    const timeMs = Date.parse(event.start) - keyToUtc(dateKey(event.start));
    const startMs = keyToUtc(newKey) + timeMs;
    out.start = isoFromMs(startMs);
    if (event.end) out.end = isoFromMs(startMs + durMs);
  }
  if (index > 0) {
    out.uid = `${event.uid}#${newKey}`;
    out.recurrenceId = event.uid;
  }
  return out;
}

/**
 * Expand a (possibly recurring) event into the occurrences whose date falls in
 * [rangeStartKey, rangeEndKey]. Supports daily/weekly/monthly/yearly with
 * interval, and a count or until bound. A non-recurring event yields itself
 * when it lands in range.
 */
export function expandRecurrence(event, rangeStartKey, rangeEndKey) {
  const out = [];
  const rec = event.recurrence;
  const startKey = dateKey(event.start);
  if (!rec || !rec.freq) {
    if (startKey >= rangeStartKey && startKey <= rangeEndKey) out.push(event);
    return out;
  }
  const interval = rec.interval && rec.interval > 0 ? rec.interval : 1;
  const untilKey = rec.until ? dateKey(rec.until) : null;
  const durMs = eventDurationMs(event);
  let cursor = startKey;
  let n = 0;
  for (let i = 0; i < 5000; i += 1) {
    if (rec.count && n >= rec.count) break;
    if (untilKey && cursor > untilKey) break;
    if (cursor > rangeEndKey) break;
    if (cursor >= rangeStartKey) {
      out.push(shiftEvent(event, cursor, durMs, i));
    }
    n += 1;
    // Advance from the ORIGINAL start, not the previous cursor, so month-end
    // recurrences don't drift (C2): a monthly event on the 31st clamps to Feb 28
    // but recovers to Mar 31, instead of sticking at the 28th forever. Daily and
    // weekly are unaffected (day arithmetic never clamps).
    if (rec.freq === "daily") cursor = addDays(startKey, n * interval);
    else if (rec.freq === "weekly") cursor = addDays(startKey, n * 7 * interval);
    else if (rec.freq === "monthly") cursor = addMonths(startKey, n * interval);
    else if (rec.freq === "yearly") cursor = addMonths(startKey, n * 12 * interval);
    else break;
  }
  return out;
}

/** Expand every event into occurrences within a date-key range, sorted. */
export function eventsInRange(events, rangeStartKey, rangeEndKey) {
  return events
    .flatMap((event) => expandRecurrence(event, rangeStartKey, rangeEndKey))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

/** Occurrences that land on a given day (timed and all-day). */
export function eventsForDay(events, key) {
  return eventsInRange(events, key, key);
}

/** Distinct categories used by a set of events, sorted. */
export function eventCategories(events) {
  const set = new Set();
  for (const e of events) {
    if (e.category) set.add(e.category);
  }
  return [...set].sort();
}

// ---- to-dos (AC-WKS-C7) ----------------------------------------------------

/** Sort to-dos: undone first, then by due date, then title. */
export function sortTodos(todos) {
  return todos.slice().sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    const ad = a.due || "9999-99-99";
    const bd = b.due || "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

// ---- RRULE (recurrence ICS round-trip) -------------------------------------

function recurrenceToRrule(rec) {
  const parts = [`FREQ=${String(rec.freq).toUpperCase()}`];
  if (rec.interval && rec.interval !== 1) parts.push(`INTERVAL=${rec.interval}`);
  if (rec.count) parts.push(`COUNT=${rec.count}`);
  if (rec.until) parts.push(`UNTIL=${icsDate(rec.until)}`);
  return parts.join(";");
}
function parseRrule(value) {
  const map = {};
  for (const kv of value.split(";")) {
    const [k, v] = kv.split("=");
    if (k) map[k.toUpperCase()] = v;
  }
  const freq = String(map.FREQ ?? "").toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(freq)) return null;
  const rec = { freq };
  if (map.INTERVAL) rec.interval = Number(map.INTERVAL);
  if (map.COUNT) rec.count = Number(map.COUNT);
  if (map.UNTIL) rec.until = parseIcsDate(map.UNTIL);
  return rec;
}

// ---- natural-language scheduling (DSG-S8) ----------------------------------

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY_ABBR = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  weds: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a natural-language scheduling phrase into a PROPOSED event, or null when
 * the text isn't a direct scheduling request (questions / availability queries
 * return null so the caller routes them to the on-device model instead).
 *
 * Pure and deterministic: `nowIso` anchors every relative date. The caller MUST
 * confirm with the user before creating anything, this never auto-creates.
 *
 * Handles: today / tomorrow / [next|this] <weekday> / bare <weekday>; "at noon",
 * "at midnight", "at 3pm", "3:30pm", "at 15:00"; titles with the date/time and a
 * leading verb ("schedule"/"add"/…) stripped. Timed events default to 1 hour.
 */
export function parseSchedulingPhrase(text, nowIso) {
  const raw = String(text ?? "").trim();
  if (raw === "") return null;
  const s = raw.toLowerCase();

  // Questions and availability look-ups are queries, not create requests.
  if (/\?\s*$/.test(raw)) return null;
  if (
    /^\s*(what|when|where|who|whom|which|how|is|are|was|were|do|does|did|can|could|would|will|show|list|tell|find|any|am|i'?m)\b/.test(
      s,
    )
  ) {
    return null;
  }

  const todayKey = dateKey(nowIso);
  const strip = []; // case-insensitive regexes removed from the title

  // --- date ---
  let dayKey = null;
  if (/\btoday\b/.test(s)) {
    dayKey = todayKey;
    strip.push(/\btoday\b/i);
  } else if (/\btomorrow\b/.test(s)) {
    dayKey = addDays(todayKey, 1);
    strip.push(/\btomorrow\b/i);
  } else {
    const wd =
      /\b(next|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)\b/.exec(
        s,
      );
    if (wd) {
      const qualifier = wd[1];
      const name = wd[2];
      const target =
        WEEKDAY_ABBR[name] !== undefined ? WEEKDAY_ABBR[name] : WEEKDAY_NAMES.indexOf(name);
      if (target >= 0) {
        let delta = (target - weekday(todayKey) + 7) % 7;
        // "next Tuesday" → the following week; bare/"this"/"on" → the soonest
        // upcoming day of that name (never today, to avoid ambiguity).
        if (qualifier === "next") delta = delta === 0 ? 7 : delta + 7;
        else if (delta === 0) delta = 7;
        dayKey = addDays(todayKey, delta);
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the day name is escaped by escapeRegExp
        strip.push(new RegExp("\\b(next|this|on)?\\s*" + escapeRegExp(name) + "\\b", "i"));
      }
    }
  }

  // --- time ---
  let time = null;
  if (/\bnoon\b/.test(s)) {
    time = { h: 12, m: 0 };
    strip.push(/\b(at\s+)?noon\b/i);
  } else if (/\bmidnight\b/.test(s)) {
    time = { h: 0, m: 0 };
    strip.push(/\b(at\s+)?midnight\b/i);
  } else {
    const ampm = /\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s);
    const h24 = /\b(at\s+)(\d{1,2}):(\d{2})\b/.exec(s);
    const m = ampm ?? h24;
    if (m) {
      let h = Number(m[2]);
      const min = m[3] ? Number(m[3]) : 0;
      const ap = m[4];
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        time = { h, m: min };
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the matched text is escaped by escapeRegExp
        strip.push(new RegExp(escapeRegExp(m[0]), "i"));
      }
    }
  }

  // Need at least a date or a time to be a scheduling request.
  if (!dayKey && !time) return null;
  if (!dayKey) dayKey = todayKey; // time-only → today

  // --- title (preserve original casing; strip matched date/time + lead verb) ---
  let title = raw;
  for (const r of strip) title = title.replace(r, " ");
  title = title
    .replace(/^\s*(please\s+)?(schedule|add|book|set\s*up|create|plan|put|make|new)\b/i, " ")
    .replace(/^\s*(an?|the)\b/i, " ")
    .replace(/^\s*(meeting|appointment|event|reminder)\s+(with|for|about|to|on)\b/i, "$1 $2")
    .replace(/^\s*(with|for|to|about)\b/i, " ")
    .replace(/\b(at|on|for|with|to)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  const summary = title === "" ? "New event" : title.charAt(0).toUpperCase() + title.slice(1);

  const allDay = !time;
  if (allDay) {
    return { summary, start: dayKey, allDay: true };
  }
  const start = `${dayKey}T${pad2(time.h)}:${pad2(time.m)}:00Z`;
  const end = `${dayKey}T${pad2((time.h + 1) % 24)}:${pad2(time.m)}:00Z`;
  return { summary, start, end };
}

// ---- text helpers -----------------------------------------------------------

function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeText(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function unfold(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw !== "") {
      out.push(raw);
    }
  }
  return out;
}
