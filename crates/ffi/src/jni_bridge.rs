//! JNI exports for the Android Capacitor plugin (`io.veldris.hearthsuite.HearthCorePlugin`).
//!
//! The Kotlin plugin loads `libhearth_ffi.so` and declares three `external`
//! static methods, mapped here by JNI name mangling:
//!
//! - `nativeOpen(dbPath: String, seed: ByteArray): Long` opens the core from the
//!   Keystore-unlocked seed and returns an opaque handle (0 on error).
//! - `nativeCall(handle: Long, request: String): String` dispatches a
//!   `{ method, params }` request and returns the `{ ok } / { error }` envelope.
//! - `nativeFree(handle: Long)` drops the core.
//!
//! The handle is a `*mut HearthCore` widened to `jlong`; the JVM holds it for the
//! app's lifetime and frees it on teardown. Built only with the `jni` feature.

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jlong, jstring};
use jni::JNIEnv;

use crate::cabi::{call_json, open_core};
use crate::facade::HearthCore;

/// `HearthCorePlugin.nativeOpen(dbPath, seed)`.
// The JNI ABI passes owned local references by value; that is mandated here.
#[allow(clippy::needless_pass_by_value)]
#[no_mangle]
pub extern "system" fn Java_io_veldris_hearthsuite_HearthCorePlugin_nativeOpen(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    db_path: JString<'_>,
    seed: JByteArray<'_>,
) -> jlong {
    let Ok(path) = env.get_string(&db_path) else {
        return 0;
    };
    let path: String = path.into();
    let Ok(seed_bytes) = env.convert_byte_array(&seed) else {
        return 0;
    };
    match open_core(&path, &seed_bytes) {
        Ok(core) => Box::into_raw(Box::new(core)) as jlong,
        Err(_) => 0,
    }
}

/// `HearthCorePlugin.nativeCall(handle, request)`.
// The JNI ABI passes owned local references by value; that is mandated here.
#[allow(clippy::needless_pass_by_value)]
#[no_mangle]
pub extern "system" fn Java_io_veldris_hearthsuite_HearthCorePlugin_nativeCall(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    handle: jlong,
    request: JString<'_>,
) -> jstring {
    let response = native_call(&mut env, handle, &request)
        .unwrap_or_else(|| r#"{"error":"native call failed"}"#.to_owned());
    env.new_string(response)
        .map_or(std::ptr::null_mut(), jni::objects::JString::into_raw)
}

fn native_call(env: &mut JNIEnv<'_>, handle: jlong, request: &JString<'_>) -> Option<String> {
    if handle == 0 {
        return None;
    }
    let request: String = env.get_string(request).ok()?.into();
    // SAFETY: `handle` is a pointer returned by `nativeOpen` and not yet freed;
    // the JVM serialises plugin calls so there is no concurrent &mut aliasing.
    let core: &mut HearthCore = unsafe { (handle as *mut HearthCore).as_mut()? };
    Some(call_json(core, &request))
}

/// `HearthCorePlugin.nativeFree(handle)`.
#[no_mangle]
pub extern "system" fn Java_io_veldris_hearthsuite_HearthCorePlugin_nativeFree(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    handle: jlong,
) {
    if handle != 0 {
        // SAFETY: `handle` came from `nativeOpen` and is freed exactly once.
        drop(unsafe { Box::from_raw(handle as *mut HearthCore) });
    }
}
