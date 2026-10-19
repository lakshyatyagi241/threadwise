import { describe, expect, it } from 'vitest';
import { ERROR_CODES, LEAD_FIRST_REPLY_REASONS } from '@crm/contracts';
import {
  FIRST_REPLY_EXPIRY_MS,
  dueAtOf,
  isLeadTooOld,
  nextBusinessOpening,
  reasonText,
  templateProblem,
  timelineEntry,
  verdictOfCode,
  verdictOfDenial,
  type TemplateFacts,
} from '../../../src/modules/leads/lead-first-reply.rules';

const T = (iso: string) => new Date(iso);

describe('dueAtOf', () => {
  it('adds the delay in minutes and nothing for zero', () => {
    const now = T('2026-10-16T10:00:00Z');
    expect(dueAtOf(now, 0)).toEqual(now);
    expect(dueAtOf(now, 45)).toEqual(T('2026-10-16T10:45:00Z'));
    expect(FIRST_REPLY_EXPIRY_MS).toBe(24 * 3_600_000);
  });
});

describe('isLeadTooOld', () => {
  const at = T('2026-10-16T10:00:00Z');
  it('is true only past the limit', () => {
    expect(isLeadTooOld(T('2026-10-16T09:00:00Z'), at, 60)).toBe(false);
    expect(isLeadTooOld(T('2026-10-16T08:59:59Z'), at, 60)).toBe(true);
    expect(isLeadTooOld(T('2026-10-13T10:00:00Z'), at, 3 * 24 * 60)).toBe(false);
  });
  it('treats a submission time in the future (a skewed clock) as fresh', () => {
    expect(isLeadTooOld(T('2026-10-16T10:30:00Z'), at, 60)).toBe(false);
  });
});

describe('nextBusinessOpening', () => {
  // Monday to Friday 09:00-17:00, Kolkata time (UTC+5:30).
  const hours = {
    days: Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [
        d,
        { enabled: true, from: '09:00', to: '17:00' },
      ]),
    ),
  };
  const zone = 'Asia/Kolkata';

  it('is the instant itself while the workspace is open', () => {
    const open = T('2026-10-14T06:00:00Z'); // Wednesday 11:30 in Kolkata
    expect(nextBusinessOpening(hours, zone, open)).toEqual(open);
  });

  it('with no hours configured the workspace is always open', () => {
    const at = T('2026-10-17T22:00:00Z');
    expect(nextBusinessOpening(null, zone, at)).toEqual(at);
    expect(nextBusinessOpening({ days: {} }, zone, at)).toEqual(at);
  });

  it('after closing waits for the next morning, on the quarter hour', () => {
    const evening = T('2026-10-14T13:00:00Z'); // Wednesday 18:30 Kolkata
    expect(nextBusinessOpening(hours, zone, evening)).toEqual(T('2026-10-15T03:30:00Z')); // Thursday 09:00
  });

  it('over a weekend waits for Monday', () => {
    const saturday = T('2026-10-17T08:00:00Z'); // Saturday 13:30 Kolkata
    expect(nextBusinessOpening(hours, zone, saturday)).toEqual(T('2026-10-19T03:30:00Z'));
  });

  it('is null when no day ever opens', () => {
    const closed = { days: { mon: { enabled: false } } };
    expect(nextBusinessOpening(closed, zone, T('2026-10-14T06:00:00Z'))).toBeNull();
  });

  it('reads the hours of the zone, not of UTC', () => {
    // 04:00 UTC on Wednesday is 09:30 in Kolkata: open there, closed if read as UTC.
    const at = T('2026-10-14T04:00:00Z');
    expect(nextBusinessOpening(hours, zone, at)).toEqual(at);
    expect(nextBusinessOpening(hours, 'UTC', at)?.toISOString()).toBe('2026-10-14T09:00:00.000Z');
  });
});

