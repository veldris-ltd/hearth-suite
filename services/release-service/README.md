# release-service, TUF-signed updates (P3.3)

Implements The Update Framework (TUF): signed targets metadata, channels (`beta`,
`stable`), and root-key-verified publishing. Clients verify signatures and hashes
against their own **pinned roots** before installing (diagram 06d), so a
compromised mirror serving a tampered artifact fails verification on the client.

## Layout

- `api/`, Rust/axum service (excluded from the workspace; built into the image).
  Metadata model, signing, and verification come from the in-workspace, tested
  `crates/release` (the same code the client runs).
- `Dockerfile`, `docker-compose.yml`, `helm/`, self-hosting.

## API

| Method | Path                      | Purpose                                                                                                                           |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/{channel}/targets.json` | Serve the channel's TUF-signed metadata.                                                                                          |
| `POST` | `/{channel}/publish`      | Publish signed metadata (CI signing step; bearer-auth). The service re-verifies the signature against its roots before accepting. |
| `GET`  | `/metrics`                | Current published version per channel.                                                                                            |

`{channel}` is `beta` or `stable` (`hearth_release::Channel`).

## Acceptance criteria

- **AC-REL-1 (signed metadata + channels):** per-channel TUF metadata signed with
  the post-quantum ML-DSA root key (`hearth-seal` / `hearth-release`).
- **AC-REL-2 (client verifies against pinned roots):** clients call
  `ReleaseMetadata::verify(&TrustedRoots)` + `verify_artifact` before installing
  (`apps/desktop/src-tauri/src/updater.rs`); the service performs the same check
  on publish.
- **AC-REL-3 (tampered mirror fails):** any change to metadata or artifact bytes
  breaks signature/hash verification, proven by `crates/release` tests
  (`rejects_tampered_metadata`, `rejects_tampered_artifact`).

## CI integration

The CI signing step (`.github/workflows/ci.yml` → `sign` job) produces signed
artifacts + TUF metadata; the `publish-beta` / `publish-stable` jobs POST the
signed metadata to this service's `/{channel}/publish` endpoint (bearer token in
`HEARTH_PUBLISH_TOKEN`).

## Run

```sh
# no default passwords: generate them once (.env is git-ignored)
printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> services/release-service/.env
docker compose -f services/release-service/docker-compose.yml up --build
# or: helm install release services/release-service/helm \
#       --set config.rootPubkeyB64=… --set config.publishTokenSecret=release-publish
```
