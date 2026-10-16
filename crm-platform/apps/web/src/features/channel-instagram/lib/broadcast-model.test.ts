import { describe, expect, it } from 'vitest';
import {
  canSend,
  exceedsCap,
  filterThreads,
  openCount,
  outcomeOf,
  prefill,
  selectAll,
  toggle,
  type Thread,
} from './broadcast-model';

const th = (id: string, title: string, windowOpen = true): Thread => ({ id, title, windowOpen });
const many = (n: number): Thread[] =>
  Array.from({ length: n }, (_, i) => th(`t${i}`, `Person ${i}`));

describe('which threads show (TW-IG-013)', () => {
  it('keeps those whose title contains the search, ignoring case and outer spaces', () => {
    const all = [th('1', 'Asha K'), th('2', 'Ravi'), th('3', 'ashok')];
    expect(filterThreads(all, '  ASH ').map((t) => t.id)).toEqual(['1', '3']);
    expect(filterThreads(all, '').map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(filterThreads(all, 'zzz')).toEqual([]);
  });

  it('counts the threads whose window is open', () => {
    expect(openCount([th('1', 'a'), th('2', 'b', false), th('3', 'c')])).toBe(2);
  });
});

describe('picking (TW-IG-014)', () => {
  it('ticks and unticks one thread without touching the original set', () => {
    const base = new Set(['a']);
    const added = toggle(base, 'b');
    expect([...added]).toEqual(['a', 'b']);
    expect([...base]).toEqual(['a']);
    expect([...toggle(added, 'a')]).toEqual(['b']);
  });

  it('stops adding at the cap but still lets one go', () => {
    const full = new Set(['a', 'b']);
    expect([...toggle(full, 'c', 2)]).toEqual(['a', 'b']);
    expect([...toggle(full, 'a', 2)]).toEqual(['b']);
  });

  it('select all takes the first 200 of what is shown, and says when there are more', () => {
    expect(selectAll(many(5)).size).toBe(5);
    expect(selectAll(many(250)).size).toBe(200);
    expect(selectAll(many(250)).has('t199')).toBe(true);
    expect(selectAll(many(250)).has('t200')).toBe(false);
    expect(exceedsCap(many(200))).toBe(false);
    expect(exceedsCap(many(201))).toBe(true);
  });
});

describe('the message and the button', () => {
  it('a template fills an empty message and never replaces typed text', () => {
    expect(prefill('', 'Big sale')).toBe('Big sale');
    expect(prefill('   ', 'Big sale')).toBe('Big sale');
    expect(prefill('typed', 'Big sale')).toBe('typed');
  });

  it('send needs a name, a message within 1000 characters, someone picked, and nothing already sending', () => {
    const ok = { name: 'Autumn', message: 'Hi', picked: 1, busy: false };
    expect(canSend(ok)).toBe(true);
    expect(canSend({ ...ok, name: ' ' })).toBe(false);
    expect(canSend({ ...ok, message: '  ' })).toBe(false);
    expect(canSend({ ...ok, message: 'x'.repeat(1001) })).toBe(false);
    expect(canSend({ ...ok, message: 'x'.repeat(1000) })).toBe(true);
    expect(canSend({ ...ok, picked: 0 })).toBe(false);
    expect(canSend({ ...ok, busy: true })).toBe(false);
  });

  it('a result is none when nothing went, partial when some failed, all otherwise', () => {
    const base = { errors: [], held: 0, heldUntil: null, skipped: 0, skippedReasons: [] };
    expect(outcomeOf({ ...base, sent: 0, failed: 3 })).toBe('none');
    expect(outcomeOf({ ...base, sent: 2, failed: 1 })).toBe('partial');
    expect(outcomeOf({ ...base, sent: 2, failed: 0 })).toBe('all');
  });

  it('a result where everyone waits for the quiet hours is held, not none (BL-191)', () => {
    const at = '2026-10-16T03:30:00.000Z';
    const none = { skipped: 0, skippedReasons: [] };
    expect(outcomeOf({ sent: 0, failed: 0, errors: [], held: 4, heldUntil: at, ...none })).toBe(
      'held',
    );
    // Some failed while others wait: nothing went, so it still reads as a failure to act on.
    expect(outcomeOf({ sent: 0, failed: 1, errors: [], held: 3, heldUntil: at, ...none })).toBe(
      'none',
    );
    expect(outcomeOf({ sent: 1, failed: 0, errors: [], held: 3, heldUntil: at, ...none })).toBe(
      'all',
    );
  });

  it('a result where the consent check refused everyone who was not waiting is skipped, not none (BL-141)', () => {
    const base = { errors: [], held: 0, heldUntil: null };
    const skippedReasons = [{ reason: 'withdrawn' as const, count: 3 }];
    expect(outcomeOf({ ...base, sent: 0, failed: 0, skipped: 3, skippedReasons })).toBe('skipped');
    // Some went, the rest were refused: the send worked, the refusals are listed beside it.
    expect(outcomeOf({ ...base, sent: 2, failed: 0, skipped: 3, skippedReasons })).toBe('all');
    // A failure is still a failure to act on.
    expect(outcomeOf({ ...base, sent: 0, failed: 1, skipped: 2, skippedReasons })).toBe('none');
  });
});
