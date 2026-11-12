# Dependency licence compliance

Hearth Suite ships under **Apache-2.0** and depends only on **OSI-approved, permissive
or copyleft-compatible** licences. This is enforced automatically, a release
cannot pass CI with a disallowed or unknown licence (AC-LAUNCH-4, AC-FND-2).

## Policy (enforced)

The Rust dependency graph is gated by [`cargo deny`](../deny.toml). The allow-list:

```
Apache-2.0, Apache-2.0 WITH LLVM-exception, MIT, MITNFA,
BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, Unicode-DFS-2016,
CC0-1.0, MPL-2.0, Unlicense, BSL-1.0
```

Anything outside this set (or an unknown licence below the confidence threshold)
**fails the build**. `cargo deny` also rejects unknown registries/git sources and
yanked crates.

The JavaScript workspace uses only permissive dev/build tooling (Vite, ESLint,
Prettier, TypeScript) and the client shells (`@tauri-apps/*`, `@capacitor/*`), all
MIT/Apache-2.0.

## Generate the report

```sh
# Rust: licence + advisory + source check (the authoritative gate).
cargo deny check licenses

# Rust: a full licence inventory.
cargo deny list

# JavaScript: licence inventory for the pnpm workspace.
pnpm licenses list
```

CI runs `cargo deny check` in the `audit` stage and produces a CycloneDX **SBOM**
for both ecosystems; the SBOM is attached to release artifacts as an attestation.

## Adding a dependency

1. Prefer crates already in the graph.
2. Confirm the licence is on the allow-list; if it is permissive but new, add it
   to `deny.toml` in the same PR with a one-line justification.
3. Never add a dependency with a non-open or unknown licence.
4. Crypto dependencies additionally require maintainer review (see
   `CONTRIBUTING.md`).
