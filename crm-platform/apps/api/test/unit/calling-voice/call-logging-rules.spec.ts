import { describe, expect, it } from 'vitest';
import {
  CALL_CLICK_NUDGE,
  CALL_INGEST_MAX_BATCH,
  callLogPrefill,
  callLogPrefillSchema,
  ingestCallsInputSchema,
  logCallInputSchema,
  shouldNudgeCall,
} from '@crm/contracts';
import {
  activityTypeOf,
  checkStartedAt,
  decodeLogCursor,
  defaultStartedAt,
  durationWords,
  e164Of,
  editVerdict,
  encodeLogCursor,
  mobileExternalId,
  notesPreview,
  outcomeFromDevice,
  outcomeFromTelephony,
  stageNudge,
  telephonyExternalId,
  timelineTitle,
} from '../../../src/modules/calling-voice/logging/call-logging.rules';

const NOW = new Date('2026-10-17T10:00:00Z');
const HOUR = 3_600_000;

describe('the words on the timeline', () => {
  it('reads "Outbound call, Connected, 4 min, by Priya"', () => {
    expect(
      timelineTitle({
        direction: 'outbound',
        outcome: 'connected',
        durationSec: 240,
        handlerName: 'Priya',
      }),
    ).toBe('Outbound call, Connected, 4 min, by Priya');
  });

  it('leaves out the talk time of a call that did not connect, and of a connected call of unknown length', () => {
    expect(
      timelineTitle({
        direction: 'inbound',
        outcome: 'no_answer',
        durationSec: 30,
        handlerName: null,
      }),
    ).toBe('Inbound call, No answer');
    expect(
      timelineTitle({
        direction: 'inbound',
        outcome: 'connected',
        durationSec: 0,
        handlerName: ' ',
      }),
    ).toBe('Inbound call, Connected');
  });

  it('says every outcome in words', () => {
    const words = (['busy', 'left_voicemail', 'wrong_number', 'declined', 'failed'] as const).map(
      (o) =>
        timelineTitle({ direction: 'outbound', outcome: o, durationSec: 0, handlerName: null }),
    );
    expect(words).toEqual([
      'Outbound call, Busy',
      'Outbound call, Left voicemail',
      'Outbound call, Wrong number',
      'Outbound call, Declined',
      'Outbound call, Failed',
    ]);
  });

  it('reads talk time as a person does', () => {
    expect(durationWords(45)).toBe('45 sec');
    expect(durationWords(60)).toBe('1 min');
    expect(durationWords(3900)).toBe('1 h 5 min');
    expect(durationWords(7200)).toBe('2 h');
  });

  it('picks the timeline type from the source, so the icon follows the source', () => {
    expect(activityTypeOf('mobile_app')).toBe('call_mobile_app');
    expect(activityTypeOf('web_click_to_call')).toBe('call_web_click_to_call');
  });

  it('cuts the notes preview at a word and keeps short notes whole', () => {
    expect(notesPreview('  spoke  about\nthe quote ')).toBe('spoke about the quote');
    expect(notesPreview(null)).toBeNull();
    expect(notesPreview('   ')).toBeNull();
    const long = `${'word '.repeat(60)}end`;
    const out = notesPreview(long, 40)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).not.toMatch(/wo…$/);
  });
});

describe('the time of a call', () => {
  it('accepts now, a few minutes ahead (clocks differ) and last year', () => {
    expect(checkStartedAt(new Date(NOW.getTime() + 4 * 60_000), NOW)).toBe('ok');
    expect(checkStartedAt(new Date(NOW.getTime() - 300 * 86_400_000), NOW)).toBe('ok');
  });
  it('refuses the future and the long ago', () => {
    expect(checkStartedAt(new Date(NOW.getTime() + HOUR), NOW)).toBe('future');
    expect(checkStartedAt(new Date(NOW.getTime() - 401 * 86_400_000), NOW)).toBe('too_old');
    expect(checkStartedAt(new Date('nonsense'), NOW)).toBe('too_old');
  });
  it('starts a call without a time `duration` ago', () => {
    expect(defaultStartedAt(120, NOW).toISOString()).toBe('2026-10-17T09:58:00.000Z');
  });
});

