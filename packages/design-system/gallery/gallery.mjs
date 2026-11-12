/**
 * Hearth Suite design-system gallery (DSG-C5), the canonical, framework-free reference
 * surface (the comparison target for the DSG-X3 pixel diff). Vanilla ES module;
 * Vite serves it so the TypeScript design-system source resolves. It imports the
 * real `icon()`, `tokens`, `applyTheme`, the icon registry and `EmberPanel`, then
 * fills the foundations + a live Ember demo. Everything else is static markup in
 * index.html using the `.hb-*` classes.
 */

import { applyTheme, EmberPanel, icon, ICON_NAMES, tokens } from "../src/index.ts";

const $ = (id) => document.getElementById(id);

// ---- Theme toggle -------------------------------------------------------
let theme = "light";
applyTheme(theme);
const themeBtn = $("gall-theme");
themeBtn.textContent = "Dark theme";
themeBtn.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  applyTheme(theme);
  themeBtn.textContent = theme === "light" ? "Dark theme" : "Light theme";
});

// ---- Fill the inline icons referenced by markup -------------------------
for (const el of document.querySelectorAll("[data-icon]")) {
  el.innerHTML = icon(el.dataset.icon, 18);
}
$("gall-iconbtn").innerHTML = icon("plus", 18);
$("gall-leadicon").innerHTML = icon("search", 16);
$("gall-tagrm").innerHTML = icon("x", 14);
$("gall-errtext").innerHTML = `${icon("alert", 14)}<span>Please fix this field.</span>`;
$("gall-build").innerHTML = `${icon("device", 14)}<span>gallery</span>`;
$("gall-sealed").insertAdjacentHTML("afterbegin", icon("shield", 16));
$("gall-ondevice").insertAdjacentHTML("afterbegin", icon("lock", 14));
$("gall-soon").insertAdjacentHTML("afterbegin", icon("clock", 11));
$("gall-probadge").innerHTML = `${icon("flame", 11)}Pro`;
$("gall-proghost").innerHTML = `${icon("flame", 11)}Pro`;

// ---- Foundations: WCAG contrast helper ----------------------------------
function luminance(hex) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  const ch = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---- Semantic colour swatches (computed hex + contrast on surface) ------
const COLOR_TOKENS = [
  "bg",
  "bg-subtle",
  "surface",
  "surface-raised",
  "surface-sunken",
  "paper",
  "text",
  "text-muted",
  "text-subtle",
  "border",
  "border-strong",
  "primary",
  "primary-hover",
  "brand-flame",
  "accent",
  "sealed-bg",
  "sealed-text",
  "success",
  "warning",
  "danger",
  "info",
  "writer",
  "sheets",
  "records",
  "calendar",
];
function paintColors() {
  const surface = cssVar("--hb-color-surface");
  const host = $("gall-colors");
  host.replaceChildren();
  for (const name of COLOR_TOKENS) {
    const value = cssVar(`--hb-color-${name}`);
    const ratio = contrast(value, surface);
    const cell = document.createElement("div");
    cell.className = "gall-cell";
    const sw = document.createElement("div");
    sw.className = "gall-swatch";
    sw.style.background = `var(--hb-color-${name})`;
    cell.append(sw);
    cell.insertAdjacentHTML(
      "beforeend",
      `<strong>${name}</strong><span class="gall-mono">${value || "-"}</span>` +
        `<span class="gall-mono">${ratio ? `${ratio.toFixed(1)}:1` : "-"}</span>`,
    );
    host.append(cell);
  }
}

// ---- Primitive ramps ----------------------------------------------------
function paintRamps() {
  const host = $("gall-ramps");
  host.replaceChildren();
  for (const [ramp, stops] of Object.entries(tokens.ramp)) {
    const label = document.createElement("div");
    label.className = "gall-mono";
    label.textContent = ramp;
    const row = document.createElement("div");
    row.className = "gall-ramp";
    for (const [stop, hex] of Object.entries(stops)) {
      const cell = document.createElement("div");
      cell.className = "gall-ramp-stop";
      cell.style.background = hex;
      cell.style.color = (luminance(hex) ?? 0) > 0.5 ? "#000" : "#fff";
      cell.textContent = stop;
      cell.title = `${ramp}-${stop} ${hex}`;
      row.append(cell);
    }
    host.append(label, row);
  }
}

