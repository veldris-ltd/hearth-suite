//! Hearth Suite Admin Control Panel API (P3.4, diagram 03b).
//!
//! Serves the operator console: the API under `/api` (RBAC-gated, fully audited,
//! WebAuthn-authenticated) and the static admin web build as a fallback. All
//! domain rules live in `hearth-admin-core`; this binary is the HTTP + auth
//! adapter. It has zero visibility into user document content.

mod auth;
mod routes;
mod state;

use std::net::SocketAddr;

use axum::http::{header, HeaderValue};
use axum::routing::get;
use axum::Router;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

use crate::state::AppState;

/// Apply standard security response headers. TLS is terminated upstream (the
/// ingress / load balancer); HSTS is emitted so browsers enforce HTTPS once
/// present. The admin panel serves a same-origin web build, so its CSP allows
/// `self` (the API-only services use a stricter `'none'` default).
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

#[tokio::main]
async fn main() {
    // Structured JSON logging. Events are built to pass the observability log
    // guard and routed through `redact` as a defensive sink, so no secret or
    // user content can reach a log line (AC-OBS-2).
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let rp_id = std::env::var("HEARTH_RP_ID").unwrap_or_else(|_| "localhost".to_owned());
    let rp_origin =
        std::env::var("HEARTH_RP_ORIGIN").unwrap_or_else(|_| "https://localhost".to_owned());
    let web_dir = std::env::var("HEARTH_ADMIN_WEB").unwrap_or_else(|_| "/srv/admin-web".to_owned());

    let state = AppState::new(&rp_id, &rp_origin).expect("valid WebAuthn relying-party config");

    let app = harden(
        Router::new()
            // Aggregate, content-free metrics for Prometheus (root path, AC-OBS-2).
            .route("/metrics", get(routes::metrics))
            .nest("/api", routes::router())
            .fallback_service(ServeDir::new(web_dir))
            .with_state(state),
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; \
         script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind admin-cp listener");
    axum::serve(listener, app)
        .await
        .expect("serve admin-cp");
}
