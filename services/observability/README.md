# Observability (privacy-preserving)

Observability for Hearth Suite's **optional, self-hosted cloud services only**. Clients
are local-first and emit **no telemetry** (AC-OBS-1), they are never scraped.

## What's here

- `prometheus.yml`, scrape config; each service exposes aggregate, content-free
  metrics at `/metrics` (rendered by the `hearth-observability` crate).
- `dashboards/`, Grafana dashboards:
  - `relay-health.json`, up, blobs/bytes stored vs quota, error rate (AC-OBS-2).
  - `release-adoption.json`, aggregate active installs by version/channel (AC-OBS-3).
  - `error-rates.json`, error ratio + request/error rates by service/endpoint.

Load the dashboards into Grafana (import by file or provision from this folder)
with a Prometheus data source named `Prometheus`.

## Privacy guarantees (how this stays safe)

- **Metrics are aggregates only.** The metric models live in
  `crates/observability/src/metrics.rs`, counts, gauges, and ratios over ids and
  totals. No metric can carry document content or identities.
- **Logs never contain decryptable content or keys.** Services build structured
  log events that pass `hearth_observability::log::assert_log_safe`, and route
  them through `redact` as a defensive sink (drops any secret/content field).
  Unit-tested in `crates/observability/src/log.rs`.
- **Traces** carry span names, ids, durations, and status, never payloads.
- **Clients are silent by default.** `TelemetryPolicy::default()` is `Off`; any
  client telemetry is strictly opt-in and aggregate. Enforced by a workspace
  guard (`crates/ffi/tests/no_telemetry.rs`) and a client-package guard
  (`apps/e2e/tests/no-telemetry.test.mjs`).

## Service wiring

Each service binary:

1. initialises `tracing-subscriber` with a JSON formatter, redacting fields via
   the observability guard;
2. records aggregate counters/gauges;
3. serves them at `GET /metrics` via `hearth_observability::render_prometheus`.

See `services/admin-cp/api/src` for the reference wiring (`/metrics` route +
tracing init). The relay, key-directory, and release services (P3.1–P3.3) use the
same crate.
