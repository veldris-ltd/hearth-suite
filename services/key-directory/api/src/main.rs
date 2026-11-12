//! Hearth Suite key directory (P3.2).
//!
//! Publishes users' **public** post-quantum keys (ML-KEM encapsulation + ML-DSA
//! verifying keys, plus the X25519 public half) for recipient lookup, with
//! publish/revoke and an append-only transparency log so key substitution is
//! detectable. It never stores private keys (`AC-KEYDIR-1..3`). The directory is
//! optional, clients can also exchange keys peer-to-peer (QR / contact card).
//!
//! Domain logic (validation, log, substitution detection) is tested in
//! `hearth-key-directory-core`; this binary is the HTTP/persistence adapter.

use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::set_header::SetResponseHeaderLayer;

use hearth_key_directory_core::KeyDirectory;

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
    dir: Arc<Mutex<KeyDirectory>>,
    // TODO(P3.2): Postgres pool for durable entries + the append-only log.
}

/// Publish (or rotate) a public identity. Body is the raw `PublicIdentity` bytes.
async fn publish(State(state): State<AppState>, body: Bytes) -> impl IntoResponse {
    let mut dir = match state.dir.lock() {
        Ok(g) => g,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "lock" }))),
    };
    match dir.publish(&body) {
        Ok(key_id) => (StatusCode::CREATED, Json(json!({ "key_id": key_id }))),
        // Only valid public-key material is accepted (AC-KEYDIR-1).
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() }))),
    }
}

/// Look up an active public key for recipient sealing.
async fn lookup(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let dir = match state.dir.lock() {
        Ok(g) => g,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match dir.lookup(&id) {
        Some(entry) => Json(serde_json::to_value(entry).unwrap_or(Value::Null)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Revoke a key (recorded in the transparency log).
async fn revoke(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let mut dir = match state.dir.lock() {
        Ok(g) => g,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR,
    };
    match dir.revoke(&id) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

/// The full transparency log, clients verify the hash chain (AC-KEYDIR-2/3).
async fn log(State(state): State<AppState>) -> impl IntoResponse {
    let dir = match state.dir.lock() {
        Ok(g) => g,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    Json(serde_json::to_value(dir.log().events()).unwrap_or(Value::Null)).into_response()
}

#[derive(Deserialize)]
struct InclusionQuery {
    seq: u64,
    hash: String,
}

/// Verify an event's inclusion (a client cross-checks a pinned event).
async fn inclusion(
    State(state): State<AppState>,
    Query(q): Query<InclusionQuery>,
) -> impl IntoResponse {
    let dir = match state.dir.lock() {
        Ok(g) => g,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR,
    };
    match dir.log().verify_inclusion(q.seq, &q.hash) {
        Ok(()) => StatusCode::OK,
        Err(_) => StatusCode::CONFLICT,
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();
    let state = AppState {
        dir: Arc::new(Mutex::new(KeyDirectory::new())),
    };
    let app = harden(
        Router::new()
            .route("/keys", axum::routing::put(publish))
            .route("/keys/:id", get(lookup).delete(revoke))
            .route("/log", get(log))
            .route("/log/inclusion", get(inclusion))
            .route("/healthz", get(|| async { StatusCode::OK }))
            .with_state(state),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", 8080)).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
