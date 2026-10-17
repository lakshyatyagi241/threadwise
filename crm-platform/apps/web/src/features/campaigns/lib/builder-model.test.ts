import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  defaultSchedule,
  editorType,
  problems,
  submitKey,
  toInput,
  type BuilderForm,
} from './builder-model';

const ok: BuilderForm = {
  ...EMPTY_FORM,
  name: 'Diwali',
  senderKey: 'baileys:1',
  customMessage: 'Hello {{name}}',
  contactIds: ['c1'],
};

describe('problems', () => {
  it('needs a sender, but a draft can be saved without one', () => {
    expect(problems({ ...ok, senderKey: '' })).toEqual(['sender']);
    expect(problems({ ...ok, senderKey: '' }, { draft: true })).toEqual([]);
  });

  it('a complete text campaign has none', () => {
    expect(problems(ok)).toEqual([]);
  });

  it('lists what is missing in the order the screen shows it', () => {
    expect(problems({ ...EMPTY_FORM })).toEqual(['name', 'sender', 'message', 'audience']);
    expect(problems({ ...ok, type: 'template', customMessage: '' })).toEqual(['template']);
    expect(problems({ ...ok, type: 'flow', customMessage: '' })).toEqual(['flow']);
  });

  it('a draft may have no audience', () => {
    expect(problems({ ...ok, contactIds: [] }, { draft: true })).toEqual([]);
    expect(problems({ ...ok, contactIds: [] })).toEqual(['audience']);
    // Typed numbers and a CSV count as an audience.
    expect(problems({ ...ok, contactIds: [], manualNumbers: '919812345678' })).toEqual([]);
    expect(problems({ ...ok, contactIds: [], csvText: 'phone\n919812345678' })).toEqual([]);
  });

  it('a scheduled campaign needs its date and time, and an end date after them', () => {
    expect(problems({ ...ok, scheduleType: 'scheduled' })).toEqual(['date', 'time']);
    const base = {
      ...ok,
      scheduleType: 'scheduled' as const,
      sendDate: '2026-12-05',
      sendTime: '09:00',
    };
    expect(problems({ ...base, expiresAt: '2026-12-05T09:00' })).toEqual(['expiry']);
    expect(problems({ ...base, expiresAt: '2026-12-06T09:00' })).toEqual([]);
    // An immediate campaign has no send moment to compare to.
    expect(problems({ ...ok, expiresAt: '2020-01-01T00:00' })).toEqual([]);
  });

  it('the window needs both ends, the throttle a max at least the min, the media an https or http address', () => {
    expect(problems({ ...ok, windowStart: '09:00' })).toEqual(['window']);
    expect(problems({ ...ok, windowStart: '09:00', windowEnd: '18:00' })).toEqual([]);
    expect(problems({ ...ok, throttleMinSec: '9', throttleMaxSec: '5' })).toEqual(['throttle']);
    expect(problems({ ...ok, mediaUrl: 'ftp://x' })).toEqual(['media']);
    expect(problems({ ...ok, mediaUrl: 'https://cdn.test/a.png' })).toEqual([]);
  });
});

describe('previous sends', () => {
  const picked = { sends: [{ kind: 'campaign' as const, id: 'c1' }], outcome: 'read' as const };

  it('count as an audience', () => {
    const f = { ...ok, contactIds: [], previousSends: picked };
    expect(problems(f)).toEqual([]);
    expect(problems({ ...f, previousSends: { sends: [], outcome: 'read' } })).toEqual(['audience']);
  });

  it('are sent with the outcome, and left out of the body when none is picked', () => {
    expect(toInput({ ...ok, previousSends: picked }).previousSends).toEqual(picked);
    expect(toInput(ok)).not.toHaveProperty('previousSends');
  });

  it('are cleaned the way the server wants them before they are sent', () => {
    const bad = {
      sends: [
        { kind: 'broadcast' as const, id: 'b1' },
        { kind: 'broadcast' as const, id: 'b1' },
      ],
      outcome: 'clicked' as const,
    };
    expect(toInput({ ...ok, previousSends: bad }).previousSends).toEqual({
      sends: [{ kind: 'broadcast', id: 'b1' }],
      outcome: 'all',
    });
  });
});

