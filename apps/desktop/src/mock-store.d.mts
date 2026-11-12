// Type declarations for the pure mock store (mock-store.mjs).

export interface MockField {
  id: string;
  name: string;
  datatype: string;
}
export interface MockRow {
  id: string;
  values: unknown;
}
export interface MockTableSummary {
  id: string;
  name: string;
}
export interface MockDocument {
  id: string;
  doc_type: string;
  title?: string;
}

export interface MockStore {
  createTable(bundleId: string, name: string): string;
  addField(tableId: string, name: string, datatype: string): string;
  listFields(tableId: string): MockField[];
  listTables(bundleId: string): MockTableSummary[];
  insertRow(tableId: string, values: unknown): string;
  updateRow(rowId: string, values: unknown): string;
  deleteRow(rowId: string): null;
  queryRows(tableId: string): MockRow[];
  saveDocument(bundleId: string, docType: string, title?: string, content?: string): MockDocument;
  listDocuments(bundleId: string): MockDocument[];
  getDocument(id: string): { content_base64: string };
  reorderDocuments(bundleId: string, orderedIds: string[]): null;
  setPreference(key: string, value: string): null;
  getPreference(key: string): string | null;
  listPreferences(): Array<{ key: string; value: string }>;
}

export function createMockStore(seed?: {
  tables?: Array<{ id?: string; bundleId: string; name: string }>;
}): MockStore;