describe('phone numbers', () => {
  it('reads a local number in the default country and an international one as written', () => {
    expect(e164Of('98765 43210', '+91')).toBe('+919876543210');
    expect(e164Of('+44 20 7946 0958', '+91')).toBe('+442079460958');
    expect(e164Of('0091 98765 43210', '+91')).toBe('+919876543210');
  });
  it('does not guess a country, and refuses what is not a number', () => {
    expect(e164Of('9876543210', null)).toBeNull();
    expect(e164Of('anonymous', '+91')).toBeNull();
    expect(e164Of('', '+91')).toBeNull();
    expect(e164Of('-1', '+91')).toBeNull();
  });
});

describe('who may edit or delete an entry', () => {
  const base = {
    source: 'manual',
    createdById: 7,
    createdAt: new Date(NOW.getTime() - 2 * HOUR),
    viewerId: 7,
    canManage: false,
    windowHours: 24,
    now: NOW,
  };
  it('lets the person who logged it, inside the window', () => {
    expect(editVerdict(base)).toBe('allowed');
    expect(editVerdict({ ...base, source: 'web_click_to_call' })).toBe('allowed');
  });
  it('closes the window', () => {
    expect(editVerdict({ ...base, createdAt: new Date(NOW.getTime() - 25 * HOUR) })).toBe(
      'window_closed',
    );
    expect(editVerdict({ ...base, createdAt: new Date(NOW.getTime() - 24 * HOUR) })).toBe(
      'allowed',
    );
  });
  it('answers as if another person’s entry did not exist', () => {
    expect(editVerdict({ ...base, viewerId: 8 })).toBe('not_found');
    expect(editVerdict({ ...base, viewerId: null })).toBe('not_found');
  });
  it('keeps a phone’s or a provider’s report as it was told', () => {
    expect(editVerdict({ ...base, source: 'mobile_app' })).toBe('not_editable');
    expect(editVerdict({ ...base, source: 'telephony' })).toBe('not_editable');
    expect(editVerdict({ ...base, source: 'web_click_to_call', reported: true })).toBe(
      'not_editable',
    );
  });
  it('lets call.logging.manage change anything at any time', () => {
    expect(
      editVerdict({
        ...base,
        source: 'telephony',
        viewerId: 99,
        canManage: true,
        createdAt: new Date(0),
      }),
    ).toBe('allowed');
  });
});

describe('outcomes from outside reports', () => {
  it('reads the phone’s call log', () => {
    expect(outcomeFromDevice('incoming', 90)).toBe('connected');
    expect(outcomeFromDevice('outgoing', 0)).toBe('no_answer');
    expect(outcomeFromDevice('missed', 0)).toBe('no_answer');
    expect(outcomeFromDevice('voicemail', 20)).toBe('no_answer');
    expect(outcomeFromDevice('rejected', 0)).toBe('declined');
    expect(outcomeFromDevice(undefined, 12)).toBe('connected');
  });
  it('skips the phone’s own blocked calls', () => {
    expect(outcomeFromDevice('blocked', 0)).toBeNull();
  });
  it('reads a provider’s finished call', () => {
    expect(outcomeFromTelephony('completed', 30)).toBe('connected');
    expect(outcomeFromTelephony('completed', 0)).toBe('no_answer');
    expect(outcomeFromTelephony('busy', 0)).toBe('busy');
    expect(outcomeFromTelephony('declined', 0)).toBe('declined');
    expect(outcomeFromTelephony('voicemail', 15)).toBe('left_voicemail');
    expect(outcomeFromTelephony('failed', 0)).toBe('failed');
    expect(outcomeFromTelephony('canceled', 0)).toBe('no_answer');
    expect(outcomeFromTelephony('no_answer', 0)).toBe('no_answer');
  });
  it('keys a report by where it came from, so the same report lands once', () => {
    expect(mobileExternalId('dev-1', '42')).toBe('dev-1:42');
    expect(telephonyExternalId('c-uuid', 'CA123')).toBe('c-uuid:CA123');
  });
});

describe('the lifecycle nudge', () => {
  const stages = [
    { value: 'new', label: 'New', isWon: false, isLost: false },
    { value: 'contacted', label: 'Contacted', isWon: false, isLost: false },
    { value: 'won', label: 'Won', isWon: true, isLost: false },
    { value: 'lost', label: 'Lost', isWon: false, isLost: true },
  ];
  it('suggests the next stage for a connected call to a contact still at the first stage', () => {
    expect(stageNudge('connected', 'new', stages)).toEqual({
      kind: 'lifecycle_stage',
      current: 'new',
      suggested: 'contacted',
      suggestedLabel: 'Contacted',
    });
  });
  it('suggests nothing for a call that did not connect, a contact past the first stage, or a workspace with one stage', () => {
    expect(stageNudge('no_answer', 'new', stages)).toBeNull();
    expect(stageNudge('connected', 'contacted', stages)).toBeNull();
    expect(stageNudge('connected', 'new', stages.slice(0, 1))).toBeNull();
  });
  it('never suggests a stage that ends the story', () => {
    const odd = [
      { value: 'new', label: null, isWon: false, isLost: false },
      { value: 'won', label: null, isWon: true, isLost: false },
    ];
    expect(stageNudge('connected', 'new', odd)).toBeNull();
  });
});

