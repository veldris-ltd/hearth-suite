// Capacitor plugin: bridges the webview to the embedded Hearth Suite core on Android.
//
// The core ships as libhearth_ffi.so (built for the android targets by the CI
// mobile matrix via cargo-ndk, with the FFI crate's `jni` feature). The JNI
// exports live in crates/ffi/src/jni_bridge.rs:
//
//   external fun nativeOpen(dbPath: String, seed: ByteArray): Long
//   external fun nativeCall(handle: Long, request: String): String
//   external fun nativeFree(handle: Long)
//
// The webview transport sends `{ method, params }` JSON and receives the
// `{ ok } / { error }` envelope, identical to the desktop protocol.

package io.veldris.hearthsuite

import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.security.SecureRandom

@CapacitorPlugin(name = "HearthCore")
class HearthCorePlugin : Plugin() {
  companion object {
    init {
      System.loadLibrary("hearth_ffi")
    }

    // Implemented by the FFI crate's JNI exports (the `jni` feature).
    @JvmStatic external fun nativeOpen(dbPath: String, seed: ByteArray): Long

    @JvmStatic external fun nativeCall(handle: Long, request: String): String

    @JvmStatic external fun nativeFree(handle: Long)
  }

  // Opaque core handle (a *mut HearthCore widened to Long), held for the app's
  // lifetime and freed on teardown.
  private var core: Long = 0L
  private val lock = Any()

  private fun ensureCore(): Long {
    synchronized(lock) {
      if (core == 0L) {
        val dbPath = File(context.filesDir, "hearth.store").absolutePath
        core = nativeOpen(dbPath, identitySeed())
      }
      return core
    }
  }

  // The 32-byte identity seed, held in the Android Keystore-backed encrypted
  // preferences (generated once on first run, never leaves the device).
  private fun identitySeed(): ByteArray {
    val masterKey =
      MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    val prefs =
      EncryptedSharedPreferences.create(
        context,
        "hearth_identity",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
    prefs.getString("seed", null)?.let {
      return Base64.decode(it, Base64.NO_WRAP)
    }
    val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
    prefs.edit().putString("seed", Base64.encodeToString(seed, Base64.NO_WRAP)).apply()
    return seed
  }

  @PluginMethod
  fun call(invoke: PluginCall) {
    val request = invoke.getString("request")
    if (request == null) {
      invoke.reject("missing request")
      return
    }
    val handle = ensureCore()
    if (handle == 0L) {
      invoke.reject("core not initialised")
      return
    }
    val ret = JSObject()
    ret.put("response", nativeCall(handle, request))
    invoke.resolve(ret)
  }

  override fun handleOnDestroy() {
    synchronized(lock) {
      if (core != 0L) {
        nativeFree(core)
        core = 0L
      }
    }
    super.handleOnDestroy()
  }
}
