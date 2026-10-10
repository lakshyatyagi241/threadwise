import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

/**
 * The one place a credential touches disk, and only through the OS keychain (iOS Keychain, Android Keystore-backed storage).
 * Never AsyncStorage, never MMKV, never a file: the lint rule `no-restricted-imports` fails the build on those.
 *
 * One keychain item holding both tokens, so a write is atomic: there is no moment where the access token is new and the
 * refresh token is the one that was just rotated away.
 *
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: the item is not readable while the phone is locked and does not leave the device in a
 * backup or a phone-to-phone transfer (docs/adr/0023). The price: a background task that wakes on a locked phone cannot refresh.
 */
const KEY = 'crm.auth.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const storedTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds. */
  accessExpiresAt: z.number(),
});
export type StoredTokens = z.infer<typeof storedTokensSchema>;

export async function readTokens(): Promise<StoredTokens | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY, OPTIONS);
  } catch {
    // The keychain can refuse a read (device restored from backup, keystore reset). Treat as signed out; the user signs in again.
    return null;
  }
  if (!raw) return null;
  try {
    return storedTokensSchema.parse(JSON.parse(raw));
  } catch {
    await clearTokens();
    return null;
  }
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), OPTIONS);
}

export async function clearTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  } catch {
    // Nothing to delete or the keychain is unavailable; the in-memory copy is cleared by the caller regardless.
  }
}