describe('verdictOfCode', () => {
  it('a refusal of consent, plan or channel becomes a final verdict, a wait becomes a held one', () => {
    expect(verdictOfCode(ERROR_CODES.CONSENT_OPTED_OUT)).toEqual({
      status: 'blocked',
      reason: 'opted_out',
    });
    expect(verdictOfCode(ERROR_CODES.CONSENT_SEND_DENIED)).toEqual({
      status: 'blocked',
      reason: 'no_consent',
    });
    expect(verdictOfCode(ERROR_CODES.PLAN_LIMIT_REACHED)).toEqual({
      status: 'blocked',
      reason: 'plan_limit',
    });
    expect(verdictOfCode(ERROR_CODES.WALLET_EMPTY)).toEqual({
      status: 'held',
      reason: 'wallet_empty',
    });
    expect(verdictOfCode(ERROR_CODES.AUTH_SEND_HALTED)).toEqual({
      status: 'held',
      reason: 'send_halted',
    });
    expect(verdictOfCode(ERROR_CODES.CHANNEL_DISCONNECTED)).toEqual({
      status: 'held',
      reason: 'channel_unavailable',
    });
  });

  it('knows nothing about a code it was not told about', () => {
    expect(verdictOfCode('SOMETHING_ELSE')).toBeNull();
  });
});

describe('verdictOfDenial: the consent gate is never overridden', () => {
  it('names a withdrawal, a minor and a missing grant differently, and everything else as no consent', () => {
    expect(verdictOfDenial('withdrawn')).toEqual({ status: 'blocked', reason: 'opted_out' });
    expect(verdictOfDenial('subject_minor')).toEqual({ status: 'blocked', reason: 'minor' });
    expect(verdictOfDenial('no_consent_recorded')).toEqual({
      status: 'blocked',
      reason: 'no_consent',
    });
    expect(verdictOfDenial('purpose_not_applicable')).toEqual({
      status: 'blocked',
      reason: 'no_consent',
    });
    expect(verdictOfDenial('gate_unavailable_closed')).toEqual({
      status: 'blocked',
      reason: 'no_consent',
    });
  });
});

const approved: TemplateFacts = {
  status: 'approved',
  metaStatus: 'APPROVED',
  pausedUntil: null,
  templateType: 'standard',
  attachmentType: 'none',
  header: null,
  parameterFormat: 'POSITIONAL',
  buttons: [],
  headerTokens: [],
  buttonUrlTokens: [],
};

describe('templateProblem: what a first message can be made from', () => {
  const now = T('2026-10-16T10:00:00Z');
  it('an approved text template with body variables only is fine', () => {
    expect(templateProblem(approved, now)).toBeNull();
    expect(templateProblem({ ...approved, status: 'public', metaStatus: null }, now)).toBeNull();
  });

  it('refuses everything the contact cannot fill', () => {
    const cases: Array<[Partial<TemplateFacts>, string]> = [
      [{ status: 'pending' }, 'not_approved'],
      [{ metaStatus: 'REJECTED' }, 'not_approved'],
      [{ pausedUntil: T('2026-10-17T00:00:00Z') }, 'paused'],
      [{ templateType: 'auth' }, 'authentication'],
      [{ parameterFormat: 'NAMED' }, 'named_variables'],
      [{ attachmentType: 'image' }, 'media_header'],
      [{ headerTokens: ['1'] }, 'header_variable'],
      [{ buttonUrlTokens: [[], ['1']] }, 'dynamic_button'],
    ];
    for (const [patch, expected] of cases) {
      expect(templateProblem({ ...approved, ...patch }, now), expected).toBe(expected);
    }
  });

  it('a pause that has ended no longer blocks', () => {
    expect(
      templateProblem({ ...approved, pausedUntil: T('2026-10-15T00:00:00Z') }, now),
    ).toBeNull();
  });
});

describe('the timeline entry and the reasons', () => {
  it('has words for every reason, so no entry ever says "unknown reason"', () => {
    for (const r of LEAD_FIRST_REPLY_REASONS) expect(reasonText(r), r).not.toBe('unknown reason');
    expect(reasonText(null)).toBe('unknown reason');
  });

  it('says the outcome and the reason, never the message or an address', () => {
    expect(timelineEntry('sent', 'whatsapp', null)).toEqual({
      title: 'First message sent by WhatsApp',
      body: null,
    });
    const blocked = timelineEntry('blocked', 'email', 'no_consent');
    expect(blocked.title).toBe('First message by email not sent');
    expect(blocked.body).toBe('Blocked: no recorded consent');
    const held = timelineEntry('held', 'sms', 'quiet_hours', T('2026-10-17T03:30:00Z'));
    expect(held.body).toContain('quiet hours');
    expect(held.body).toContain('2026-10-17T03:30:00.000Z');
  });
});
