import { createScheduleInputSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  audienceCount,
  draftFromSchedule,
  firstInvalidStep,
  initialDraft,
  parseNumbers,
  serverFieldError,
  stepOfServerErrors,
  toCreateInput,
  toUpdateInput,
  validateStep,
  type CheckContext,
  type Draft,
} from './composer-model';

const NOW = Date.UTC(2026, 9, 10, 10, 0);
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const ctx: CheckContext = {
  now: NOW,
  options: {
    minLeadMinutes: 2,
    senders: [
      { key: 'baileys:a', engine: 'baileys', label: 'Shop', phone: null, warming: false },
      { key: 'waba:b', engine: 'waba', label: 'Cloud', phone: null, warming: false },
    ],
    templates: [
      {
        id: G1,
        name: 'cloud_ok',
        header: null,
        body: 'Hi',
        footer: null,
        category: 'marketing',
        type: 'standard',
        engine: 'waba',
        language: 'en',
        buttons: [],
        variableMap: {},
        attachmentType: null,
        attachmentUrl: null,
        senderLabel: null,
        twilioReady: false,
        usableOn: ['waba', 'baileys'],
        senderKey: null,
      },
      {
        id: G2,
        name: 'text_only',
        header: null,
        body: 'Hi',
        footer: null,
        category: 'utility',
        type: 'standard',
        engine: 'baileys',
        language: 'en',
        buttons: [],
        variableMap: {},
        attachmentType: null,
        attachmentUrl: null,
        senderLabel: null,
        twilioReady: false,
        usableOn: ['baileys', 'twilio'],
        senderKey: null,
      },
    ],
  },
};

const draft = (over: Partial<Draft> = {}): Draft => ({
  ...initialDraft(NOW, 'UTC'),
  name: 'Spring promo',
  senders: ['baileys:a'],
  groupIds: [G1],
  message: 'Hi {name}',
  sendDate: '2026-10-11',
  sendTime: '10:00',
  ...over,
});

describe('initial draft', () => {
  it('starts ten minutes ahead on the zone clock, with a lone sender ticked', () => {
    const d = initialDraft(NOW, 'Asia/Kolkata', ['baileys:a']);
    expect(d).toMatchObject({
      sendDate: '2026-10-10',
      sendTime: '15:40',
      timezone: 'Asia/Kolkata',
      senders: ['baileys:a'],
    });
    expect(initialDraft(NOW, 'UTC', ['a', 'b']).senders).toEqual([]);
  });
});

describe('numbers', () => {
  it('keeps digits, drops blanks and repeats', () => {
    expect(parseNumbers('+91 98765 43210\n919876543210, \n 4477001122;')).toEqual([
      '919876543210',
      '4477001122',
    ]);
    expect(parseNumbers('  \n ')).toEqual([]);
  });
  it('counts the chosen audience by source', () => {
    expect(audienceCount(draft())).toBe(1);
    expect(audienceCount(draft({ recipientType: 'tag', tagIds: [] }))).toBe(0);
    expect(audienceCount(draft({ recipientType: 'number', numbersText: '1\n2\n2' }))).toBe(2);
  });
});

