// Hearth Suite help, task-oriented, plain-language help that works offline.
//
// In the Works spirit: no videos, no account, no network. A small corpus of
// "how do I…" tasks, short per-module first-time coach tips (dismissed forever
// in one tap), a local search, and an Ember request builder that answers
// questions FROM this corpus (the model only ever sees these local strings).
// Pure data + functions, unit-tested directly.

/**
 * The help corpus: each topic is a task ("how do I…"), answered in plain
 * language. `module` groups it (writer/sheets/records/calendar/general);
 * `keywords` widen search beyond the title.
 */
export const HELP_TOPICS = [
  // Writer
  {
    id: "w-letter",
    module: "writer",
    task: "Write a letter or document",
    answer:
      "Open Writer from the rail, type in the page, and it saves on your device as you go. Use the menu bar for commands and the ribbon below it for formatting.",
    keywords: ["letter", "document", "write", "type"],
  },
  {
    id: "w-format",
    module: "writer",
    task: "Make text bold, change font or size",
    answer:
      "Select the text, then use the ribbon: B for bold, I for italic, and the Font and Size menus. The colour swatch sets text colour.",
    keywords: ["bold", "italic", "font", "size", "colour", "format"],
  },
  {
    id: "w-chart",
    module: "writer",
    task: "Put a chart in a document",
    answer:
      "Insert ▸ Chart… Paste rows of data or link a sheet range; the chart embeds and can be refreshed from its source.",
    keywords: ["chart", "graph", "insert"],
  },
  {
    id: "w-merge",
    module: "writer",
    task: "Send the same letter to many people (mail merge)",
    answer:
      "Mailings ▸ Mail merge letters… Pick a data source (Contacts or a Records table), insert {{fields}} in the letter, then create or print the set. Envelopes and Labels are there too.",
    keywords: ["mail merge", "letters", "envelopes", "labels", "fields"],
  },
  {
    id: "w-export",
    module: "writer",
    task: "Print or export a document",
    answer: "File ▸ Print preview… to print or save as PDF, or File ▸ Export as ODF / Word / PDF.",
    keywords: ["print", "export", "pdf", "odf", "word"],
  },

  // Sheets
  {
    id: "s-sum",
    module: "sheets",
    task: "Total a column",
    answer:
      "Click the cell below your numbers and press Σ (AutoSum), or type =SUM(A1:A9). The total updates as you edit.",
    keywords: ["sum", "total", "add", "autosum"],
  },
  {
    id: "s-formula",
    module: "sheets",
    task: "Write a formula",
    answer:
      "Start a cell with = , e.g. =A1*B1. Stuck? Press ƒx Helper and it walks you through choosing and filling a function.",
    keywords: ["formula", "function", "calculate", "fx"],
  },
  {
    id: "s-chart",
    module: "sheets",
    task: "Make a chart from data",
    answer:
      "Select nothing, just press New chart. Hearth Suite proposes a sensible chart type from your data; change it or let Ember choose.",
    keywords: ["chart", "graph", "bar", "line", "pie"],
  },
  {
    id: "s-money",
    module: "sheets",
    task: "Show numbers as money or percent",
    answer:
      "Select the cell, then pick a format from the Number format menu, Money £/$/€, Percent, Date, and more.",
    keywords: ["money", "currency", "percent", "format", "number"],
  },
  {
    id: "s-sheets",
    module: "sheets",
    task: "Use more than one sheet",
    answer:
      "Press the + tab to add a sheet. Refer across sheets with Sheet2!A1. New books start with one sheet so it stays simple.",
    keywords: ["sheets", "tabs", "workbook", "multiple"],
  },

  // Records
  {
    id: "r-add",
    module: "records",
    task: "Add a record or a field",
    answer:
      "Form view shows one record at a time, use ◀ ▶ to page and New record to add one. Add field lets you pick a type (text, number, date, formula, auto-number).",
    keywords: ["record", "field", "add", "form", "navigate"],
  },
  {
    id: "r-formula",
    module: "records",
    task: "Calculate a field from others",
    answer:
      "Add a field of type Formula and write e.g. [Price]*[Qty]. It recalculates for every record.",
    keywords: ["formula", "calculate", "field"],
  },
  {
    id: "r-filter",
    module: "records",
    task: "Find or filter records",
    answer:
      'Use the Find box for a quick search, or Filter to build conditions in plain words ("is after", "is greater than") and save them by name.',
    keywords: ["filter", "find", "search", "condition", "sort"],
  },
  {
    id: "r-report",
    module: "records",
    task: "Total or group records (a report)",
    answer:
      "Press Report, say what to total and how to group it (or describe it in a line), then print, copy, or send it to a letter as a merge source.",
    keywords: ["report", "total", "group", "summary"],
  },
  {
    id: "r-import",
    module: "records",
    task: "Import a spreadsheet or CSV",
    answer: "Import ▸ paste your delimited data; field names and types are inferred automatically.",
    keywords: ["import", "csv", "spreadsheet", "delimited"],
  },

  // Calendar
  {
    id: "c-add",
    module: "calendar",
    task: "Add an appointment",
    answer:
      "Press New event, or double-click a day or hour. Set a time or mark it all-day, choose a calendar, and add a reminder.",
    keywords: ["event", "appointment", "add", "all-day"],
  },
  {
    id: "c-repeat",
    module: "calendar",
    task: "Make an event repeat",
    answer:
      "In the event, set Repeat to every day/week/month/year. Birthdays from Contacts repeat yearly on their own calendar.",
    keywords: ["repeat", "recurring", "recurrence", "weekly", "birthday"],
  },
  {
    id: "c-todo",
    module: "calendar",
    task: "Keep a to-do list",
    answer:
      "The To-do panel on the right takes tasks with optional due dates; tick them off when done.",
    keywords: ["todo", "task", "due", "done"],
  },
  {
    id: "c-overlay",
    module: "calendar",
    task: "Show several calendars together",
    answer:
      "Add named calendars on the right, each with a colour, and toggle them on or off to overlay them in one view.",
    keywords: ["calendars", "overlay", "colour", "toggle"],
  },
  {
    id: "c-ics",
    module: "calendar",
    task: "Import or export a calendar (.ics)",
    answer: "Import to paste an .ics file, or Export to copy or download your calendar as .ics.",
    keywords: ["ics", "import", "export", "icalendar"],
  },

  // General
  {
    id: "g-seal",
    module: "general",
    task: "Keep something private (Seal)",
    answer:
      "Sealing encrypts a Bundle end-to-end so only you (and anyone you choose) can open it. Open a Bundle's contents and press Seal Bundle.",
    keywords: ["seal", "encrypt", "private", "security"],
  },
  {
    id: "g-bundle",
    module: "general",
    task: "Collect documents into a Bundle",
    answer:
      "From any document choose Add to Bundle… to send it into a project Bundle. Open a Bundle to see its contents and drag to reorder them.",
    keywords: ["bundle", "portfolio", "collect", "project"],
  },
  {
    id: "g-search",
    module: "general",
    task: "Find anything quickly",
    answer:
      "Press Ctrl-K (⌘K on Mac) anywhere to open search across your documents, sheets, records and events.",
    keywords: ["search", "find", "command", "palette"],
  },
  {
    id: "g-offline",
    module: "general",
    task: "Does this work offline / need an account?",
    answer:
      "Everything works offline with no account. Your data and the Ember assistant run on this device; nothing is uploaded unless you choose to share.",
    keywords: ["offline", "account", "private", "local", "ember"],
  },
];

