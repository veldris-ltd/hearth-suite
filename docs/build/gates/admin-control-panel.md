# Admin Control Panel (P3.4)

The operator console for Veldris (or any self-hoster) running the **optional**
cloud services. Per diagram 03b it is a web app plus a Rust API, split so the
auditable rules are toolchain-light and fully tested:

```
crates/admin-core/        Pure domain logic (in the workspace; unit-tested).
  rbac.rs       Least-privilege role/permission policy.
  audit.rs      Append-only, hash-chained, signable audit log.
  relay.rs      Quota + blob lifecycle over content-free metadata.
  release.rs    Sign/publish/promote channels (verified via hearth-release).
  keydir.rs     Publish/revoke + transparency log.
  telemetry.rs  Aggregate health + content-redaction guard.
apps/admin/               Web UI (pnpm workspace; typechecked + tested).
  core.mjs      WebAuthn ceremony FSM, RBAC mirror, client redaction guard.
  api.ts        Typed Admin API client (guards every response).
  auth.ts       WebAuthn sign-in. app.ts/main.ts: the panel.
services/admin-cp/        Deployable: Rust/axum API + Dockerfile.
  api/          Excluded from the workspace (axum/tokio/webauthn-rs).
```

## How the acceptance criteria are met

- **AC-ADMIN-1 (RBAC enforced):** `rbac::can` is the single decision point; the API
  calls it before every mutating route, and a denied attempt returns 403 **and** is
  audited. Tested in `admin-core` (rbac + the cross-module flow test).
- **AC-ADMIN-2 (immutable audit):** `audit::AuditLog` is append-only and
  hash-chained, altering any past entry breaks every later hash (tested), and the
  head can be signed by an offline operator key for external tamper-evidence. There
  is no edit/delete API.
- **AC-ADMIN-3 (strong admin auth):** sign-in is WebAuthn (discoverable passkey) in
  `services/admin-cp/api/src/auth.rs`; the ceremony state machine (`nextAuthState`)
  admits `authenticated` only via a successful assertion (tested in `apps/admin`).
- **AC-ADMIN-4 (no content visibility):** relay and telemetry types carry only
  opaque ids, counts, and hashes, never content. `telemetry::assert_aggregate_only`
  (server) and `assertNoUserContent` (client) reject any field whose name hints at
  user content; both are tested. Consistent with the zero-knowledge relay.
- **AC-ADMIN-5 (relay & release ops):** quotas, blob lifecycle (expire→reclaim), and
  release channel promotion all take effect and are audited; release promotion
  re-verifies the signed metadata via `hearth-release`. Tested in `admin-core`
  (relay + release).
- **AC-ADMIN-6 (least privilege):** `rbac::default_role()` is `ReadOnly`; the API
  provisions new operators at that role, and elevation is an Owner-only audited
  action. Tested.

## What is verified where

The domain crate and the web app's pure logic are covered by `cargo test` and
`node:test` in CI. The axum API service is excluded from the workspace gate (like
the Tauri binary) and is built, signed, and deployed by `services.yml` once a
Dockerfile is present, which it now is, built from the repository root so the API
can reference `crates/admin-core` by path. Operational persistence (operators,
passkeys, audit storage, relay/key metadata) is in-memory in the scaffold with
TODO markers for the operational DB and encrypted object store.
