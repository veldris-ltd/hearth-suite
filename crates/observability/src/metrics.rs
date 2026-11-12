//! Aggregate, content-free metrics and their Prometheus exposition (AC-OBS-2/3).
//!
//! Every metric here is a count, gauge, or ratio over *aggregates*, it can never
//! carry user content. The typed snapshots ([`RelayHealth`], [`ReleaseAdoption`],
//! [`ErrorRate`]) back the operator dashboards (relay health, release adoption,
//! error rates) and render to the Prometheus text exposition format the services
//! serve at `/metrics`.

use serde::{Deserialize, Serialize};

/// A metric kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricKind {
    /// Monotonically increasing total.
    Counter,
    /// Point-in-time value.
    Gauge,
}

impl MetricKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Counter => "counter",
            Self::Gauge => "gauge",
        }
    }
}

/// A single metric sample.
#[derive(Debug, Clone)]
pub struct Metric {
    /// Metric name (e.g. `hearth_relay_bytes_stored`).
    pub name: String,
    /// One-line help text.
    pub help: String,
    /// Counter or gauge.
    pub kind: MetricKind,
    /// Label key/value pairs.
    pub labels: Vec<(String, String)>,
    /// The sample value.
    pub value: f64,
}

impl Metric {
    /// A new metric sample.
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        help: impl Into<String>,
        kind: MetricKind,
        value: f64,
    ) -> Self {
        Self {
            name: name.into(),
            help: help.into(),
            kind,
            labels: Vec::new(),
            value,
        }
    }

    /// Add a label.
    #[must_use]
    pub fn with_label(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.labels.push((key.into(), value.into()));
        self
    }
}

/// Lossless `u64 → f64` for metric values (Prometheus samples are floats).
#[allow(clippy::cast_precision_loss)]
fn as_f64(v: u64) -> f64 {
    v as f64
}

/// Render metrics to the Prometheus text exposition format.
///
/// Samples are grouped by name so each name emits one `# HELP` / `# TYPE` header
/// followed by its samples (valid exposition format).
#[must_use]
pub fn render_prometheus(metrics: &[Metric]) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    let mut emitted_header: Vec<&str> = Vec::new();

    for metric in metrics {
        if !emitted_header.contains(&metric.name.as_str()) {
            let _ = writeln!(out, "# HELP {} {}", metric.name, metric.help);
            let _ = writeln!(out, "# TYPE {} {}", metric.name, metric.kind.as_str());
            emitted_header.push(metric.name.as_str());
        }
        out.push_str(&metric.name);
        if !metric.labels.is_empty() {
            out.push('{');
            let rendered: Vec<String> = metric
                .labels
                .iter()
                .map(|(k, v)| format!("{k}=\"{}\"", escape_label(v)))
                .collect();
            out.push_str(&rendered.join(","));
            out.push('}');
        }
        let _ = writeln!(out, " {}", metric.value);
    }
    out
}

fn escape_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

// ---- typed aggregate snapshots ---------------------------------------------

/// Relay health and usage (relay-health dashboard).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayHealth {
    /// Relay instance name.
    pub instance: String,
    /// Whether the relay is healthy.
    pub healthy: bool,
    /// Blobs currently stored.
    pub blobs_stored: u64,
    /// Bytes currently stored.
    pub bytes_stored: u64,
    /// Configured byte quota.
    pub quota_bytes: u64,
    /// Total requests served.
    pub requests_total: u64,
    /// Total errors served.
    pub errors_total: u64,
}

impl RelayHealth {
    /// Render to metrics.
    #[must_use]
    pub fn to_metrics(&self) -> Vec<Metric> {
        let lbl = ("instance", self.instance.clone());
        vec![
            Metric::new(
                "hearth_relay_up",
                "Relay health (1=up)",
                MetricKind::Gauge,
                f64::from(u8::from(self.healthy)),
            )
            .with_label(lbl.0, lbl.1.clone()),
            Metric::new(
                "hearth_relay_blobs_stored",
                "Blobs stored",
                MetricKind::Gauge,
                as_f64(self.blobs_stored),
            )
            .with_label(lbl.0, lbl.1.clone()),
            Metric::new(
                "hearth_relay_bytes_stored",
                "Bytes stored",
                MetricKind::Gauge,
                as_f64(self.bytes_stored),
            )
            .with_label(lbl.0, lbl.1.clone()),
            Metric::new(
                "hearth_relay_quota_bytes",
                "Byte quota",
                MetricKind::Gauge,
                as_f64(self.quota_bytes),
            )
            .with_label(lbl.0, lbl.1.clone()),
            Metric::new(
                "hearth_relay_requests_total",
                "Total requests",
                MetricKind::Counter,
                as_f64(self.requests_total),
            )
            .with_label(lbl.0, lbl.1.clone()),
            Metric::new(
                "hearth_relay_errors_total",
                "Total errors",
                MetricKind::Counter,
                as_f64(self.errors_total),
            )
            .with_label(lbl.0, lbl.1),
        ]
    }
}

