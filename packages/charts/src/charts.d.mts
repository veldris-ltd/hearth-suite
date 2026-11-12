// Type declarations for the pure charts core (charts.mjs).

/** The supported chart types. */
export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "stacked-bar"
  | "stacked-area";

/** A named data series. */
export interface ChartSeries {
  name: string;
  values: number[];
}

/** Where a chart's data came from (for live-linked embeds). */
export interface ChartSource {
  kind: "sheet" | "inline";
  bundleId?: string;
  sheet?: string;
  range?: string;
  label?: string;
}

/** A first-class, named chart object. */
export interface ChartSpec {
  id: string;
  title: string;
  type: ChartType;
  categories: string[];
  series: ChartSeries[];
  source?: ChartSource;
}

/** Extracted, chart-ready data. */
export interface ChartData {
  categories: string[];
  series: ChartSeries[];
}

export interface ChartTypeInfo {
  id: ChartType;
  label: string;
  multi: boolean;
  summary: string;
}

export const CHART_TYPES: ChartTypeInfo[];

export type CellValue = number | string | boolean | null;

export function extractChartData(grid: CellValue[][], opts?: { hasHeader?: boolean }): ChartData;
export function suggestChartType(grid: CellValue[][], opts?: { hasHeader?: boolean }): ChartType;
export function suggestChartReason(type: ChartType): string;
export function makeChartSpec(input: {
  id?: string;
  title?: string;
  type?: ChartType;
  grid?: CellValue[][];
  data?: ChartData;
  source?: ChartSource;
  hasHeader?: boolean;
}): ChartSpec;
export function renderChartSvg(spec: ChartSpec, opts?: { width?: number; height?: number }): string;
