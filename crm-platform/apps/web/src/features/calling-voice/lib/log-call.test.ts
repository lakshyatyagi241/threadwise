import { describe, expect, it } from 'vitest';
import { logCallInputSchema } from '@crm/contracts';
import {
  buildLogCallInput,
  localDateTimeValue,
  tomorrowMorning,
  type LogCallForm,
} from './log-call';

const NOW = new Date(2026, 9, 17, 10, 0, 0);
const form = (over: Partial<LogCallForm> = {}): LogCallForm => ({
  phone: '98765 43210',
  direction: 'outbound',
  outcome: 'connected',
  when: '2026-10-17T09:30',
  minutes: '4',
  notes: '  Asked for the annual plan  ',
  followUp: null,
  ...over,
});

describe('the Log a call form', () => {
  it('writes the request the server takes: the number as typed, the time as an instant, the length in seconds', () => {
    const r = buildLogCallInput(form(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      customerPhone: '98765 43210',
      direction: 'outbound',
      outcome: 'connected',
      startedAt: new Date(2026, 9, 17, 9, 30).toISOString(),
      durationSec: 240,
      notes: 'Asked for the annual plan',
      source: 'manual',
      suggestStageNudge: false,
    });
    expect(logCallInputSchema.safeParse(r.input).success).toBe(true);
  });

  it('needs the contact or the number', () => {
    expect(buildLogCallInput(form({ phone: '  ' }), NOW)).toEqual({ ok: false, problem: 'noWho' });
    const withContact = buildLogCallInput(
      form({ phone: '', contactId: '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b' }),
      NOW,
    );
    expect(withContact.ok && withContact.input.customerPhone).toBeUndefined();
    expect(withContact.ok && withContact.input.contactId).toBe(
      '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b',
    );
  });

  it('refuses a time that is not one and a call that has not started', () => {
    expect(buildLogCallInput(form({ when: '' }), NOW)).toEqual({ ok: false, problem: 'badWhen' });
    expect(buildLogCallInput(form({ when: '2026-10-17T11:00' }), NOW)).toEqual({
      ok: false,
      problem: 'futureWhen',
    });
    expect(buildLogCallInput(form({ when: '2026-10-17T10:03' }), NOW).ok).toBe(true);
  });

  it('leaves the length out when it is not known, accepts half minutes and refuses nonsense', () => {
    const none = buildLogCallInput(form({ minutes: '' }), NOW);
    expect(none.ok && none.input.durationSec).toBe(0);
    const half = buildLogCallInput(form({ minutes: '1.5' }), NOW);
    expect(half.ok && half.input.durationSec).toBe(90);
    for (const bad of ['-1', 'abc', '1441']) {
      expect(buildLogCallInput(form({ minutes: bad }), NOW)).toEqual({
        ok: false,
        problem: 'badMinutes',
      });
    }
  });

  it('keeps notes out of the request when empty, and cuts them at the cap', () => {
    const empty = buildLogCallInput(form({ notes: '   ' }), NOW);
    expect(empty.ok && 'notes' in empty.input).toBe(false);
    const long = buildLogCallInput(form({ notes: 'x'.repeat(3000) }), NOW);
    expect(long.ok && long.input.notes?.length).toBe(2000);
  });

  it('asks for the follow-up date when a task is wanted', () => {
    expect(buildLogCallInput(form({ followUp: { due: '' } }), NOW)).toEqual({
      ok: false,
      problem: 'noDue',
    });
    expect(buildLogCallInput(form({ followUp: { due: 'soon' } }), NOW)).toEqual({
      ok: false,
      problem: 'badDue',
    });
    const ok = buildLogCallInput(form({ followUp: { due: '2026-10-18T09:00' } }), NOW);
    expect(ok.ok && ok.input.followUp).toEqual({
      dueAt: new Date(2026, 9, 18, 9, 0).toISOString(),
    });
  });

  it('marks a call confirmed after a click as such', () => {
    const r = buildLogCallInput(form({ source: 'web_click_to_call' }), NOW);
    expect(r.ok && r.input.source).toBe('web_click_to_call');
  });

  it('starts the form at the person’s own clock and a follow-up at nine tomorrow', () => {
    expect(localDateTimeValue(new Date(2026, 0, 5, 7, 4))).toBe('2026-01-05T07:04');
    expect(localDateTimeValue(tomorrowMorning(NOW))).toBe('2026-10-18T09:00');
  });
});
