//! The CRDT document: a last-writer-wins keyed map with version history.
//!
//! Each key holds the operation with the greatest [`Timestamp`] seen for it
//! (Lamport counter, replica tiebreak). Because the merge per key is the
//! commutative, associative, idempotent "take the max-timestamp op", replicas
//! that have seen the same set of operations, in any order, converge to
//! identical state (`AC-SYNC-2`).

use std::collections::{BTreeMap, BTreeSet};

use crate::error::Result;
use crate::ops::{Delta, Key, LocalOp, Op, OpKind, ReplicaId, Timestamp, Value};

/// The winning operation currently held at a key.
#[derive(Debug, Clone, PartialEq)]
struct Register {
    ts: Timestamp,
    kind: OpKind,
}

/// A named, restorable snapshot of the document's materialized state.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    /// Sequential version id.
    pub id: usize,
    /// Human-readable label.
    pub label: String,
    /// The materialized key/value state at this version.
    pub state: BTreeMap<Key, Value>,
}

/// A local-first CRDT document.
///
/// All editing is local; nothing leaves the device unless the caller explicitly
/// [`encode_delta`](Document::encode_delta)s and sends it. The engine never
/// performs any network I/O (`AC-SYNC-1`).
pub struct Document {
    replica: ReplicaId,
    clock: u64,
    registers: BTreeMap<Key, Register>,
    log: Vec<Op>,
    applied: BTreeSet<(u64, ReplicaId)>,
    versions: Vec<Version>,
}

impl Document {
    /// Create an empty document for the given replica id.
    pub fn new(replica: ReplicaId) -> Self {
        Self {
            replica,
            clock: 0,
            registers: BTreeMap::new(),
            log: Vec::new(),
            applied: BTreeSet::new(),
            versions: Vec::new(),
        }
    }

    /// This document's replica id.
    pub fn replica(&self) -> ReplicaId {
        self.replica
    }

    // ---- local editing -----------------------------------------------------

    /// Apply a locally-initiated operation, returning the resulting [`Op`]
    /// (which the caller may batch into a delta).
    pub fn apply_local_op(&mut self, local: LocalOp) -> Op {
        self.clock += 1;
        let ts = Timestamp {
            lamport: self.clock,
            replica: self.replica,
        };
        let op = match local {
            LocalOp::Set { key, value } => Op {
                key,
                kind: OpKind::Set(value),
                ts,
            },
            LocalOp::Remove { key } => Op {
                key,
                kind: OpKind::Remove,
                ts,
            },
        };
        self.apply(op.clone());
        op
    }

    /// Convenience: set `key` to `value` locally.
    pub fn set(&mut self, key: impl Into<Key>, value: Value) -> Op {
        self.apply_local_op(LocalOp::Set {
            key: key.into(),
            value,
        })
    }

    /// Convenience: remove `key` locally.
    pub fn remove(&mut self, key: impl Into<Key>) -> Op {
        self.apply_local_op(LocalOp::Remove { key: key.into() })
    }

    // ---- merge -------------------------------------------------------------

    /// The full operation log, e.g. for an initial sync to a new replica.
    pub fn all_ops(&self) -> &[Op] {
        &self.log
    }

    /// Encode operations into an opaque delta payload.
    ///
    /// # Errors
    /// Returns an error if serialization fails.
    pub fn encode_delta(ops: &[Op]) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&Delta { ops: ops.to_vec() })?)
    }

    /// Decode and merge a remote delta, converging toward shared state.
    ///
    /// Merging is commutative, associative, and idempotent: applying the same
    /// delta twice, or in a different order, yields the same state.
    ///
    /// # Errors
    /// Returns an error if the delta cannot be decoded.
    pub fn merge_remote_delta(&mut self, delta: &[u8]) -> Result<()> {
        let delta: Delta = serde_json::from_slice(delta)?;
        for op in delta.ops {
            self.apply(op);
        }
        Ok(())
    }

    /// Apply a single operation (local or remote) idempotently.
    fn apply(&mut self, op: Op) {
        let dot = (op.ts.lamport, op.ts.replica);
        if !self.applied.insert(dot) {
            return; // already applied, idempotent
        }
        self.clock = self.clock.max(op.ts.lamport);

        let win = match self.registers.get(&op.key) {
            Some(existing) => op.ts > existing.ts,
            None => true,
        };
        if win {
            self.registers.insert(
                op.key.clone(),
                Register {
                    ts: op.ts,
                    kind: op.kind.clone(),
                },
            );
        }
        self.log.push(op);
    }

    // ---- materialized state ------------------------------------------------

    /// The current value at `key`, if present.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self.registers.get(key) {
            Some(Register {
                kind: OpKind::Set(value),
                ..
            }) => Some(value),
            _ => None,
        }
    }

    /// The full materialized key/value state (omitting removed keys).
    pub fn materialize(&self) -> BTreeMap<Key, Value> {
        self.registers
            .iter()
            .filter_map(|(key, reg)| match &reg.kind {
                OpKind::Set(value) => Some((key.clone(), value.clone())),
                OpKind::Remove => None,
            })
            .collect()
    }

    // ---- version history (AC-SYNC-4) ---------------------------------------

    /// Snapshot the current state as a restorable version, returning its id.
    pub fn checkpoint(&mut self, label: impl Into<String>) -> usize {
        let id = self.versions.len();
        self.versions.push(Version {
            id,
            label: label.into(),
            state: self.materialize(),
        });
        id
    }

    /// List the saved versions, oldest first.
    pub fn history(&self) -> &[Version] {
        &self.versions
    }

    /// The materialized state captured by a saved version.
    pub fn version_state(&self, id: usize) -> Option<&BTreeMap<Key, Value>> {
        self.versions.get(id).map(|v| &v.state)
    }

    /// Restore the document's live state to a saved version.
    ///
    /// Restoration is itself expressed as local operations, so it converges and
    /// propagates like any other edit.
    pub fn restore(&mut self, id: usize) -> bool {
        let Some(target) = self.versions.get(id).map(|v| v.state.clone()) else {
            return false;
        };
        let current = self.materialize();
        // Re-set keys that differ, and remove keys no longer present.
        for (key, value) in &target {
            if current.get(key) != Some(value) {
                self.set(key.clone(), value.clone());
            }
        }
        for key in current.keys() {
            if !target.contains_key(key) {
                self.remove(key.clone());
            }
        }
        true
    }
}