describe('the cursor of the unified list', () => {
  const c = {
    startedAt: '2026-10-17T10:00:00.123456Z',
    uuid: '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b',
  };
  it('round-trips', () => {
    expect(decodeLogCursor(encodeLogCursor(c))).toEqual(c);
  });
  it('refuses a cursor that is not ours', () => {
    expect(decodeLogCursor('!!!')).toBeNull();
    expect(decodeLogCursor(Buffer.from('nonsense|x').toString('base64url'))).toBeNull();
    expect(
      decodeLogCursor(Buffer.from('2026-10-17T10:00:00Z|drop table').toString('base64url')),
    ).toBeNull();
  });
});

describe('the contract', () => {
  const valid = {
    direction: 'outbound',
    outcome: 'connected',
    customerPhone: '+919876543210',
  } as const;

  it('needs the contact or the number', () => {
    expect(logCallInputSchema.safeParse({ direction: 'inbound', outcome: 'busy' }).success).toBe(
      false,
    );
    expect(logCallInputSchema.safeParse(valid).success).toBe(true);
    expect(
      logCallInputSchema.safeParse({
        direction: 'inbound',
        outcome: 'busy',
        contactId: '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b',
      }).success,
    ).toBe(true);
  });
  it('caps the notes and the talk time and knows only the seven outcomes', () => {
    expect(logCallInputSchema.safeParse({ ...valid, notes: 'x'.repeat(2001) }).success).toBe(false);
    expect(logCallInputSchema.safeParse({ ...valid, durationSec: 86_401 }).success).toBe(false);
    expect(logCallInputSchema.safeParse({ ...valid, outcome: 'maybe' }).success).toBe(false);
    expect(logCallInputSchema.safeParse({ ...valid, source: 'telephony' }).success).toBe(false);
  });
  it('takes a mobile batch of 1 to 100 entries', () => {
    const entry = {
      deviceCallId: '1',
      direction: 'inbound',
      startedAt: '2026-10-17T09:00:00Z',
      durationSec: 10,
      customerPhone: '+919876543210',
    };
    const batch = (n: number) => ({
      deviceId: 'd',
      platform: 'android',
      entries: Array.from({ length: n }, (_, i) => ({ ...entry, deviceCallId: String(i) })),
    });
    expect(ingestCallsInputSchema.safeParse(batch(0)).success).toBe(false);
    expect(ingestCallsInputSchema.safeParse(batch(1)).success).toBe(true);
    expect(ingestCallsInputSchema.safeParse(batch(CALL_INGEST_MAX_BATCH)).success).toBe(true);
    expect(ingestCallsInputSchema.safeParse(batch(CALL_INGEST_MAX_BATCH + 1)).success).toBe(false);
  });
});

describe('the web "did you call? log it" nudge', () => {
  it('prefills an outbound web click-to-call that started at the click', () => {
    const p = callLogPrefill({
      customerPhone: '+919876543210',
      clickedAt: new Date('2026-10-17T09:55:00Z'),
    });
    expect(p).toEqual({
      source: 'web_click_to_call',
      direction: 'outbound',
      customerPhone: '+919876543210',
      startedAt: '2026-10-17T09:55:00.000Z',
    });
    expect(callLogPrefillSchema.safeParse(p).success).toBe(true);
  });
  it('asks only after the person was away a while, and not for an old click', () => {
    const away = CALL_CLICK_NUDGE.minAwaySeconds * 1000;
    const maxAge = CALL_CLICK_NUDGE.maxAgeMinutes * 60_000;
    expect(shouldNudgeCall(away - 1, 60_000)).toBe(false);
    expect(shouldNudgeCall(away, 60_000)).toBe(true);
    expect(shouldNudgeCall(away, maxAge)).toBe(true);
    expect(shouldNudgeCall(away, maxAge + 1)).toBe(false);
  });
});
