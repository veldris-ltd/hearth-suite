// A vault-backed preference store (P2-CL3, seam #6).
//
// The design system and Sheets read/write preferences (theme, Ember effort,
// onboarding, "Easy Formats" style sets) through a SYNCHRONOUS localStorage-
// shaped seam. The vault store, however, is asynchronous. We bridge the two with
// a write-through cache: an in-memory Map answers reads and writes immediately,
// every write is mirrored to the encrypted vault (fire-and-forget), and the
// cache is hydrated from the vault once at startup so values persist across
// reloads and travel with sync.
//
// Pure logic only (no DOM): the host wires it to a real HearthClient, and a
// node --test suite asserts the contract here.

/**
 * @typedef {object} PrefClient
 * @property {(key: string, value: string) => Promise<unknown>} setPreference
 * @property {() => Promise<Array<{ key: string, value: string }>>} listPreferences
 */

/**
 * @typedef {object} VaultPreferenceStore
 * @property {(key: string) => (string | null)} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 * @property {() => Promise<void>} hydrate
 */

/**
 * Create a synchronous, vault-backed preference store over an async client.
 *
 * Removal is modelled as an empty-string tombstone (the store is a pure
 * key/value upsert with no delete), which the design system's parse guards
 * already treat as "unset" (an empty string is never a valid theme, effort or
 * the "1" onboarding flag). The `onError` hook lets the host surface a failed
 * persist; reads never throw.
 *
 * @param {PrefClient} client
 * @param {(error: unknown) => void} [onError]
 * @returns {VaultPreferenceStore}
 */
export function createVaultPreferenceStore(client, onError) {
  /** @type {Map<string, string>} */
  const cache = new Map();

  const persist = (key, value) => {
    Promise.resolve()
      .then(() => client.setPreference(key, value))
      .catch((error) => {
        if (onError) onError(error);
      });
  };

  return {
    getItem(key) {
      return cache.has(key) ? cache.get(key) : null;
    },
    setItem(key, value) {
      cache.set(key, value);
      persist(key, value);
    },
    removeItem(key) {
      // Empty-string tombstone: the store has no delete, and the parse guards
      // read "" as unset.
      cache.set(key, "");
      persist(key, "");
    },
    async hydrate() {
      const entries = await client.listPreferences();
      for (const { key, value } of entries) {
        cache.set(key, value);
      }
    },
  };
}
