// A pure, in-memory store backing the preview MockTransport. Extracting it as
// plain logic (no DOM, no Transport plumbing) lets a node --test contract suite
// assert exactly the behaviour the UI relies on, the same contract the real
// Tauri/Rust core must honour. Never shipped.

/**
 * Create an in-memory records/documents store.
 * @param {object} [seed]
 * @param {Array<{id?: string, bundleId: string, name: string}>} [seed.tables]
 */
export function createMockStore(seed = {}) {
  /** @type {Map<string, {name: string, bundleId: string, fields: Array<{id:string,name:string,datatype:string}>, rows: Array<{id:string, values:unknown}>}>} */
  const tables = new Map();
  /** @type {Map<string, Array<{id:string, doc_type:string}>>} */
  const docs = new Map();
  /** @type {Map<string, string>} preference key -> UTF-8 value */
  const prefs = new Map();
  let seq = 0;
  const nextId = (prefix) => {
    seq += 1;
    return `${prefix}${seq}`;
  };

  const store = {
    createTable(bundleId, name) {
      const id = nextId("t");
      tables.set(id, { name, bundleId, fields: [], rows: [] });
      return id;
    },
    addField(tableId, name, datatype) {
      const id = nextId("f");
      const table = tables.get(tableId);
      if (table) {
        table.fields.push({ id, name, datatype });
      }
      return id;
    },
    listFields(tableId) {
      return (tables.get(tableId)?.fields ?? []).map((f) => ({ ...f }));
    },
    listTables(bundleId) {
      const out = [];
      for (const [id, table] of tables) {
        if (table.bundleId === bundleId) {
          out.push({ id, name: table.name });
        }
      }
      return out;
    },
    insertRow(tableId, values) {
      const id = nextId("r");
      const table = tables.get(tableId);
      if (table) {
        table.rows.push({ id, values });
      }
      return id;
    },
    updateRow(rowId, values) {
      for (const table of tables.values()) {
        const row = table.rows.find((r) => r.id === rowId);
        if (row) {
          row.values = values;
          return rowId;
        }
      }
      return rowId;
    },
    deleteRow(rowId) {
      for (const table of tables.values()) {
        const i = table.rows.findIndex((r) => r.id === rowId);
        if (i >= 0) {
          table.rows.splice(i, 1);
          return null;
        }
      }
      return null;
    },
    queryRows(tableId) {
      return (tables.get(tableId)?.rows ?? []).map((r) => ({ id: r.id, values: r.values }));
    },
    saveDocument(bundleId, docType, title = "", content = "") {
      const id = nextId("d");
      const list = docs.get(bundleId) ?? [];
      list.push({ id, doc_type: docType, title, content });
      docs.set(bundleId, list);
      return { id, doc_type: docType, title };
    },
    listDocuments(bundleId) {
      return (docs.get(bundleId) ?? []).map((d) => ({
        id: d.id,
        doc_type: d.doc_type,
        title: d.title,
      }));
    },
    getDocument(id) {
      for (const list of docs.values()) {
        const found = list.find((d) => d.id === id);
        if (found) return { content_base64: found.content ?? "" };
      }
      return { content_base64: "" };
    },
    reorderDocuments(bundleId, orderedIds) {
      const list = docs.get(bundleId);
      if (!list) return null;
      const byId = new Map(list.map((d) => [d.id, d]));
      const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      // Keep any documents not named in the order (defensive).
      for (const d of list) {
        if (!orderedIds.includes(d.id)) reordered.push(d);
      }
      docs.set(bundleId, reordered);
      return null;
    },
    setPreference(key, value) {
      prefs.set(key, value);
      return null;
    },
    getPreference(key) {
      return prefs.has(key) ? prefs.get(key) : null;
    },
    listPreferences() {
      return [...prefs.entries()].map(([key, value]) => ({ key, value }));
    },
  };

  for (const t of seed.tables ?? []) {
    const id = store.createTable(t.bundleId, t.name);
    void (t.id && id);
  }
  return store;
}
