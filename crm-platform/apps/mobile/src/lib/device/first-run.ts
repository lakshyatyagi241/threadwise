import * as SecureStore from 'expo-secure-store';

/**
 * Whether the app has already asked for its permissions on this phone (see `askForPermissions`). A plain flag, not a secret: it
 * lives in the same keychain-backed store as everything else the app keeps on the phone, so the app has one place for local state.
 * Changing the key (`.v2`) makes the app ask once more, for example after a new permission is added.
 */
const KEY = 'crm.permissions-asked.v3';

export async function hasAskedForPermissions(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY)) === '1';
}

export async function markPermissionsAsked(): Promise<void> {
  await SecureStore.setItemAsync(KEY, '1');
}
