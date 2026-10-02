import { describe, expect, it } from 'vitest';
import { counter, parseMarkup, wrapSelection } from './format';

describe('WhatsApp markup', () => {
  it('parses bold, italic, strike, code and variables', () => {
    const segs = parseMarkup('*bold* _it_ ~gone~ ```code``` {{name}}');
    expect(segs.filter((s) => s.kind !== 'text').map((s) => s.kind)).toEqual([
      'bold',
      'italic',
      'strike',
      'code',
      'var',
    ]);
    expect(segs.find((s) => s.kind === 'var')).toEqual({ kind: 'var', token: 'name' });
  });

  it('keeps a variable inside bold text', () => {
    const [b] = parseMarkup('*hi {{name}}*');
    expect(b).toMatchObject({ kind: 'bold' });
    expect(b && 'children' in b && b.children.some((c) => c.kind === 'var')).toBe(true);
  });

  it('does not treat a variable name with underscores as italic', () => {
    const segs = parseMarkup('{{first_name}} and {{last_name}}');
    expect(segs.filter((s) => s.kind === 'var')).toHaveLength(2);
    expect(segs.some((s) => s.kind === 'italic')).toBe(false);
  });

  it('keeps markup characters as text when unmatched', () => {
    expect(parseMarkup('2 * 3')).toEqual([{ kind: 'text', text: '2 * 3' }]);
  });

  it('never produces markup from html', () => {
    const segs = parseMarkup('<script>alert(1)</script>');
    expect(segs).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }]);
  });

  it('counts characters against a limit', () => {
    expect(counter('abc', 2)).toEqual({ used: 3, max: 2, over: true });
    expect(counter('ab', 2).over).toBe(false);
  });

  it('wraps a selection, or inserts the fallback word', () => {
    expect(wrapSelection('hello world', 6, 11, '*')).toEqual({
      value: 'hello *world*',
      start: 7,
      end: 12,
    });
    expect(wrapSelection('', 0, 0, '_', 'text')).toEqual({ value: '_text_', start: 1, end: 5 });
  });
});
