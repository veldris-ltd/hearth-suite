//! Hearth Suite release/update service (P3.3), The Update Framework (TUF).
//!
//! Serves TUF-signed targets metadata per channel (`beta`, `stable`) and accepts
//! publishes from the CI signing step. Crucially, it **verifies metadata against
//! the configured roots before accepting or serving it**, and clients re-verify
//! signatures + hashes against their own pinned roots before installing, so a
//! compromised mirror serving a tampered artifact fails verification on the
//! client (`AC-REL-1..3`, diagram 06d). The verification logic is the tested
//! `hearth-release` crate, identical to what the client runs.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use tower_http::set_header::SetResponseHeaderLayer;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_observability::{render_prometheus, Metric, MetricKind};
use hearth_release::{Channel, ReleaseMetadata, TrustedRoots};
use hearth_seal::ReleaseVerifyingKey;

/// Apply standard security response headers. TLS is terminated upstream (the
/// ingress / load balancer); HSTS is emitted so browsers enforce HTTPS once
/// present.
fn harden(router: Router, csp: &'static str) -> Router {
    router
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(csp),
        ))
}

#[derive(Clone)]
struct AppState {
    /// Channel name -> the currently-published, verified metadata JSON.
    channels: Arc<Mutex<HashMap<String, ReleaseMetadata>>>,
    roots: Arc<TrustedRoots>,
    /// Bearer token the CI signing step presents to publish.
    publish_token: Arc<Option<String>>,
}

/// Build the pinned root set from the environment (provisioned by the operator).
fn pinned_roots() -> TrustedRoots {
    let mut roots = TrustedRoots::new();
    if let (Ok(id), Ok(b64)) = (
        std::env::var("HEARTH_ROOT_KEY_ID"),
        std::env::var("HEARTH_ROOT_PUBKEY_B64"),
    ) {
        if let Ok(bytes) = B64.decode(b64) {
            if let Ok(key) = ReleaseVerifyingKey::from_bytes(&bytes) {
                roots.insert(id, key);
            }
        }
    }
    roots
}

/// Serve a channel's signed metadata. Clients verify it against their own pinned
/// roots before installing (AC-REL-2/3).
async fn targets(State(state): State<AppState>, Path(channel): Path<String>) -> impl IntoResponse {
    if Channel::parse(&channel).is_none() {
        return (StatusCode::NOT_FOUND, String::new()).into_response();
    }
    let channels = match state.channels.lock() {
        Ok(g) => g,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match channels.get(&channel).and_then(|m| m.to_json().ok()) {
        Some(json) => ([(header::CONTENT_TYPE, "application/json")], json).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Publish signed metadata for a channel (CI signing step). The service verifies
/// the signature against its configured roots before storing, a mirror cannot
/// inject unsigned/tampered metadata (AC-REL-1/3).
async fn publish(
    State(state): State<AppState>,
    Path(channel): Path<String>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    if Channel::parse(&channel).is_none() {
        return StatusCode::NOT_FOUND;
    }
    // Authenticate the publisher.
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if state.publish_token.as_ref().as_deref() != presented {
        return StatusCode::UNAUTHORIZED;
    }
    let Ok(metadata) = ReleaseMetadata::from_json(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    // Verify the signature against the pinned roots before accepting.
    if metadata.verify(&state.roots).is_err() {
        return StatusCode::UNPROCESSABLE_ENTITY;
    }
    match state.channels.lock() {
        Ok(mut c) => {
            c.insert(channel, metadata);
            StatusCode::CREATED
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Aggregate metric: current published version per channel.
async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let metrics: Vec<Metric> = match state.channels.lock() {
        Ok(c) => c
            .iter()
            .map(|(channel, m)| {
                Metric::new(
                    "hearth_release_channel_version",
                    "Current published metadata version per channel",
                    MetricKind::Gauge,
                    f64::from(m.signed.version),
                )
                .with_label("channel", channel.clone())
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    render_prometheus(&metrics)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let state = AppState {
        channels: Arc::new(Mutex::new(HashMap::new())),
        roots: Arc::new(pinned_roots()),
        publish_token: Arc::new(std::env::var("HEARTH_PUBLISH_TOKEN").ok()),
    };
    let app = harden(
        Router::new()
            .route("/:channel/targets.json", get(targets))
            .route("/:channel/publish", post(publish))
            .route("/metrics", get(metrics))
            .route("/healthz", get(|| async { StatusCode::OK }))
            .with_state(state),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", 8080)).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
