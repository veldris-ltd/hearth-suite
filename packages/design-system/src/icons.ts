/**
 * Brand and UI iconography as inline SVG strings.
 *
 * Inlined (rather than loaded from files) so they render in any host without a
 * network/asset fetch and pass the desktop's strict offline CSP. The UI set is
 * the Hearth Suite v1.0 "i-*" family: a 24×24 grid, 2px stroke, round caps/joins,
 * drawing with `currentColor` (a few small accents are filled). The brand flame
 * and module glyphs mirror `assets/logo/glyph*.svg` and `assets/module/*.svg`.
 */

/** The complete set of named glyphs available to {@link icon}. */
export type IconName =
  // Brand
  | "flame"
  | "flame-keyhole"
  | "flame-line"
  | "flame-two-tone"
  | "ember"
  | "sparkle-sm"
  // Modules
  | "writer"
  | "sheets"
  | "records"
  | "calendar"
  // Navigation / chrome
  | "home"
  | "search"
  | "plus"
  | "check"
  | "x"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "arrow-right"
  | "menu"
  | "more"
  | "settings"
  | "bell"
  | "user"
  | "contact"
  | "device"
  // Security / trust
  | "lock"
  | "lock-open"
  | "seal"
  | "shield"
  | "key"
  | "qr"
  | "share"
  | "offline"
  | "chip"
  // Content / objects
  | "doc"
  | "bundle"
  | "folder"
  | "grid"
  | "tag"
  | "bolt"
  | "clock"
  | "download"
  | "info"
  | "alert"
  | "trash"
  | "edit"
  | "copy"
  | "eye"
  | "filter"
  | "send"
  | "refresh"
  | "sun"
  | "moon"
  | "android"
  | "phone"
  // Editor marks
  | "bold"
  | "italic"
  | "list"
  | "link"
  | "undo"
  // Platform sub-brand marks (roadmap family, not active modules)
  | "macros"
  | "forge"
  | "kindling"
  | "hallmark"
  | "marketplace"
  | "connections";

// Shared grammar for stroke glyphs: 24 grid · 2px · round caps/joins.
const STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

// Glyphs whose artwork is authored on a viewBox other than the default 24×24.
// The flame family from the brand handoff is drawn at 48×48.
const VIEWBOX: Partial<Record<IconName, string>> = {
  "flame-keyhole": "0 0 48 48",
  "flame-line": "0 0 48 48",
  "flame-two-tone": "0 0 48 48",
  macros: "0 0 48 48",
  forge: "0 0 48 48",
  kindling: "0 0 48 48",
  hallmark: "0 0 48 48",
  marketplace: "0 0 48 48",
  connections: "0 0 48 48",
};

