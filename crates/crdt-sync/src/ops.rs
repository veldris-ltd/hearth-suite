//! CRDT values, timestamps, and operations.

use serde::{Deserialize, Serialize};

/// A document key (e.g. a cell address, field id, or block id).
pub type Key = String;

/// A unique replica (device) identifier.
pub type ReplicaId = u64;

/// A CRDT value at a key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Value {
    /// Text value.
    Text(String),
    /// Numeric value.
    Number(f64),
    /// Opaque bytes.
    Bytes(Vec<u8>),
    /// Empty/null value.
    Null,
}

/// A logical timestamp: a Lamport counter with a replica tiebreaker.
///
/// The `Ord` derive compares `lamport` first, then `replica`, giving a **total
/// order** over all operations, the basis for deterministic last-writer-wins
/// convergence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Timestamp {
    /// Lamport logical clock value.
    pub lamport: u64,
    /// Originating replica id (tiebreaker).
    pub replica: ReplicaId,
}

/// What an operation does to a key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    /// Set the key to a value.
    Set(Value),
    /// Remove the key.
    Remove,
}

/// A single CRDT operation, uniquely identified by its timestamp.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Op {
    /// The key this operation targets.
    pub key: Key,
    /// The effect of the operation.
    pub kind: OpKind,
    /// The operation's logical timestamp (globally unique).
    pub ts: Timestamp,
}

/// A locally-initiated operation intent (before it is assigned a timestamp).
#[derive(Debug, Clone, PartialEq)]
pub enum LocalOp {
    /// Set `key` to `value`.
    Set {
        /// Target key.
        key: Key,
        /// New value.
        value: Value,
    },
    /// Remove `key`.
    Remove {
        /// Target key.
        key: Key,
    },
}

/// A batch of operations exchanged between replicas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Delta {
    /// The operations in this delta.
    pub ops: Vec<Op>,
}
