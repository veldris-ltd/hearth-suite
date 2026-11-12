//! WebAuthn admin authentication (AC-ADMIN-3).
//!
//! Sign-in requires a hardware-backed passkey. We use a usernameless
//! (discoverable) ceremony: `begin` issues a challenge, the operator's
//! authenticator signs it, and `finish` verifies the assertion and mints a
//! session. Operator → passkey registration is provisioned out-of-band by an
//! Owner (an audited `ManageOperators` action).

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::state::{AppState, OperatorSession};

/// Resolve the operator session from the `hearth_admin_session` cookie.
pub fn session_from_headers(state: &AppState, headers: &HeaderMap) -> Option<OperatorSession> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    let token = cookie
        .split(';')
        .find_map(|kv| kv.trim().strip_prefix("hearth_admin_session="))?;
    state.admin.lock().ok()?.sessions.get(token).cloned()
}

/// Begin a discoverable WebAuthn authentication; returns the challenge.
pub async fn begin(State(state): State<AppState>) -> Result<impl IntoResponse, StatusCode> {
    let (challenge, auth_state) = state
        .webauthn
        .start_discoverable_authentication()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let ceremony = Uuid::new_v4().to_string();
    state
        .admin
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .pending_auth
        .insert(ceremony.clone(), auth_state);

    // The ceremony id rides in a short-lived, HttpOnly cookie.
    let cookie = format!("hearth_admin_auth={ceremony}; HttpOnly; SameSite=Strict; Secure; Path=/");
    let body = serde_json::to_value(&challenge).unwrap_or(Value::Null);
    Ok(([(header::SET_COOKIE, cookie)], Json(body)))
}

/// Finish authentication: verify the assertion and establish a session.
///
/// The credential→operator mapping and passkey lookup are consulted here; on
/// success a random session token is issued. (TODO(P3.4): persist passkeys and
/// the credential→operator index in the operational DB; this scaffold holds them
/// in memory.)
pub async fn finish(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(assertion): Json<PublicKeyCredential>,
) -> Result<impl IntoResponse, StatusCode> {
    let ceremony = headers
        .get(header::COOKIE)
        .and_then(|c| c.to_str().ok())
        .and_then(|c| {
            c.split(';')
                .find_map(|kv| kv.trim().strip_prefix("hearth_admin_auth=").map(str::to_owned))
        })
        .ok_or(StatusCode::BAD_REQUEST)?;

    let auth_state = {
        let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        admin.pending_auth.remove(&ceremony).ok_or(StatusCode::BAD_REQUEST)?
    };

    // Resolve which enrolled operator this discoverable credential belongs to
    // (never a hardcoded account), then verify the assertion against THAT
    // operator's registered passkeys. An unknown credential is refused.
    let (operator, role, passkeys) = {
        let admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let (operator, role) = admin
            .directory
            .resolve(&assertion.id)
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let passkeys = admin.passkeys.get(&operator).cloned().unwrap_or_default();
        (operator, role, passkeys)
    };

    let keys: Vec<DiscoverableKey> = passkeys.iter().map(DiscoverableKey::from).collect();
    state
        .webauthn
        .finish_discoverable_authentication(&assertion, auth_state, &keys)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Mint a session token.
    let token = Uuid::new_v4().to_string();
    {
        let mut admin = state.admin.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        admin.sessions.insert(
            token.clone(),
            OperatorSession {
                operator: operator.clone(),
                role,
            },
        );
    }
    let cookie = format!("hearth_admin_session={token}; HttpOnly; SameSite=Strict; Secure; Path=/");
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "operator": operator, "role": role })),
    ))
}
