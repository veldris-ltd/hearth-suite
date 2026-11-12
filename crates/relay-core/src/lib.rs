//! Zero-knowledge sync-relay domain logic (P3.1).
//!
//! The relay accepts authenticated PUT/GET of **opaque, client-encrypted** CRDT
//! deltas and document blobs. It is *architecturally incapable* of reading
//! content: no content key ever reaches it, and the types here model only
//! metadata, account, opaque blob id, size, TTL, lifecycle state. The bytes
//! themselves are handled by the object store and are always ciphertext.
//!
//! This crate is the pure, tested heart of the `sync-relay` service:
//!
//! - [`RelayLedger`], per-account quota accounting and blob lifecycle/GC
//!   (`AC-RELAY-1, 2, 3`).
//! - [`RateLimiter`], a deterministic token-bucket limiter.
//!
//! Persistence (Postgres metadata, S3-compatible object store) and auth live in
//! the service binary; the rules that matter are tested here.

mod capability;
mod error;
mod ratelimit;
mod relay;

pub use capability::{mint_capability_token, verify_capability_token};
pub use error::{Error, Result};
pub use ratelimit::RateLimiter;
pub use relay::{usage_by_account, AccountId, BlobMeta, BlobState, Quota, RelayLedger};