// ---- Type scale ---------------------------------------------------------
const FONT = {
  serif: "var(--hb-font-serif)",
  sans: "var(--hb-font-sans)",
  mono: "var(--hb-font-mono)",
};
function paintType() {
  const host = $("gall-type");
  host.replaceChildren();
  for (const [step, spec] of Object.entries(tokens.type.scale)) {
    const line = document.createElement("div");
    line.style.fontSize = `var(--hb-text-${step})`;
    line.style.lineHeight = `var(--hb-leading-${step})`;
    line.style.fontFamily = FONT[spec.family];
    if (spec.tracking) line.style.letterSpacing = `var(--hb-tracking-${step})`;
    line.style.margin = "0 0 var(--hb-space-2)";
    line.textContent = `${step}, Warm light around the hearth`;
    host.append(line);
  }
}

// ---- Spacing / radius / elevation / motion ------------------------------
function paintSpace() {
  const host = $("gall-space");
  host.replaceChildren();
  for (const [k, v] of Object.entries(tokens.space)) {
    if (k === "0") continue;
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:var(--hb-space-3);margin-block-end:4px";
    const bar = document.createElement("div");
    bar.style.cssText = `inline-size:var(--hb-space-${k});block-size:14px;background:var(--hb-color-primary);border-radius:2px`;
    row.append(bar);
    row.insertAdjacentHTML("beforeend", `<span class="gall-mono">space-${k} · ${v}</span>`);
    host.append(row);
  }
}
function paintRadius() {
  const host = $("gall-radius");
  host.replaceChildren();
  for (const [k, v] of Object.entries(tokens.radius)) {
    const cell = document.createElement("div");
    cell.className = "gall-cell";
    cell.style.inlineSize = "100px";
    const box = document.createElement("div");
    box.style.cssText = `inline-size:64px;block-size:48px;background:var(--hb-color-surface-sunken);border:var(--hb-stroke-base) solid var(--hb-color-border-strong);border-radius:var(--hb-radius-${k})`;
    cell.append(box);
    cell.insertAdjacentHTML("beforeend", `<span class="gall-mono">${k} · ${v}</span>`);
    host.append(cell);
  }
}
function paintElevation() {
  const host = $("gall-elev");
  host.replaceChildren();
  for (const k of ["1", "2", "3", "4", "ember"]) {
    const cell = document.createElement("div");
    cell.className = "gall-cell";
    cell.style.cssText = "inline-size:120px;border:none";
    const box = document.createElement("div");
    box.style.cssText = `inline-size:100%;block-size:48px;background:var(--hb-color-surface);border-radius:var(--hb-radius-md);box-shadow:var(--hb-elev-${k})`;
    cell.append(box);
    cell.insertAdjacentHTML("beforeend", `<span class="gall-mono">elev-${k}</span>`);
    host.append(cell);
  }
}
function paintMotion() {
  const host = $("gall-motion");
  host.replaceChildren();
  const durs = Object.keys(tokens.motion.duration);
  const eases = Object.keys(tokens.motion.easing);
  for (const d of durs)
    host.insertAdjacentHTML(
      "beforeend",
      `<span class="hb-badge gall-mono">dur-${d} · ${tokens.motion.duration[d]}</span>`,
    );
  for (const e of eases)
    host.insertAdjacentHTML("beforeend", `<span class="hb-badge gall-mono">ease-${e}</span>`);
}

// ---- Icon grid ----------------------------------------------------------
function paintIcons() {
  const host = $("gall-icons");
  host.replaceChildren();
  for (const name of ICON_NAMES) {
    const cell = document.createElement("div");
    cell.className = "gall-cell";
    const g = document.createElement("div");
    g.style.color = "var(--hb-color-primary)";
    g.innerHTML = icon(name, 24);
    cell.append(g);
    cell.insertAdjacentHTML("beforeend", `<span class="gall-mono">${name}</span>`);
    host.append(cell);
  }
}

// ---- Live Ember demo ----------------------------------------------------
function mountEmber() {
  const panel = new EmberPanel({
    intro: "This is the shared Ember panel, answers stay on your device.",
    run: async (req) => ({ text: `(demo) ${req.request}`, model: "Phi", device_local: true }),
    suggestions: [
      { label: "Summarise", build: (effort) => ({ request: "Summarise this", effort }) },
      { label: "Draft", build: (effort) => ({ request: "Draft something", effort }) },
    ],
    ask: { placeholder: "Ask Ember…", build: (text, effort) => ({ request: text, effort }) },
  });
  $("gall-ember").append(panel.el());
}

paintColors();
paintRamps();
paintType();
paintSpace();
paintRadius();
paintElevation();
paintMotion();
paintIcons();
mountEmber();

// Colour swatches + contrast depend on the active theme; repaint on toggle.
themeBtn.addEventListener("click", () => setTimeout(paintColors, 0));
