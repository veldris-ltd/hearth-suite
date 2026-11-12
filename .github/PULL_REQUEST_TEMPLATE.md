<!-- Thanks for contributing to Hearth Suite! Please complete the checklist below. -->

## What does this change?

<!-- A short description of the change and the motivation. Link any issue. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / chore

## Checklist

- [ ] Every commit is signed off (`git commit -s`, Developer Certificate of Origin; see CONTRIBUTING.md).
- [ ] `just lint` passes (clippy `-D warnings`, eslint, prettier).
- [ ] `just test` passes (and `just coverage` stays above threshold).
- [ ] New behaviour is covered by tests (unit / property / integration / e2e as appropriate).
- [ ] No new dependency with a non-open licence (`cargo deny check` passes).
- [ ] **Privacy:** no telemetry, no network by default; any network feature is opt-in and end-to-end encrypted.
- [ ] **Cryptography:** no bespoke crypto; changes to `seal`/`key-manager` are flagged for maintainer review.
- [ ] Docs updated if behaviour or setup changed.
- [ ] Branding uses the "Hearth Suite by Veldris Ltd." lockup; the ® symbol is **not** used.
