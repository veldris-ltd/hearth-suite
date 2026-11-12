//! The operator directory: which WebAuthn credential belongs to which operator,
//! and what role that operator holds (P2-SVC2).
//!
//! Admin sign-in is usernameless: the authenticator presents a discoverable
//! credential, and the service must resolve *which enrolled operator* that
//! credential belongs to, never assume a fixed account. This directory is that
//! mapping. Enrollment (`enroll`) is an audited Owner action; sign-in calls
//! [`OperatorDirectory::resolve`] with the verified credential id.
//!
//! It holds only opaque ids and roles, never key material or user content.

use std::collections::BTreeMap;

use crate::rbac::{default_role, Role};

/// Maps credential ids to operators, and operators to roles.
#[derive(Debug, Default, Clone)]
pub struct OperatorDirectory {
    /// Credential id (base64url) -> operator id.
    cred_to_operator: BTreeMap<String, String>,
    /// Operator id -> assigned role.
    roles: BTreeMap<String, Role>,
}

impl OperatorDirectory {
    /// An empty directory.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Provision an operator at a role *without* a credential yet (e.g. the
    /// bootstrap owner, or an Invite that awaits passkey enrollment).
    pub fn provision(&mut self, operator: &str, role: Role) {
        self.roles.insert(operator.to_owned(), role);
    }

    /// Invite a new operator at the least-privileged role (`AC-ADMIN-6`),
    /// returning the role assigned.
    pub fn invite(&mut self, operator: &str) -> Role {
        let role = default_role();
        self.roles.insert(operator.to_owned(), role);
        role
    }

    /// Enroll a verified credential for an operator. The operator must already
    /// be provisioned; enrollment binds the credential to them.
    ///
    /// Returns `false` if the operator is not provisioned (enroll is refused).
    pub fn enroll(&mut self, credential_id: &str, operator: &str) -> bool {
        if !self.roles.contains_key(operator) {
            return false;
        }
        self.cred_to_operator
            .insert(credential_id.to_owned(), operator.to_owned());
        true
    }

    /// Resolve a signed-in credential to its `(operator, role)`, or `None` if the
    /// credential is not enrolled. This is what sign-in uses instead of assuming
    /// a fixed operator.
    #[must_use]
    pub fn resolve(&self, credential_id: &str) -> Option<(String, Role)> {
        let operator = self.cred_to_operator.get(credential_id)?;
        let role = *self.roles.get(operator)?;
        Some((operator.clone(), role))
    }

    /// The role assigned to `operator`, if provisioned.
    #[must_use]
    pub fn role_of(&self, operator: &str) -> Option<Role> {
        self.roles.get(operator).copied()
    }

    /// Reassign an operator's role (an audited Owner action).
    pub fn set_role(&mut self, operator: &str, role: Role) -> bool {
        if let Some(slot) = self.roles.get_mut(operator) {
            *slot = role;
            true
        } else {
            false
        }
    }

    /// Whether a credential is enrolled.
    #[must_use]
    pub fn is_enrolled(&self, credential_id: &str) -> bool {
        self.cred_to_operator.contains_key(credential_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_credential_to_its_enrolled_operator_and_role() {
        let mut dir = OperatorDirectory::new();
        dir.provision("ops.lena", Role::KeyOfficer);
        assert!(dir.enroll("cred-AAA", "ops.lena"));

        // The credential resolves to its operator and role, never a fixed owner.
        assert_eq!(
            dir.resolve("cred-AAA"),
            Some(("ops.lena".to_owned(), Role::KeyOfficer))
        );
    }

    #[test]
    fn an_unknown_credential_does_not_resolve() {
        let dir = OperatorDirectory::new();
        assert_eq!(dir.resolve("cred-unknown"), None);
        assert!(!dir.is_enrolled("cred-unknown"));
    }

    #[test]
    fn enrollment_requires_a_provisioned_operator() {
        let mut dir = OperatorDirectory::new();
        // No operator provisioned -> enrollment refused -> credential unknown.
        assert!(!dir.enroll("cred-X", "ghost"));
        assert_eq!(dir.resolve("cred-X"), None);
    }

    #[test]
    fn invite_defaults_to_least_privilege_and_promotion_is_explicit() {
        let mut dir = OperatorDirectory::new();
        assert_eq!(dir.invite("ops.new"), Role::ReadOnly);
        dir.enroll("cred-N", "ops.new");
        assert_eq!(
            dir.resolve("cred-N"),
            Some(("ops.new".to_owned(), Role::ReadOnly))
        );

        // An Owner later elevates them; the credential now resolves at the new role.
        assert!(dir.set_role("ops.new", Role::ReleaseManager));
        assert_eq!(
            dir.resolve("cred-N"),
            Some(("ops.new".to_owned(), Role::ReleaseManager))
        );
    }

    #[test]
    fn distinct_credentials_resolve_to_distinct_operators() {
        let mut dir = OperatorDirectory::new();
        dir.provision("owner", Role::Owner);
        dir.provision("ops.bryce", Role::RelayOperator);
        dir.enroll("cred-owner", "owner");
        dir.enroll("cred-bryce", "ops.bryce");

        assert_eq!(dir.resolve("cred-owner").unwrap().1, Role::Owner);
        assert_eq!(dir.resolve("cred-bryce").unwrap().1, Role::RelayOperator);
    }
}
