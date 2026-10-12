import { describe, expect, it } from 'vitest';
import { reasonOf, scoreChange } from './runs-model';

describe('scoreChange', () => {
  it('prints the move, or just the score for a first score', () => {
    expect(scoreChange({ status: 'ok', score: 72, previousScore: 40 })).toBe('40 → 72');
    expect(scoreChange({ status: 'ok', score: 72, previousScore: null })).toBe('72');
    expect(scoreChange({ status: 'ok', score: 72, previousScore: 72 })).toBe('72');
  });
  it('prints nothing for a run that wrote no score', () => {
    expect(scoreChange({ status: 'failed', score: null, previousScore: 3 })).toBeNull();
    expect(scoreChange({ status: 'kept', score: 60, previousScore: null })).toBeNull();
  });
});

describe('reasonOf', () => {
  it('knows the reasons the API writes and calls the rest other', () => {
    expect(reasonOf(null)).toBeNull();
    expect(reasonOf('no_key')).toBe('no_key');
    expect(reasonOf('something new')).toBe('other');
  });
});
