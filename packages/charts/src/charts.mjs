// Hearth Suite charts: a pure, framework-agnostic charting core. A ChartSpec is a
// first-class named object (bar, line, pie, area, scatter, and stacked
// variants); `renderChartSvg` turns it into a self-contained SVG string that
// both Sheets and Writer embed (Writer keeps it live-linked to its source).
// No DOM, no I/O, unit-tested directly.

/** The chart types Hearth Suite offers, with plain-language guidance. */
export const CHART_TYPES = [
  { id: "bar", label: "Bar", multi: true, summary: "Compare values across categories." },
  { id: "line", label: "Line", multi: true, summary: "Show a trend over time." },
  { id: "area", label: "Area", multi: true, summary: "A trend with filled volume." },
  { id: "pie", label: "Pie", multi: false, summary: "Show parts of a whole." },
  { id: "scatter", label: "Scatter", multi: false, summary: "Relationship between two numbers." },
  { id: "stacked-bar", label: "Stacked bar", multi: true, summary: "Totals broken into parts." },
  {
    id: "stacked-area",
    label: "Stacked area",
    multi: true,
    summary: "A cumulative trend by part.",
  },
];

/** Whether a chart type stacks its series. */
function isStacked(type) {
  return type === "stacked-bar" || type === "stacked-area";
}

/** The brand chart palette (design-system tokens with hex fallbacks). */
const PALETTE = [
  "var(--hb-chart-1, #E8761A)",
  "var(--hb-chart-2, #0F766E)",
  "var(--hb-chart-3, #CA8A04)",
  "var(--hb-chart-4, #4D7C0F)",
  "var(--hb-chart-5, #9C4413)",
  "var(--hb-chart-6, #A8456B)",
];

function color(i) {
  return PALETTE[i % PALETTE.length];
}

