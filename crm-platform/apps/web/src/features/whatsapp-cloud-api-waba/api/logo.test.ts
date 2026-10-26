import { describe, expect, it } from 'vitest';
import { isLogoFile } from './logo';

const MB = 1024 * 1024;
const file = (type: string, size: number) => new File([new Uint8Array(size)], 'logo', { type });

describe('isLogoFile', () => {
  it('takes a JPG or PNG up to 5 MB', () => {
    expect(isLogoFile(file('image/jpeg', 1))).toBe(true);
    expect(isLogoFile(file('image/png', 5 * MB))).toBe(true);
  });

  it('refuses another format or anything over 5 MB', () => {
    expect(isLogoFile(file('image/gif', 1))).toBe(false);
    expect(isLogoFile(file('image/webp', 1))).toBe(false);
    expect(isLogoFile(file('image/png', 5 * MB + 1))).toBe(false);
  });
});
