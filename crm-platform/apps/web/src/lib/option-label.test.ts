import { describe, expect, it } from 'vitest';
import { optionLabel } from './option-label';

describe('optionLabel', () => {
  it('leaves a short name as it is', () => {
    expect(optionLabel('VIP')).toBe('VIP');
  });
  it('cuts a long name to the limit with an ellipsis', () => {
    const out = optionLabel('AI · Likely to convert, 88, '.repeat(10), 30);
    expect(Array.from(out)).toHaveLength(30);
    expect(out.endsWith('…')).toBe(true);
  });
  it('collapses line breaks and extra spaces', () => {
    expect(optionLabel('  a \n  b ')).toBe('a b');
  });
  it('does not split an emoji', () => {
    expect(optionLabel('😀'.repeat(60), 10)).toBe(`${'😀'.repeat(9)}…`);
  });
});
