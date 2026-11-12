# Hearth Suite optional-cloud services

All services here are **optional and self-hostable**, the default Hearth Suite experience
touches none of them. Each is built into a container image, signed, and deployed by
[`.github/workflows/services.yml`](../.github/workflows/services.yml), following the lower
branch of diagram `09_cicd`.

| Service           | Responsibility                                                           | Build prompt |
| ----------------- | ------------------------------------------------------------------------ | ------------ |
| `sync-relay`      | Zero-knowledge encrypted-blob store for opt-in sync                      | P3.1         |
| `key-directory`   | Publishes users' post-quantum public keys (append-only transparency log) | P3.2         |
| `release-service` | TUF-signed release metadata and update channels                          | P3.3         |
| `admin-cp`        | Operator console, RBAC + audit, relay/release/key ops (no content)       | P3.4         |

Each service lives at `services/<name>/` with a `Dockerfile`, a `docker-compose.yml`
for local self-hosting, and a Helm chart under `helm/`. Their domain logic lives
in tested workspace crates (`relay-core`, `key-directory-core`, `release`,
`admin-core`); the service binaries (under `*/api/`) are excluded from the Cargo
workspace and built into container images by the service-image workflow. A service
without a `Dockerfile` is skipped cleanly so the pipeline stays green.

All four services are present (P3.1–P3.4). None require Veldris infrastructure:
`docker compose -f services/<name>/docker-compose.yml up` self-hosts each one.
