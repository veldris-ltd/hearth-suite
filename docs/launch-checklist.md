# Hearth Suite v1.0 launch checklist

The gate for cutting the public open-source v1.0. Each item maps to an acceptance
criterion and to the automation that verifies it.

## Artifacts & supply chain

- [ ] **Signed artifacts on all five platforms**, Windows `.msi`, macOS `.dmg`,
      Linux `.AppImage`/`.deb`, iOS, Android. _(AC-LAUNCH-1, AC-DESK-1, AC-MOB-4;
      CI `build` + `sign` jobs.)_
- [ ] **Reproducible builds verified**, independent rebuild matches hashes.
      _(AC-LAUNCH-2, AC-CI-4; CI `reproducible-build` job.)_
- [ ] **SLSA provenance + SBOM attestations** attached to every artifact.
      _(AC-LAUNCH-2; CI `sign` job: `attest-build-provenance`, `attest-sbom`.)_
- [ ] **No unsigned artifact** in the release. _(AC-CI-3; CI `sign` gate.)_
- [ ] **TUF release metadata** published; client update verification tested.
      _(AC-DESK-3.)_

## Quality & security

- [ ] `just lint`, `just test`, and the **coverage gate** are green.
      _(AC-QA-1, AC-QA-2.)_
- [ ] **Security tests pass**: crypto KATs, Ember zero-egress, Seal tamper,
      parser fuzzing (Bundle + ODF/legacy). _(AC-QA-3, AC-SEC-11.)_
- [ ] **Dependency-licence report clean**, open licences only.
      _(AC-LAUNCH-4, AC-FND-2; `cargo deny check`, see `dependency-licences.md`.)_
- [ ] **No HIGH/CRITICAL advisories**. _(AC-CI-2; CI `audit` job.)_
- [ ] **Security docs published**: `SECURITY.md`, STRIDE threat model, crypto
      audit package. _(AC-SEC-10, AC-SEC-12.)_

## Documentation

- [ ] **Getting started**, **user guide**, **contributor docs**, and a
      **self-hosting guide** are published. _(AC-LAUNCH-3.)_
- [ ] The **website** at [hearth-suite.app](https://hearth-suite.app/) is live and uses the approved branding.

## Accessibility & internationalisation

- [ ] **WCAG 2.1 AA substantiated**: app-wide `prefers-reduced-motion`, a
      skip-to-content link on every page, visible focus rings, and the contrast
      unit test. _(P2-Q1; static gate `apps/e2e/tests/a11y.test.mjs` + CI `a11y`
      axe-core job.)_
- [x] **Language scope decided**: English-only for v1.0, with RTL-ready logical
      properties already in place and i18n deferred post-1.0. _(P2-Q2; see
      `docs/i18n.md`.)_

## Repo hygiene

- [ ] `LICENSE` (Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`,
      `CODE_OF_CONDUCT.md` present. _(AC-LAUNCH-4.)_
- [ ] **Issue & PR templates** present (`.github/`).
- [ ] Dependabot / dependency review enabled.

## Branding (trademark-safe)

- [ ] Public-facing materials use the **"Hearth Suite by Veldris Ltd." composite
      lockup**. _(AC-LAUNCH-5.)_
- [ ] The **registered-trademark symbol is NOT used** anywhere public until
      trademark registration completes (per the clearance dossier). Enforced by
      the brand guard test (`apps/e2e/tests/brand.test.mjs`). See `brand.md`.

## Sign-off

- [ ] Maintainer approval recorded for the `production` environment (the
      `publish-stable` gate).
- [ ] Release notes + changelog published.
