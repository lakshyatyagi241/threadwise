import { describe, expect, it } from 'vitest';
import {
  canonicalStorageKey,
  storageKeyIsOwnedBy,
  storageKeyOrg,
} from '../../../src/common/storage-key-owner';

describe('TI-022: storage key ownership is judged on the key the storage layer acts on', () => {
  it('a storage/ prefix, leading slash or whitespace does not hide another workspace', () => {
    for (const k of [
      'chat/9/a.png',
      'storage/chat/9/a.png',
      '/chat/9/a.png',
      '  /storage/chat/9/a.png',
    ]) {
      expect(canonicalStorageKey(k)).toBe('chat/9/a.png');
      expect(storageKeyOrg(k)).toBe(9);
      expect(storageKeyIsOwnedBy(7, k)).toBe(false);
      expect(storageKeyIsOwnedBy(9, k)).toBe(true);
    }
  });

  it('refuses keys with no workspace segment and dot segments', () => {
    expect(storageKeyIsOwnedBy(7, 'uploads/a.png')).toBe(false);
    expect(storageKeyIsOwnedBy(7, 'chat/7/../9/a.png')).toBe(false);
    expect(storageKeyIsOwnedBy(7, 'chat/7//a.png')).toBe(false);
    expect(storageKeyIsOwnedBy(7, '')).toBe(false);
  });
});
