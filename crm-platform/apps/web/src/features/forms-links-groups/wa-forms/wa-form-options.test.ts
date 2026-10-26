import { describe, expect, it } from 'vitest';
import { parseOptions } from './wa-form-builder-screen';

describe('parseOptions', () => {
  it('splits comma separated choices and trims them', () => {
    expect(parseOptions('Red, Green,Blue ')).toEqual(['Red', 'Green', 'Blue']);
  });
  it('keeps a trailing comma from producing an empty choice', () => {
    expect(parseOptions('Red, ')).toEqual(['Red']);
  });
  it('accepts new lines and the Arabic or full-width commas', () => {
    expect(parseOptions('Red\nGreen، Blue，Pink、Grey')).toEqual([
      'Red',
      'Green',
      'Blue',
      'Pink',
      'Grey',
    ]);
  });
});
