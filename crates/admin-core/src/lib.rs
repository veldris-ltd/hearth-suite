//! Admin Control Panel domain logic (P3.4, diagram 03b).
//!
//! The auditable heart of the operator console for Veldris (or any self-hoster)
//! running the optional cloud. It is deliberately I/O-free, no HTTP, no
//! database, no secrets, so every rule that matters can be unit-tested:
//!
//! - [`rbac`], least-privilege role/permission policy (`AC-ADMIN-1`, `AC-ADMIN-6`).
//! - [`audit`], append-only, hash-chained, signable audit log (`AC-ADMIN-2`).
//! - [`relay`], quotas and blob lifecycle over content-free metadata (`AC-ADMIN-5`).
//! - [`release`], sign/publish/promote channels, verified via [`hearth_release`]
//!   (`AC-ADMIN-5`).
//! - [`keydir`], publish/revoke with an append-only transparency log.
//! - [`telemetry`], aggregate health plus a content-redaction guard (`AC-ADMIN-4`).
//!
//! Strong admin auth (WebAuthn, `AC-ADMIN-3`) is enforced at the API/transport
//! layer (`services/admin-cp`), not here. Nothing in this crate can read user
//! document content: relay and telemetry types carry only opaque ids, counts,
//! and hashes, consistent with the zero-knowledge relay.

mod hash;

pub mod audit;
pub mod error;
pub mod keydir;
pub mod operators;
pub mod rbac;
pub mod relay;
pub mod release;
pub mod telemetry;

pub use error::{Error, Result};

#[cfg(test)]
mod tests {
    //! Cross-module flow: an authorized action is performed and audited; an
    //! unauthorized one is denied and *also* audited (AC-ADMIN-1 + 2 together).

    use crate::audit::{AuditLog, Outcome};
    use crate::rbac::{can, Action, Role};

    /// Attempt an action under RBAC, recording the outcome to the audit log.
    fn attempt(
        log: &mut AuditLog,
        at: u64,
        actor: &str,
        role: Role,
        action: Action,
        target: &str,
    ) -> bool {
        let allowed = can(role, action);
        let outcome = if allowed {
            Outcome::Allowed
        } else {
            Outcome::Denied
        };
        log.record(at, actor, format!("{action:?}"), target, outcome);
        allowed
    }

    #[test]
    fn authorized_and_denied_actions_are_both_audited() {
        let mut log = AuditLog::new();

        // A read-only operator is denied a relay change…
        assert!(!attempt(
            &mut log,
            1,
            "carol",
            Role::ReadOnly,
            Action::ManageRelayQuota,
            "relay-eu",
        ));
        // …and the relay operator succeeds.
        assert!(attempt(
            &mut log,
            2,
            "dave",
            Role::RelayOperator,
            Action::ManageRelayQuota,
            "relay-eu",
        ));

        assert_eq!(log.entries().len(), 2);
        assert_eq!(log.entries()[0].outcome, Outcome::Denied);
        assert_eq!(log.entries()[1].outcome, Outcome::Allowed);
        assert!(log.verify_chain().is_ok());
    }
}