describe('draft to request', () => {
  it('maps a plain once schedule and satisfies the contract', () => {
    const input = toCreateInput(draft());
    expect(input).toMatchObject({
      name: 'Spring promo',
      scheduleType: 'once',
      messageType: 'plain',
      recipientType: 'group',
      groupIds: [G1],
      message: 'Hi {name}',
      timezone: 'UTC',
    });
    expect(input.tagIds).toBeUndefined();
    expect(input.repeatInterval).toBeUndefined();
    expect(createScheduleInputSchema.safeParse(input).success).toBe(true);
  });
  it('maps a weekly recurring media schedule with an end date and a test number', () => {
    const input = toCreateInput(
      draft({
        messageType: 'media',
        media: ' https://x.test/a.jpg ',
        message: 'Look',
        scheduleType: 'recurring',
        repeatInterval: 'weekly',
        repeatEvery: '2',
        daysOfWeek: [5, 1],
        endMode: 'date',
        endDate: '2026-12-31',
        sendTest: true,
        testNumber: '+91 98765-43210',
      }),
    );
    expect(input).toMatchObject({
      media: 'https://x.test/a.jpg',
      repeatInterval: 'weekly',
      repeatEvery: 2,
      daysOfWeek: [1, 5],
      endDate: '2026-12-31',
      testNumber: '919876543210',
    });
    expect(createScheduleInputSchema.safeParse(input).success).toBe(true);
  });
  it('maps template and location without the message fields', () => {
    const tpl = toCreateInput(draft({ messageType: 'template', templateId: G1 }));
    expect(tpl.templateId).toBe(G1);
    expect(tpl.message).toBeUndefined();
    const loc = toCreateInput(
      draft({ messageType: 'location', latitude: '26.9', longitude: '75.7' }),
    );
    expect(loc).toMatchObject({ latitude: 26.9, longitude: 75.7 });
    expect(createScheduleInputSchema.safeParse(loc).success).toBe(true);
  });
  it('leaves the end date and weekdays out unless they apply', () => {
    const input = toCreateInput(
      draft({
        scheduleType: 'recurring',
        repeatInterval: 'daily',
        daysOfWeek: [1],
        endMode: 'never',
        endDate: '2026-12-31',
      }),
    );
    expect(input.daysOfWeek).toBeUndefined();
    expect(input.endDate).toBeUndefined();
  });
});

