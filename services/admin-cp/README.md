# admin-cp, Admin Control Panel (P3.4)

Operator console for Veldris (or any self-hoster) running the **optional** cloud
services. Per diagram 03b it has two parts:

- **API** (`api/`, Rust/axum), RBAC-gated, fully audited, WebAuthn-authenticated.
  Excluded from the root Cargo workspace (web-server + WebAuthn deps); built into
  this image. Depends on `crates/admin-core` by path.
- **Web UI** (`apps/admin`, in the pnpm workspace), the panel front-end, built by
  Vite and served as static assets by the API.

The domain rules live in **`crates/admin-core`** and are unit-tested in CI:

| Module             | Backed by                                  | AC            |
| ------------------ | ------------------------------------------ | ------------- |
| RBAC + audit       | `admin_core::rbac` + `admin_core::audit`   | ADMIN-1, 2, 6 |
| Relay management   | `admin_core::relay`                        | ADMIN-4, 5    |
| Release management | `admin_core::release` (+ `hearth-release`) | ADMIN-5       |
| Key-directory ops  | `admin_core::keydir`                       | ADMIN-4, 5    |
| Observability      | `admin_core::telemetry`                    | ADMIN-4       |
| Strong admin auth  | `api/src/auth.rs` (WebAuthn)               | ADMIN-3       |

## Security posture

- **Least privilege (ADMIN-1, 6):** every mutating route calls
  `admin_core::rbac::can` before acting; new operators default to `read_only`.
- **Immutable audit (ADMIN-2):** every attempt, allowed _or_ denied, is appended
  to a hash-chained, signable log (`admin_core::audit`); there is no edit/delete API.
- **WebAuthn (ADMIN-3):** sign-in requires a hardware passkey (discoverable flow).
- **No content visibility (ADMIN-4):** relay/telemetry types carry only opaque ids,
  counts, and hashes. The API serves aggregates; the web client additionally runs a
  content-redaction guard on every response. Consistent with the zero-knowledge relay,
  the panel cannot read user document content.

## Build & run

The image is built from the **repository root** (the API needs the workspace
crates by path):

```sh
docker build -f services/admin-cp/Dockerfile -t hearth-admin-cp .
docker run -p 8080:8080 \
  -e HEARTH_RP_ID=admin.example.org \
  -e HEARTH_RP_ORIGIN=https://admin.example.org \
  hearth-admin-cp
```

`.github/workflows/services.yml` builds, signs (cosign keyless), and deploys the
image. Operational state (operators, passkeys, audit log, relay/key metadata) is
held in memory in this scaffold; production wires it to the operational DB and
encrypted object store (TODO markers in `api/src`).