const PATHS: Record<IconName, string> = {
  // ---- Brand -----------------------------------------------------------
  flame:
    '<path fill="currentColor" d="M12 2c2.6 3.1 4.3 5.6 4.3 8.6a4.3 4.3 0 0 1-2.2 3.8c.5-1 .4-2.1-.4-3.1.1 1.4-.6 2.4-1.8 3.2a4.4 4.4 0 0 1-4.2-4.4c0-1.4.6-2.7 1.7-3.8-.2 1 .1 1.8.9 2.4C9.7 6.9 10.3 4.4 12 2z"/>',
  "flame-keyhole":
    '<path fill="currentColor" fill-rule="evenodd" d="M24 3.5 C26 12.8 33 18 37 24 C40.4 28.9 40.2 34.2 38 38.2 C35.3 43.1 30 45.8 24 45.8 C18 45.8 12.7 43.1 10 38.2 C7.8 34.2 7.6 28.9 11 24 C15 18 22 12.8 24 3.5 Z M24 23.2 C21.7 23.2 19.9 25 19.9 27.3 C19.9 28.8 20.7 30.1 21.9 30.8 L20.7 37.2 L27.3 37.2 L26.1 30.8 C27.3 30.1 28.1 28.8 28.1 27.3 C28.1 25 26.3 23.2 24 23.2 Z"/>',
  "flame-line":
    '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" d="M24 5 C26 13.6 32.5 18.6 36.2 24.2 C39.3 28.8 39.1 33.7 37.1 37.4 C34.6 41.9 29.6 44.4 24 44.4 C18.4 44.4 13.4 41.9 10.9 37.4 C8.9 33.7 8.7 28.8 11.8 24.2 C15.5 18.6 22 13.6 24 5 Z"/>',
  "flame-two-tone":
    '<path fill="#CF6A2C" d="M24 3.5 C26 12.8 33 18 37 24 C40.4 28.9 40.2 34.2 38 38.2 C35.3 43.1 30 45.8 24 45.8 C18 45.8 12.7 43.1 10 38.2 C7.8 34.2 7.6 28.9 11 24 C15 18 22 12.8 24 3.5 Z"/><path fill="#F0B988" d="M24 18 C25 23.5 29 26.6 31 30 C32.7 32.9 32.6 35.8 31 38 C29.4 40.2 26.9 41.4 24 41.4 C21.1 41.4 18.6 40.2 17 38 C15.4 35.8 15.3 32.9 17 30 C19 26.6 23 23.5 24 18 Z"/>',
  ember:
    '<path fill="currentColor" d="M12 2.5 C12.8 6.7 14.7 8.6 18.9 9.4 C14.7 10.2 12.8 12.1 12 16.3 C11.2 12.1 9.3 10.2 5.1 9.4 C9.3 8.6 11.2 6.7 12 2.5 Z"/><circle cx="18.5" cy="17.5" r="2.1" fill="currentColor"/><circle cx="6" cy="19" r="1.3" fill="currentColor" opacity="0.7"/>',
  "sparkle-sm":
    '<path fill="currentColor" d="M12 4 C12.6 7.4 13.6 8.4 17 9 C13.6 9.6 12.6 10.6 12 14 C11.4 10.6 10.4 9.6 7 9 C10.4 8.4 11.4 7.4 12 4 Z"/>',

  // ---- Modules ---------------------------------------------------------
  writer: `<g ${STROKE}><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><line x1="8" y1="13" x2="15" y2="13"/><line x1="8" y1="16.5" x2="15" y2="16.5"/></g>`,
  sheets: `<g ${STROKE}><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="4" x2="10" y2="20"/></g>`,
  records: `<g ${STROKE}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></g>`,
  calendar: `<g ${STROKE}><rect x="4" y="5" width="16" height="15" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/></g>`,

  // ---- Navigation / chrome --------------------------------------------
  home: `<g ${STROKE}><path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z"/></g>`,
  search: `<g ${STROKE}><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L21 21"/></g>`,
  plus: `<g ${STROKE}><path d="M12 5 V19 M5 12 H19"/></g>`,
  check: `<g ${STROKE}><path stroke-width="2.2" d="M5 12.5 L10 17.5 L19 6.5"/></g>`,
  x: `<g ${STROKE}><path d="M6 6 L18 18 M18 6 L6 18"/></g>`,
  "chevron-down": `<g ${STROKE}><path d="M6 9.5 L12 15.5 L18 9.5"/></g>`,
  "chevron-right": `<g ${STROKE}><path d="M9.5 6 L15.5 12 L9.5 18"/></g>`,
  "chevron-left": `<g ${STROKE}><path d="M14.5 6 L8.5 12 L14.5 18"/></g>`,
  "arrow-right": `<g ${STROKE}><path d="M4 12 H20 M14 6 L20 12 L14 18"/></g>`,
  menu: `<g ${STROKE}><path d="M4 7 H20 M4 12 H20 M4 17 H20"/></g>`,
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
  settings: `<g ${STROKE}><circle cx="12" cy="12" r="3"/><path d="M12 2.5 V5 M12 19 V21.5 M21.5 12 H19 M5 12 H2.5 M18.7 5.3 L17 7 M7 17 L5.3 18.7 M18.7 18.7 L17 17 M7 7 L5.3 5.3"/></g>`,
  bell: `<g ${STROKE}><path d="M6.5 17 V11 A5.5 5.5 0 0 1 17.5 11 V17 L19 19.5 H5 Z"/><path d="M10 19.5 A2 2 0 0 0 14 19.5"/></g>`,
  user: `<g ${STROKE}><circle cx="12" cy="8" r="4"/><path d="M4.5 20 C4.5 15.8 7.9 13.5 12 13.5 C16.1 13.5 19.5 15.8 19.5 20"/></g>`,
  contact: `<g ${STROKE}><circle cx="12" cy="8" r="4"/><path d="M4.5 20 C4.5 15.8 7.9 13.5 12 13.5 C16.1 13.5 19.5 15.8 19.5 20"/></g>`,
  device: `<g ${STROKE}><path d="M12 3l1.6 3.4L17 8l-3.4 1.6L12 13l-1.6-3.4L7 8l3.4-1.6z"/><path d="M18 14l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/></g>`,

  // ---- Security / trust ------------------------------------------------
  lock: `<g ${STROKE}><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11 V8 A4 4 0 0 1 16 8 V11"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></g>`,
  "lock-open": `<g ${STROKE}><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11 V8 A4 4 0 0 1 16 8"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></g>`,
  seal: `<g ${STROKE}><path d="M12 2.5 L20 5.5 V11 C20 16.2 16.6 19.8 12 21.5 C7.4 19.8 4 16.2 4 11 V5.5 Z"/><circle cx="12" cy="10.5" r="2.1"/><path d="M12 12.4 V15.2"/></g>`,
  shield: `<g ${STROKE}><path d="M12 2.5 L20 5.5 V11 C20 16.2 16.6 19.8 12 21.5 C7.4 19.8 4 16.2 4 11 V5.5 Z"/><path d="M8.5 11.5 L11 14 L15.5 9"/></g>`,
  key: `<g ${STROKE}><circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2 L20 20 M17 17 L19.5 14.5 M14.5 14.5 L16.5 16.5"/></g>`,
  qr: `<g ${STROKE}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 14 H17 V17 M20 14 V20 H14"/></g>`,
  share: `<g ${STROKE}><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.8 L15.7 7.2 M8.3 13.2 L15.7 16.8"/></g>`,
  offline: `<g ${STROKE}><path d="M12 18.5 h.01 M8 15 a5.5 5.5 0 0 1 8 0 M4.5 11.5 a10 10 0 0 1 15 0"/><path d="M3.5 3.5 L20.5 20.5"/></g>`,
  chip: `<g ${STROKE}><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5 V6 M14 3.5 V6 M10 18 V20.5 M14 18 V20.5 M3.5 10 H6 M3.5 14 H6 M18 10 H20.5 M18 14 H20.5"/></g>`,

  // ---- Content / objects ----------------------------------------------
  doc: `<g ${STROKE}><path d="M6 3.5 H14 L19 8.5 V20.5 H6 Z"/><path d="M14 3.5 V8.5 H19 M9 13 H15 M9 16.5 H13"/></g>`,
  bundle: `<g ${STROKE}><path d="M3.5 7.5 L12 3.5 L20.5 7.5 V16.5 L12 20.5 L3.5 16.5 Z"/><path d="M3.5 7.5 L12 11.5 L20.5 7.5 M12 11.5 V20.5"/></g>`,
  folder: `<g ${STROKE}><path d="M3.5 6.5 A1.5 1.5 0 0 1 5 5 H9.5 L11.5 7.5 H19 A1.5 1.5 0 0 1 20.5 9 V17.5 A1.5 1.5 0 0 1 19 19 H5 A1.5 1.5 0 0 1 3.5 17.5 Z"/></g>`,
  grid: `<g ${STROKE}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></g>`,
  tag: `<g ${STROKE}><path d="M4 4 H11 L20 13 A2 2 0 0 1 20 16 L16 20 A2 2 0 0 1 13 20 L4 11 Z"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/></g>`,
  bolt: `<g ${STROKE}><path d="M13 2.5 L5 13.5 H11 L10 21.5 L19 9.5 H12.5 Z"/></g>`,
  clock: `<g ${STROKE}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5 V12 L15 14"/></g>`,
  download: `<g ${STROKE}><path d="M12 4 V15 M7.5 10.5 L12 15 L16.5 10.5 M5 19 H19"/></g>`,
  info: `<g ${STROKE}><circle cx="12" cy="12" r="8.5"/><path d="M12 11 V16"/><circle cx="12" cy="7.8" r="1.2" fill="currentColor" stroke="none"/></g>`,
  alert: `<g ${STROKE}><path d="M12 3.5 L21 19.5 H3 Z"/><path d="M12 9.5 V13.5"/><circle cx="12" cy="16.5" r="1.2" fill="currentColor" stroke="none"/></g>`,
  trash: `<g ${STROKE}><path d="M4.5 6.5 H19.5 M9 6.5 V4.5 H15 V6.5 M6.5 6.5 L7.5 19.5 H16.5 L17.5 6.5 M10 10 V16 M14 10 V16"/></g>`,
  edit: `<g ${STROKE}><path d="M5 19 H9 L19 9 L15 5 L5 15 Z"/><path d="M13 7 L17 11"/></g>`,
  copy: `<g ${STROKE}><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8 V6 A2 2 0 0 0 14 4 H6 A2 2 0 0 0 4 6 V14 A2 2 0 0 0 6 16 H8"/></g>`,
  eye: `<g ${STROKE}><path d="M2.5 12 C4.5 7.5 8 5.5 12 5.5 C16 5.5 19.5 7.5 21.5 12 C19.5 16.5 16 18.5 12 18.5 C8 18.5 4.5 16.5 2.5 12 Z"/><circle cx="12" cy="12" r="2.8"/></g>`,
  filter: `<g ${STROKE}><path d="M3.5 5.5 H20.5 L14 13 V19 L10 21 V13 Z"/></g>`,
  send: `<g ${STROKE}><path d="M20.5 3.5 L10.5 13.5 M20.5 3.5 L14 20.5 L10.5 13.5 L3.5 10 Z"/></g>`,
  refresh: `<g ${STROKE}><path d="M20 11 A8 8 0 1 0 19 15"/><path d="M20 5 V11 H14"/></g>`,
  sun: `<g ${STROKE}><circle cx="12" cy="12" r="4"/><path d="M12 2.5 V5 M12 19 V21.5 M21.5 12 H19 M5 12 H2.5 M18.4 5.6 L16.6 7.4 M7.4 16.6 L5.6 18.4 M18.4 18.4 L16.6 16.6 M7.4 7.4 L5.6 5.6"/></g>`,
  moon: `<g ${STROKE}><path d="M20 13.5 A8 8 0 1 1 10.5 4 A6.2 6.2 0 0 0 20 13.5 Z"/></g>`,
  android:
    '<path fill="currentColor" d="M6 9.5h12V17a1.5 1.5 0 0 1-1.5 1.5H15V21a1 1 0 0 1-2 0v-2.5h-2V21a1 1 0 0 1-2 0v-2.5H7.5A1.5 1.5 0 0 1 6 17V9.5Zm-2.5 0a1 1 0 0 1 2 0V15a1 1 0 0 1-2 0V9.5Zm15 0a1 1 0 0 1 2 0V15a1 1 0 0 1-2 0V9.5ZM7.6 8.2A4.9 4.9 0 0 1 9.4 5.3l-.9-1.3a.3.3 0 0 1 .5-.34l.95 1.36a5.6 5.6 0 0 1 4.1 0l.95-1.36a.3.3 0 0 1 .5.34l-.9 1.3a4.9 4.9 0 0 1 1.8 2.9H7.6Zm2.15-1.2a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24Zm4.5 0a.62.62 0 1 0 0-1.24.62.62 0 0 0 0 1.24Z"/>',
  phone: `<g ${STROKE}><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 5.5h4"/><circle cx="12" cy="18" r="0.9" fill="currentColor" stroke="none"/></g>`,

  // ---- Editor marks ----------------------------------------------------
  bold: `<g ${STROKE}><path d="M7 4.5 H13 A3.75 3.75 0 0 1 13 12 H7 Z M7 12 H14 A3.75 3.75 0 0 1 14 19.5 H7 Z"/></g>`,
  italic: `<g ${STROKE}><path d="M10 4.5 H17 M7 19.5 H14 M14.5 4.5 L9.5 19.5"/></g>`,
  list: `<g ${STROKE}><path d="M8 6.5 H20 M8 12 H20 M8 17.5 H20"/><circle cx="4" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="17.5" r="1.3" fill="currentColor" stroke="none"/></g>`,
  link: `<g ${STROKE}><path d="M9.5 14.5 L14.5 9.5 M8 11 L6 13 A3.5 3.5 0 0 0 11 18 L13 16 M16 13 L18 11 A3.5 3.5 0 0 0 13 6 L11 8"/></g>`,
  undo: `<g ${STROKE}><path d="M8 8 L4 12 L8 16 M4 12 H15 A5 5 0 0 1 15 22 H12"/></g>`,

  // ---- Platform sub-brand marks (48-grid, 2.5px line-grammar, roadmap) --
  macros:
    '<path d="M18 14 L10 24 L18 34 M30 14 L38 24 L30 34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 18.5 C24.5 21.6 25.8 22.9 28.9 23.4 C25.8 23.9 24.5 25.2 24 28.3 C23.5 25.2 22.2 23.9 19.1 23.4 C22.2 22.9 23.5 21.6 24 18.5 Z" fill="currentColor"/>',
  forge:
    '<rect x="8" y="9" width="16" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="24" y="26" width="16" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M16 22 V32.5 H24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="22" r="1.8" fill="currentColor"/><circle cx="24" cy="32.5" r="1.8" fill="currentColor"/>',
  kindling:
    '<path d="M24 7 C25.2 13 29 15.5 29 20 C29 23.4 26.8 25.6 24 25.6 C21.2 25.6 19 23.4 19 20 C19 15.5 22.8 13 24 7 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M13 39 L29 30 M35 39 L19 30" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  hallmark:
    '<circle cx="24" cy="17.5" r="11" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M24 11 C24.7 14.8 27 16.4 27 19.2 C27 21.3 25.7 22.8 24 22.8 C22.3 22.8 21 21.3 21 19.2 C21 16.4 23.3 14.8 24 11 Z" fill="currentColor"/><path d="M18.5 27 L15.5 41 L21 37.5 L24 41 L27 37.5 L32.5 41 L29.5 27" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>',
  marketplace:
    '<path d="M11.5 16 H36.5 L34.7 39.2 A2.6 2.6 0 0 1 32.1 41.5 H15.9 A2.6 2.6 0 0 1 13.3 39.2 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 16 V13 A6 6 0 0 1 30 13 V16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  connections:
    '<path d="M15 33 A7.5 7.5 0 0 1 15 18.2 A9 9 0 0 1 32.4 16.4 A8.5 8.5 0 0 1 33 33 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="24" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 26.2 V30.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/** A roadmap platform epic: its mark, label and module-tinted accent token. */
export interface PlatformMark {
  name: IconName;
  label: string;
  /** The CSS custom property carrying the epic's accent tint. */
  tint: string;
}

/**
 * The six platform sub-brands (roadmap / coming-soon, NOT active modules).
 * Each pairs its line-grammar glyph with a module-tinted accent.
 */
export const PLATFORM_MARKS: readonly PlatformMark[] = [
  { name: "macros", label: "Macros", tint: "var(--hb-color-calendar)" },
  { name: "forge", label: "The Forge", tint: "var(--hb-color-writer)" },
  { name: "kindling", label: "Kindling", tint: "var(--hb-color-sheets)" },
  { name: "hallmark", label: "Hallmark", tint: "var(--hb-color-accent)" },
  { name: "marketplace", label: "Marketplace", tint: "var(--hb-color-primary)" },
  { name: "connections", label: "Connections", tint: "var(--hb-color-records)" },
];

/** Every glyph name, in registration order (derived from the registry). */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/**
 * Return an inline `<svg>` string for a named glyph.
 *
 * The brand flame is size-aware: at >=48px (app tiles) the plain `flame`
 * upgrades to the Seal-tie-in `flame-keyhole`; at smaller sizes (favicon, rail)
 * it stays the plain flame, whose detail reads cleanly down to favicon size.
 *
 * @param name - the glyph to render.
 * @param size - pixel size for width/height (default 24).
 */
export function icon(name: IconName, size = 24): string {
  const resolved: IconName = name === "flame" && size >= 48 ? "flame-keyhole" : name;
  const viewBox = VIEWBOX[resolved] ?? "0 0 24 24";
  return (
    `<svg class="hb-icon hb-icon--${resolved}" viewBox="${viewBox}" ` +
    `width="${size}" height="${size}" role="img" aria-hidden="true" focusable="false">` +
    `${PATHS[resolved]}</svg>`
  );
}
