# Observability, privacy-preserving (P4.3)

Structured logging, metrics, and tracing for Hearth Suite's **optional cloud services
only**. Clients are local-first and emit **no telemetry by default**; any client
telemetry would be strictly opt-in, aggregate, and content-free. Satisfies
AC-OBS-1..3.

## Where it lives

- `crates/observability`, the pure, tested core: a log-safety guard, aggregate
  metric models, a Prometheus renderer, and the telemetry policy. Dependency-light
  (no runtime logging stack), so it is fully unit-tested in CI.
- `services/observability`, `prometheus.yml` scrape config + Grafana dashboards.
- Each service binary wires the crate to `tracing-subscriber` and a `/metrics`
  endpoint (reference wiring in `services/admin-cp/api`).

## AC-OBS-1, clients silent by default

`TelemetryPolicy::default()` is `Off` (`crates/observability/src/policy.rs`).
Two guards enforce that no client ships a telemetry path:

- `crates/ffi/tests/no_telemetry.rs`, the client Rust workspace links no
  analytics/telemetry/crash SDK (scans `Cargo.lock`).
- `apps/e2e/tests/no-telemetry.test.mjs`, no client `package.json` depends on a
  telemetry/analytics npm package.

The Ember zero-egress test (`crates/ember-bridge/tests/zero_egress.rs`) further
guarantees on-device AI has no network path.

## AC-OBS-2, service observability without content/keys

- **Logs**, services emit structured JSON events that pass
  `hearth_observability::log::assert_log_safe` and are routed through `redact`,
  which **drops** any field whose name marks a secret or user content
  (`secret_key`, `recovery_phrase`, `authorization`, `content_base64`, …). The
  guard is deliberately specific so legitimate ids (`key_id`, `pubkey_sha256`,
  `context`) are not falsely stripped. Unit-tested.
- **Metrics**, aggregate counters/gauges only (`RelayHealth`, `ErrorRate`),
  rendered to Prometheus text and served at `/metrics`. No metric can carry
  content or identities.
- **Traces**, span names, ids, durations, status codes; never payloads.

## AC-OBS-3, release adoption

`ReleaseAdoption` exposes `hearth_release_active_installs{version,channel}`, an
aggregate count with no per-user identity, surfaced on the
`release-adoption` dashboard so operators can see version uptake as updates roll
out.

## Dashboards

Import `services/observability/dashboards/*.json` into Grafana (Prometheus data
source): **relay-health**, **release-adoption**, **error-rates**.
