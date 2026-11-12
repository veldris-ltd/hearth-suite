// Type declarations for the pure Sheets core (core.mjs).

/** A computed cell value. */
export type CellValue = number | string | boolean | null;

/** A spreadsheet with cells and named ranges. */
export class Sheet {
  cells: Map<string, string>;
  names: Map<string, string>;
  workbook?: Workbook;
  name: string;
  setCell(ref: string, raw: string): this;
  setName(name: string, target: string): this;
  valueOf(ref: string, visiting?: Set<string>): CellValue;
  evaluate(body: string, visiting?: Set<string>): CellValue;
  recalc(): Record<string, CellValue>;
  spliceLines(axis: "row" | "col", at: number, delta: number): this;
  insertRow(at: number, count?: number): this;
  deleteRow(at: number, count?: number): this;
  insertColumn(at: number, count?: number): this;
  deleteColumn(at: number, count?: number): this;
}

/** An ordered collection of named sheets with cross-sheet references. */
export class Workbook {
  order: string[];
  sheets: Map<string, Sheet>;
  addSheet(name: string): Sheet;
  sheet(name: string): Sheet | undefined;
  names(): string[];
  renameSheet(oldName: string, newName: string): void;
  removeSheet(name: string): void;
}

export const ERR_DIV0: string;
export const ERR_NAME: string;
export const ERR_VALUE: string;
export const ERR_CYCLE: string;
export const ERR_NA: string;
export const ERR_NUM: string;
export const ERR_REF: string;
export function adjustFormulaBody(
  body: string,
  axis: "row" | "col",
  at: number,
  delta: number,
  names?: Set<string> | string[],
): string;

/** A named cell number format. */
export interface NumberFormat {
  id: string;
  label: string;
}
export const NUMBER_FORMATS: NumberFormat[];
export function formatNumber(
  value: CellValue,
  format?: string,
  opts?: { zipWidth?: number },
): string;

/** Extend a seed of cell values by `count` more (linear/date/text/copy). */
export function fillSeries(seed: CellValue[], count: number): CellValue[];

/** Cells a drag-fill from `fromRef` to `toRef` writes (seed excluded). */
export function fillRangeRefs(fromRef: string, toRef: string): string[];

/** Build the AutoSum formula for a target cell from a value reader. */
export function autoSumFormula(getValue: (ref: string) => CellValue, ref: string): string;

/** A Formula Helper catalogue entry. */
export interface CatalogFunction {
  name: string;
  signature: string;
  summary: string;
  args: string[];
}
export interface CatalogCategory {
  category: string;
  functions: CatalogFunction[];
}
export const FUNCTION_CATALOG: CatalogCategory[];
export const FUNCTION_NAMES: string[];

export interface PivotResult {
  group: string;
  value: number;
}
export function pivot(
  rows: Array<Record<string, unknown>>,
  groupBy: string,
  valueField: string,
  agg?: "sum" | "avg" | "count" | "min" | "max",
): PivotResult[];

export type ChartType = "none" | "pie" | "bar" | "line";
export function suggestChart(rows: Array<[string, number]>): ChartType;

export function explainFormula(formula: string): string;

export interface FormulaRequest {
  task: "formula";
  document: string;
  request: string;
  effort: "fast" | "balanced" | "thorough";
}
export function buildFormulaRequest(
  naturalLanguage: string,
  selection?: string,
  effort?: "fast" | "balanced" | "thorough",
): FormulaRequest;

export type SheetCell =
  | { kind: "empty" }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string };
export interface SpreadsheetModel {
  sheets: Array<{ name: string; rows: Array<{ cells: SheetCell[] }> }>;
}
export function toSpreadsheetModel(name: string, grid: CellValue[][]): SpreadsheetModel;

export interface RecordsField {
  name: string;
  datatype: string;
}
export interface RecordsTable {
  name: string;
  fields: RecordsField[];
  rows: Array<Record<string, unknown>>;
}
export function dataTableToRecords(
  name: string,
  header: string[],
  dataRows: unknown[][],
): RecordsTable;
export function recordsToDataTable(records: RecordsTable): {
  header: string[];
  dataRows: unknown[][];
};
