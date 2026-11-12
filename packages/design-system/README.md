# @hearth/design-system

The Hearth Suite design system: design tokens, a framework-agnostic component library,
and the brand asset set. Built per the Hearth Suite Design Brief, a warm, calm,
anti-blue identity that any of the module editors (Svelte/React/Vue) can consume.

## Tokens (AC-DS-1)

`src/tokens.json` is the single source of truth, transcribed from the Hearth Suite
Design System **v1.0** handoff. It holds:

- **Primitive ramps** (theme-agnostic): `ember 50–900`, `warm 0–950`,
  `seal 50–900`, and semantic hue ramps `green/amber/red/slate`.
- **Semantic layer** (`light` + `dark`): surfaces, text variants, borders, ring,
  `primary{,-hover,-active,-subtle}`, `brand-flame`, `accent{,-hover,-subtle}`,
  `sealed-*`, and `success/warning/danger/info` each with `-bg`/`-text`.
- **Module colours** `writer/sheets/records/calendar` each with a `-bg`.
- **Per-theme elevation** (`elev-1…4` + `elev-ember`; warm-brown shadows in light,
  black in dark) and the non-colour set: type, spacing, radius, stroke, motion,
  layout/z-index.

`scripts/build.mjs` generates the exports:

```sh
pnpm --filter @hearth/design-system build   # -> dist/tokens.css + dist/tokens.json
```

- **CSS variables** (`dist/tokens.css`): `--hb-*` custom properties, ramps as
  `--hb-ember-500` (no `color` segment), semantic as `--hb-color-bg` /
  `--hb-color-text-muted` / `--hb-color-primary` / `--hb-color-writer-bg`,
  elevation as `--hb-elev-2`. Light on `:root`, dark via `[data-theme="dark"]`
  and `prefers-color-scheme`.
- **JSON** (`dist/tokens.json` / `src/tokens.json`): for tooling and native clients.

```ts
import { applyTheme, tokens, cls } from "@hearth/design-system";
applyTheme("dark");
```

### Token migration (v1.0)

The v1.0 regeneration renames and **repurposes** several variables. The headline
change: `accent` is no longer the ember, the ember is now `primary` /
`brand-flame`, and `accent` is the **seal teal trust colour**.

| Pre-v1.0 (old)              | v1.0 (new)                                                   | Note                                                                   |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `--hb-color-accent` (ember) | `--hb-color-primary` (ember hero)                            | hero hue; brighter logo hue is `--hb-color-brand-flame`                |
| `--hb-color-seal` (teal)    | `--hb-color-accent` (teal)                                   | generic teal; sealed UI uses `--hb-color-sealed-{bg,border,text,icon}` |
| `--hb-color-on-primary`     | `--hb-color-text-on-primary`                                 | rename                                                                 |
| `--hb-color-on-seal`        | `--hb-color-sealed-text` / `-text-on-primary`                | sealed badges use the subtle sealed-\* set                             |
| `--hb-color-on-danger`      | `--hb-color-text-inverse`                                    | flips white/dark per theme; AA-safe on `danger`                        |
| `--hb-color-focus`          | `--hb-color-ring` (outlines), `--hb-color-primary` (borders) |                                                                        |
| `--hb-color-surface-muted`  | `--hb-color-surface-sunken`                                  | rename                                                                 |
| `--hb-elevation-0…3`        | `--hb-elev-0…4` (+ `--hb-elev-ember`)                        | per-theme shadows                                                      |
| `--hb-font-display`         | `--hb-font-serif`                                            | family is now Literata                                                 |
| `--hb-font-ui`              | `--hb-font-sans`                                             | + new `--hb-font-mono`                                                 |

New additive tokens: `--hb-stroke-*`, `--hb-dur-*` / `--hb-ease-*` (motion),
`--hb-sidebar-w` / `--hb-content-max` / `--hb-z-*` (layout), `--hb-space-16/20/24`.

### Type scale (v1.0)

The flat UI sizes were replaced by the **named v1.0 scale**. Each step emits a
size (`--hb-text-<step>`), a line-height (`--hb-leading-<step>`) and, where the
step defines one, letter-spacing (`--hb-tracking-<step>`).

