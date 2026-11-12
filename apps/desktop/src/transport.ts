/**
 * The desktop transport: delivers a typed core-client call to the embedded Rust
 * core over Tauri's `invoke` bridge, and unwraps the result envelope.
 *
 * The Rust side exposes one command, `hearth_invoke`, which forwards the request
 * string to `hearth_ffi::call_json`, the same dispatch the C-ABI and WASM
 * bindings use. So the desktop client speaks the identical protocol as every
 * other Hearth Suite front-end.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Transport } from "@hearth/core-client";

import { buildRequest, parseResponse } from "./core.mjs";

/** A {@link Transport} backed by the Tauri-embedded native core. */
export class TauriTransport implements Transport {
  async call<T>(method: string, params: unknown): Promise<T> {
    const raw = await invoke<string>("hearth_invoke", {
      request: buildRequest(method, params),
    });
    return parseResponse(raw) as T;
  }
}
