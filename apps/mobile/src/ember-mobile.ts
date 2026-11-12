/**
 * On-device Ember setup within mobile memory constraints (AC-MOB-2).
 *
 * The client always *starts* on the smallest viable Phi tier; a heavier tier is
 * a deliberate, Wi-Fi-only, consented download. The decision logic lives in
 * `core.mjs` (tested); this module wires it to the device plugins.
 */

import { registerPlugin } from "@capacitor/core";
import type { HearthClient } from "@hearth/core-client";

import { canDownloadWeights, chooseTier } from "./core.mjs";

/** Reports the active network type (e.g. "wifi", "cellular", "none"). */
interface NetworkPlugin {
  getStatus(): Promise<{ connectionType: string }>;
}

/** Manages on-device model weights (download to app storage; never bundled). */
interface EmberWeightsPlugin {
  deviceRamMb(): Promise<{ ramMb: number }>;
  installed(options: { gguf: string }): Promise<{ present: boolean }>;
  download(options: { gguf: string }): Promise<{ ok: boolean }>;
}

const Network = registerPlugin<NetworkPlugin>("Network");
const EmberWeights = registerPlugin<EmberWeightsPlugin>("EmberWeights");

/** Options for {@link ensureEmberModel}. */
export interface EmberSetupOptions {
  /** The user opted into a heavier tier than the mobile default. */
  allowHeavy?: boolean;
  /** The user consented to a (possibly large) weights download. */
  consented?: boolean;
}

/**
 * Pick the appropriate tier for this device and ensure its weights are present,
 * downloading only when permitted (Wi-Fi + consent). Returns the chosen tier id.
 */
export async function ensureEmberModel(
  client: HearthClient,
  options: EmberSetupOptions = {},
): Promise<string | undefined> {
  const tiers = await client.emberTiers();
  const { ramMb } = await EmberWeights.deviceRamMb();
  const tierId = chooseTier(tiers, { ramMb, allowHeavy: options.allowHeavy ?? false });
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) {
    return undefined;
  }
  const { present } = await EmberWeights.installed({ gguf: tier.gguf });
  if (present) {
    return tier.id;
  }
  const { connectionType } = await Network.getStatus();
  if (canDownloadWeights({ network: connectionType, consented: options.consented ?? false })) {
    await EmberWeights.download({ gguf: tier.gguf });
  }
  return tier.id;
}
