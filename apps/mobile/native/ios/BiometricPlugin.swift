// Capacitor plugin: Face ID / Touch ID gate for the identity vault (AC-MOB-3).
//
// The identity seed is stored in the Keychain with
// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + a biometric access control
// (`SecAccessControl` with `.biometryCurrentSet`). Reading it triggers the system
// LocalAuthentication prompt; the seed never leaves the Secure Enclave-backed
// Keychain unprotected. This plugin exposes that gate to the web layer.

import Capacitor
import LocalAuthentication

@objc(BiometricPlugin)
public class BiometricPlugin: CAPPlugin {
  @objc func isAvailable(_ call: CAPPluginCall) {
    let context = LAContext()
    var error: NSError?
    let ok = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    call.resolve(["available": ok])
  }

  @objc func unlock(_ call: CAPPluginCall) {
    let reason = call.getString("reason") ?? "Unlock your Hearth Suite vault"
    let context = LAContext()
    // `.deviceOwnerAuthentication` uses biometrics, falling back to the passcode.
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
      call.resolve(["unlocked": success])
    }
  }
}
