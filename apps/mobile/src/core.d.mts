/** Types for the pure mobile-client helpers in `core.mjs`. */

export function buildRequest(method: string, params: unknown): string;
export function unwrapEnvelope(response: unknown): unknown;
export function parseResponse(raw: string): unknown;

export interface TierLike {
  id: string;
  min_ram_mb: number;
  mobile_default: boolean;
}

export function chooseTier(
  tiers: ReadonlyArray<TierLike>,
  options?: { ramMb?: number; allowHeavy?: boolean },
): string | undefined;

export function canDownloadWeights(status: { network?: string; consented?: boolean }): boolean;

export type UnlockState = "locked" | "unlocking" | "unlocked" | "error";
export type UnlockEvent = "request" | "success" | "failure" | "lock";

export const UNLOCK_STATES: {
  readonly LOCKED: "locked";
  readonly UNLOCKING: "unlocking";
  readonly UNLOCKED: "unlocked";
  readonly ERROR: "error";
};

export function nextUnlockState(state: UnlockState, event: UnlockEvent): UnlockState;

export const OFFLINE_METHODS: readonly string[];
export function isOfflineCapable(method: string): boolean;
