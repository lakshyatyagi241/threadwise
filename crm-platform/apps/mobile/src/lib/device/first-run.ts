import * as SecureStore from 'expo-secure-store';

/**
 * Whether the first-open permission screen has been shown (and answered or skipped). A plain flag, not a secret: it lives in the
 * same keychain-backed store as everything else the app keeps on the phone, so the app has one place for local state. The
 * `.v2` lets a later version of the screen (a new permission) ask once more by changing the key: v1 offered notifications only,
 * v2 offers notifications, calls and camera.
 */
const KEY = 'crm.permissions-intro.v2';

export async function hasSeenPermissionsIntro(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY)) === '1';
}

export async function markPermissionsIntroSeen(): Promise<void> {
  await SecureStore.setItemAsync(KEY, '1');
}