function num(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function isNumeric(value) {
  return value !== null && value !== "" && !Number.isNaN(Number(value));
}

function escapeXml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

// ---- data extraction --------------------------------------------------------

/** Heuristic: does the first row look like a header (labels over numeric data)? */
function inferHeader(rows) {
  if (rows.length < 2) return false;
  const first = rows[0];
  const second = rows[1];
  const firstNumeric = first.slice(1).some(isNumeric);
  const secondNumeric = second.slice(1).some(isNumeric);
  return !firstNumeric && secondNumeric;
}

/**
 * Extract chart-ready `{ categories, series }` from a 2-D grid of cell values.
 * The first column is the category axis; each later column is a named series.
 * A single-column grid becomes one series indexed 1..n.
 */
export function extractChartData(grid, opts = {}) {
  const rows = (grid ?? []).filter(
    (r) => Array.isArray(r) && r.some((c) => c !== null && c !== ""),
  );
  if (rows.length === 0) {
    return { categories: [], series: [] };
  }
  const hasHeader = opts.hasHeader ?? inferHeader(rows);
  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const cols = Math.max(...body.map((r) => r.length));
  if (cols <= 1) {
    return {
      categories: body.map((_r, i) => String(i + 1)),
      series: [
        {
          name: header?.[0] != null ? String(header[0]) : "Series 1",
          values: body.map((r) => num(r[0])),
        },
      ],
    };
  }
  const categories = body.map((r) => String(r[0] ?? ""));
  const series = [];
  for (let c = 1; c < cols; c += 1) {
    series.push({
      name: header?.[c] != null ? String(header[c]) : `Series ${c}`,
      values: body.map((r) => num(r[c] ?? 0)),
    });
  }
  return { categories, series };
}

// ---- type suggestion (Ember's local heuristic) -----------------------------

const TIME_RE =
  /\b(19|20)\d\d\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|mon|tue|wed|thu|fri|sat|sun/i;

/**
 * Propose a sensible chart type from a grid (AC-WKS-X8). The same heuristic
 * Ember uses locally: two numeric columns → scatter; time-like categories →
 * line; a single small series → pie; several series → grouped bar; else bar.
 */
export function suggestChartType(grid, opts = {}) {
  const { categories, series } = extractChartData(grid, opts);
  if (series.length === 0 || categories.length === 0) {
    return "bar";
  }
  const categoriesNumeric = categories.every((c) => isNumeric(c));
  if (series.length === 1 && categoriesNumeric && categories.length > 2) {
    return "scatter";
  }
  const timeLike = categories.some((c) => TIME_RE.test(String(c)));
  if (timeLike) {
    return series.length > 1 ? "line" : "line";
  }
  if (series.length === 1 && categories.length <= 6) {
    return "pie";
  }
  return series.length > 1 ? "bar" : "bar";
}

/** A plain-language reason for a suggested type (for the New Chart flow). */
export function suggestChartReason(type) {
  const found = CHART_TYPES.find((t) => t.id === type);
  return found ? found.summary : "Compare your values.";
}

// ---- spec construction ------------------------------------------------------

/** Build a {@link ChartSpec} from a grid, choosing a default type if absent. */
export function makeChartSpec({
  id = "chart",
  title = "Chart",
  type,
  grid,
  data,
  source,
  hasHeader,
} = {}) {
  const extracted = data ?? extractChartData(grid ?? [], { hasHeader });
  const chosen = type ?? suggestChartType(grid ?? [], { hasHeader });
  return {
    id,
    title,
    type: chosen,
    categories: extracted.categories,
    series: extracted.series,
    ...(source ? { source } : {}),
  };
}

// ---- SVG rendering ----------------------------------------------------------

const MARGIN = { top: 30, right: 14, bottom: 26, left: 38 };

function seriesMax(series, stacked, categories) {
  if (stacked) {
    let max = 0;
    for (let i = 0; i < categories.length; i += 1) {
      let sum = 0;
      for (const s of series) sum += Math.max(0, s.values[i] ?? 0);
      max = Math.max(max, sum);
    }
    return max || 1;
  }
  let max = 0;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  return max || 1;
}

/**
 * Render a {@link ChartSpec} to a self-contained SVG string. Deterministic and
 * DOM-free: the same markup renders in Sheets and embeds into Writer. Colours
 * use the `--hb-chart-*` design tokens (with hex fallbacks).
 */
export function renderChartSvg(spec, opts = {}) {
  const width = opts.width ?? 360;
  const height = opts.height ?? 220;
  const categories = spec.categories ?? [];
  const series = spec.series ?? [];
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const x0 = MARGIN.left;
  const y0 = MARGIN.top;
  const baseline = y0 + plotH;

  let body = "";
  if (series.length === 0 || categories.length === 0) {
    body = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="hb-chart__empty" fill="currentColor">No data to chart</text>`;
  } else if (spec.type === "pie") {
    body = renderPie(spec, width, height);
  } else if (spec.type === "scatter") {
    body = renderScatter(spec, x0, y0, plotW, plotH, baseline);
  } else if (spec.type === "line" || spec.type === "area" || spec.type === "stacked-area") {
    body = renderLineArea(spec, x0, y0, plotW, plotH, baseline);
  } else {
    body = renderBars(spec, x0, y0, plotW, plotH, baseline);
  }

  const title = spec.title
    ? `<text x="${width / 2}" y="18" text-anchor="middle" class="hb-chart__title" fill="currentColor">${escapeXml(spec.title)}</text>`
    : "";
  const legend = renderLegend(series, width, height);

  return (
    `<svg class="hb-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `role="img" aria-label="${escapeXml(spec.title || spec.type + " chart")}" xmlns="http://www.w3.org/2000/svg">` +
    title +
    `<line x1="${x0}" y1="${baseline}" x2="${x0 + plotW}" y2="${baseline}" class="hb-chart__axis" stroke="currentColor" stroke-opacity="0.3"/>` +
    body +
    legend +
    `</svg>`
  );
}

function renderBars(spec, x0, y0, plotW, plotH, baseline) {
  const { categories, series } = spec;
  const stacked = isStacked(spec.type);
  const max = seriesMax(series, stacked, categories);
  const group = plotW / categories.length;
  let out = "";
  for (let i = 0; i < categories.length; i += 1) {
    if (stacked) {
      let acc = 0;
      const barW = group * 0.62;
      const bx = x0 + i * group + (group - barW) / 2;
      for (let s = 0; s < series.length; s += 1) {
        const v = Math.max(0, series[s].values[i] ?? 0);
        const h = (v / max) * plotH;
        const by = baseline - acc - h;
        acc += h;
        out += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color(s)}"/>`;
      }
    } else {
      const innerW = group * 0.8;
      const barW = innerW / series.length;
      for (let s = 0; s < series.length; s += 1) {
        const v = series[s].values[i] ?? 0;
        const h = (Math.max(0, v) / max) * plotH;
        const bx = x0 + i * group + (group - innerW) / 2 + s * barW;
        out += `<rect x="${bx.toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${(barW * 0.86).toFixed(1)}" height="${h.toFixed(1)}" fill="${color(s)}"/>`;
      }
    }
    out += axisLabel(categories[i], x0 + i * group + group / 2, baseline + 14);
  }
  return out;
}

