//! Native C-ABI bridge for desktop and mobile shells.
//!
//! A single JSON-in / JSON-out entry point ([`hearth_call`]) dispatches the full
//! facade surface. The host process constructs a [`HearthCore`] (with the real
//! on-device inference backend) and passes the pointer in; this keeps the ABI
//! free of trait objects while exposing every operation.

use std::ffi::{c_char, CStr, CString};
use std::path::Path;

use futures::stream;
use hearth_ember_bridge::{InferenceBackend, Prompt, TokenStream};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dto::{
    AddFieldRequest, CreateTableRequest, EmberRequest, InsertRowRequest, SaveDocumentRequest,
    SealRequest, SealedDto, UpdateRowRequest,
};
use crate::error::{Error, Result};
use crate::facade::HearthCore;

/// The on-device inference backend used before a local model is installed.
///
/// Returns a single calm, *local* message, there is no network path, so the
/// offline-first guarantee holds even on a fresh mobile install. Both the iOS
/// C-ABI constructor and the Android JNI bridge open the core with this backend;
/// installing a model swaps it later.
pub(crate) struct UnconfiguredBackend;

impl InferenceBackend for UnconfiguredBackend {
    fn generate(&self, _prompt: &Prompt, _budget: usize) -> TokenStream {
        let message = "Ember isn't set up yet, add a local model in Settings to enable \
                       on-device help. Nothing you write ever leaves this device."
            .to_owned();
        Box::pin(stream::iter(vec![Ok(message)]))
    }
}

/// Open a core from a store path and a 32-byte identity seed, with the default
/// (unconfigured) on-device backend. Shared by the iOS C-ABI and Android JNI.
///
/// # Errors
/// Returns [`Error::InvalidRequest`] if the seed is not exactly 32 bytes, or a
/// store/identity error if the vault cannot be opened.
pub(crate) fn open_core(path: &str, seed: &[u8]) -> Result<HearthCore> {
    let seed: &[u8; 32] = seed
        .try_into()
        .map_err(|_| Error::InvalidRequest("identity seed must be 32 bytes".to_owned()))?;
    HearthCore::open(Path::new(path), seed, Box::new(UnconfiguredBackend))
}

/// Open a core by restoring the identity from a BIP-39 recovery phrase, with the
/// default on-device backend. Shared by the iOS C-ABI and Android JNI restore
/// paths (seam #7).
///
/// # Errors
/// Returns an error if the phrase is invalid or the store cannot be opened.
pub(crate) fn restore_core(path: &str, phrase: &str) -> Result<HearthCore> {
    HearthCore::open_from_phrase(Path::new(path), phrase, Box::new(UnconfiguredBackend))
}

