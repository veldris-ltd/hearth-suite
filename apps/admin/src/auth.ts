/**
 * WebAuthn admin sign-in (AC-ADMIN-3).
 *
 * Hardware-backed authentication is required: the server issues a challenge, the
 * operator's authenticator (security key / platform TPM) signs it, and the
 * server verifies the assertion. The ceremony state machine lives in `core.mjs`.
 */

import { AdminApiClient } from "./api";
import type { Session } from "./api";
import { AUTH_STATES, nextAuthState } from "./core.mjs";
import type { AuthState } from "./core.mjs";

/** Decode a base64url string to an ArrayBuffer (a valid `BufferSource`). */
function fromB64url(value: string): ArrayBuffer {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Encode an ArrayBuffer as base64url (for sending the assertion back). */
function toB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Serialize an assertion credential into the JSON the server expects. */
function serializeAssertion(credential: PublicKeyCredential): unknown {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: toB64url(response.authenticatorData),
      clientDataJSON: toB64url(response.clientDataJSON),
      signature: toB64url(response.signature),
      userHandle: response.userHandle ? toB64url(response.userHandle) : null,
    },
  };
}

/**
 * Run the WebAuthn sign-in ceremony. Resolves with the session (operator +
 * role) on success, or null if authentication did not complete.
 */
export async function signIn(api: AdminApiClient): Promise<Session | null> {
  let state: AuthState = nextAuthState(AUTH_STATES.UNAUTHENTICATED, "begin");
  try {
    const options = await api.beginWebAuthn();
    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: fromB64url(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: "required",
        allowCredentials: options.allowCredentials.map((c) => ({
          id: fromB64url(c.id),
          type: "public-key" as const,
        })),
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return null;
    }
    const session = await api.finishWebAuthn(serializeAssertion(credential));
    state = nextAuthState(state, "assert_success");
    return state === AUTH_STATES.AUTHENTICATED ? session : null;
  } catch {
    return null;
  }
}
