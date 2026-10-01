import { describe, expect, it } from 'vitest';
import { DANGER_ACTIONS, endsCallersSession, phraseMatches } from './danger';

describe('phraseMatches', () => {
  it('ignores case, outer spaces and repeated spaces', () => {
    expect(phraseMatches('  Halt   SENDS ', 'halt sends')).toBe(true);
    expect(phraseMatches('halt sends', 'halt sends')).toBe(true);
  });
  it('rejects partial or different text', () => {
    expect(phraseMatches('halt', 'halt sends')).toBe(false);
    expect(phraseMatches('', 'halt sends')).toBe(false);
    expect(phraseMatches('resume sends', 'halt sends')).toBe(false);
  });
});

describe('DANGER_ACTIONS', () => {
  it('has one distinct phrase and path per action', () => {
    const all = Object.values(DANGER_ACTIONS);
    expect(new Set(all.map((a) => a.phrase)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.path)).size).toBe(all.length);
    for (const a of all) expect(DANGER_ACTIONS[a.kind]).toBe(a);
  });
  it('knows which action ends the caller session', () => {
    expect(endsCallersSession('revoke_sessions')).toBe(true);
    expect(endsCallersSession('halt_sends')).toBe(false);
  });
});
