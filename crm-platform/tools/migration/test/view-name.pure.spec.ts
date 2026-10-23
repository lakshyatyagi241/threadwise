import { describe, expect, it } from 'vitest';
import { fitViewName, VIEW_NAME_MAX, VIEW_NAME_MIN } from '../transform/segments';

describe('saved view names fit the app rule (3 to 50 characters)', () => {
  it('keeps a name inside the range as it is, trimmed', () => {
    expect(fitViewName('  Hot leads  ')).toEqual({ name: 'Hot leads', soft: [] });
  });

  it('cuts a name longer than 50 characters and says so', () => {
    const out = fitViewName('x'.repeat(60));
    expect(out.name).toHaveLength(VIEW_NAME_MAX);
    expect(out.soft.map((s) => s.code)).toEqual(['VIEW_NAME_CUT']);
  });

  it('never cuts an emoji in half', () => {
    const out = fitViewName(`${'a'.repeat(49)}😀tail`);
    expect(out.name).toBe('a'.repeat(49));
    expect(/[\uD800-\uDBFF]$/.test(out.name)).toBe(false);
  });

  it('does not leave a space at the cut', () => {
    const out = fitViewName(`${'a'.repeat(49)} bbbb`);
    expect(out.name.endsWith(' ')).toBe(false);
  });

  it('adds " view" to a name shorter than 3 characters and says so', () => {
    expect(VIEW_NAME_MIN).toBe(3);
    expect(fitViewName('A')).toEqual({
      name: 'A view',
      soft: [{ code: 'VIEW_NAME_EXTENDED', reason: expect.any(String) }],
    });
  });
});
