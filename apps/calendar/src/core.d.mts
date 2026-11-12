// Type declarations for the pure Calendar/Contacts core (core.mjs).

export interface Recurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  count?: number;
  until?: string;
}

export interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end?: string;
  description?: string;
  reminderMinutes?: number;
  lastModified?: string;
  source?: string;
  /** All-day event (date-only start/end). */
  allDay?: boolean;
  /** A category label, for the category filter. */
  category?: string;
  /** Which named calendar this event belongs to. */
  calendarId?: string;
  /** A recurrence rule; the event repeats. */
  recurrence?: Recurrence;
  /** Set on a generated occurrence: the originating event's uid. */
  recurrenceId?: string;
}

/** A named, colour-coded calendar that can be overlaid and toggled. */
export interface NamedCalendar {
  id: string;
  name: string;
  colour: string;
  enabled: boolean;
}

/** A to-do item with an optional due date and a done state. */
export interface Todo {
  id: string;
  title: string;
  due?: string;
  done: boolean;
}

export interface Contact {
  uid: string;
  name: string;
  email?: string;
  phone?: string;
  lastModified?: string;
}

export type Provider = "google" | "outlook" | "icloud" | "ics" | "caldav";

export type SourceAuth =
  | { type: "oauth"; provider: Provider; accessToken: string }
  | { type: "url"; url: string; user?: string; pass?: string };

export interface ImportSource {
  id: string;
  name: string;
  auth: SourceAuth;
  enabled: boolean;
  mode: "import" | "two-way";
}

export interface CalDavTransport {
  get(url: string, headers?: Record<string, string>): Promise<string>;
  put(url: string, body: string, headers?: Record<string, string>): Promise<void>;
}

export interface SearchItem {
  id: string;
  kind: "calendar" | "record";
  title: string;
  module: "calendar" | "records";
}

export function toIcs(events: CalEvent[]): string;
export function parseIcs(text: string): CalEvent[];
export function toVcard(contacts: Contact[]): string;
export function parseVcard(text: string): Contact[];
export function dueReminders(events: CalEvent[], nowIso: string): CalEvent[];
export function toSearchItems(events: CalEvent[], contacts: Contact[]): SearchItem[];
export function mapExternalEvent(provider: Provider, raw: unknown, sourceId: string): CalEvent;
export function mergeImported(localEvents: CalEvent[], importedEvents: CalEvent[]): CalEvent[];
export function resolveConflict(local: CalEvent, remote: CalEvent): CalEvent;
export function visibleEvents(events: CalEvent[], sources: ImportSource[]): CalEvent[];
export function oauthSource(
  id: string,
  name: string,
  provider: Provider,
  accessToken: string,
  mode?: "import" | "two-way",
): ImportSource;
export function urlSource(
  id: string,
  name: string,
  url: string,
  mode?: "import" | "two-way",
  user?: string,
  pass?: string,
): ImportSource;
export function subscribe(
  transport: CalDavTransport,
  url: string,
  headers?: Record<string, string>,
): Promise<CalEvent[]>;
export function publish(
  transport: CalDavTransport,
  url: string,
  events: CalEvent[],
  headers?: Record<string, string>,
): Promise<void>;

// ---- date / view / recurrence helpers --------------------------------------
export function dateKey(iso: string): string;
export function addDays(key: string, n: number): string;
export function addMonths(key: string, n: number): string;
export function weekday(key: string): number;
export function startOfWeek(key: string, weekStartsOn?: number): string;
export function weekDays(key: string, weekStartsOn?: number): string[];
export function monthGrid(year: number, month: number, weekStartsOn?: number): string[][];
export function hoursOfDay(): number[];
export function expandRecurrence(
  event: CalEvent,
  rangeStartKey: string,
  rangeEndKey: string,
): CalEvent[];
export function eventsInRange(
  events: CalEvent[],
  rangeStartKey: string,
  rangeEndKey: string,
): CalEvent[];
export function eventsForDay(events: CalEvent[], key: string): CalEvent[];
export function eventCategories(events: CalEvent[]): string[];
export function sortTodos(todos: Todo[]): Todo[];

/** A scheduling proposal parsed from natural language; needs user confirmation. */
export interface ProposedEvent {
  summary: string;
  start: string;
  end?: string;
  allDay?: boolean;
}
/**
 * Parse a natural-language scheduling phrase into a proposed event, or null when
 * the text is a question/query. Pure; `nowIso` anchors all relative dates. Never
 * auto-creates, the caller must confirm.
 */
export function parseSchedulingPhrase(text: string, nowIso: string): ProposedEvent | null;
