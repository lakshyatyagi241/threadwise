import { describe, expect, it } from 'vitest';
import { safeUrl } from './safe-url';

describe('safeUrl', () => {
  it('keeps http(s) URLs and same-site paths', () => {
    expect(safeUrl('https://example.com/terms')).toBe('https://example.com/terms');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
    expect(safeUrl('/legal/terms')).toBe('/legal/terms');
  });
  it('drops anything that could run code or leave through a protocol-relative URL', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<b>',
      'vbscript:x',
      '//evil.example',
      '/\\evil.example',
      'legal/terms',
      '',
      '   ',
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
    expect(safeUrl(null)).toBeNull();
  });
});
