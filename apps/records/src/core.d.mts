// Type declarations for the pure Records core (core.mjs).

export type FieldType =
  | "text"
  | "email"
  | "select"
  | "status"
  | "relation"
  | "number"
  | "date"
  | "time"
  | "bool"
  | "formula"
  | "auto";
export const FIELD_TYPES: FieldType[];
export const FIELD_TYPE_LABELS: Record<FieldType, string>;
export const COMPUTED_TYPES: FieldType[];

export interface FieldDef {
  name: string;
  datatype: FieldType;
  /** A literal starting value for new records. */
  default?: unknown;
  /** For formula fields: the expression (e.g. "[Price]*[Qty]"). */
  formula?: string;
  /** Whether the field is hidden from views. */
  hidden?: boolean;
}

export type Row = Record<string, unknown>;

export interface ValidateResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}
export function validateValue(type: FieldType, raw: unknown): ValidateResult;
export function validateRow(
  fields: FieldDef[],
  values: Row,
): { ok: boolean; values: Row; errors: Record<string, string> };

// ---- defaults, auto-number, formulas ---------------------------------------
export function applyDefaults(fields: FieldDef[], seed?: Row): Row;
export function nextAutoIncrement(rows: Row[], fieldName: string, start?: number): number;
export function computeRow(fields: FieldDef[], row: Row): Row;
export function evalFormula(formula: string, row: Row): unknown;
export function fieldRefs(formula: string): string[];

// ---- relations / lookups ---------------------------------------------------
export interface Relation {
  fromField: string;
  toKey: string;
  lookupField?: string;
}
export function resolveLookup(row: Row, relation: Relation, toRows: Row[]): unknown;
export function applyLookup(rows: Row[], relation: Relation, toRows: Row[], asField: string): Row[];

// ---- reports ----------------------------------------------------------------
export type FilterOp = "eq" | "neq" | "gt" | "lt" | "contains";
export interface ReportDef {
  fields: string[];
  filter?: { field: string; op: FilterOp; value: unknown };
  sort?: { field: string; dir?: "asc" | "desc" };
}
export function runReport(rows: Row[], def: ReportDef): Row[];
export function reportToMergeRecords(reportRows: Row[]): Row[];

// ---- rich reports (ReportCreator heir) -------------------------------------
export type ReportAgg = "sum" | "count" | "average" | "min" | "max" | "stddev" | "variance";
export interface ReportAggInfo {
  id: ReportAgg;
  label: string;
}
export const REPORT_AGGS: ReportAggInfo[];
export function aggregateValues(values: unknown[], agg: ReportAgg): number;

export interface ReportSummaryDef {
  field: string;
  agg: ReportAgg;
}
export interface ReportSpec {
  title?: string;
  columns?: string[];
  groupBy?: string | null;
  summaries?: ReportSummaryDef[];
  filter?: FilterSet | null;
  sort?: SortKey[];
}
export interface ReportSummary {
  field: string;
  agg: ReportAgg;
  label: string;
  value: number;
}
export interface ReportGroup {
  key: string;
  rows: Row[];
  summaries: ReportSummary[];
}
export interface Report {
  title: string;
  columns: string[];
  summaryDefs: ReportSummaryDef[];
  grouped: boolean;
  groupBy: string | null;
  groups: ReportGroup[] | null;
  rows: Row[] | null;
  grand: ReportSummary[];
  count: number;
}
export function buildReport(rows: Row[], spec: ReportSpec, fields?: FieldDef[]): Report;
export function reportToText(report: Report): string;
export function reportMergeRecords(report: Report): Array<Record<string, string>>;
export function inferReportSpec(phrase: string, fields: FieldDef[]): ReportSpec;
export function buildReportRequest(
  naturalLanguage: string,
  tableSummary: string,
  effort?: "fast" | "balanced" | "thorough",
): EmberQuery;

// ---- saved filters, human operators ----------------------------------------
export interface FilterOpInfo {
  id: string;
  label: string;
  types: FieldType[];
  nullary?: boolean;
}
export const FILTER_OPS: FilterOpInfo[];
export function opsForType(type: FieldType): FilterOpInfo[];
export function matchCondition(
  value: unknown,
  op: string,
  target: unknown,
  type?: FieldType,
): boolean;

export interface FilterCondition {
  field: string;
  op: string;
  value?: unknown;
}
export interface FilterSet {
  name?: string;
  match: "all" | "any";
  conditions: FilterCondition[];
}
export function applyFilterSet(rows: Row[], set: FilterSet, fields?: FieldDef[]): Row[];

// ---- multi-key sort, find ---------------------------------------------------
export interface SortKey {
  field: string;
  dir?: "asc" | "desc";
}
export function sortRows(rows: Row[], sortKeys: SortKey[]): Row[];
export function findRows(rows: Row[], query: string): Row[];

// ---- delimited import/export ------------------------------------------------
export function parseCsv(text: string): { header: string[]; rows: string[][] };
export function parseDelimited(
  text: string,
  delimiter?: string,
): { header: string[]; rows: string[][] };
export function toDelimited(fields: FieldDef[], rows: Row[], delimiter?: string): string;
export function inferSchema(header: string[], rows: string[][]): FieldDef[];

// ---- Ember requests ---------------------------------------------------------
export interface EmberQuery {
  task: "query";
  document: string;
  request: string;
  effort: "fast" | "balanced" | "thorough";
}
export function buildQueryRequest(
  naturalLanguage: string,
  tableSummary: string,
  effort?: "fast" | "balanced" | "thorough",
): EmberQuery;
export function buildImportRequest(csvSample: string): EmberQuery;
