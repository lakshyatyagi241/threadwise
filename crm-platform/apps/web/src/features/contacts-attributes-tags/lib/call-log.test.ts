import { describe, expect, it } from 'vitest';
import {
  CALL_NUDGE,
  FORM_OUTCOMES,
  dismissCallPrompt,
  pendingCall,
  rememberCallClick,
  shouldAsk,
} from './call-log';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const ID = '11111111-1111-4111-8111-111111111111';
describe('the inline form', () => {
  it('offers the five common outcomes, all of them known to the framework', () => {
    expect([...FORM_OUTCOMES]).toEqual([
      'connected',
      'no_answer',
      'busy',
      'left_voicemail',
      'wrong_number',
    ]);
  });

  it('takes the away time and age limit of the framework and adds the idle wait', () => {
    expect(CALL_NUDGE).toMatchObject({ minAwaySeconds: 15, maxAgeMinutes: 30, idleSeconds: 30 });
  });
});

describe('How did the call go?', () => {
  const t0 = Date.parse('2026-10-17T10:00:00.000Z');

  it('asks about a fresh click, once, per contact', () => {
    const pending = memory();
    const dismissed = memory();
    expect(pendingCall(pending, dismissed, ID, t0)).toBeNull();
    rememberCallClick(pending, ID, t0);
    const call = pendingCall(pending, dismissed, ID, t0 + 60_000);
    expect(call).toEqual({ contactId: ID, clickedAt: t0 });
    dismissCallPrompt(pending, dismissed, call!);
    expect(pendingCall(pending, dismissed, ID, t0 + 90_000)).toBeNull();
    // Another contact is not affected, and a new click on the same contact asks again.
    rememberCallClick(pending, 'other', t0);
    expect(pendingCall(pending, dismissed, 'other', t0 + 1000)).not.toBeNull();
    rememberCallClick(pending, ID, t0 + 120_000);
    expect(pendingCall(pending, dismissed, ID, t0 + 130_000)).not.toBeNull();
  });

  it('forgets a click older than half an hour and one from the future', () => {
    const pending = memory();
    rememberCallClick(pending, ID, t0);
    expect(pendingCall(pending, memory(), ID, t0 + 31 * 60_000)).toBeNull();
    expect(pendingCall(pending, memory(), ID, t0 - 10 * 60_000)).toBeNull();
  });

  it('survives storage that is broken or holds junk', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberCallClick(broken, ID, t0)).not.toThrow();
    expect(pendingCall(broken, broken, ID, t0)).toBeNull();
    const junk = memory();
    junk.setItem('crm.call.pending', '{"a":"x","b":');
    expect(pendingCall(junk, memory(), ID, t0)).toBeNull();
    junk.setItem('crm.call.pending', JSON.stringify({ [ID]: 'soon' }));
    expect(pendingCall(junk, memory(), ID, t0)).toBeNull();
  });

  it('asks on coming back after a real absence, or half a minute after the click, and not after half an hour', () => {
    expect(shouldAsk(20_000, 25_000)).toBe(true);
    expect(shouldAsk(5_000, 25_000)).toBe(false);
    expect(shouldAsk(0, 30_000)).toBe(true);
    expect(shouldAsk(0, 29_000)).toBe(false);
    expect(shouldAsk(60_000, 31 * 60_000)).toBe(false);
    expect(shouldAsk(60_000, -1)).toBe(false);
  });
});