describe('sharing a send across several numbers', () => {
  const shared = {
    ...ok,
    senderKeys: ['baileys:1', 'waba:2'],
    senderShare: { 'baileys:1': 2, 'waba:2': 1 },
  };

  it('ships the numbers and their weights only when more than one is ticked', () => {
    const body = toInput(shared);
    expect(body.senderKeys).toEqual(['baileys:1', 'waba:2']);
    expect(body.senderShare).toEqual({ 'baileys:1': 2, 'waba:2': 1 });
    expect(toInput(ok)).not.toHaveProperty('senderKeys');
    expect(toInput({ ...ok, senderKeys: ['baileys:1'] })).not.toHaveProperty('senderKeys');
  });

  it('a mail or a flow has no number to share, so nothing is shipped', () => {
    expect(toInput({ ...shared, senderKey: 'email:1' })).not.toHaveProperty('senderKeys');
    expect(toInput({ ...shared, type: 'flow' })).not.toHaveProperty('senderKeys');
  });
});

describe('toInput', () => {
  it('ships a copy-code button with its code', () => {
    const body = toInput({
      ...ok,
      buttons: [{ type: 'copy_code', text: 'Copy', value: 'PROMO50' }],
    });
    expect(body.customButtons).toEqual([{ type: 'copy_code', text: 'Copy', value: 'PROMO50' }]);
  });

  it('sends only what the type uses and leaves blanks out', () => {
    const body = toInput({
      ...ok,
      customHeader: '  ',
      buttons: [
        { type: 'url', text: 'Shop', value: 'https://x.test' },
        { type: 'quick_reply', text: 'Yes', value: '' },
        { type: 'url', text: '', value: 'https://dropped.test' },
      ],
      mediaUrl: ' https://cdn.test/a.png ',
      throttleMinSec: '5',
      throttleMaxSec: '',
      templateId: 'ignored',
    });
    expect(body).toMatchObject({
      name: 'Diwali',
      type: 'text',
      customMessage: 'Hello {{name}}',
      customHeader: null,
      mediaUrl: 'https://cdn.test/a.png',
      templateId: null,
      throttleMinSec: 5,
      throttleMaxSec: null,
      status: null,
      sendDate: null,
    });
    expect(body.customButtons).toEqual([
      { type: 'url', text: 'Shop', url: 'https://x.test', value: 'https://x.test' },
      { type: 'quick_reply', text: 'Yes', value: 'Yes' },
    ]);
  });

  it('retries failed messages unless the person switched that off, and says so either way', () => {
    expect(EMPTY_FORM.retryFailed).toBe(true);
    expect(toInput(ok).retryFailed).toBe(true);
    expect(toInput({ ...ok, retryFailed: false }).retryFailed).toBe(false);
  });

  it('a template campaign sends the template and its overrides, not a typed message', () => {
    const body = toInput({
      ...EMPTY_FORM,
      name: 'T',
      type: 'template',
      templateId: 't1',
      customMessage: 'ignored',
      abTesting: true,
      templateIdB: 't2',
      templateOverrides: { body: ['x'] },
      templateOverridesB: { body: ['y'] },
      contactIds: ['c1'],
    });
    expect(body).toMatchObject({
      customMessage: null,
      templateId: 't1',
      templateIdB: 't2',
      templateOverrides: { body: ['x'] },
      templateOverridesB: { body: ['y'] },
    });
    expect(
      toInput({ ...EMPTY_FORM, name: 'T', type: 'template', templateId: 't1', templateIdB: 't2' })
        .templateIdB,
    ).toBeNull();
  });

  it('schedule fields go only for a scheduled campaign; recurring adds its cadence; a draft says so', () => {
    const now = toInput({ ...ok, sendDate: '2026-12-05', sendTime: '09:00' });
    expect(now).toMatchObject({ sendDate: null, sendTime: null, repeatInterval: null });
    const rec = toInput({
      ...ok,
      scheduleType: 'recurring',
      sendDate: '2026-12-05',
      sendTime: '09:00',
      repeatInterval: 'daily',
      repeatUntil: '2027-01-01',
    });
    expect(rec).toMatchObject({
      sendDate: '2026-12-05',
      repeatInterval: 'daily',
      repeatUntil: '2027-01-01',
    });
    expect(toInput(ok, { draft: true }).status).toBe('draft');
  });
});

