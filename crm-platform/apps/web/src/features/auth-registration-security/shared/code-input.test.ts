import { describe, expect, it } from 'vitest';
import { sanitizeCode } from './code-input';

describe('sanitizeCode', () => {
  it('keeps digits only', () => {
    expect(sanitizeCode('12a3-4 5')).toBe('12345');
  });
  it('accepts a code pasted with a space in the middle', () => {
    expect(sanitizeCode('123 456')).toBe('123456');
  });
  it('truncates to the code length', () => {
    expect(sanitizeCode('1234567890')).toBe('123456');
    expect(sanitizeCode('1234567890', 8)).toBe('12345678');
  });
  it('is empty for no digits', () => {
    expect(sanitizeCode('abc')).toBe('');
  });
});
