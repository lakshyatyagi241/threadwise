import { describe, expect, it } from 'vitest';
import { bandOf, isManualScore, parseScoreInput, scoreChange, scoreToText } from './score';

describe('bandOf', () => {
  it('cuts at 34 and 67', () => {
    expect([0, 33].map(bandOf)).toEqual(['cold', 'cold']);
    expect([34, 66].map(bandOf)).toEqual(['warm', 'warm']);
    expect([67, 100].map(bandOf)).toEqual(['hot', 'hot']);
  });
});

describe('isManualScore', () => {
  it('is a score the AI did not write', () => {
    expect(isManualScore({ leadScore: 40, leadScoreSource: 'manual' })).toBe(true);
    expect(isManualScore({ leadScore: 40, leadScoreSource: null })).toBe(true);
    expect(isManualScore({ leadScore: 40, leadScoreSource: 'ai' })).toBe(false);
    expect(isManualScore({ leadScore: null, leadScoreSource: null })).toBe(false);
  });
});

describe('parseScoreInput', () => {
  it('accepts whole numbers from 0 to 100 and an empty box', () => {
    expect(parseScoreInput('')).toEqual({ kind: 'empty' });
    expect(parseScoreInput('  ')).toEqual({ kind: 'empty' });
    expect(parseScoreInput('0')).toEqual({ kind: 'value', value: 0 });
    expect(parseScoreInput(' 100 ')).toEqual({ kind: 'value', value: 100 });
  });
  it.each(['101', '-1', '5.5', 'abc', '1e2', '1000'])('rejects %s', (s) => {
    expect(parseScoreInput(s)).toEqual({ kind: 'invalid' });
  });
});

describe('scoreChange', () => {
  it('sends nothing when the typed score is the one the contact has', () => {
    expect(scoreChange('72', 72)).toBeUndefined();
    expect(scoreChange('', null)).toBeUndefined();
  });
  it('sends the number when it differs and null when the box was cleared', () => {
    expect(scoreChange('80', 72)).toBe(80);
    expect(scoreChange('0', null)).toBe(0);
    expect(scoreChange('', 72)).toBeNull();
  });
  it('sends nothing for text that is not a score', () => {
    expect(scoreChange('abc', 72)).toBeUndefined();
  });
});

describe('scoreToText', () => {
  it('prints the score or nothing', () => {
    expect(scoreToText(0)).toBe('0');
    expect(scoreToText(null)).toBe('');
    expect(scoreToText(undefined)).toBe('');
  });
});
