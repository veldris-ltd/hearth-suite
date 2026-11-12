/**
 * Hearth Suite Calendar, local-first appointments at Works parity.
 *
 * Day / Week / Month / Agenda views with prev/next/today navigation; timed and
 * all-day appointments; recurrence; categories with a filter; multiple named
 * calendars overlaid in one view, each with a colour and on/off; a to-do pane
 * with due dates and done-states; birthdays & anniversaries auto-generated from
 * Contacts; reliable in-app reminders (with a per-platform background-scheduler
 * seam); .ics import/export; and print layouts. CalDAV/CardDAV subscribe +
 * publish and the Pro import extension sit alongside. Persisted encrypted at
 * rest via the `store` crate through the FFI client.
 */

import type { Effort, EmberRequest, HearthClient } from "@hearth/core-client";
import { cls, EmberPanel, icon, type PreferenceStorage } from "@hearth/design-system";

import {
  addDays,
  addMonths,
  dateKey,
  dueReminders,
  eventCategories,
  eventsForDay,
  eventsInRange,
  hoursOfDay,
  mergeImported,
  monthGrid,
  oauthSource,
  parseIcs,
  parseSchedulingPhrase,
  publish,
  sortTodos,
  subscribe,
  toIcs,
  urlSource,
  visibleEvents,
  weekDays,
} from "./core.mjs";
import type {
  CalDavTransport,
  CalEvent,
  ImportSource,
  NamedCalendar,
  ProposedEvent,
  Provider,
  Recurrence,
  SourceAuth,
  Todo,
} from "./core.mjs";

/** Host hooks for Calendar. */
export interface CalendarOptions {
  bundleId: string;
  now?: () => string;
  transport?: CalDavTransport;
  /** Read-only events (e.g. Contacts birthdays/anniversaries, C4). */
  seedEvents?: CalEvent[];
  /**
   * Schedule OS-level reminders for events that have one. The host wires a
   * per-platform background scheduler (Tauri notifications / Capacitor local
   * notifications); without it, the in-app reminder banner still fires.
   */
  onScheduleReminders?: (events: CalEvent[]) => void;
  /** Send the current calendar into a chosen Bundle (Portfolio collect-flow). */
  onAddToBundle?: (payload: { docType: string; title: string; contentBase64: string }) => void;
  /**
   * Where the calendar's working state (created events, to-dos, named calendars)
   * persists so it survives reopen (C6: to-dos persist). Defaults to
   * `localStorage`; the client shell injects a vault-backed adapter so it is
   * encrypted and travels with sync (P2-CL3). Events still export as .ics.
   */
  stateStorage?: PreferenceStorage;
  onError?: (message: string) => void;
}

type View = "month" | "week" | "day" | "agenda";