describe('step checks', () => {
  it('step 1: name, a sender, and a template every ticked number can send', () => {
    expect(validateStep(draft({ name: ' ', senders: [] }), 1, ctx)).toEqual({
      name: 'nameRequired',
      senders: 'senderRequired',
    });
    // a Cloud API number takes a template when Meta approved it, not a text-only one
    expect(
      validateStep(draft({ messageType: 'template', templateId: G1, senders: ['waba:b'] }), 1, ctx),
    ).toEqual({});
    expect(
      validateStep(draft({ messageType: 'template', templateId: G2, senders: ['waba:b'] }), 1, ctx),
    ).toEqual({ senders: 'templateNotForSender' });
    expect(
      validateStep(
        draft({ messageType: 'template', templateId: G2, senders: ['baileys:a'] }),
        1,
        ctx,
      ),
    ).toEqual({});
    expect(validateStep(draft({ messageType: 'plain', senders: ['waba:b'] }), 1, ctx)).toEqual({});
  });
  it('step 3: an uploaded file is checked against the channel of every ticked number', () => {
    const file = (size: number, kind: 'image' | 'video' = 'image', mime = 'image/png') => ({
      id: G1,
      name: 'a.png',
      mime,
      kind,
      size,
      url: 'https://files.test/a',
    });
    const big = file(6 * 1024 * 1024);
    expect(
      validateStep(draft({ messageType: 'media', senders: ['waba:b'], mediaFile: big }), 3, ctx),
    ).toEqual({ media: 'mediaTooLarge' });
    expect(
      validateStep(draft({ messageType: 'media', senders: ['baileys:a'], mediaFile: big }), 3, ctx),
    ).toEqual({});
    // one Cloud API number among the ticked ones is enough to refuse it
    expect(
      validateStep(
        draft({ messageType: 'media', senders: ['baileys:a', 'waba:b'], mediaFile: big }),
        3,
        ctx,
      ),
    ).toEqual({ media: 'mediaTooLarge' });
    expect(
      validateStep(
        draft({
          messageType: 'media',
          senders: ['waba:b'],
          mediaFile: file(1000, 'image', 'image/webp'),
        }),
        3,
        ctx,
      ),
    ).toEqual({ media: 'mediaType' });
    // no link needed once a file is attached
    expect(
      validateStep(
        draft({ messageType: 'media', senders: ['waba:b'], mediaFile: file(1000), media: '' }),
        3,
        ctx,
      ),
    ).toEqual({});
  });
  it('step 4: an edit that leaves the time alone may keep a time that has already passed', () => {
    const past = draft({ sendDate: '2026-10-10', sendTime: '09:00' });
    expect(validateStep(past, 4, ctx)).toEqual({ sendTime: 'tooSoon' });
    expect(validateStep(past, 4, { ...ctx, skipLead: true })).toEqual({});
  });
  it('step 2: something chosen for the source', () => {
    expect(validateStep(draft({ groupIds: [] }), 2, ctx)).toEqual({ groupIds: 'audienceRequired' });
    expect(validateStep(draft({ recipientType: 'number', numbersText: '' }), 2, ctx)).toEqual({
      numbers: 'numbersRequired',
    });
    expect(validateStep(draft(), 2, ctx)).toEqual({});
  });
  it('step 3: text, template, link or coordinates by type', () => {
    expect(validateStep(draft({ message: ' ' }), 3, ctx)).toEqual({ message: 'messageRequired' });
    expect(validateStep(draft({ message: 'x'.repeat(1025) }), 3, ctx)).toEqual({
      message: 'messageTooLong',
    });
    expect(validateStep(draft({ messageType: 'template' }), 3, ctx)).toEqual({
      templateId: 'templateRequired',
    });
    expect(validateStep(draft({ messageType: 'media', media: 'ftp://x' }), 3, ctx)).toEqual({
      media: 'mediaLink',
    });
    expect(
      validateStep(draft({ messageType: 'media', media: 'https://x.test/a.png' }), 3, ctx),
    ).toEqual({});
    expect(
      validateStep(draft({ messageType: 'location', latitude: '91', longitude: '' }), 3, ctx),
    ).toEqual({ latitude: 'latitude', longitude: 'longitude' });
  });
  it('step 4: the lead time is measured on the wall clock of the chosen zone', () => {
    expect(validateStep(draft({ sendDate: '2026-10-10', sendTime: '10:01' }), 4, ctx)).toEqual({
      sendTime: 'tooSoon',
    });
    expect(validateStep(draft({ sendDate: '2026-10-10', sendTime: '10:03' }), 4, ctx)).toEqual({});
    // 10:03 in Kolkata is 04:33 UTC: already past.
    expect(
      validateStep(
        draft({ sendDate: '2026-10-10', sendTime: '10:03', timezone: 'Asia/Kolkata' }),
        4,
        ctx,
      ),
    ).toEqual({ sendTime: 'tooSoon' });
    expect(validateStep(draft({ sendTime: '' }), 4, ctx)).toEqual({ sendTime: 'timeRequired' });
  });
  it('step 4: recurrence needs a count, weekdays when weekly, and a sane end', () => {
    const rec = { scheduleType: 'recurring' as const, repeatInterval: 'weekly' as const };
    expect(validateStep(draft({ ...rec, daysOfWeek: [] }), 4, ctx)).toEqual({
      daysOfWeek: 'daysRequired',
    });
    expect(validateStep(draft({ ...rec, daysOfWeek: [1], repeatEvery: '0' }), 4, ctx)).toEqual({
      repeatEvery: 'repeatEvery',
    });
    expect(
      validateStep(
        draft({ ...rec, repeatInterval: 'daily', endMode: 'date', endDate: '2026-10-01' }),
        4,
        ctx,
      ),
    ).toEqual({ endDate: 'endBeforeStart' });
    expect(
      validateStep(
        draft({ ...rec, repeatInterval: 'monthly', endMode: 'date', endDate: '' }),
        4,
        ctx,
      ),
    ).toEqual({ endDate: 'endDateRequired' });
  });
  it('step 5: a test number needs a country code', () => {
    expect(validateStep(draft({ sendTest: true, testNumber: '123' }), 5, ctx)).toEqual({
      testNumber: 'testNumber',
    });
    expect(validateStep(draft({ sendTest: false, testNumber: '' }), 5, ctx)).toEqual({});
  });
  it('finds the first step with a problem', () => {
    expect(firstInvalidStep(draft(), ctx)).toBeNull();
    expect(firstInvalidStep(draft({ groupIds: [], message: '' }), ctx)).toBe(2);
  });
});

