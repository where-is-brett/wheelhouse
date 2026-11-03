// tests/helpers/file-key-store.js
// A stand-in for the computer's own store of keys (scripts/host/store.js), backed by the key files under the test's
// Wheelhouse home, so a test that sets keys with writeKey and reads them with readKey sees what setup, cut-access and
// uninstall keep, and no test asks the real keychain, Credential Manager or git's helper. Call `useFileKeyStore()` at
// the top of a test file.
import { readKey, writeKey, deleteKey, useKeyStore } from '../../scripts/host/keys.js';

export const fileKeyStore = {
  readKey: async (name) => readKey(name),
  storeKey: async (name, value) => writeKey(name, value),
  deleteKey: async (name) => deleteKey(name),
};

export function useFileKeyStore() {
  return useKeyStore(fileKeyStore);
}
