import { describe, expect, it } from 'vitest';
import { canLookup, isKnownKind, lookupTone } from './lookup-model';

describe('the number lookup result', () => {
  it('is green for a mobile, coral for a landline or an invalid number, amber for VoIP', () => {
    expect(lookupTone('mobile')).toBe('good');
    expect(lookupTone('landline')).toBe('bad');
    expect(lookupTone('invalid')).toBe('bad');
    expect(lookupTone('voip')).toBe('warn');
    expect(lookupTone('unknown')).toBe('neutral');
  });

  it('runs nothing for an empty field', () => {
    expect(canLookup('')).toBe(false);
    expect(canLookup('   ')).toBe(false);
    expect(canLookup('+1 555')).toBe(true);
  });

  it('has its own sentence for the four known kinds only', () => {
    for (const k of ['mobile', 'landline', 'voip', 'invalid'] as const)
      expect(isKnownKind(k)).toBe(true);
    expect(isKnownKind('unknown')).toBe(false);
  });
});