const PALETTE = ["#E8761A", "#0F766E", "#CA8A04", "#4D7C0F", "#9C4413", "#A8456B"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The Calendar editor. */
export class Calendar {
  private events: CalEvent[] = [];
  private sources: ImportSource[] = [];
  private calendars: NamedCalendar[] = [
    { id: "personal", name: "Personal", colour: "var(--hb-chart-1, #E8761A)", enabled: true },
    {
      id: "birthdays",
      name: "Birthdays & anniversaries",
      colour: "var(--hb-chart-6, #A8456B)",
      enabled: true,
    },
  ];
  private todos: Todo[] = [];
  private view: View = "month";
  private focus: string;
  private categoryFilter: string | null = null;
  private root: HTMLElement | undefined;
  private ember: EmberPanel<EmberRequest> | undefined;
  private pendingProposal: ProposedEvent | null = null;
  private seq = 0;

  constructor(
    private readonly client: HearthClient,
    private readonly options: CalendarOptions,
  ) {
    this.focus = dateKey(options.now?.() ?? new Date().toISOString());
    for (const seed of options.seedEvents ?? []) {
      // Birthdays/anniversaries recur yearly and live on their own calendar.
      this.events.push({
        ...seed,
        allDay: seed.allDay ?? true,
        recurrence: seed.recurrence ?? { freq: "yearly" },
        calendarId: seed.calendarId ?? "birthdays",
      });
    }
  }

  visible(): CalEvent[] {
    return visibleEvents(this.events, this.sources);
  }

  private ownEvents(): CalEvent[] {
    return this.events.filter((e) => e.source !== "contacts");
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.loadState();
    this.rerender();
  }

  private rerender(): void {
    if (!this.root) {
      return;
    }
    const shell = el("div", { class: "hb-cal" });
    shell.append(this.renderHeader(), this.renderReminders());
    const main = el("div", { class: "hb-cal__main" });
    main.append(this.renderView(), this.renderSidebar());
    shell.append(main);
    this.root.replaceChildren(shell);
  }

  // ---- header + navigation -------------------------------------------------

  private renderHeader(): HTMLElement {
    const header = el("div", { class: "hb-cal__header" });
    const titles = el(
      "div",
      {},
      el("h1", { class: "hb-cal__title" }, "Calendar"),
      el("p", { class: "hb-cal__meta" }, this.periodLabel()),
    );
    const enc = el("span", { class: "hb-cal__enc" });
    enc.innerHTML = `${icon("lock", 14)}<span>Encrypted on this device</span>`;
    header.append(titles, el("div", { class: "hb-cal__header-right" }, enc, this.renderToolbar()));
    return header;
  }

  private renderToolbar(): HTMLElement {
    const bar = el("div", { class: "hb-cal__toolbar", role: "toolbar" });
    const nav = el("div", { class: "hb-cal__nav" });
    nav.append(
      iconBtn("‹", "Previous", () => this.step(-1)),
      button("Today", () => this.goToday()),
      iconBtn("›", "Next", () => this.step(1)),
    );
    const views = el("div", { class: "hb-cal__views", role: "tablist" });
    for (const v of ["day", "week", "month", "agenda"] as View[]) {
      views.append(tab(capitalize(v), this.view === v, () => this.setView(v)));
    }
    bar.append(
      nav,
      views,
      primary("New event", () => this.openEventDialog()),
      button("Import", () => this.openImport()),
      button("Export", () => this.openExport()),
      button("Print", () => window.print()),
    );
    if (this.options.onAddToBundle) {
      bar.append(button("Add to Bundle", () => this.addToBundle()));
    }
    if (this.options.transport) {
      bar.append(button("Publish", () => void this.publishAll()));
    }
    return bar;
  }

  private periodLabel(): string {
    const { y, m, d } = ymd(this.focus);
    if (this.view === "month") return `${MONTHS[m - 1]} ${y}`;
    if (this.view === "day")
      return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
    if (this.view === "week") {
      const days = weekDays(this.focus);
      return `${(days[0] ?? "").slice(8)}–${(days[6] ?? "").slice(8)} ${MONTHS[m - 1]} ${y}`;
    }
    return "Upcoming";
  }

  private setView(view: View): void {
    this.view = view;
    this.rerender();
  }
  private goToday(): void {
    this.focus = dateKey(this.options.now?.() ?? new Date().toISOString());
    this.rerender();
  }
  private step(dir: number): void {
    if (this.view === "month") this.focus = addMonths(this.focus, dir);
    else if (this.view === "week") this.focus = addDays(this.focus, dir * 7);
    else this.focus = addDays(this.focus, dir);
    this.rerender();
  }

  // ---- reminders -----------------------------------------------------------

  private renderReminders(): HTMLElement {
    const now = this.options.now?.() ?? new Date().toISOString();
    const due = dueReminders(this.expandedAround(), now);
    const banner = el("div", { class: "hb-cal__reminders", role: "status" });
    for (const event of due) {
      banner.append(el("div", { class: cls.toast }, `Reminder: ${event.summary}`));
    }
    return banner;
  }

  // ---- the visible, expanded event set -------------------------------------

  /** Events visible under source toggles, enabled calendars, and category. */
  private filteredEvents(): CalEvent[] {
    const enabledCals = new Set(this.calendars.filter((c) => c.enabled).map((c) => c.id));
    return this.visible().filter((event) => {
      const cal = event.calendarId ?? "personal";
      if (!enabledCals.has(cal)) return false;
      if (this.categoryFilter && event.category !== this.categoryFilter) return false;
      return true;
    });
  }

  /** Occurrences expanded across the visible range plus a buffer (reminders). */
  private expandedAround(): CalEvent[] {
    return eventsInRange(this.filteredEvents(), addDays(this.focus, -40), addDays(this.focus, 40));
  }

  private calendarColour(event: CalEvent): string {
    return (
      this.calendars.find((c) => c.id === (event.calendarId ?? "personal"))?.colour ?? palette(0)
    );
  }

  // ---- views ---------------------------------------------------------------

  private renderView(): HTMLElement {
    const wrap = el("section", { class: "hb-cal__viewwrap", "aria-label": `${this.view} view` });
    if (this.view === "month") wrap.append(this.renderMonth());
    else if (this.view === "week") wrap.append(this.renderWeek());
    else if (this.view === "day") wrap.append(this.renderDay());
    else wrap.append(this.renderAgenda());
    return wrap;
  }

  private renderMonth(): HTMLElement {
    const { y, m } = ymd(this.focus);
    const grid = el("div", { class: "hb-cal__month" });
    const head = el("div", { class: "hb-cal__month-head" });
    for (const d of DOW) head.append(el("div", { class: "hb-cal__dow" }, d));
    grid.append(head);
    const todayKey = dateKey(this.options.now?.() ?? new Date().toISOString());
    for (const week of monthGrid(y, m)) {
      const row = el("div", { class: "hb-cal__week-row" });
      for (const key of week) {
        const inMonth = key.startsWith(`${y}-${String(m).padStart(2, "0")}`);
        const cell = el("div", {
          class: `hb-cal__day${inMonth ? "" : " is-out"}${key === todayKey ? " is-today" : ""}`,
        });
        const num = el(
          "button",
          { class: "hb-cal__daynum", type: "button" },
          key.slice(8).replace(/^0/, ""),
        );
        num.addEventListener("click", () => {
          this.focus = key;
          this.setView("day");
        });
        cell.append(num);
        for (const event of eventsForDay(this.filteredEvents(), key).slice(0, 4)) {
          cell.append(this.eventChip(event, true));
        }
        cell.addEventListener("dblclick", () => this.openEventDialog(key));
        row.append(cell);
      }
      grid.append(row);
    }
    return grid;
  }

  private renderWeek(): HTMLElement {
    const days = weekDays(this.focus);
    return this.renderHourGrid(days);
  }

  private renderDay(): HTMLElement {
    return this.renderHourGrid([this.focus]);
  }

  /** A shared hour grid for the day (1 col) and week (7 cols) views. */
  private renderHourGrid(days: string[]): HTMLElement {
    const wrap = el("div", { class: "hb-cal__hours-wrap" });
    const table = el("table", { class: "hb-cal__hours" });
    const head = el("tr");
    head.append(el("th", { class: "hb-cal__hour-col" }, ""));
    const todayKey = dateKey(this.options.now?.() ?? new Date().toISOString());
    for (const key of days) {
      const { y, m, d } = ymd(key);
      head.append(
        el(
          "th",
          { class: key === todayKey ? "is-today" : "" },
          `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`,
        ),
      );
    }
    table.append(head);

    // All-day row.
    const allDayRow = el("tr", { class: "hb-cal__allday-row" });
    allDayRow.append(el("th", { class: "hb-cal__hour-col" }, "all-day"));
    for (const key of days) {
      const cell = el("td", {});
      for (const event of eventsForDay(this.filteredEvents(), key).filter((e) => e.allDay)) {
        cell.append(this.eventChip(event, false));
      }
      cell.addEventListener("dblclick", () => this.openEventDialog(key, true));
      allDayRow.append(cell);
    }
    table.append(allDayRow);

    for (const hour of hoursOfDay()) {
      const tr = el("tr");
      tr.append(el("th", { class: "hb-cal__hour-col" }, `${String(hour).padStart(2, "0")}:00`));
      for (const key of days) {
        const cell = el("td", {});
        const hourEvents = eventsForDay(this.filteredEvents(), key).filter(
          (e) => !e.allDay && Number(e.start.slice(11, 13)) === hour,
        );
        for (const event of hourEvents) cell.append(this.eventChip(event, false));
        cell.addEventListener("dblclick", () => this.openEventDialog(key, false, hour));
        tr.append(cell);
      }
      table.append(tr);
    }
    wrap.append(table);
    return wrap;
  }

  private renderAgenda(): HTMLElement {
    const section = el("section", { class: "hb-cal__agenda", "aria-label": "Agenda" });
    const upcoming = eventsInRange(this.filteredEvents(), this.focus, addDays(this.focus, 60));
    if (upcoming.length === 0) {
      section.append(el("div", { class: cls.emptyState }, "Nothing scheduled."));
      return section;
    }
    for (const event of upcoming) {
      const card = el("div", { class: cls.card });
      const dot = el("span", { class: "hb-cal__dot" });
      dot.setAttribute("style", `background:${this.calendarColour(event)}`);
      card.append(dot, el("strong", {}, event.summary), el("time", {}, formatWhen(event)));
      card.addEventListener("click", () =>
        this.openEventDialog(undefined, false, undefined, event),
      );
      section.append(card);
    }
    return section;
  }

  private eventChip(event: CalEvent, compact: boolean): HTMLElement {
    const chip = el("button", {
      class: `hb-cal__chip${compact ? " is-compact" : ""}`,
      type: "button",
      title: event.summary,
    });
    chip.setAttribute("style", `--chip:${this.calendarColour(event)}`);
    const time = event.allDay ? "" : `${event.start.slice(11, 16)} `;
    chip.append(
      el(
        "span",
        { class: "hb-cal__chip-text" },
        `${time}${event.summary}${event.recurrence ? " ↻" : ""}`,
      ),
    );
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openEventDialog(undefined, false, undefined, event);
    });
    return chip;
  }

  // ---- sidebar: calendars, categories, to-dos, sources ---------------------

  private renderSidebar(): HTMLElement {
    const aside = el("aside", { class: "hb-cal__sidebar", "aria-label": "Calendars and to-dos" });
    aside.append(
      this.renderCalendars(),
      this.renderCategories(),
      this.renderTodos(),
      this.renderSources(),
      this.renderEmber(),
    );
    return aside;
  }

  /** The shared Ember panel (DSG-S8): ask about your schedule or say what to add
   *  in plain language. Scheduling phrases are parsed on-device into a *proposed*
   *  event you confirm, nothing is ever added automatically. */
  private renderEmber(): HTMLElement {
    if (!this.ember) {
      const summary = (): string =>
        this.visible()
          .slice(0, 60)
          .map((e) => `${e.start} ${e.summary}`)
          .join("; ");
      const query = (request: string, effort: Effort): EmberRequest => ({
        task: "query",
        document: summary(),
        request,
        effort,
      });
      this.ember = new EmberPanel<EmberRequest>({
        run: (req) => this.runEmberOrSchedule(req),
        intro: "Ask about your schedule, or say what to add. Answered on your device.",
        suggestions: [
          {
            label: "What's on next week?",
            build: (effort) => query("What's on my schedule next week?", effort),
          },
          {
            label: "Any free mornings?",
            build: (effort) => query("Which mornings are free this week?", effort),
          },
          {
            label: "Lunch with Sam Tuesday at noon",
            build: (effort) => query("Lunch with Sam Tuesday at noon", effort),
          },
        ],
        ask: {
          placeholder: "e.g. lunch with Sam next Tuesday at noon",
          build: (text, effort) => query(text, effort),
        },
        resultActions: () => this.proposalActions(),
        onError: (message) => this.options.onError?.(message),
      });
    }
    return el("div", { class: "hb-cal__ember" }, this.ember.el());
  }

  /** Parse a scheduling phrase locally into a confirmable proposal; otherwise
   *  fall through to the on-device model for free-form schedule questions. */
  private async runEmberOrSchedule(
    req: EmberRequest,
  ): Promise<{ text: string; model: string; device_local: boolean }> {
    const now = this.options.now?.() ?? new Date().toISOString();
    const proposal = parseSchedulingPhrase(req.request, now);
    if (proposal) {
      this.pendingProposal = proposal;
      return {
        text: `I can add “${proposal.summary}”, ${describeProposal(proposal)}. Add it? I won't until you confirm.`,
        model: "Hearth Suite",
        device_local: true,
      };
    }
    this.pendingProposal = null;
    return this.client.runEmber(req);
  }

  /** Confirm/dismiss buttons under a proposed event (never auto-creates). */
  private proposalActions(): HTMLElement[] {
    const proposal = this.pendingProposal;
    if (!proposal) {
      return [];
    }
    this.pendingProposal = null; // consume: this proposal belongs to this bubble
    const add = el("button", { class: cls.buttonPrimary, type: "button" }, "Add to calendar");
    const dismiss = el("button", { class: cls.button, type: "button" }, "Not now");
    add.addEventListener("click", () => {
      this.createFromProposal(proposal);
      (add as HTMLButtonElement).disabled = true;
      add.textContent = "Added ✓";
      dismiss.remove();
    });
    dismiss.addEventListener("click", () => {
      add.remove();
      dismiss.remove();
    });
    return [add, dismiss];
  }

  /** Create a real event from a confirmed proposal, then persist + rerender. */
  private createFromProposal(proposal: ProposedEvent): void {
    this.seq += 1;
    this.events.push({
      uid: `e-${this.seq}-ember`,
      summary: proposal.summary,
      start: proposal.start,
      end: proposal.end,
      allDay: proposal.allDay,
      calendarId: "personal",
      lastModified: this.options.now?.() ?? new Date().toISOString(),
    });
    void this.persist();
    this.rerender();
  }

  private renderCalendars(): HTMLElement {
    const panel = el("div", { class: "hb-cal__panel" });
    panel.append(el("h2", { class: "hb-cal__panel-title" }, "Calendars"));
    for (const calendar of this.calendars) {
      const row = el("label", { class: "hb-cal__cal-row" });
      const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = calendar.enabled;
      cb.addEventListener("change", () => {
        calendar.enabled = cb.checked;
        this.persistState();
        this.rerender();
      });
      const swatch = el("span", { class: "hb-cal__swatch" });
      swatch.setAttribute("style", `background:${calendar.colour}`);
      row.append(cb, swatch, el("span", {}, calendar.name));
      panel.append(row);
    }
    // Local calendars are sealed; reassure that they stay private (DSG-S7).
    const sealed = el("p", { class: "hb-cal__sealed-note" });
    sealed.innerHTML = `${icon("lock", 14)}<span>Sealed on this device, only invitees can open the agenda &amp; notes.</span>`;
    panel.append(
      sealed,
      button("Add calendar", () => this.addCalendar()),
    );
    return panel;
  }

  /** The live subscription this event came from, if any (it's external / not
   *  end-to-end encrypted). Pasted-in .ics copies live locally and are sealed. */
  private sourceFor(event: CalEvent): ImportSource | undefined {
    return event.source ? this.sources.find((s) => s.id === event.source) : undefined;
  }

  private addCalendar(): void {
    const name = typeof prompt === "function" ? prompt("New calendar name:") : null;
    if (!name || name.trim() === "") {
      return;
    }
    this.seq += 1;
    const colour = palette(this.calendars.length);
    this.calendars.push({ id: `cal-${this.seq}`, name: name.trim(), colour, enabled: true });
    this.persistState();
    this.rerender();
  }

  private renderCategories(): HTMLElement {
    const panel = el("div", { class: "hb-cal__panel" });
    const cats = eventCategories(this.events);
    if (cats.length === 0) {
      return panel;
    }
    panel.append(el("h2", { class: "hb-cal__panel-title" }, "Categories"));
    const chips = el("div", { class: "hb-cal__catchips" });
    const chip = (label: string, value: string | null): HTMLElement => {
      const c = el(
        "button",
        {
          class: `hb-cal__catchip${this.categoryFilter === value ? " is-active" : ""}`,
          type: "button",
        },
        label,
      );
      c.addEventListener("click", () => {
        this.categoryFilter = value;
        this.rerender();
      });
      return c;
    };
    chips.append(chip("All", null));
    for (const cat of cats) chips.append(chip(cat, cat));
    panel.append(chips);
    return panel;
  }

  private renderTodos(): HTMLElement {
    const panel = el("div", { class: "hb-cal__panel" });
    panel.append(el("h2", { class: "hb-cal__panel-title" }, "To-do"));
    const list = el("ul", { class: "hb-cal__todos" });
    for (const todo of sortTodos(this.todos)) {
      const li = el("li", { class: `hb-cal__todo${todo.done ? " is-done" : ""}` });
      const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = todo.done;
      cb.addEventListener("change", () => {
        todo.done = cb.checked;
        this.persistState();
        this.rerender();
      });
      li.append(cb, el("span", { class: "hb-cal__todo-title" }, todo.title));
      if (todo.due) li.append(el("span", { class: "hb-cal__todo-due" }, `due ${todo.due}`));
      list.append(li);
    }
    panel.append(
      list,
      button("Add to-do", () => this.addTodo()),
    );
    return panel;
  }

  private addTodo(): void {
    const title = typeof prompt === "function" ? prompt("To-do:") : null;
    if (!title || title.trim() === "") {
      return;
    }
    const due =
      typeof prompt === "function" ? (prompt("Due date (YYYY-MM-DD, optional):") ?? "") : "";
    this.seq += 1;
    this.todos.push({
      id: `t-${this.seq}`,
      title: title.trim(),
      due: due.trim() || undefined,
      done: false,
    });
    this.persistState();
    this.rerender();
  }

  // ---- event dialog --------------------------------------------------------

  private openEventDialog(dayKey?: string, allDay = false, hour?: number, edit?: CalEvent): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-cal__dialog",
      role: "dialog",
      "aria-label": edit ? "Edit event" : "New event",
    });
    card.append(el("h2", { class: "hb-cal__dialog-title" }, edit ? "Edit event" : "New event"));

    // Make the E2E status unmissable: sealed-local vs external-server (DSG-S7).
    const ext = edit ? this.sourceFor(edit) : undefined;
    const e2e = el("div", {
      class: ext ? "hb-cal__e2e hb-cal__e2e--ext" : "hb-cal__e2e hb-cal__e2e--sealed",
    });
    e2e.innerHTML = ext
      ? `${icon("link", 14)}<span>From ${escapeText(ext.name)} · not end-to-end encrypted. It lives on someone else's server.</span>`
      : `${icon("lock", 14)}<span>Sealed, only invitees can open the agenda &amp; notes.</span>`;
    card.append(e2e);

    const startKey = edit ? dateKey(edit.start) : (dayKey ?? this.focus);
    const titleIn = el("input", { class: cls.input, placeholder: "Title" }) as HTMLInputElement;
    titleIn.value = edit?.summary ?? "";
    const dateIn = el("input", { class: cls.input, type: "date" }) as HTMLInputElement;
    dateIn.value = startKey;
    const allDayCb = el("input", { type: "checkbox" }) as HTMLInputElement;
    allDayCb.checked = edit?.allDay ?? allDay;
    const startTime = el("input", { class: cls.input, type: "time" }) as HTMLInputElement;
    startTime.value =
      edit && !edit.allDay
        ? edit.start.slice(11, 16)
        : hour !== undefined
          ? `${String(hour).padStart(2, "0")}:00`
          : "09:00";
    const endTime = el("input", { class: cls.input, type: "time" }) as HTMLInputElement;
    endTime.value = edit?.end && !edit.allDay ? edit.end.slice(11, 16) : "10:00";

    const calSel = el("select", {
      class: cls.input,
      "aria-label": "Calendar",
    }) as HTMLSelectElement;
    for (const c of this.calendars) calSel.append(el("option", { value: c.id }, c.name));
    calSel.value = edit?.calendarId ?? "personal";
    const catIn = el("input", {
      class: cls.input,
      placeholder: "Category (optional)",
    }) as HTMLInputElement;
    catIn.value = edit?.category ?? "";
    const remindSel = el("select", {
      class: cls.input,
      "aria-label": "Reminder",
    }) as HTMLSelectElement;
    for (const opt of [
      ["", "No reminder"],
      ["0", "At start"],
      ["10", "10 min before"],
      ["15", "15 min before"],
      ["60", "1 hour before"],
      ["1440", "1 day before"],
    ]) {
      remindSel.append(el("option", { value: opt[0] ?? "" }, opt[1] ?? ""));
    }
    remindSel.value = edit?.reminderMinutes != null ? String(edit.reminderMinutes) : "15";
    const repeatSel = el("select", {
      class: cls.input,
      "aria-label": "Repeat",
    }) as HTMLSelectElement;
    for (const opt of [
      ["", "Does not repeat"],
      ["daily", "Every day"],
      ["weekly", "Every week"],
      ["monthly", "Every month"],
      ["yearly", "Every year"],
    ]) {
      repeatSel.append(el("option", { value: opt[0] ?? "" }, opt[1] ?? ""));
    }
    repeatSel.value = edit?.recurrence?.freq ?? "";

    const timeRow = el(
      "div",
      { class: "hb-cal__dialog-times" },
      labelled("Start", startTime),
      labelled("End", endTime),
    );
    const syncTimes = (): void => {
      timeRow.style.display = allDayCb.checked ? "none" : "";
    };
    allDayCb.addEventListener("change", syncTimes);
    syncTimes();

    const allDayRow = el("label", { class: "hb-cal__check" });
    allDayRow.append(allDayCb, el("span", {}, "All day"));

    const foot = el("div", { class: "hb-cal__dialog-foot" });
    if (edit) {
      foot.append(
        button("Delete", () => {
          this.events = this.events.filter((e) => e.uid !== (edit.recurrenceId ?? edit.uid));
          overlay.remove();
          void this.persist();
          this.rerender();
        }),
      );
    }
    foot.append(
      button("Cancel", () => overlay.remove()),
      primary("Save", () => {
        const title = titleIn.value.trim();
        if (title === "") {
          return;
        }
        const isAllDay = allDayCb.checked;
        const start = isAllDay ? dateIn.value : `${dateIn.value}T${startTime.value}:00Z`;
        const end = isAllDay ? undefined : `${dateIn.value}T${endTime.value}:00Z`;
        const recurrence: Recurrence | undefined = repeatSel.value
          ? { freq: repeatSel.value as Recurrence["freq"] }
          : undefined;
        const base: CalEvent = {
          uid: edit ? (edit.recurrenceId ?? edit.uid) : `e-${++this.seq}`,
          summary: title,
          start,
          end,
          allDay: isAllDay || undefined,
          calendarId: calSel.value,
          category: catIn.value.trim() || undefined,
          reminderMinutes: remindSel.value === "" ? undefined : Number(remindSel.value),
          recurrence,
          lastModified: this.options.now?.() ?? new Date().toISOString(),
        };
        if (edit) {
          this.events = this.events.map((e) => (e.uid === base.uid ? base : e));
        } else {
          this.events.push(base);
        }
        overlay.remove();
        void this.persist();
        this.rerender();
      }),
    );

    card.append(
      labelled("Title", titleIn),
      labelled("Date", dateIn),
      allDayRow,
      timeRow,
      labelled("Calendar", calSel),
      labelled("Category", catIn),
      labelled("Reminder", remindSel),
      labelled("Repeat", repeatSel),
      foot,
    );
    overlay.append(card);
    document.body.append(overlay);
    titleIn.focus();
  }

  // ---- .ics import / export (AC-WKS-C10) -----------------------------------

  private openImport(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-cal__dialog",
      role: "dialog",
      "aria-label": "Import calendar",
    });
    card.append(el("h2", { class: "hb-cal__dialog-title" }, "Import .ics"));
    const area = el("textarea", {
      class: cls.input,
      rows: "8",
      placeholder: "Paste iCalendar (.ics) text",
    }) as HTMLTextAreaElement;
    const foot = el("div", { class: "hb-cal__dialog-foot" });
    foot.append(
      button("Cancel", () => overlay.remove()),
      primary("Import", () => {
        try {
          const imported = parseIcs(area.value).map((e) => ({ ...e, source: "import" }));
          this.events = mergeImported(this.events, imported);
          overlay.remove();
          void this.persist();
          this.rerender();
        } catch (error) {
          this.fail(error);
        }
      }),
    );
    card.append(area, foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  private openExport(): void {
    const overlay = modalBackdrop(() => overlay.remove());
    const card = el("div", {
      class: "hb-cal__dialog",
      role: "dialog",
      "aria-label": "Export calendar",
    });
    card.append(el("h2", { class: "hb-cal__dialog-title" }, "Export .ics"));
    const out = el("textarea", {
      class: cls.input,
      rows: "8",
      readonly: "",
    }) as HTMLTextAreaElement;
    out.value = toIcs(this.ownEvents());
    const foot = el("div", { class: "hb-cal__dialog-foot" });
    foot.append(
      button("Copy", () => {
        out.select();
        void navigator.clipboard?.writeText(out.value);
      }),
      primary("Download", () => this.download(out.value, "calendar.ics")),
      button("Close", () => overlay.remove()),
    );
    card.append(out, foot);
    overlay.append(card);
    document.body.append(overlay);
  }

  private download(text: string, filename: string): void {
    const blob = new Blob([text], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---- import sources (Pro, AC-CAL-3 / AC-CAL-4) ---------------------------

  private renderSources(): HTMLElement {
    const panel = el("div", { class: "hb-cal__panel" });
    panel.append(el("h2", { class: "hb-cal__panel-title" }, "Subscriptions"));
    const note = el("p", { class: "hb-cal__ext-note" });
    // CalDAV/OAuth subscribe is a Pro feature (AC-CAL-3/4) that needs a host
    // transport. Without one (e.g. the web preview), show where it lives rather
    // than dead "Connect" buttons that can never obtain a token.
    if (!this.options.transport) {
      note.innerHTML = `${icon("link", 14)}<span>Subscribe to Google, Outlook, or any CalDAV calendar from the Hearth Suite desktop app. (You can still import or export <code>.ics</code> here.)</span>`;
      panel.append(note);
      return panel;
    }
    // External calendars are not end-to-end encrypted, say so plainly so they
    // never blur with the sealed local calendars above (DSG-S7).
    note.innerHTML = `${icon("link", 14)}<span>Not end-to-end encrypted, these live on someone else's server.</span>`;
    panel.append(note);
    for (const source of this.sources) {
      const row = el("div", { class: "hb-cal__source is-external" });
      const label = el("span", { class: "hb-cal__source-name" });
      label.append(
        el("span", {}, `${source.name} (${source.mode})`),
        chip("Not E2E", "Lives on someone else's server, not end-to-end encrypted."),
      );
      const toggle = el("button", {
        class: cls.toggle,
        type: "button",
        "aria-checked": String(source.enabled),
        "aria-label": `Toggle ${source.name}`,
      });
      toggle.addEventListener("click", () => {
        source.enabled = !source.enabled;
        this.rerender();
      });
      row.append(
        label,
        toggle,
        button("Sync", () => void this.syncSource(source)),
      );
      panel.append(row);
    }
    // URL / CalDAV subscribe works over the native transport. OAuth "Connect
    // Google/Outlook" needs registered provider apps (a separate seam), so it
    // stays out of the UI until those exist — see connect() below.
    panel.append(button("Add ICS/CalDAV URL", () => this.addUrlSource()));
    const oauthNote = el("p", { class: "hb-cal__ext-note" });
    oauthNote.innerHTML = `${icon("link", 14)}<span>One-click Google &amp; Outlook sign-in is coming, paste their secret iCal/CalDAV address here meanwhile.</span>`;
    panel.append(oauthNote);
    return panel;
  }

  /**
   * Add an OAuth-backed source programmatically (e.g. once a provider app is
   * registered and a token obtained by the host). Not surfaced as a button yet.
   */
  connect(provider: Provider, accessToken = ""): void {
    const id = `${provider}-${this.sources.length + 1}`;
    this.sources.push(oauthSource(id, capitalize(provider), provider, accessToken));
    this.rerender();
  }

  private addUrlSource(): void {
    const url = typeof prompt === "function" ? prompt("ICS/CalDAV URL?") : null;
    if (!url) {
      return;
    }
    // Optional HTTP Basic auth (many private CalDAV feeds need it). Blank = none.
    const user =
      typeof prompt === "function" ? (prompt("Username (leave blank for none):") ?? "") : "";
    const pass = user && typeof prompt === "function" ? (prompt("Password:") ?? "") : "";
    this.sources.push(
      urlSource(
        `url-${this.sources.length + 1}`,
        "Subscription",
        url,
        "import",
        user || undefined,
        pass || undefined,
      ),
    );
    this.rerender();
  }

  /** Build the per-source request headers (HTTP Basic auth when present). */
  private sourceHeaders(auth: SourceAuth): Record<string, string> | undefined {
    if (auth.type === "url" && auth.user) {
      return { Authorization: `Basic ${btoa(`${auth.user}:${auth.pass ?? ""}`)}` };
    }
    return undefined;
  }

  async syncSource(source: ImportSource): Promise<void> {
    if (source.auth.type !== "url" || !this.options.transport) {
      return;
    }
    try {
      const imported = (
        await subscribe(this.options.transport, source.auth.url, this.sourceHeaders(source.auth))
      ).map((event) => ({ ...event, source: source.id }));
      this.events = mergeImported(this.events, imported);
      await this.persist();
      this.rerender();
    } catch (error) {
      this.fail(error);
    }
  }

  private async publishAll(): Promise<void> {
    const source = this.sources.find((s) => s.auth.type === "url" && s.mode === "two-way");
    if (!this.options.transport || source?.auth.type !== "url") {
      return;
    }
    try {
      await publish(
        this.options.transport,
        source.auth.url,
        visibleEvents(this.ownEvents(), this.sources),
        this.sourceHeaders(source.auth),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- persistence ---------------------------------------------------------

  private async persist(): Promise<void> {
    // Hand reminder-bearing events to the platform background scheduler (seam).
    this.options.onScheduleReminders?.(
      this.ownEvents().filter((e) => typeof e.reminderMinutes === "number"),
    );
    // Keep working state (events + to-dos + calendars) durable across reopen.
    this.persistState();
    try {
      await this.client.saveDocument({
        bundle_id: this.options.bundleId,
        doc_type: "calendar",
        content_base64: encodeIcs(this.ownEvents()),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  // ---- working-state persistence (events, to-dos, named calendars, C6) -----

  private stateStore(): Pick<PreferenceStorage, "getItem" | "setItem"> | null {
    if (this.options.stateStorage) {
      return this.options.stateStorage; // vault-backed when the shell injects it
    }
    try {
      return typeof globalThis !== "undefined" && globalThis.localStorage
        ? globalThis.localStorage
        : null;
    } catch {
      return null;
    }
  }

  /** Save created events, to-dos, and named calendars so they survive reopen. */
  private persistState(): void {
    const store = this.stateStore();
    if (!store) {
      return;
    }
    try {
      store.setItem(
        `hb-calendar-state:${this.options.bundleId}`,
        JSON.stringify({ events: this.ownEvents(), todos: this.todos, calendars: this.calendars }),
      );
    } catch {
      /* storage full or unavailable; the in-session state still works */
    }
  }

  /** Restore previously-saved events, to-dos, and named calendars. */
  private loadState(): void {
    const store = this.stateStore();
    if (!store) {
      return;
    }
    try {
      const raw = store.getItem(`hb-calendar-state:${this.options.bundleId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed?.events)) {
        // Keep the read-only Contacts seed; replace our own events with the saved set.
        this.events = [...this.events.filter((e) => e.source === "contacts"), ...parsed.events];
      }
      if (Array.isArray(parsed?.todos)) {
        this.todos = parsed.todos;
      }
      if (Array.isArray(parsed?.calendars) && parsed.calendars.length > 0) {
        this.calendars = parsed.calendars;
      }
    } catch {
      /* corrupt entry; fall back to defaults */
    }
  }

  /** Send the current calendar (as .ics) into a chosen Bundle (Portfolio S7). */
  private addToBundle(): void {
    this.options.onAddToBundle?.({
      docType: "calendar",
      title: "Calendar",
      contentBase64: encodeIcs(this.ownEvents()),
    });
  }

  private fail(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error.message : String(error));
  }
}

// ---- helpers ----------------------------------------------------------------

function encodeIcs(events: CalEvent[]): string {
  const bytes = new TextEncoder().encode(toIcs(events));
  return btoa(String.fromCharCode(...bytes));
}

function formatWhen(event: CalEvent): string {
  if (event.allDay) return `${event.start} · all day`;
  return `${event.start.slice(0, 10)} ${event.start.slice(11, 16)}`;
}

/** A friendly "when" for a proposed event, for the Ember confirmation bubble. */
function describeProposal(proposal: ProposedEvent): string {
  const date = proposal.start.slice(0, 10);
  return proposal.allDay ? `all day on ${date}` : `${date} at ${proposal.start.slice(11, 16)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ymd(key: string): { y: number; m: number; d: number } {
  const parts = key.split("-");
  return { y: Number(parts[0] ?? 0), m: Number(parts[1] ?? 1), d: Number(parts[2] ?? 1) };
}

function palette(index: number): string {
  return PALETTE[index % PALETTE.length] ?? "#E8761A";
}

function modalBackdrop(onOutside: () => void): HTMLElement {
  const overlay = el("div", { class: "hb-modal__backdrop hb-cal__modal" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) onOutside();
  });
  return overlay;
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "hb-cal__field" });
  wrap.append(el("span", { class: "hb-cal__field-label" }, label), control);
  return wrap;
}

function tab(label: string, selected: boolean, onClick: () => void): HTMLElement {
  const node = el(
    "button",
    { class: cls.tab, type: "button", "aria-selected": String(selected) },
    label,
  );
  node.addEventListener("click", onClick);
  return node;
}

function button(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.button, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function primary(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.buttonPrimary, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}

function iconBtn(glyph: string, label: string, onClick: () => void): HTMLElement {
  const node = el(
    "button",
    { class: `${cls.button} hb-cal__iconbtn`, type: "button", "aria-label": label, title: label },
    glyph,
  );
  node.addEventListener("click", onClick);
  return node;
}

/** A small inline status chip (e.g. the "Not E2E" badge), with a tooltip. */
function chip(label: string, title: string): HTMLElement {
  return el("span", { class: "hb-cal__e2e-chip", title }, label);
}

/** Escape text for safe interpolation into an innerHTML string. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
