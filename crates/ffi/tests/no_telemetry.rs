//! Clients are silent by default (`AC-OBS-1`).
//!
//! The client-side workspace must link no analytics/telemetry/crash-reporting
//! SDK, there is no code that could phone home. (The optional cloud services
//! that *do* emit aggregate metrics are excluded from this workspace and built
//! separately, so they never appear in the client dependency graph.)

/// Analytics / telemetry / crash-reporting crates that must not be present.
const FORBIDDEN: &[&str] = &[
    "sentry",
    "segment",
    "mixpanel",
    "amplitude",
    "posthog",
    "datadog",
    "opentelemetry",
    "tracing-opentelemetry",
    "google-analytics",
    "bugsnag",
    "rollbar",
    "honeycomb",
];

#[test]
fn client_workspace_links_no_telemetry_sdk() {
    let lock = include_str!("../../../Cargo.lock").to_lowercase();
    for needle in FORBIDDEN {
        assert!(
            !lock.contains(&format!("name = \"{needle}\"")),
            "client workspace unexpectedly links telemetry crate `{needle}` (AC-OBS-1)"
        );
    }
}