/** Short, per-module first-time coach tips (shown once, dismissed forever). */
export const COACH = {
  writer: {
    title: "Welcome to Writer",
    lead: "A calm place to write. A few things to know:",
    tips: [
      "The menu bar (File · Edit · Insert · Mailings · …) holds every command; the ribbon below is just formatting.",
      "Ember on the right can draft, rewrite, summarise, or answer questions about your document.",
      "It saves on this device as you type, there's nothing to set up.",
    ],
  },
  sheets: {
    title: "Welcome to Sheets",
    lead: "Numbers made simple:",
    tips: [
      "Total a column with Σ AutoSum, or start any cell with = for a formula.",
      "New chart turns a range into a graph; the ƒx Helper walks you through functions.",
      "Add more sheets with the + tab when you need them.",
    ],
  },
  records: {
    title: "Welcome to Records",
    lead: "A flat, friendly database, no SQL:",
    tips: [
      "Form view shows one record; page with ◀ ▶ or switch to the List.",
      "Add fields of any type, text, number, date, even a Formula.",
      "Filter and Report turn your records into answers.",
    ],
  },
  calendar: {
    title: "Welcome to Calendar",
    lead: "Your time, on your device:",
    tips: [
      "Switch Day · Week · Month at the top; double-click a day to add an event.",
      "Toggle named calendars on the right to overlay them, each in its own colour.",
      "Reminders fire locally, no cloud needed.",
    ],
  },
};

