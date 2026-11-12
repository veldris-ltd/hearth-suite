//! The set of pinned TUF root keys a client trusts.
//!
//! A client ships with one or more [`ReleaseVerifyingKey`]s baked into its
//! binary (the "TUF roots" of diagram 06d). An update is only ever trusted if
//! its metadata carries a signature that verifies under one of these pinned
//! keys, there is no trust-on-first-use and no network-fetched root.

use std::collections::BTreeMap;

use hearth_seal::ReleaseVerifyingKey;

/// A pinned set of trusted release-signing keys, indexed by key id.
#[derive(Default)]
pub struct TrustedRoots {
    keys: BTreeMap<String, ReleaseVerifyingKey>,
}

impl TrustedRoots {
    /// An empty root set.
    #[must_use]
    pub fn new() -> Self {
        Self {
            keys: BTreeMap::new(),
        }
    }

    /// Add a pinned key, returning `self` for chaining.
    #[must_use]
    pub fn with_key(mut self, keyid: impl Into<String>, key: ReleaseVerifyingKey) -> Self {
        self.keys.insert(keyid.into(), key);
        self
    }

    /// Add a pinned key in place.
    pub fn insert(&mut self, keyid: impl Into<String>, key: ReleaseVerifyingKey) {
        self.keys.insert(keyid.into(), key);
    }

    /// The pinned key for `keyid`, if any.
    #[must_use]
    pub fn get(&self, keyid: &str) -> Option<&ReleaseVerifyingKey> {
        self.keys.get(keyid)
    }

    /// Whether no keys are pinned.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// The number of pinned keys.
    #[must_use]
    pub fn len(&self) -> usize {
        self.keys.len()
    }
}
