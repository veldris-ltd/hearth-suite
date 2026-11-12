// Capacitor plugin: BiometricPrompt gate for the identity vault (AC-MOB-3).
//
// The identity seed is held in the Android Keystore with
// `setUserAuthenticationRequired(true)`, so the key is usable only inside a
// successful BiometricPrompt authentication. This plugin drives that prompt.

package io.veldris.hearthsuite

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Biometric")
class BiometricPlugin : Plugin() {
  private val allowed =
    BiometricManager.Authenticators.BIOMETRIC_STRONG or
      BiometricManager.Authenticators.DEVICE_CREDENTIAL

  @PluginMethod
  fun isAvailable(call: PluginCall) {
    val status = BiometricManager.from(context).canAuthenticate(allowed)
    val ret = JSObject()
    ret.put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
    call.resolve(ret)
  }

  @PluginMethod
  fun unlock(call: PluginCall) {
    val reason = call.getString("reason") ?: "Unlock your Hearth Suite vault"
    val activity = activity as FragmentActivity
    activity.runOnUiThread {
      val executor = ContextCompat.getMainExecutor(context)
      val prompt =
        BiometricPrompt(
          activity,
          executor,
          object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
              resolveUnlocked(call, true)
            }

            override fun onAuthenticationError(code: Int, msg: CharSequence) {
              resolveUnlocked(call, false)
            }
          },
        )
      val info =
        BiometricPrompt.PromptInfo.Builder()
          .setTitle("Hearth Suite")
          .setSubtitle(reason)
          .setAllowedAuthenticators(allowed)
          .build()
      prompt.authenticate(info)
    }
  }

  private fun resolveUnlocked(call: PluginCall, unlocked: Boolean) {
    val ret = JSObject()
    ret.put("unlocked", unlocked)
    call.resolve(ret)
  }
}
