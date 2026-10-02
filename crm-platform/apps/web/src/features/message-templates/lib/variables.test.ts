import { describe, expect, it } from 'vitest';
import {
  countPlaceholders,
  fillSamples,
  normalizePlaceholders,
  sampleFor,
  slotsFromMap,
  syncSlots,
  toVariableMap,
  tokensOf,
} from './variables';

describe('variables', () => {
  it('lists distinct tokens in order of first appearance', () => {
    expect(tokensOf('Hi {{name}}, order {{ order_id }} for {{name}}')).toEqual([
      'name',
      'order_id',
    ]);
    expect(tokensOf('no tokens')).toEqual([]);
  });

  it('counts every occurrence, as Meta does', () => {
    expect(countPlaceholders('{{a}} {{a}} {{b}}')).toBe(3);
  });

  it('renumbers tokens by first appearance', () => {
    expect(normalizePlaceholders('{{b}} then {{a}} then {{b}}')).toBe(
      '{{1}} then {{2}} then {{1}}',
    );
    expect(normalizePlaceholders('{{2}} {{1}}')).toBe('{{1}} {{2}}');
    expect(normalizePlaceholders('{{1}} stays')).toBe('{{1}} stays');
  });

  it('leaves tokens with spaces, dots or hyphens alone', () => {
    expect(normalizePlaceholders('{{a.b}} {{c-d}}')).toBe('{{a.b}} {{c-d}}');
  });

  it('prefers the typed sample, then a stand-in, else nothing', () => {
    const slots = {
      name: { key: 'name', example: 'Asha' },
      city: { key: 'city', example: '' },
      weird: { key: 'weird', example: '' },
    };
    expect(sampleFor('name', slots)).toBe('Asha');
    expect(sampleFor('city', slots)).toBe('Austin');
    expect(sampleFor('weird', slots)).toBeNull();
    expect(sampleFor('first_name', {})).toBe('John');
  });

  it('fills the preview and keeps unknown tokens visible', () => {
    expect(fillSamples('Hi {{first_name}}, {{mystery}}', {})).toBe('Hi John, {{mystery}}');
  });

  it('keeps typed samples while editing and drops removed tokens', () => {
    const first = syncSlots('{{a}} {{b}}', {});
    expect(Object.keys(first)).toEqual(['a', 'b']);
    first.a = { key: 'first_name', example: 'Asha' };
    const next = syncSlots('{{a}} {{c}}', first);
    expect(next.a).toEqual({ key: 'first_name', example: 'Asha' });
    expect(next.c).toEqual({ key: 'c', example: '' });
    expect(next.b).toBeUndefined();
  });

  it('builds the variable map numbered like the normalised text', () => {
    const map = toVariableMap(
      { text: 'Hello {{name}}', slots: { name: { key: 'first_name', example: 'Asha' } } },
      { text: '{{order}} for {{name}}', slots: { order: { key: 'order_id', example: '' } } },
    );
    expect(map.header).toEqual([{ num: 1, key: 'first_name', example: 'Asha' }]);
    expect(map.body).toEqual([
      { num: 1, key: 'order_id' },
      { num: 2, key: 'name' },
    ]);
  });

  it('has no map entries for a text without tokens', () => {
    expect(toVariableMap(null, { text: 'plain', slots: {} })).toEqual({});
  });

  it('reads a stored map back by position', () => {
    const s = slotsFromMap('{{1}} {{2}}', [
      { num: 1, key: 'name', example: 'Asha' },
      { num: 2, key: 'city' },
    ]);
    expect(s['1']).toEqual({ key: 'name', example: 'Asha' });
    expect(s['2']).toEqual({ key: 'city', example: '' });
  });
});
