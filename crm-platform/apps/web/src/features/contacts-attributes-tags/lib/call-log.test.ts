import { describe, expect, it } from 'vitest';
import {
  buildLogCallRequest,
  dismissCallPrompt,
  emptyCallDraft,
  pendingCall,
  rememberCallClick,
  shouldAsk,
  tomorrowMorning,
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
// Saturday 17 Oct 2026, 15:45 in Kolkata.
const now = new Date('2026-10-17T10:15:00.000Z');
const zone = 'Asia/Kolkata';

describe('the form', () => {
  it('starts as an outgoing call that just happened, with the follow-up due tomorrow at nine', () => {
    const d = emptyCallDraft(now, zone);
    expect(d).toMatchObject({
      direction: 'outbound',
      outcome: 'connected',
      when: '2026-10-17T15:45',
      minutes: '',
      notes: '',
      followUp: false,
      due: '2026-10-18T09:00',
    });
    expect(tomorrowMorning(now, zone)).toBe('2026-10-18T09:00');
  });

  it('builds the request on the viewer clock, with the length in seconds and no follow-up unless asked', () => {
    const r = buildLogCallRequest(
      ID,
      { ...emptyCallDraft(now, zone), minutes: '4,5', notes: '  asked for a quote ' },
      { now, timeZone: zone },
    );
    expect(r).toEqual({
      ok: true,
      input: {
        contactId: ID,
        direction: 'outbound',
        outcome: 'connected',
        startedAt: '2026-10-17T10:15:00.000Z',
        durationSec: 270,
        notes: 'asked for a quote',
        source: 'manual',
        suggestStageNudge: false,
      },
    });
  });

  it('adds the follow-up with its due instant, and needs the date', () => {
    const base = { ...emptyCallDraft(now, zone), followUp: true };
    const ok = buildLogCallRequest(ID, base, { now, timeZone: zone, source: 'web_click_to_call' });
    expect(ok).toMatchObject({
      ok: true,
      input: { followUp: { dueAt: '2026-10-18T03:30:00.000Z' }, source: 'web_click_to_call' },
    });
    expect(buildLogCallRequest(ID, { ...base, due: '' }, { now, timeZone: zone })).toEqual({
      ok: false,
      problem: 'noDue',
    });
    expect(
      buildLogCallRequest(ID, { ...base, due: '2026-02-31T09:00' }, { now, timeZone: zone }),
    ).toEqual({
      ok: false,
      problem: 'badDue',
    });
  });

  it('refuses a start in the future (a few minutes of clock difference are fine), a bad time and a bad length', () => {
    const d = emptyCallDraft(now, zone);
    expect(
      buildLogCallRequest(ID, { ...d, when: '2026-10-17T15:49' }, { now, timeZone: zone }).ok,
    ).toBe(true);
    expect(
      buildLogCallRequest(ID, { ...d, when: '2026-10-17T16:30' }, { now, timeZone: zone }),
    ).toEqual({
      ok: false,
      problem: 'futureWhen',
    });
    expect(buildLogCallRequest(ID, { ...d, when: '' }, { now, timeZone: zone })).toEqual({
      ok: false,
      problem: 'badWhen',
    });
    for (const minutes of ['abc', '-1', '1441']) {
      expect(buildLogCallRequest(ID, { ...d, minutes }, { now, timeZone: zone })).toEqual({
        ok: false,
        problem: 'badMinutes',
      });
    }
    expect(buildLogCallRequest(ID, { ...d, minutes: '1440' }, { now, timeZone: zone }).ok).toBe(
      true,
    );
  });

  it('cuts notes at the limit', () => {
    const r = buildLogCallRequest(
      ID,
      { ...emptyCallDraft(now, zone), notes: 'x'.repeat(2500) },
      { now, timeZone: zone },
    );
    expect(r.ok && r.input.notes?.length).toBe(2000);
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
