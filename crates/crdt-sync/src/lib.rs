//! CRDT sync for Hearth Suite.
//!
//! Conflict-free replicated document state with **local-first** semantics,
//! version history, and deterministic merge for opt-in real-time co-editing.
//!
//! - [`Document`], a last-writer-wins keyed CRDT with `apply_local_op`,
//!   `encode_delta`, and `merge_remote_delta`; concurrent edits converge
//!   (`AC-SYNC-2`) and prior versions are restorable (`AC-SYNC-4`).
//! - [`sync`], optional, off-by-default encrypted-delta exchange over a
//!   zero-knowledge relay (`AC-SYNC-1`, `AC-SYNC-3`).
//!
//! The engine performs **no network I/O**; it only produces and consumes deltas
//! when the caller asks. Sync is entirely optional and absent by default.
//!
//! Implemented for P1.6.

pub mod document;
pub mod error;
pub mod ops;
pub mod sync;

pub use document::{Document, Version};
pub use error::{Error, Result};
pub use ops::{Delta, Key, LocalOp, Op, OpKind, ReplicaId, Timestamp, Value};
pub use sync::{merge_sealed_delta, seal_delta, DeltaCipher, KeyedCipher, SyncConfig};
