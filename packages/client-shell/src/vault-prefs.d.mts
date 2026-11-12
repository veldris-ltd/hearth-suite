// Type declarations for the vault-backed preference store (vault-prefs.mjs).

export interface PrefClient {
  setPreference(key: string, value: string): Promise<unknown>;
  listPreferences(): Promise<Array<{ key: string; value: string }>>;
}

export interface VaultPreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  hydrate(): Promise<void>;
}

export function createVaultPreferenceStore(
  client: PrefClient,
  onError?: (error: unknown) => void,
): VaultPreferenceStore;
