//! FFI / WASM bindings for the Hearth Suite core.
//!
//! Exposes the core, `bundle`/`store`, `seal`, `ember-bridge`, `crdt-sync`, to
//! the UI layer through one typed facade ([`HearthCore`]) over serializable
//! [`dto`]s. The same surface is reachable two ways:
//!
//! - **Native FFI** ([`cabi`]), a JSON-in/JSON-out C-ABI for desktop/mobile.
//! - **WASM** (`wasm` feature), `serde-wasm-bindgen` wrappers for the web.
//!
//! Every DTO derives [`ts_rs::TS`], so running the test suite regenerates the
//! TypeScript types in `bindings/` that match the Rust API (`AC-FFI-1`). The
//! hand-written typed client lives in `packages/core-client`.
//!
//! Implemented for P1.8 (`AC-FFI-1..2`).

// The FFI/WASM boundary legitimately requires `unsafe` (raw pointers, C strings).
#![allow(unsafe_code)]

pub mod cabi;
pub mod dto;
pub mod error;

#[cfg(feature = "wasm")]
pub mod wasm;

// The Android JNI exports (module named `jni_bridge` so it does not shadow the
// `jni` crate it uses). Built for the android targets via cargo-ndk.
#[cfg(feature = "jni")]
pub mod jni_bridge;

#[path = "core.rs"]
mod facade;

pub use cabi::{
    call_json, hearth_call, hearth_core_free, hearth_core_into_raw, hearth_core_open,
    hearth_string_free,
};
pub use error::{Error, Result};
pub use facade::HearthCore;
