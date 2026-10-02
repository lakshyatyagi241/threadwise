import { describe, expect, it } from 'vitest';
import { exportFileName } from './export-name';

describe('exportFileName', () => {
  it('slugs the brand and stamps the time', () => {
    expect(exportFileName('Acme Chat!', new Date('2026-03-04T05:06:07Z'))).toBe(
      'acme-chat-settings-20260304-0506.json',
    );
  });
  it('falls back when the brand has no usable characters', () => {
    expect(exportFileName('!!!', new Date('2026-03-04T05:06:07Z'))).toMatch(/^platform-settings-/);
  });
});