#[derive(Deserialize)]
struct Call {
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct IdParam {
    id: String,
}

#[derive(Deserialize)]
struct ReorderParam {
    id: String,
    order: Vec<String>,
}

#[derive(Deserialize)]
struct VerifyParam {
    sealed: SealedDto,
    signer_public_base64: String,
}

#[derive(Deserialize)]
struct EnabledParam {
    enabled: bool,
}

#[derive(Deserialize)]
struct KeyParam {
    key: String,
}

#[derive(Deserialize)]
struct SetPreferenceParam {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct DecodeLegacyParam {
    format: String,
    content_base64: String,
}

/// Dispatch a method call against the core, returning a JSON value.
///
/// Shared by the C-ABI and the WASM bindings so both expose the same surface.
pub(crate) fn dispatch(core: &mut HearthCore, method: &str, params: Value) -> Result<Value> {
    let value = match method {
        "create_bundle" => json_of(&core.create_bundle(&from_value(params)?)?)?,
        "list_bundles" => json_of(&core.list_bundles()?)?,
        "list_tables" => json_of(&core.list_tables(&from_value::<IdParam>(params)?.id)?)?,
        "save_document" => {
            json_of(&core.save_document(&from_value::<SaveDocumentRequest>(params)?)?)?
        }
        "open_document" => json_of(&core.open_document(&from_value::<IdParam>(params)?.id)?)?,
        "list_documents" => json_of(&core.list_documents(&from_value::<IdParam>(params)?.id)?)?,
        "reorder_documents" => {
            let p: ReorderParam = from_value(params)?;
            core.reorder_documents(&p.id, &p.order)?;
            json!(null)
        }
        "set_preference" => {
            let p: SetPreferenceParam = from_value(params)?;
            core.set_preference(&p.key, &p.value)?;
            json!(null)
        }
        "get_preference" => json!(core.get_preference(&from_value::<KeyParam>(params)?.key)?),
        "list_preferences" => json_of(&core.list_preferences()?)?,
        "decode_legacy" => {
            let p: DecodeLegacyParam = from_value(params)?;
            core.decode_legacy(&p.format, &p.content_base64)?
        }
        "lexicon_dataset" => core.lexicon_dataset()?,
        "identity_public" => json!(core.identity_public()),
        "recovery_phrase" => json!(core.recovery_phrase()),
        "seal" => json_of(&core.seal(&from_value::<SealRequest>(params)?)?)?,
        "unseal" => json_of(&core.unseal(&from_value::<SealedDto>(params)?)?)?,
        "verify" => {
            let v: VerifyParam = from_value(params)?;
            json!(core.verify(&v.sealed, &v.signer_public_base64)?)
        }
        "run_ember" => json_of(&core.run_ember(&from_value::<EmberRequest>(params)?)?)?,
        "ember_tiers" => json_of(&core.ember_tiers())?,
        "create_table" => {
            let r: CreateTableRequest = from_value(params)?;
            json!(core.create_table(&r.bundle_id, &r.name)?)
        }
        "add_field" => {
            let r: AddFieldRequest = from_value(params)?;
            json!(core.add_field(&r.table_id, &r.name, &r.datatype)?)
        }
        "list_fields" => json_of(&core.list_fields(&from_value::<IdParam>(params)?.id)?)?,
        "insert_row" => json!(core.insert_row(&from_value::<InsertRowRequest>(params)?)?),
        "update_row" => json!(core.update_row(&from_value::<UpdateRowRequest>(params)?)?),
        "delete_row" => {
            core.delete_row(&from_value::<IdParam>(params)?.id)?;
            json!(null)
        }
        "query_rows" => json_of(&core.query_rows(&from_value::<IdParam>(params)?.id)?)?,
        "set_sync_enabled" => {
            core.set_sync_enabled(from_value::<EnabledParam>(params)?.enabled);
            json!(null)
        }
        "sync_status" => json_of(&core.sync_status())?,
        other => return Err(Error::InvalidRequest(format!("unknown method: {other}"))),
    };
    Ok(value)
}

/// Dispatch a JSON request against the core from safe Rust.
///
/// Returns the same `{"ok": <result>}` / `{"error": "<message>"}` envelope as
/// [`hearth_call`], but without the raw-pointer / C-string dance. The in-process
/// host (the Tauri desktop shell, or any embedder) holds a `HearthCore` directly
/// and calls this, so the desktop client reuses the exact dispatch surface that
/// the C-ABI and WASM bindings expose.
#[must_use]
pub fn call_json(core: &mut HearthCore, request_json: &str) -> String {
    dispatch_envelope(core, request_json)
        .unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string())
}

/// Parse a request, dispatch it, and wrap the result in the `ok` envelope.
fn dispatch_envelope(core: &mut HearthCore, request_json: &str) -> Result<String> {
    let call: Call = serde_json::from_str(request_json)?;
    let value = dispatch(core, &call.method, call.params)?;
    Ok(json!({ "ok": value }).to_string())
}

fn from_value<T: serde::de::DeserializeOwned>(v: Value) -> Result<T> {
    serde_json::from_value(v).map_err(Error::from)
}

fn json_of<T: serde::Serialize>(value: &T) -> Result<Value> {
    serde_json::to_value(value).map_err(Error::from)
}

/// Call the core with a JSON request, returning a newly-allocated JSON response.
///
/// The response is `{"ok": <result>}` or `{"error": "<message>"}`. The returned
/// string must be freed with [`hearth_string_free`].
///
/// # Safety
/// `core` must be a valid pointer obtained from [`hearth_core_into_raw`] and not
/// yet freed; `request_json` must be a valid, NUL-terminated UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn hearth_call(
    core: *mut HearthCore,
    request_json: *const c_char,
) -> *mut c_char {
    let response = call_inner(core, request_json)
        .unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string());
    CString::new(response).unwrap_or_default().into_raw()
}

