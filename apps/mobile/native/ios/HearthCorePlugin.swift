// Capacitor plugin: bridges the webview to the embedded Hearth Suite core on iOS.
//
// The core ships as a static library (libhearth_ffi.a, built for the apple-ios
// targets by the CI mobile matrix) exposing the C-ABI from crates/ffi/src/cabi.rs.
// Swift calls it through the bridging header (Hearth-Bridging-Header.h), which
// declares:
//
//   HearthCore *hearth_core_open(const char *db_path, const uint8_t *seed, size_t len);
//   char       *hearth_call(HearthCore *core, const char *request_json);
//   void        hearth_string_free(char *s);
//   void        hearth_core_free(HearthCore *core);
//
// The webview transport (`CapacitorTransport`) sends `{ method, params }` JSON
// and receives the `{ ok } / { error }` envelope, the same protocol as desktop.

import Capacitor
import Foundation
import Security

@objc(HearthCorePlugin)
public class HearthCorePlugin: CAPPlugin {
  // The single embedded core pointer, created on first use from the identity
  // seed (held in the Keychain, device-only) and the app's container path.
  private var core: OpaquePointer?
  private let lock = NSLock()

  private func ensureCore() -> OpaquePointer? {
    lock.lock(); defer { lock.unlock() }
    if core == nil {
      core = makeCore()
    }
    return core
  }

  /// Construct the core over the C-ABI: open the on-device vault in the app's
  /// support directory using the Keychain-held identity seed.
  private func makeCore() -> OpaquePointer? {
    guard let seed = identitySeed() else { return nil }
    guard
      let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { return nil }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dbPath = dir.appendingPathComponent("hearth.store").path

    return seed.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> OpaquePointer? in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return nil }
      return dbPath.withCString { hearth_core_open($0, base, seed.count) }
    }
  }

  /// The 32-byte identity seed, stored in the Keychain device-only (Secure
  /// Enclave-backed accessibility). Created once on first run.
  private func identitySeed() -> Data? {
    let account = "io.veldris.hearthsuite.identity-seed"
    let lookup: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data, data.count == 32
    {
      return data
    }

    var seed = Data(count: 32)
    let made = seed.withUnsafeMutableBytes { ptr -> Int32 in
      guard let base = ptr.baseAddress else { return errSecParam }
      return SecRandomCopyBytes(kSecRandomDefault, 32, base)
    }
    guard made == errSecSuccess else { return nil }

    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecValueData as String: seed,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { return nil }
    return seed
  }

  @objc func call(_ invokeCall: CAPPluginCall) {
    guard let request = invokeCall.getString("request") else {
      invokeCall.reject("missing request")
      return
    }
    guard let core = ensureCore() else {
      invokeCall.reject("core not initialised")
      return
    }
    let responsePtr = request.withCString { hearth_call(core, $0) }
    defer { if let p = responsePtr { hearth_string_free(p) } }
    let response = responsePtr.map { String(cString: $0) } ?? "{\"error\":\"null response\"}"
    invokeCall.resolve(["response": response])
  }

  deinit {
    if let core = core { hearth_core_free(core) }
  }
}
