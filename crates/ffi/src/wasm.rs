//! WASM bindings for the web stack (feature `wasm`, built for `wasm32`).
//!
//! Exposes the same dispatch surface as the C-ABI, exchanging JS values via
//! `serde-wasm-bindgen`. The host shell constructs the [`HearthCore`] (wiring the
//! browser-side store and the wasm inference backend); this module then routes
//! typed calls to it. The generated TypeScript types (see `bindings/`) describe
//! every `params`/result shape.

use wasm_bindgen::prelude::*;

use crate::facade::HearthCore;

/// A WASM handle around the core.
#[wasm_bindgen]
pub struct Hearth {
    core: HearthCore,
}

#[wasm_bindgen]
impl Hearth {
    /// Dispatch a method by name, passing and receiving JS values whose shapes
    /// are the generated TypeScript types.
    ///
    /// # Errors
    /// Returns a JS error if the params are malformed or the operation fails.
    pub fn call(&mut self, method: &str, params: JsValue) -> Result<JsValue, JsValue> {
        let params: serde_json::Value = serde_wasm_bindgen::from_value(params)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let value = crate::cabi::dispatch(&mut self.core, method, params)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_wasm_bindgen::to_value(&value).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

impl Hearth {
    /// Wrap an already-constructed core (called by the host shell).
    #[must_use]
    pub fn from_core(core: HearthCore) -> Self {
        Self { core }
    }
}
