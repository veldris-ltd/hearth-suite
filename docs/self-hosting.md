# Self-hosting the optional Hearth Suite cloud

Hearth Suite needs **no** cloud, the default experience is fully local. But if you want
optional sync, a key directory, your own release channel, or an operator console,
every service is **self-hostable** and **zero-knowledge**: the server never sees
your document content.

> You never need Veldris's infrastructure. Run it all yourself.

## Services

| Service | Image | Purpose | Prompt |
| ------- | ----- | ------- | ------ |
| `sync-relay` | `ghcr.io/veldris-ltd/hearth-suite/sync-relay` | Zero-knowledge encrypted-blob store for opt-in sync | P3.1 |
| `key-directory` | `…/key-directory` | Publishes users' public keys (append-only transparency log) | P3.2 |
| `release-service` | `…/release-service` | TUF-signed release metadata + update channels | P3.3 |
| `admin-cp` | `…/admin-cp` | Operator console, RBAC + audit, relay/release/key ops | P3.4 |

All images are built, **signed (cosign keyless)**, SBOM-attested, and published by
`.github/workflows/services.yml`.

## Quick start (Docker)

```sh
# Admin Control Panel (operator console).
docker run -p 8080:8080 \
  -e HEARTH_RP_ID=admin.example.org \
  -e HEARTH_RP_ORIGIN=https://admin.example.org \
  ghcr.io/veldris-ltd/hearth-suite/admin-cp:latest
```

Put the services behind a TLS-terminating reverse proxy. Point clients' sync
setting at your relay's URL.

## Kubernetes (Helm)

For a cluster deployment, use the chart in
[`deploy/helm/hearth-services`](../deploy/helm/hearth-services). It deploys each
enabled service as a hardened, non-root (`65532`) Deployment with a
read-only root filesystem and dropped capabilities, a ClusterIP Service, and a
single TLS-terminating Ingress.

```sh
# 1. Provide the service configuration as a Secret (referenced by every pod).
kubectl create namespace hearth
kubectl -n hearth create secret generic hearth-services-secrets \
  --from-literal=HEARTH_RELAY_TOKEN_SECRET="$(openssl rand -hex 32)" \
  --from-literal=HEARTH_PUBLISH_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=HEARTH_ROOT_KEY_ID=hearth-release \
  --from-literal=HEARTH_ROOT_PUBKEY_B64="<hearth-tuf-sign pubkey>" \
  --from-literal=HEARTH_RP_ID=ops.example.com \
  --from-literal=HEARTH_RP_ORIGIN=https://ops.example.com

# 2. Install (set your host + image tag; provide a TLS cert secret).
helm upgrade --install hearth deploy/helm/hearth-services -n hearth \
  --set ingress.host=hearth.example.com \
  --set ingress.tls.secretName=hearth-tls \
  --set image.tag=<release-sha>
```

Disable any service you do not run with `--set services.<name>.enabled=false`.
The same `helm upgrade --install` runs in CI (`.github/workflows/services.yml`)
when a cluster kubeconfig secret is configured; without one the deploy stages are
skipped (the chart is still lint-checked on every run).

### TLS termination & security headers

TLS is terminated at the **ingress / reverse proxy**, not in the services: they
speak plain HTTP inside the cluster and the ingress holds the certificate
(`ingress.tls.secretName`, e.g. issued by cert-manager). Every service emits a
standard security-header set on all responses, `Strict-Transport-Security`
(HSTS), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`
(`default-src 'none'` for the JSON APIs; `'self'` for the admin console), so once
TLS is in front, browsers enforce HTTPS and the responses are locked down.

## Observability

Each service exposes aggregate, content-free metrics at `/metrics`. Import the
Grafana dashboards and Prometheus scrape config from
[`services/observability/`](../services/observability/README.md):

- **relay-health**, up, storage vs quota, error rate.
- **release-adoption**, aggregate installs by version/channel.
- **error-rates**, error ratios by service/endpoint.

Logs are structured and **never contain decryptable content or keys**; clients
emit no telemetry.

## Security & operations

- **RBAC + audit:** operators get least privilege by default; every action is
  recorded in an append-only, tamper-evident audit log. Sign-in is WebAuthn
  (hardware-backed). See `docs/build/gates/admin-control-panel.md`.
- **Relay is zero-knowledge:** it stores only opaque sealed blobs; quotas and
  blob lifecycle (expire → reclaim) are managed without ever reading content.
- **Backups:** back up the encrypted object store and the operational DB. Neither
  contains plaintext content.
- **Updates:** clients verify update signatures + hashes against pinned roots
  before installing; you control your own release channel via `release-service`.

## Trust model

The optional cloud is **semi-trusted**: it can observe metadata (blob sizes,
timing, IP) but never content. Self-hosting removes even that exposure from third
parties. See the [threat model](security/threat-model.md).