| Old size token  | v1.0 step  | size / line-height / tracking  | family |
| --------------- | ---------- | ------------------------------ | ------ |
| ,               | `display`  | 3.75rem / 1.05 / −0.022em      | serif  |
| ,               | `h1`       | 2.5rem / 1.1 / −0.02em         | serif  |
| `--hb-text-2xl` | `h2`       | 2rem / 1.15 / −0.015em         | serif  |
| `--hb-text-xl`  | `h3`       | 1.5rem / 1.25 / −0.01em        | sans   |
| ,               | `h4`       | 1.25rem / 1.3 / −0.005em       | sans   |
| `--hb-text-lg`  | `body-lg`  | 1.125rem / 1.6                 | sans   |
| `--hb-text-md`  | `body`     | 1rem / 1.6                     | sans   |
| `--hb-text-sm`  | `body-sm`  | 0.875rem / 1.5                 | sans   |
| `--hb-text-xs`  | `caption`  | 0.75rem / 1.35 / 0.01em        | sans   |
| ,               | `code`     | 0.875rem / 1.5                 | mono   |
| ,               | `overline` | 0.6875rem / 0.12em (uppercase) | sans   |

Headings (`display`/`h1`/`h2`) use `--hb-font-serif`; `h3`/`h4` and all body/UI
text use `--hb-font-sans`; **`--hb-font-mono` (Spline Sans Mono)** is used for code,
spreadsheet formulae & cell references (formula bar, name box, column/row headers),
key fingerprints, and the Ember effort labels.

## Identity (AC-DS-2)

The hero colour is **ember** (`--hb-color-primary`, with the brighter logo flame
as `--hb-color-brand-flame`), never corporate blue. The encrypted **Seal** state
has its own **teal** trust treatment (`--hb-color-accent` and the
`--hb-color-sealed-{bg,border,text,icon}` set) and is always shown with a lock
icon and a plain-language label, never colour alone.

## Components (AC-DS-4)

`styles/components.css` provides buttons, inputs, selects, toggles, tabs, modals,
toasts, cards, tables, menus, sidebars, search, empty states, and badges. Every
interactive component defines **default / hover / focus / active / disabled /
error** states, and all are token-driven so both themes are covered automatically.

```html
<link rel="stylesheet" href="@hearth/design-system/tokens.css" />
<link rel="stylesheet" href="@hearth/design-system/fonts.css" />
<link rel="stylesheet" href="@hearth/design-system/components.css" />

<button class="hb-btn hb-btn--primary">Create</button>
<span class="hb-seal-badge"><svg class="hb-seal-badge__icon">…</svg> Sealed</span>
```

## Brand assets (AC-DS-3)

`assets/logo/`, `glyph.svg` (glyph-only), `lockup-horizontal.svg`, and
`lockup-endorsed.svg` ("Hearth Suite by Veldris Ltd."). Vector marks remain legible
from 16px to hero size. `assets/glyph/ember.svg` is the Ember assistant mark and
`assets/module/` holds the Writer/Sheets/Records/Calendar glyphs.

## Accessibility (AC-A11Y-1)

`tests/contrast.test.mjs` verifies WCAG 2.1 AA contrast in both themes against
the documented v1.0 ratios, body text ≥ 12:1 (light 12.4:1), muted text ≥ 5.5:1
(5.6:1), white-on-primary ≥ 4.5:1 (4.95:1), white-on-accent ≥ 6.3:1 (measured
**6.34:1**; the handoff's "6.4" rounds up), and sealed-text-on-sealed-bg ≥ 6.6:1

- plus identity invariants (accent reads as the trust teal, the hero/flame stays
  warm, elevation shadows stay warm). Components ship visible `:focus-visible` rings
  and ≥ 44px touch targets.

```sh
pnpm --filter @hearth/design-system test
```

Type: **Literata** (serif, display & document craft), **Spline Sans** (UI), and
**Spline Sans Mono** (code), all SIL OFL and all vendored as `.woff2` (with their
OFL licence texts) under `assets/fonts/` (see `styles/fonts.css`). The former
display face, Fraunces, is retired and its assets removed.
