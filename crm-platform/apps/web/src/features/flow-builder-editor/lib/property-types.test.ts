import { describe, expect, it } from 'vitest';
import { compatiblePropertyTypes } from './property-types';

describe('property types a bot step may create', () => {
  it('a button, a list row or a card button stores text: no number, date or other type', () => {
    expect(compatiblePropertyTypes('choice')).toEqual(['text', 'long_text']);
    expect(compatiblePropertyTypes('choice')).not.toContain('decimal');
  });

  it('a question offers the type that holds its answer, and text', () => {
    expect(compatiblePropertyTypes('answer', 'email')).toEqual(['email', 'text', 'long_text']);
    expect(compatiblePropertyTypes('answer', 'phone')).toEqual(['phone', 'text']);
    expect(compatiblePropertyTypes('answer', 'number')).toContain('decimal');
    expect(compatiblePropertyTypes('answer', 'date')).toEqual(['date', 'text']);
    expect(compatiblePropertyTypes('answer', 'text')).toEqual(['text', 'long_text']);
    expect(compatiblePropertyTypes('answer')).toEqual(['text', 'long_text']);
  });
});
