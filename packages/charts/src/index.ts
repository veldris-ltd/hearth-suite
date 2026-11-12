/**
 * Hearth Suite charts, first-class, named chart objects shared by Sheets and Writer.
 *
 * A {@link ChartSpec} (bar, line, pie, area, scatter, and stacked variants) is
 * pure data; {@link renderChartSvg} turns it into a self-contained, on-brand SVG
 * string that Sheets renders live and Writer embeds and keeps live-linked to its
 * source. {@link suggestChartType} is the same local heuristic Ember uses to
 * propose a sensible default from a selection. No DOM, no network.
 */

export {
  CHART_TYPES,
  extractChartData,
  suggestChartType,
  suggestChartReason,
  makeChartSpec,
  renderChartSvg,
} from "./charts.mjs";
export type {
  ChartType,
  ChartSeries,
  ChartSource,
  ChartSpec,
  ChartData,
  ChartTypeInfo,
} from "./charts.mjs";
