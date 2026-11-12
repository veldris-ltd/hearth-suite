//! HTTP routes. Each mutating handler enforces RBAC via `hearth-admin-core` and
//! records the attempt, allowed or denied, to the immutable audit log
//! (AC-ADMIN-1, 2, 5). View handlers expose only aggregates, ids, and hashes
//! (AC-ADMIN-4).

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use hearth_admin_core::audit::Outcome;
use hearth_admin_core::rbac::{can, Action};
use hearth_admin_core::relay::Quota;
use hearth_admin_core::release::{promote_to_stable, publish_beta, Channel};
use hearth_observability::{render_prometheus, RelayHealth};
use hearth_release::ReleaseMetadata;

use crate::auth;
use crate::state::{AppState, OperatorSession};

/// Build the API router (mounted under `/api`).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/webauthn/begin", post(auth::begin))
        .route("/auth/webauthn/finish", post(auth::finish))
        .route("/auth/session", get(session_view))
        .route("/observability/health", get(health))
        .route("/audit", get(audit_log))
        .route("/relay/quota", get(get_quota).post(set_quota))
        .route("/relay/blobs", get(relay_blobs))
        .route("/relay/reclaim", post(reclaim))
        .route("/releases", get(releases))
        .route("/releases/publish", post(publish))
        .route("/releases/promote", post(promote))
        .route("/keydir/log", get(keydir_log))
        .route("/keydir/revoke", post(revoke_key))
}

/// Prometheus metrics endpoint (aggregate, content-free, AC-OBS-2).
///
/// Mounted at the root (`/metrics`), unauthenticated, for in-cluster scraping;
/// it exposes only counts/gauges, never identities or content.
pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let body = {
        let admin = match state.admin.lock() {
            Ok(g) => g,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, String::new()),
        };
        let health = RelayHealth {
            instance: "admin-cp".to_owned(),
            healthy: true,
            blobs_stored: admin.relay.used_blobs(),
            bytes_stored: admin.relay.used_bytes(),
            quota_bytes: admin.relay.quota().max_bytes,
            requests_total: 0,
            errors_total: 0,
        };
        render_prometheus(&health.to_metrics())
    };
    (StatusCode::OK, body)
}

/// Current unix time in seconds (for audit timestamps).
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Extract the operator session from the session cookie, or 401.
fn require_session(state: &AppState, headers: &HeaderMap) -> Result<OperatorSession, StatusCode> {
    auth::session_from_headers(state, headers).ok_or(StatusCode::UNAUTHORIZED)
}

/// Check RBAC and record the attempt to the audit log; 403 if denied.
fn authorize(
    state: &AppState,
    session: &OperatorSession,
    action: Action,
    target: &str,
) -> Result<(), StatusCode> {
    let allowed = can(session.role, action);
    let outcome = if allowed {
        Outcome::Allowed
    } else {
        Outcome::Denied
    };
    {
        let mut admin = state
            .admin
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        admin
            .audit
            .record(now_secs(), &session.operator, format!("{action:?}"), target, outcome);
    }
    if allowed {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

async fn session_view(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    Ok(Json(json!({ "operator": session.operator, "role": session.role })))
}

async fn health(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewObservability, "health")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Aggregate-only snapshot (never user content, AC-ADMIN-4).
    Ok(Json(json!([{
        "service": "sync-relay",
        "healthy": true,
        "uptime_seconds": now_secs(),
        "requests_total": 0,
        "error_rate_milli": 0,
        "blobs_stored": admin.relay.used_blobs(),
        "bytes_stored": admin.relay.used_bytes(),
    }])))
}

async fn audit_log(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewAuditLog, "audit")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::to_value(admin.audit.entries()).unwrap_or(Value::Null)))
}

async fn get_quota(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewObservability, "relay/quota")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::to_value(admin.relay.quota()).unwrap_or(Value::Null)))
}

async fn set_quota(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(quota): Json<Quota>,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ManageRelayQuota, "relay/quota")?;
    let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    admin.relay.set_quota(quota);
    Ok(Json(serde_json::to_value(admin.relay.quota()).unwrap_or(Value::Null)))
}

async fn relay_blobs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewObservability, "relay/blobs")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::to_value(admin.relay.blobs()).unwrap_or(Value::Null)))
}

async fn reclaim(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ManageBlobLifecycle, "relay/reclaim")?;
    let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = now_secs();
    admin.relay.expire_due(now);
    let reclaimed = admin.relay.reclaim_expired();
    Ok(Json(json!({ "reclaimed": reclaimed })))
}

async fn releases(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewObservability, "releases")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::to_value(&admin.releases).unwrap_or(Value::Null)))
}

/// Publish signed release metadata to the beta channel. The metadata must
/// verify against the pinned roots first (reusing the client's verification),
/// so an operator can only publish a build a client would itself accept.
async fn publish(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::PublishRelease, "release/publish")?;
    let metadata = ReleaseMetadata::from_json(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let record = publish_beta(&metadata, &admin.roots).map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;
    admin.release_metadata.insert(record.version, metadata);
    if let Some(slot) = admin.releases.iter_mut().find(|r| r.version == record.version) {
        *slot = record.clone();
    } else {
        admin.releases.push(record.clone());
    }
    Ok(Json(serde_json::to_value(&record).unwrap_or(Value::Null)))
}

#[derive(Deserialize)]
struct PromoteReq {
    version: u32,
}

/// Promote a beta release to stable, re-verifying the stored signed metadata
/// against the pinned roots first (`hearth_admin_core::release::promote_to_stable`).
async fn promote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PromoteReq>,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::PromoteChannel, &format!("release/{}", req.version))?;
    let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let record = admin
        .releases
        .iter()
        .find(|r| r.version == req.version && r.channel == Channel::Beta)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)?;
    let metadata = admin
        .release_metadata
        .get(&req.version)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)?;
    let promoted =
        promote_to_stable(&record, &metadata, &admin.roots).map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;
    if let Some(slot) = admin.releases.iter_mut().find(|r| r.version == req.version) {
        *slot = promoted.clone();
    }
    Ok(Json(serde_json::to_value(&promoted).unwrap_or(Value::Null)))
}

async fn keydir_log(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::ViewTransparencyLog, "keydir/log")?;
    let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::to_value(admin.keydir.events()).unwrap_or(Value::Null)))
}

#[derive(Deserialize)]
struct RevokeReq {
    key_id: String,
}

async fn revoke_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RevokeReq>,
) -> Result<impl IntoResponse, StatusCode> {
    let session = require_session(&state, &headers)?;
    authorize(&state, &session, Action::RevokeKey, &format!("key/{}", req.key_id))?;
    let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let event = serde_json::to_value(admin.keydir.revoke(req.key_id)).unwrap_or(Value::Null);
    Ok((StatusCode::OK, header::HeaderMap::new(), Json(event)))
}
