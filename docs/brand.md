# Brand & trademark usage

Hearth Suite is the property of **Veldris Ltd.**, registered in England and Wales, company
no. 17366869. These rules keep public-facing materials trademark-safe ahead of registration
(AC-LAUNCH-5).

## Names

| Use                     | For                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| **Hearth Suite**        | The platform and the open-source (Apache-2.0) edition.              |
| **Hearth Suite Pro**    | The commercial edition: Hearth Suite plus the Pro power layer.      |
| **Hearth Suite Ops**    | The operator console for the optional self-hostable services.       |

Write the name in full. "Hearth" on its own is a former name and is no longer used in
product, store or documentation copy. Lower-case `hearth` remains the technical namespace
in code (crate names such as `hearth-seal`, the `@hearth/*` npm scope, `HEARTH_*`
environment variables and metric names); it is not a brand surface. The module and feature
names (Writer, Sheets, Records, Calendar, The Mantel, Ember, Seal, Bundle, The Forge,
Kindling, Hallmark) are unchanged.

The Pro mark is the ember "Pro" pill after the wordmark (`proPill()` in
`@hearth/design-system`); there is no separate Pro logo.

## The composite lockup

Use the **endorsed composite lockup, "Hearth Suite by Veldris Ltd."**, in
public-facing materials (site, store listings, docs headers, README). The
authoritative asset is:

- `packages/design-system/assets/logo/lockup-endorsed.svg`

with the horizontal lockup and standalone glyph available alongside it. The
wordmark uses Literata; the endorsement line ("by Veldris Ltd.") uses Spline
Sans.

## The registered-trademark symbol, do NOT use yet

**Do not display a registered-trademark symbol on the Hearth Suite name** in
public-facing materials until the trademark registration completes, per the
clearance dossier. Until then:

- Write **"Hearth Suite"** or the **"Hearth Suite by Veldris Ltd."** lockup.
- A `™` may be used where unregistered-mark notice is desired, but the default is
  no symbol.
- The registered-trademark symbol is reserved for after registration is granted.

This is enforced by an automated guard (`apps/e2e/tests/brand.test.mjs`) that
fails if the registered-trademark symbol appears in public-facing files (README,
site, getting-started, user guide, self-hosting, security docs).

## Colour & type

Brand colour is a warm ember (not corporate blue); the Seal colour is distinct
from the hero accent. Tokens and fonts live in `@hearth/design-system`
(`tokens.json`, `fonts.css`). Use the tokens rather than hard-coded values.

The ember palette is the Hearth Suite product theme, used in the apps, store listings and the
product site. Corporate documents about Hearth Suite (proposals, contracts, architecture
deliverables) carry the Veldris Ltd. house style (ink `#12161F`, brass accent `#B8873B`,
Inter) and the Veldris ownership statement, in the same way Brokkr keeps its own product theme.

## Voice

Calm, plain-language, privacy-respecting. Seal and security are described in human
terms (e.g. "Only you and Maria can open this"), never crypto jargon.