describe('small helpers', () => {
  it('the submit word follows the schedule', () => {
    expect(submitKey(ok, false)).toBe('launch');
    expect(submitKey({ ...ok, scheduleType: 'scheduled' }, false)).toBe('schedule');
    expect(submitKey({ ...ok, scheduleType: 'recurring' }, false)).toBe('saveRecurring');
    expect(submitKey(ok, true)).toBe('save');
  });

  it('button and media campaigns edit as the rich custom message', () => {
    expect(editorType('button')).toBe('custom');
    expect(editorType('media')).toBe('custom');
    expect(editorType('template')).toBe('template');
  });

  it('the default schedule is an hour ahead on the clock of the zone', () => {
    const at = new Date('2026-10-05T12:00:00Z');
    expect(defaultSchedule(at, 'UTC')).toEqual({ sendDate: '2026-10-05', sendTime: '13:00' });
    expect(defaultSchedule(at, 'Asia/Kolkata')).toEqual({
      sendDate: '2026-10-05',
      sendTime: '18:30',
    });
  });
});

describe('an email campaign', () => {
  const mail: BuilderForm = {
    ...ok,
    senderKey: 'email:5d1b',
    type: 'custom',
    customHeader: 'Your May offer is live',
    customMessage: 'Hello {{name}}',
  };

  it('sends the subject in the Header field and a typed message only', () => {
    const body = toInput({
      ...mail,
      customFooter: 'Bye',
      mediaUrl: 'https://x.test/a.png',
      abTesting: true,
      customMessageB: 'B',
      buttons: [{ type: 'url', text: 'Go', value: 'https://x.test' }],
      throttleMinSec: '1',
      batchSize: '10',
      dailyLimit: '100',
      windowStart: '09:00',
      windowEnd: '18:00',
    });
    expect(body).toMatchObject({
      senderKey: 'email:5d1b',
      type: 'custom',
      customHeader: 'Your May offer is live',
      customMessage: 'Hello {{name}}',
      abTesting: false,
      customMessageB: null,
      customFooter: null,
      customButtons: null,
      mediaUrl: null,
      templateId: null,
      templateIdB: null,
      flowId: null,
      flowIdB: null,
      trackingEnabled: false,
      throttleMinSec: null,
      throttleMaxSec: null,
      batchSize: null,
      batchPauseMin: null,
      dailyLimit: null,
      windowStart: null,
      windowEnd: null,
    });
  });

  it('a blank subject is left out (the server falls back to the campaign name)', () => {
    expect(toInput({ ...mail, customHeader: '  ' }).customHeader).toBeNull();
  });

  it('a subject over 150 characters is a problem, 150 is fine, and only for email', () => {
    expect(problems({ ...mail, customHeader: 'x'.repeat(150) })).toEqual([]);
    expect(problems({ ...mail, customHeader: 'x'.repeat(151) })).toEqual(['subject']);
    expect(problems({ ...ok, customHeader: 'x'.repeat(151) })).toEqual([]);
  });

  it('ignores sending hours and gaps, which an email does not have', () => {
    expect(
      problems({ ...mail, windowStart: '09:00', throttleMinSec: '9', throttleMaxSec: '1' }),
    ).toEqual([]);
  });

  it('a WhatsApp form still sends what it holds', () => {
    expect(toInput({ ...ok, customFooter: 'Bye', trackingEnabled: true })).toMatchObject({
      customFooter: 'Bye',
      trackingEnabled: true,
    });
  });
});
