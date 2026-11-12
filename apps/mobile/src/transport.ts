/**
 * The mobile transport: delivers a typed core-client call to the embedded Rust
 * core through a Capacitor native plugin (`HearthCore`), which forwards the JSON
 * request to `hearth_ffi::hearth_call` over JNI (Android) / the C-ABI (iOS).
 *
 * The protocol is identical to the desktop client, the core surface is shared.
 */

import { registerPlugin } from "@capacitor/core";
import type { Transport } from "@hearth/core-client";

import { buildRequest, parseResponse } from "./core.mjs";

/** The native plugin contract implemented in Swift (iOS) and Kotlin (Android). */
interface HearthCorePlugin {
  call(options: { request: string }): Promise<{ response: string }>;
}

const HearthCoreNative = registerPlugin<HearthCorePlugin>("HearthCore");

/** A {@link Transport} backed by the Capacitor-embedded native core. */
export class CapacitorTransport implements Transport {
  async call<T>(method: string, params: unknown): Promise<T> {
    const { response } = await HearthCoreNative.call({
      request: buildRequest(method, params),
    });
    return parseResponse(response) as T;
  }
}
