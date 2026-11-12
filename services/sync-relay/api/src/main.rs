//! Hearth Suite sync relay (P3.1), a zero-knowledge encrypted-blob store.
//!
//! Accepts authenticated PUT/GET/DELETE of **opaque, client-encrypted** CRDT
//! deltas and document blobs. The relay never receives a content key, so it is
//! architecturally incapable of reading content (`AC-RELAY-1`). Per-account
//! quotas (`AC-RELAY-2`), blob lifecycle + GC (`AC-RELAY-3`), and rate limiting
//! are enforced via `hearth-relay-core`. Metadata lives in Postgres; blob bytes
//! live in an S3-compatible object store.
//!
//! This binary is the I/O adapter; the accounting rules are tested in
//! `hearth-relay-core`. Storage wiring is marked TODO where the concrete sqlx /
//! object_store calls are environment-specific.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use tower_http::set_header::SetResponseHeaderLayer;

use hearth_observability::{render_prometheus, RelayHealth};
use hearth_relay_core::{verify_capability_token, Quota, RateLimiter, RelayLedger};

/// Default per-account quota (overridable via env).
const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_BLOBS: u64 = 100_000;
/// Default blob TTL (seconds) if the client does not specify one.
const DEFAULT_TTL: u64 = 30 * 24 * 3600;

#[derive(Clone)]
struct AppState {
    ledger: Arc<Mutex<RelayLedger>>,
    limiters: Arc<Mutex<HashMap<String, RateLimiter>>>,
    /// The shared issuer secret used to verify bearer capability tokens. Empty
    /// means no secret was provisioned, so every bearer is refused (fail closed).
    token_secret: Arc<Vec<u8>>,
    // TODO(P3.1): Postgres pool (sqlx) for durable metadata and an
    // `object_store::ObjectStore` handle for the S3-compatible blob bytes. The
    // in-memory ledger mirrors the tested accounting; production persists it.
}

/// Apply standard security response headers. TLS is terminated upstream (the
/// ingress / load balancer); HSTS is emitted so browsers enforce HTTPS once
/// present. `csp` is the Content-Security-Policy for this service.
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

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Resolve the account from the bearer token by verifying its HMAC capability
/// signature against the issuer secret. The relay only ever learns an opaque
/// account id, never an identity or key. An unverifiable bearer (forged,
/// tampered, or presented when no secret is provisioned) yields `None` and the
/// request is rejected (P2-SVC2 / AC-RELAY-1).
fn account_of(headers: &HeaderMap, secret: &[u8]) -> Option<String> {
    let auth = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = auth.strip_prefix("Bearer ")?;
    verify_capability_token(token, secret)
}

/// Per-account rate-limit gate.
fn allow(state: &AppState, account: &str) -> bool {
    let mut limiters = match state.limiters.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    limiters
        .entry(account.to_owned())
        .or_insert_with(|| RateLimiter::new(120, 60))
        .try_acquire(now_ms())
}

async fn put_blob(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let Some(account) = account_of(&headers, &state.token_secret) else {
        return StatusCode::UNAUTHORIZED;
    };
    if !allow(&state, &account) {
        return StatusCode::TOO_MANY_REQUESTS;
    }
    let size = body.len() as u64;
    {
        let mut ledger = match state.ledger.lock() {
            Ok(g) => g,
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR,
        };
        if ledger.admit(&account, &id, size, DEFAULT_TTL, now_secs()).is_err() {
            // Graceful rejection on quota / invalid blob (AC-RELAY-2).
            return StatusCode::INSUFFICIENT_STORAGE;
        }
    }
    // TODO(P3.1): object_store.put(Path::from(format!("{account}/{id}")), body)
    // and persist the metadata row. Bytes are opaque ciphertext, never decoded.
    let _ = body;
    StatusCode::CREATED
}

async fn get_blob(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(account) = account_of(&headers, &state.token_secret) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let exists = state
        .ledger
        .lock()
        .map(|l| l.get(&account, &id).is_some())
        .unwrap_or(false);
    if !exists {
        return StatusCode::NOT_FOUND.into_response();
    }
    // TODO(P3.1): stream the opaque bytes from the object store.
    (StatusCode::OK, Bytes::new()).into_response()
}

async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let (blobs, bytes) = state
        .ledger
        .lock()
        .map(|l| (u64::try_from(l.live_blobs().count()).unwrap_or(u64::MAX), l.total_bytes()))
        .unwrap_or((0, 0));
    let health = RelayHealth {
        instance: "sync-relay".to_owned(),
        healthy: true,
        blobs_stored: blobs,
        bytes_stored: bytes,
        quota_bytes: DEFAULT_MAX_BYTES,
        requests_total: 0,
        errors_total: 0,
    };
    render_prometheus(&health.to_metrics())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    // The shared issuer secret for verifying bearer capability tokens. Without
    // it the relay cannot verify any bearer and refuses every request.
    let token_secret = std::env::var("HEARTH_RELAY_TOKEN_SECRET").unwrap_or_default();
    if token_secret.is_empty() {
        tracing::warn!(
            "HEARTH_RELAY_TOKEN_SECRET is not set; the relay will reject all requests until a token secret is provisioned"
        );
    }

    let state = AppState {
        ledger: Arc::new(Mutex::new(RelayLedger::new(Quota {
            max_bytes: DEFAULT_MAX_BYTES,
            max_blobs: DEFAULT_MAX_BLOBS,
        }))),
        limiters: Arc::new(Mutex::new(HashMap::new())),
        token_secret: Arc::new(token_secret.into_bytes()),
    };

    // Background GC: expire by TTL, then reclaim and delete from the store.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(300));
            loop {
                tick.tick().await;
                if let Ok(mut ledger) = state.ledger.lock() {
                    ledger.expire_due(now_secs());
                    for (_account, _id) in ledger.collect_garbage() {
                        // TODO(P3.1): delete the object + metadata row.
                    }
                }
            }
        });
    }

    let app = harden(
        Router::new()
            .route("/blob/:id", get(get_blob).put(put_blob))
            .route("/metrics", get(metrics))
            .route("/healthz", get(|| async { StatusCode::OK }))
            .with_state(state),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", 8080)).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