describe('server field errors', () => {
  it('sends the person to the earliest step holding a rejected field', () => {
    expect(stepOfServerErrors([{ path: 'sendTime' }, { path: 'senders.0' }])).toBe(1);
    expect(stepOfServerErrors([{ path: 'daysOfWeek' }, { path: 'message' }])).toBe(3);
    expect(stepOfServerErrors([{ path: 'unknown' }])).toBeNull();
  });
  it('finds the message for a field, including indexed paths', () => {
    const errs = [
      { path: 'senders.0', message: 'No such sender' },
      { path: 'name', message: 'Too long' },
    ];
    expect(serverFieldError(errs, 'senders')).toBe('No such sender');
    expect(serverFieldError(errs, 'name')).toBe('Too long');
    expect(serverFieldError(errs, 'media')).toBeUndefined();
  });
});

describe('the edit request', () => {
  const stored = {
    id: G1,
    rowVersion: 4,
    name: 'Spring promo',
    scheduleType: 'recurring' as const,
    sendDate: '2031-03-10',
    sendTime: '10:30',
    timezone: 'UTC',
    repeatInterval: 'weekly' as const,
    repeatEvery: 2,
    daysOfWeek: [1, 3],
    endDate: '2031-06-01',
    sender: 'baileys:a',
    messageType: 'template' as const,
    message: '',
    templateId: G2,
    templateOverrides: { body: ['VIP'] },
    media: null,
    mediaFile: null,
    latitude: null,
    longitude: null,
    recipientType: 'number' as const,
    groupIds: [],
    tagIds: [],
    queueIds: [],
    numbers: ['919822000001', '919822000002'],
    totalRecipients: 2,
  };

  it('opens a stored schedule as the composer draft and sends the same schedule back with its version', () => {
    const d = draftFromSchedule(stored);
    expect(d).toMatchObject({
      senders: ['baileys:a'],
      templateId: G2,
      templateOverrides: { body: ['VIP'] },
      endMode: 'date',
      endDate: '2031-06-01',
      numbersText: '919822000001\n919822000002',
      repeatEvery: '2',
    });
    const body = toUpdateInput(d, 4);
    expect(body).toMatchObject({
      rowVersion: 4,
      sender: 'baileys:a',
      messageType: 'template',
      templateId: G2,
      templateOverrides: { body: ['VIP'] },
      scheduleType: 'recurring',
      repeatInterval: 'weekly',
      repeatEvery: 2,
      daysOfWeek: [1, 3],
      endDate: '2031-06-01',
      recipientType: 'number',
      numbers: ['919822000001', '919822000002'],
    });
    // one schedule is one number, and an edit sends no test message
    expect(body).not.toHaveProperty('senders');
    expect(body).not.toHaveProperty('testNumber');
  });

  it('removes the end date by sending null, and sends a file by its id', () => {
    const d = draftFromSchedule({ ...stored, endDate: null });
    expect(toUpdateInput(d, 1).endDate).toBeNull();
    const file = {
      id: G1,
      name: 'a.png',
      mime: 'image/png',
      kind: 'image' as const,
      size: 10,
      url: 'https://files.test/a',
    };
    const media = toUpdateInput(
      { ...d, messageType: 'media', mediaFile: file, media: 'https://old.test/x.png' },
      1,
    );
    expect(media.mediaId).toBe(G1);
    expect(media.media).toBeUndefined();
  });
});
