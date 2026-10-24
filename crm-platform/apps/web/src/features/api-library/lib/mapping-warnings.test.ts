import { describe, expect, it } from 'vitest';
import { numberWarning, takesNumbers } from './mapping-warnings';

describe('takesNumbers', () => {
  it('is true for the number types only', () => {
    expect(takesNumbers('integer')).toBe(true);
    expect(takesNumbers('decimal')).toBe(true);
    expect(takesNumbers('text')).toBe(false);
    expect(takesNumbers('email')).toBe(false);
    expect(takesNumbers(undefined)).toBe(false);
  });
});

describe('numberWarning', () => {
  it('says nothing for a property that takes text', () => {
    expect(numberWarning('text', 'Sample Slide Show')).toBeNull();
    expect(numberWarning(undefined, 'Sample Slide Show')).toBeNull();
  });

  it('asks for a test while no answer is known', () => {
    expect(numberWarning('decimal', undefined)).toEqual({ kind: 'untested' });
  });

  it('warns when the answer is text, and names the text', () => {
    expect(numberWarning('decimal', 'Sample Slide Show')).toEqual({
      kind: 'text',
      value: 'Sample Slide Show',
    });
    expect(numberWarning('integer', 'true')).toEqual({ kind: 'text', value: 'true' });
  });

  it('is quiet for a number, with or without spaces around it', () => {
    expect(numberWarning('decimal', '42')).toBeNull();
    expect(numberWarning('decimal', ' 3.5 ')).toBeNull();
    expect(numberWarning('integer', '-7')).toBeNull();
  });

  it('is quiet when the path is not in the answer, or the answer is blank', () => {
    expect(numberWarning('decimal', null)).toBeNull();
    expect(numberWarning('decimal', 'null')).toBeNull();
    expect(numberWarning('decimal', '   ')).toBeNull();
  });
});
