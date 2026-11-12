// Type declarations for the pure legacy-import core (legacy.mjs).

import type { ChartSpec } from "@hearth/charts";

// ---- import report ---------------------------------------------------------
export type Severity = "info" | "degraded" | "lost";
export interface ReportItem {
  severity: Severity;
  area: string;
  detail: string;
}
export interface ImportReport {
  format: string;
  ok: boolean;
  items: ReportItem[];
}
export const SEVERITIES: Severity[];
export function summarizeReport(report: ImportReport): string;
export function formatImportReport(report: ImportReport): string;

// ---- native output shapes (structurally match the editors' models) --------
export interface LegacySpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  color?: string;
  font?: string;
  size?: string;
  href?: string;
}
export type LegacyBlock =
  | { kind: "heading"; level: number; spans: LegacySpan[] }
  | { kind: "paragraph"; style?: string; spans: LegacySpan[] }
  | { kind: "table"; rows: LegacySpan[][][] };
export interface LegacyWriterDoc {
  title: string;
  blocks: LegacyBlock[];
}
export interface LegacyFieldDef {
  name: string;
  datatype: "text" | "number" | "date" | "time" | "bool" | "formula" | "auto";
  formula?: string;
  default?: unknown;
}
export interface LegacyFilterSet {
  name?: string;
  match: "all" | "any";
  conditions: Array<{ field: string; op: string; value?: unknown }>;
}
export interface LegacyReportSpec {
  title?: string;
  groupBy?: string | null;
  summaries?: Array<{ field: string; agg: string }>;
  columns?: string[];
  filter?: unknown;
  sort?: unknown[];
}

// ---- libwps intermediate representations (FFI decode output) --------------
export interface WpsRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  color?: string;
  font?: string;
  size?: string;
}
export interface WpsBlock {
  kind?: "paragraph" | "heading" | "table";
  level?: number;
  style?: string;
  runs?: WpsRun[];
  rows?: Array<Array<{ runs?: WpsRun[]; text?: string }>>;
  footnotes?: Array<{ text: string }>;
}
export interface WpsIr {
  title?: string;
  blocks?: WpsBlock[];
  header?: string;
  footer?: string;
  unsupported?: Array<{ kind?: string; detail?: string }>;
  error?: string;
}

export interface WksIr {
  name?: string;
  cells?: Array<{ ref: string; value?: unknown; formula?: string }>;
  names?: Array<{ name: string; range: string }>;
  charts?: Array<{
    type?: string;
    title?: string;
    dataRange?: string;
    rasterised?: boolean;
    categories?: string[];
    series?: Array<{ name?: string; values: number[] }>;
    data?: { categories: string[]; series: Array<{ name: string; values: number[] }> };
  }>;
  unsupported?: Array<{ kind?: string; detail?: string }>;
  error?: string;
}

export interface WdbIr {
  name?: string;
  fields?: Array<{ name: string; type?: string; formula?: string; default?: unknown }>;
  rows?: Array<Record<string, unknown>>;
  filters?: Array<{
    name?: string;
    match?: string;
    conditions?: Array<{ field: string; op: string; value?: unknown }>;
  }>;
  reports?: Array<{
    name?: string;
    title?: string;
    groupBy?: string;
    summaries?: Array<{ field: string; agg: string }>;
    columns?: string[];
  }>;
  filtersUnavailable?: number;
  reportsUnavailable?: number;
  unsupported?: Array<{ kind?: string; detail?: string }>;
  error?: string;
}

// ---- translators -----------------------------------------------------------
export interface WpsResult {
  doc: LegacyWriterDoc;
  footnotes: Array<{ id: number; text: string }>;
  headerText?: string;
  footerText?: string;
  report: ImportReport;
}
export function translateWps(ir: WpsIr): WpsResult;

export interface WksResult {
  name: string;
  cells: Record<string, string>;
  names: Array<{ name: string; range: string }>;
  charts: ChartSpec[];
  report: ImportReport;
}
export function translateWks(ir: WksIr, supported?: Set<string>): WksResult;

export interface WdbResult {
  name: string;
  fields: LegacyFieldDef[];
  rows: Array<Record<string, unknown>>;
  filters: LegacyFilterSet[];
  reports: LegacyReportSpec[];
  report: ImportReport;
}
export function translateWdb(ir: WdbIr): WdbResult;

export type LegacyResult =
  | (Partial<WpsResult> & { report: ImportReport })
  | (Partial<WksResult> & { report: ImportReport })
  | (Partial<WdbResult> & { report: ImportReport });
export function importLegacy(format: string, ir: WpsIr | WksIr | WdbIr): LegacyResult;

export interface LegacyFormat {
  id: "wps" | "wks" | "wdb";
  label: string;
  module: "writer" | "sheets" | "records";
}
export const LEGACY_FORMATS: LegacyFormat[];
