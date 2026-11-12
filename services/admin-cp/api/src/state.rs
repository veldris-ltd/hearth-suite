//! Shared service state.
//!
//! For the scaffold the operational state is held in memory behind a mutex;
//! production wires the same `hearth-admin-core` structures to the operational
//! database and encrypted object store (diagram 03b). None of this state can
//! hold user document content, only opaque ids, counts, and hashes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hearth_admin_core::audit::AuditLog;
use hearth_admin_core::keydir::TransparencyLog;
use hearth_admin_core::operators::OperatorDirectory;
use hearth_admin_core::rbac::Role;
use hearth_admin_core::relay::{Quota, RelayState};
use hearth_admin_core::release::ReleaseRecord;
use hearth_release::{ReleaseMetadata, TrustedRoots};
use hearth_seal::ReleaseVerifyingKey;
use webauthn_rs::prelude::*;

/// A signed-in operator session.
#[derive(Clone)]
pub struct OperatorSession {
    pub operator: String,
    pub role: Role,
}

/// The mutable admin domain state.
pub struct AdminState {
    pub audit: AuditLog,
    pub relay: RelayState,
    pub keydir: TransparencyLog,
    pub releases: Vec<ReleaseRecord>,
    /// Signed metadata per release version, kept so a promotion can re-verify
    /// the build against the trusted roots before moving it to stable.
    pub release_metadata: HashMap<u32, ReleaseMetadata>,
    /// Pinned release-signing roots (provisioned from the environment).
    pub roots: TrustedRoots,
    /// The credential -> operator + role directory (sign-in resolves here, never
    /// a fixed account).
    pub directory: OperatorDirectory,
    /// Active session tokens → session.
    pub sessions: HashMap<String, OperatorSession>,
    /// In-flight WebAuthn (discoverable) authentication ceremonies by id.
    pub pending_auth: HashMap<String, DiscoverableAuthentication>,
    /// Registered passkeys per operator.
    pub passkeys: HashMap<String, Vec<Passkey>>,
}

impl AdminState {
    fn new() -> Self {
        // The bootstrap owner is provisioned out-of-band; their passkey is
        // enrolled on first run. Every other operator defaults to the
        // least-privileged role (AC-ADMIN-6).
        let mut directory = OperatorDirectory::new();
        directory.provision("owner", Role::Owner);
        Self {
            audit: AuditLog::new(),
            relay: RelayState::new(Quota {
                max_bytes: 10 * 1024 * 1024 * 1024,
                max_blobs: 100_000,
            }),
            keydir: TransparencyLog::new(),
            releases: Vec::new(),
            release_metadata: HashMap::new(),
            roots: pinned_roots_from_env(),
            directory,
            sessions: HashMap::new(),
            pending_auth: HashMap::new(),
            passkeys: HashMap::new(),
        }
    }

    /// Invite a new operator at the least-privileged role; returns the role.
    pub fn provision(&mut self, operator: &str) -> Role {
        self.directory.invite(operator)
    }
}

/// Build the pinned release-signing roots from the environment (provisioned by
/// the operator, matching the signer's key id + public key).
fn pinned_roots_from_env() -> TrustedRoots {
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

/// Application state shared across handlers.
#[derive(Clone)]
pub struct AppState {
    pub admin: Arc<Mutex<AdminState>>,
    pub webauthn: Arc<Webauthn>,
}

impl AppState {
    /// Build the service state, configuring the WebAuthn relying party.
    ///
    /// # Errors
    /// Returns an error if the relying-party origin is invalid.
    pub fn new(rp_id: &str, rp_origin: &str) -> Result<Self, WebauthnError> {
        let origin = url::Url::parse(rp_origin).map_err(|_| WebauthnError::Configuration)?;
        let webauthn = WebauthnBuilder::new(rp_id, &origin)?
            .rp_name("Hearth Suite Admin")
            .build()?;
        Ok(Self {
            admin: Arc::new(Mutex::new(AdminState::new())),
            webauthn: Arc::new(webauthn),
        })
    }
}
