//! Role-based access control with least-privilege defaults (AC-ADMIN-1, 6).
//!
//! Every admin action maps to a single [`Action`]; an operator holds one
//! [`Role`]. [`can`] is the single decision point the API consults before any
//! state change, and a new operator defaults to [`Role::ReadOnly`], the minimum
//! role, so privilege is granted explicitly, never by default.

use serde::{Deserialize, Serialize};

/// An operator role. Ordered from least to most privileged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Read-only: observability and audit views only. The provisioning default.
    ReadOnly,
    /// Manages relay quotas and blob lifecycle.
    RelayOperator,
    /// Signs, publishes, and promotes releases.
    ReleaseManager,
    /// Publishes and revokes key-directory entries.
    KeyOfficer,
    /// Full control, including operator/role management.
    Owner,
}

/// A discrete admin action, each gated independently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// View service health / aggregate telemetry.
    ViewObservability,
    /// View the audit log.
    ViewAuditLog,
    /// View the key-directory transparency log.
    ViewTransparencyLog,
    /// Change relay quotas.
    ManageRelayQuota,
    /// Expire / reclaim relay blobs.
    ManageBlobLifecycle,
    /// Sign a release.
    SignRelease,
    /// Publish a release to the beta channel.
    PublishRelease,
    /// Promote a release to the stable channel.
    PromoteChannel,
    /// Publish a key-directory entry.
    PublishKey,
    /// Revoke a key-directory entry.
    RevokeKey,
    /// Provision operators and assign roles (Owner only).
    ManageOperators,
}

impl Role {
    /// A human-readable identifier (also the serialized form).
    pub fn label(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::RelayOperator => "relay_operator",
            Self::ReleaseManager => "release_manager",
            Self::KeyOfficer => "key_officer",
            Self::Owner => "owner",
        }
    }
}

/// The role a freshly-provisioned operator receives: the least privileged one
/// (`AC-ADMIN-6`). Elevation is always an explicit, audited Owner action.
#[must_use]
pub fn default_role() -> Role {
    Role::ReadOnly
}

/// Whether `role` may perform `action`.
///
/// Read views are available to every role; mutating actions require the
/// specific responsible role (or Owner). This is the sole authorization
/// decision point (`AC-ADMIN-1`).
#[must_use]
pub fn can(role: Role, action: Action) -> bool {
    use Action::{
        ManageBlobLifecycle, ManageOperators, ManageRelayQuota, PromoteChannel, PublishKey,
        PublishRelease, RevokeKey, SignRelease, ViewAuditLog, ViewObservability,
        ViewTransparencyLog,
    };

    // Owner can do everything.
    if role == Role::Owner {
        return true;
    }

    match action {
        // Read-only views: any authenticated operator.
        ViewObservability | ViewAuditLog | ViewTransparencyLog => true,
        // Relay operations.
        ManageRelayQuota | ManageBlobLifecycle => role == Role::RelayOperator,
        // Release operations.
        SignRelease | PublishRelease | PromoteChannel => role == Role::ReleaseManager,
        // Key-directory operations.
        PublishKey | RevokeKey => role == Role::KeyOfficer,
        // Operator management is Owner-only (handled by the early return).
        ManageOperators => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_operators_are_least_privileged() {
        assert_eq!(default_role(), Role::ReadOnly);
        // The default can only view, never mutate.
        assert!(can(Role::ReadOnly, Action::ViewObservability));
        assert!(can(Role::ReadOnly, Action::ViewAuditLog));
        assert!(!can(Role::ReadOnly, Action::ManageRelayQuota));
        assert!(!can(Role::ReadOnly, Action::SignRelease));
        assert!(!can(Role::ReadOnly, Action::ManageOperators));
    }

    #[test]
    fn roles_are_scoped_to_their_domain() {
        assert!(can(Role::RelayOperator, Action::ManageRelayQuota));
        assert!(!can(Role::RelayOperator, Action::SignRelease));
        assert!(can(Role::ReleaseManager, Action::PromoteChannel));
        assert!(!can(Role::ReleaseManager, Action::PublishKey));
        assert!(can(Role::KeyOfficer, Action::RevokeKey));
        assert!(!can(Role::KeyOfficer, Action::ManageRelayQuota));
    }

    #[test]
    fn only_owner_manages_operators() {
        for role in [
            Role::ReadOnly,
            Role::RelayOperator,
            Role::ReleaseManager,
            Role::KeyOfficer,
        ] {
            assert!(!can(role, Action::ManageOperators));
        }
        assert!(can(Role::Owner, Action::ManageOperators));
    }

    #[test]
    fn owner_can_do_anything() {
        for action in [
            Action::ViewObservability,
            Action::ManageRelayQuota,
            Action::SignRelease,
            Action::PublishKey,
            Action::ManageOperators,
        ] {
            assert!(can(Role::Owner, action));
        }
    }
}
