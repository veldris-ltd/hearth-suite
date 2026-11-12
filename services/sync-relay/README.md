# sync-relay, zero-knowledge encrypted-blob store (P3.1)

Optional, self-hostable relay for opt-in sync. It accepts authenticated
PUT/GET/DELETE of **opaque, client-encrypted** CRDT deltas and document blobs and
is **architecturally incapable of reading content**, no content key ever reaches
it. Metadata lives in Postgres; blob bytes live in an S3-compatible object store.

## Layout

- `api/`, Rust/axum service (excluded from the workspace; built into the image).
  Quota, blob lifecycle/GC, and rate-limiting logic come from the in-workspace,
  tested `crates/relay-core`.
- `Dockerfile`, `docker-compose.yml`, `helm/`, self-hosting (AC-RELAY-4).

## Acceptance criteria

- **AC-RELAY-1 (opaque only):** the relay stores ciphertext + metadata; the
  `BlobMeta` type carries no content/key field (`relay-core`, tested).
- **AC-RELAY-2 (quotas):** per-account byte/blob quotas reject writes gracefully
  (`413 Insufficient Storage`); tested in `relay-core`.
- **AC-RELAY-3 (lifecycle/GC):** TTL expiry + GC reclaim orphaned blobs and free
  quota; tested in `relay-core`, run on a background interval in the service.
- **AC-RELAY-4 (self-host):** `docker compose up` (relay + Postgres + MinIO) or
  the Helm chart deploys a working relay with **no Veldris infrastructure**.

## Run locally

```sh
# no default passwords: generate them once (.env is git-ignored)
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> services/sync-relay/.env
printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> services/sync-relay/.env
docker compose -f services/sync-relay/docker-compose.yml up --build
# PUT a blob (opaque ciphertext):
curl -X PUT -H "Authorization: Bearer <account-token>" \
  --data-binary @delta.bin http://localhost:8080/blob/<id>
```

## Deploy to Kubernetes

```sh
helm install relay services/sync-relay/helm \
  --set config.databaseUrl=postgres://… \
  --set config.objectStoreUrl=s3://…
```

Aggregate, content-free metrics are exposed at `/metrics` (see
`services/observability`). Logs never contain content or keys.
