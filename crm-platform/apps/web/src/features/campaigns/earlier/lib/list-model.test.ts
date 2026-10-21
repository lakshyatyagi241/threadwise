import { describe, expect, it } from 'vitest';
import { canDelete, pct1, providerLabel, providerTag, reference, statusLabel } from './list-model';

describe('labels', () => {
  it('title-cases a status', () => {
    expect(statusLabel('completed_with_errors')).toBe('Completed With Errors');
  });

  it('names the engine, with a dash for none', () => {
    expect(providerLabel('baileys')).toBe('Unofficial API');
    expect(providerLabel('WABA')).toBe('WABA');
    expect(providerLabel(null)).toBe('—');
  });

  it('tags a broadcast of the unofficial engine as disabled while the platform switch is off', () => {
    const off = 'Unofficial (disabled)';
    expect(providerTag('baileys', false, off)).toBe(off);
    expect(providerTag('BAILEYS', false, off)).toBe(off);
    expect(providerTag('baileys', true, off)).toBe('Unofficial API');
    expect(providerTag('waba', false, off)).toBe('WABA');
    expect(providerTag(null, false, off)).toBe('—');
  });

  it('only scheduled broadcasts can be deleted', () => {
    expect(['scheduled', 'failed', 'processing', 'completed', 'paused'].filter(canDelete)).toEqual([
      'scheduled',
    ]);
  });

  it('the reference is the start of the uuid', () => {
    expect(reference('abcdef12-0000-4000-8000-000000000000')).toBe('BR-ABCDEF12');
  });

  it('shows one decimal in the tiles', () => {
    expect(pct1(66.666)).toBe('66.7');
  });
});
