/**
 * Biometric unlock of the identity vault (AC-MOB-3).
 *
 * The private key is only reachable after the platform biometric prompt
 * (Face ID / Touch ID / Android BiometricPrompt) succeeds. The native plugin
 * gates the key material at the OS keystore/Secure Enclave; this module drives
 * the unlock state machine (tested in `core.mjs`) and the prompt.
 */

import { registerPlugin } from "@capacitor/core";

import { UNLOCK_STATES, nextUnlockState } from "./core.mjs";
import type { UnlockState } from "./core.mjs";

/** The native biometric plugin contract (Swift / Kotlin). */
interface BiometricPlugin {
  /** Whether biometric (or device-passcode fallback) auth is available. */
  isAvailable(): Promise<{ available: boolean }>;
  /** Prompt the user; resolves with whether access was granted. */
  unlock(options: { reason: string }): Promise<{ unlocked: boolean }>;
}

const Biometric = registerPlugin<BiometricPlugin>("Biometric");

/**
 * Run the biometric prompt and report whether the vault was unlocked.
 *
 * If biometric hardware/enrolment is missing, the native plugin falls back to
 * the OS passcode; either way `unlock` resolves to whether access was granted.
 */
export async function unlockVault(): Promise<boolean> {
  let state: UnlockState = nextUnlockState(UNLOCK_STATES.LOCKED, "request");
  try {
    const { unlocked } = await Biometric.unlock({ reason: "Unlock your Hearth Suite vault" });
    state = nextUnlockState(state, unlocked ? "success" : "failure");
  } catch {
    state = nextUnlockState(state, "failure");
  }
  return state === UNLOCK_STATES.UNLOCKED;
}