fn call_inner(core: *mut HearthCore, request_json: *const c_char) -> Result<String> {
    // SAFETY: contract documented on `hearth_call`.
    let core =
        unsafe { core.as_mut() }.ok_or_else(|| Error::InvalidRequest("null core".to_owned()))?;
    let json = unsafe { CStr::from_ptr(request_json) }
        .to_str()
        .map_err(|e| Error::InvalidRequest(e.to_string()))?;
    dispatch_envelope(core, json)
}

/// Box a [`HearthCore`] into a raw pointer for the C-ABI.
///
/// The pointer must eventually be released with [`hearth_core_free`].
#[must_use]
pub fn hearth_core_into_raw(core: HearthCore) -> *mut HearthCore {
    Box::into_raw(Box::new(core))
}

/// Open a core from a store path and identity seed, returning a raw pointer the
/// host owns (or null on error). This is the C-ABI constructor the iOS shell
/// calls (the seed is released from the Keychain / Secure Enclave only after a
/// successful biometric unlock); free it with [`hearth_core_free`].
///
/// # Safety
/// `db_path` must be a valid NUL-terminated UTF-8 C string; `seed_ptr` must point
/// to `seed_len` readable bytes (`seed_len` must be 32).
#[no_mangle]
pub unsafe extern "C" fn hearth_core_open(
    db_path: *const c_char,
    seed_ptr: *const u8,
    seed_len: usize,
) -> *mut HearthCore {
    if db_path.is_null() || seed_ptr.is_null() || seed_len != 32 {
        return std::ptr::null_mut();
    }
    // SAFETY: contract documented above.
    let Ok(path) = (unsafe { CStr::from_ptr(db_path) }).to_str() else {
        return std::ptr::null_mut();
    };
    let seed = unsafe { std::slice::from_raw_parts(seed_ptr, seed_len) };
    match open_core(path, seed) {
        Ok(core) => hearth_core_into_raw(core),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Open a core by restoring the identity from a recovery phrase (seam #7).
///
/// Returns a raw [`HearthCore`] pointer the host owns, or null if the phrase is
/// invalid or the store cannot be opened. The host writes the recovered seed to
/// its secure storage (Keychain / Secure Enclave) separately.
///
/// # Safety
/// `db_path` and `phrase` must each be a valid NUL-terminated UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn hearth_core_open_from_phrase(
    db_path: *const c_char,
    phrase: *const c_char,
) -> *mut HearthCore {
    if db_path.is_null() || phrase.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: contract documented above.
    let Ok(path) = (unsafe { CStr::from_ptr(db_path) }).to_str() else {
        return std::ptr::null_mut();
    };
    let Ok(phrase) = (unsafe { CStr::from_ptr(phrase) }).to_str() else {
        return std::ptr::null_mut();
    };
    match restore_core(path, phrase) {
        Ok(core) => hearth_core_into_raw(core),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Free a JSON string returned by [`hearth_call`].
///
/// # Safety
/// `s` must be a pointer returned by [`hearth_call`] and not already freed.
#[no_mangle]
pub unsafe extern "C" fn hearth_string_free(s: *mut c_char) {
    if !s.is_null() {
        drop(unsafe { CString::from_raw(s) });
    }
}

/// Free a core created with [`hearth_core_into_raw`].
///
/// # Safety
/// `core` must be a pointer from [`hearth_core_into_raw`] and not already freed.
#[no_mangle]
pub unsafe extern "C" fn hearth_core_free(core: *mut HearthCore) {
    if !core.is_null() {
        drop(unsafe { Box::from_raw(core) });
    }
}
