# Contributing to Hearth Suite

Thanks for your interest in Hearth Suite, the open-source, offline-first, privacy-first heir to
Microsoft Works. This guide covers how to set up, what we expect, and how changes land.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

- **Privacy and offline-first are non-negotiable.** Nothing should phone home; there is no
  mandatory account, cloud, or telemetry. Network features are opt-in and end-to-end
  encrypted.
- **No bespoke cryptography.** All crypto lives in the `seal` crate and builds only on
  vetted, audited libraries. Crypto changes need explicit maintainer review.
- **Open licences only.** Every dependency must resolve to an OSI-approved,
  Apache-2.0-compatible licence (enforced by `cargo deny` / `deny.toml`).

## Development setup

Install a stable [Rust](https://rustup.rs) toolchain, [Node.js](https://nodejs.org) 22+,
[pnpm](https://pnpm.io) 9+, and [`just`](https://github.com/casey/just). Then:

```sh
just setup     # install JS workspace dependencies
just lint      # rustfmt + clippy + eslint + prettier
just build
just test
```

A `Makefile` mirrors every target for environments without `just`.

## Workflow

1. Fork and branch from `main` (use a descriptive branch name).
2. Make focused commits; keep unrelated changes in separate PRs.
3. Run `just fmt` then `just lint` before pushing, CI rejects any clippy/eslint warning.
4. Add or update tests for behavioural changes; new crates and packages keep `just test`
   green.
5. Reference the relevant build prompt (`P*.*`) and acceptance criteria (`AC-*`) in your PR
   description where applicable.
6. Sign off every commit (see below). The `DCO sign-off` check fails a pull request with any
   commit that is not signed off.

## Signing off your commits (Developer Certificate of Origin)

Hearth Suite uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
(DCO) rather than a contributor licence agreement. By adding a sign-off line to a commit you
certify that you wrote the change, or otherwise have the right to submit it, under the
project's Apache-2.0 licence, and that the sign-off and your contribution are kept on record.

Accepted contributions are also included in Hearth Suite Pro, the commercial edition built by
Veldris Ltd. on this open-source core. Apache-2.0 already permits that use; the sign-off records
that you had the right to grant it.

Add the line with `git commit -s`:

```text
Signed-off-by: Your Name <you@example.org>
```

The email must match the commit's author email. To sign off commits you already made on a
branch, run `git rebase --signoff main` and force-push the branch. A pull request is checked by
`ci/jobs/dco.sh`, which you can run locally: `DCO_BASE=main ci/jobs/dco.sh`.

## How changes reach this repository

Hearth Suite is developed by Veldris Ltd. in a primary repository that also contains the
commercial Hearth Suite Pro edition. The public repository,
[`veldris-ltd/hearth-suite`](https://github.com/veldris-ltd/hearth-suite), is published from it
automatically: each push to the primary `main` branch produces one signed snapshot commit here,
with Pro code removed.

Pull requests are welcome on `hearth-suite`. They are reviewed there as usual; once accepted, a
maintainer applies the change to the primary repository (keeping you as the commit author) and it
appears here in the next export. Pull requests are therefore closed rather than merged on
`hearth-suite`, and anything merged directly here would be overwritten by the next export.

## Commit and PR conventions

- Write clear, imperative commit subjects (e.g. "Add Bundle manifest schema").
- Describe the _why_ in the body when it isn't obvious.
- PRs should pass the full CI pipeline: lint+fmt → tests → E2E smoke → SBOM + audit →
  build → sign.

## Code style

- **Rust:** `rustfmt` (config in `rustfmt.toml`) and `clippy` with `-D warnings`. Public
  items are documented (`missing_docs` is on).
- **TypeScript/JS:** `prettier` for formatting and `eslint` (flat config) for linting.
- Editor defaults are pinned in `.editorconfig`.

## Reporting bugs and security issues

Open a GitHub issue for ordinary bugs and feature requests. For anything security-sensitive,
**do not** open a public issue, follow [SECURITY.md](SECURITY.md) instead.

## Licensing of contributions

Hearth Suite is licensed under Apache-2.0. By submitting a contribution you agree it is licensed
under the same terms (see Section 5 of the [LICENSE](LICENSE)).