const COACH_PREFIX = "hb-coach:";

function resolveStore(storage) {
  if (storage) return storage;
  return typeof globalThis !== "undefined" && globalThis.localStorage
    ? globalThis.localStorage
    : null;
}

/** Whether a module's first-time coach panel has been dismissed forever. */
export function coachDismissed(module, storage) {
  const store = resolveStore(storage);
  try {
    return store ? store.getItem(COACH_PREFIX + module) === "1" : false;
  } catch {
    return false;
  }
}

/** Dismiss a module's coach panel forever (one tap). */
export function dismissCoach(module, storage) {
  const store = resolveStore(storage);
  try {
    store?.setItem(COACH_PREFIX + module, "1");
  } catch {
    /* storage unavailable, the panel simply reappears next time */
  }
}

/** The coach content for a module (or null if none). */
export function coachFor(module) {
  return COACH[module] ?? null;
}

/** Help topics for a module (general topics always included). */
export function helpForModule(module, topics = HELP_TOPICS) {
  return topics.filter((t) => t.module === module || t.module === "general");
}

/**
 * Search the help corpus. Ranks by where the query lands (task title > keywords
 * > answer) and how many words match. Returns topics best-first; an empty query
 * returns all topics in corpus order.
 */
export function searchHelp(query, topics = HELP_TOPICS) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (q === "") {
    return topics.slice();
  }
  const words = q.split(/\s+/);
  const scored = [];
  for (const topic of topics) {
    const task = topic.task.toLowerCase();
    const keywords = (topic.keywords ?? []).join(" ").toLowerCase();
    const answer = topic.answer.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (task.includes(word)) score += 5;
      if (keywords.includes(word)) score += 3;
      if (answer.includes(word)) score += 1;
    }
    if (task.includes(q)) score += 4;
    if (score > 0) scored.push({ topic, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.topic);
}

/**
 * Build a local Ember request that answers a "how do I…" question FROM the help
 * corpus. The corpus is the only context the model sees; nothing leaves the
 * device. We pass the most relevant topics first so a small model stays on task.
 */
export function buildHelpRequest(question, topics = HELP_TOPICS, effort = "balanced") {
  const relevant = searchHelp(question, topics);
  const chosen = (relevant.length > 0 ? relevant : topics).slice(0, 8);
  const corpus = chosen.map((t) => `Q: ${t.task}\nA: ${t.answer}`).join("\n\n");
  return {
    task: "query",
    document: `Hearth Suite help topics:\n\n${corpus}`,
    request: `Using only the help topics above, answer in plain language: ${question}`,
    effort,
  };
}