/// Aggregate version-adoption for a release (release-adoption dashboard, AC-OBS-3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseAdoption {
    /// Release version string.
    pub version: String,
    /// Channel (beta/stable).
    pub channel: String,
    /// Active installs on this version (aggregate count, no identities).
    pub active_installs: u64,
}

impl ReleaseAdoption {
    /// Render to a metric.
    #[must_use]
    pub fn to_metrics(&self) -> Vec<Metric> {
        vec![Metric::new(
            "hearth_release_active_installs",
            "Active installs by version (aggregate)",
            MetricKind::Gauge,
            as_f64(self.active_installs),
        )
        .with_label("version", self.version.clone())
        .with_label("channel", self.channel.clone())]
    }
}

/// Per-endpoint request/error counts (error-rates dashboard).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorRate {
    /// Service name.
    pub service: String,
    /// Endpoint / route.
    pub endpoint: String,
    /// Requests served.
    pub requests: u64,
    /// Errors served.
    pub errors: u64,
}

impl ErrorRate {
    /// The error ratio in `[0, 1]` (0 when no requests).
    #[must_use]
    pub fn ratio(&self) -> f64 {
        if self.requests == 0 {
            0.0
        } else {
            as_f64(self.errors) / as_f64(self.requests)
        }
    }

    /// Render to metrics.
    #[must_use]
    pub fn to_metrics(&self) -> Vec<Metric> {
        let with = |m: Metric| {
            m.with_label("service", self.service.clone())
                .with_label("endpoint", self.endpoint.clone())
        };
        vec![
            with(Metric::new(
                "hearth_requests_total",
                "Requests by endpoint",
                MetricKind::Counter,
                as_f64(self.requests),
            )),
            with(Metric::new(
                "hearth_errors_total",
                "Errors by endpoint",
                MetricKind::Counter,
                as_f64(self.errors),
            )),
            with(Metric::new(
                "hearth_error_rate",
                "Error ratio by endpoint",
                MetricKind::Gauge,
                self.ratio(),
            )),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_valid_exposition() {
        let health = RelayHealth {
            instance: "relay-eu".to_owned(),
            healthy: true,
            blobs_stored: 5,
            bytes_stored: 4096,
            quota_bytes: 1_000_000,
            requests_total: 100,
            errors_total: 2,
        };
        let text = render_prometheus(&health.to_metrics());
        assert!(text.contains("# TYPE hearth_relay_up gauge"));
        assert!(text.contains("hearth_relay_up{instance=\"relay-eu\"} 1"));
        assert!(text.contains("hearth_relay_bytes_stored{instance=\"relay-eu\"} 4096"));
    }

    #[test]
    fn release_adoption_is_aggregate(/* AC-OBS-3 */) {
        let a = ReleaseAdoption {
            version: "1.2.0".to_owned(),
            channel: "stable".to_owned(),
            active_installs: 4200,
        };
        let text = render_prometheus(&a.to_metrics());
        assert!(text
            .contains("hearth_release_active_installs{version=\"1.2.0\",channel=\"stable\"} 4200"));
    }

    #[test]
    fn error_rate_ratio() {
        let e = ErrorRate {
            service: "sync-relay".to_owned(),
            endpoint: "/blob".to_owned(),
            requests: 200,
            errors: 4,
        };
        assert!((e.ratio() - 0.02).abs() < 1e-9);
        let zero = ErrorRate {
            service: "s".to_owned(),
            endpoint: "/".to_owned(),
            requests: 0,
            errors: 0,
        };
        assert!((zero.ratio() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn one_header_per_metric_name() {
        let e = ErrorRate {
            service: "s".to_owned(),
            endpoint: "/a".to_owned(),
            requests: 10,
            errors: 1,
        };
        let mut metrics = e.to_metrics();
        metrics.extend(
            ErrorRate {
                service: "s".to_owned(),
                endpoint: "/b".to_owned(),
                requests: 20,
                errors: 0,
            }
            .to_metrics(),
        );
        let text = render_prometheus(&metrics);
        // Two endpoints, but only one HELP line per metric name.
        assert_eq!(text.matches("# HELP hearth_requests_total").count(), 1);
        assert_eq!(text.matches("hearth_requests_total{").count(), 2);
    }
}