function renderLineArea(spec, x0, y0, plotW, plotH, baseline) {
  const { categories, series } = spec;
  const stacked = spec.type === "stacked-area";
  const max = seriesMax(series, stacked, categories);
  const n = categories.length;
  const xAt = (i) => x0 + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => baseline - (Math.max(0, v) / max) * plotH;
  let out = "";
  const accum = new Array(n).fill(0);
  for (let s = 0; s < series.length; s += 1) {
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const v = stacked
        ? (accum[i] += Math.max(0, series[s].values[i] ?? 0))
        : (series[s].values[i] ?? 0);
      pts.push([xAt(i), yAt(v)]);
    }
    if (spec.type === "area" || spec.type === "stacked-area") {
      const d = `M ${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ")} L ${xAt(n - 1).toFixed(1)},${baseline} L ${xAt(0).toFixed(1)},${baseline} Z`;
      out += `<path d="${d}" fill="${color(s)}" fill-opacity="0.35" stroke="none"/>`;
    }
    out += `<polyline points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}" fill="none" stroke="${color(s)}" stroke-width="2"/>`;
    for (const p of pts)
      out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${color(s)}"/>`;
  }
  for (let i = 0; i < n; i += 1) out += axisLabel(categories[i], xAt(i), baseline + 14);
  return out;
}

function renderScatter(spec, x0, y0, plotW, plotH, baseline) {
  const { categories, series } = spec;
  const xs = categories.map((c) => Number(c) || 0);
  const ys = series[0]?.values ?? [];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs) || 1;
  const yMax = Math.max(1, ...ys.map((v) => Math.max(0, v)));
  const sx = (v) => x0 + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (v) => baseline - (Math.max(0, v) / yMax) * plotH;
  let out = "";
  for (let i = 0; i < xs.length; i += 1) {
    out += `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(ys[i] ?? 0).toFixed(1)}" r="4" fill="${color(0)}" fill-opacity="0.8"/>`;
  }
  return out;
}

function renderPie(spec, width, height) {
  const values = (spec.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const labels = spec.categories ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = width / 2;
  const cy = height / 2 + 6;
  const r = Math.min(width, height) / 2 - 30;
  let angle = -Math.PI / 2;
  let out = "";
  for (let i = 0; i < values.length; i += 1) {
    const slice = (values[i] / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += slice;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = slice > Math.PI ? 1 : 0;
    out += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color(i)}"/>`;
    void labels;
  }
  return out;
}

function renderLegend(series, width, height) {
  if (series.length <= 1) return "";
  let out = `<g class="hb-chart__legend" font-size="9" fill="currentColor">`;
  let x = MARGIN.left;
  const y = height - 6;
  for (let s = 0; s < series.length; s += 1) {
    out += `<rect x="${x}" y="${y - 8}" width="8" height="8" fill="${color(s)}"/>`;
    out += `<text x="${x + 11}" y="${y - 1}">${escapeXml(series[s].name)}</text>`;
    x += 14 + String(series[s].name).length * 5.4;
  }
  return `${out}</g>`;
}

function axisLabel(text, cx, y) {
  const t = String(text ?? "");
  const short = t.length > 8 ? `${t.slice(0, 7)}…` : t;
  return `<text x="${cx.toFixed(1)}" y="${y}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.75">${escapeXml(short)}</text>`;
}
