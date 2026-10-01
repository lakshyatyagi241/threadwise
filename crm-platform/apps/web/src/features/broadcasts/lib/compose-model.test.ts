import { describe, expect, it } from 'vitest';
import type { ComposeTemplate } from '@crm/contracts';
import {
  buildBody,
  contactName,
  defaultSchedule,
  EMPTY_FORM,
  fillSamples,
  matchesSearch,
  previewOf,
  problems,
  sharePercents,
  slotMap,
  templateOptionLabel,
  toggle,
} from './compose-model';

const form = (o: Partial<typeof EMPTY_FORM> = {}) => ({
  ...EMPTY_FORM,
  name: 'May offer',
  templateId: 't1',
  ...o,
});

describe('share percentages', () => {
  it('7 and 3 make 70% and 30%; unticked senders have none', () => {
    expect(sharePercents(['a', 'b', 'c'], ['a', 'b'], { a: 7, b: 3 })).toEqual({
      a: 70,
      b: 30,
      c: null,
    });
  });
  it('equal weights split evenly; a missing weight is 1; a zero or bad weight is 0%', () => {
    expect(sharePercents(['a', 'b'], ['a', 'b'], {})).toEqual({ a: 50, b: 50 });
    expect(sharePercents(['a', 'b'], ['a', 'b'], { a: 0, b: 5 })).toEqual({ a: 0, b: 100 });
    expect(sharePercents(['a'], ['a'], { a: Number.NaN })).toEqual({ a: 0 });
  });
});

describe('the request body', () => {
  it('a send-now body has no schedule fields or overrides', () => {
    const b = buildBody(
      form({ contactIds: ['c1'], senderKeys: ['waba:1'], shares: { 'waba:1': 4 } }),
    );
    expect(b).toEqual({
      name: 'May offer',
      templateId: 't1',
      contactIds: ['c1'],
      groupIds: [],
      tagIds: [],
      senderKeys: ['waba:1'],
      senderShare: { 'waba:1': 4 },
      scheduleType: 'now',
      timezone: 'UTC',
    });
  });
  it('a later body carries the date and time; empty overrides are left out, filled ones sent', () => {
    const later = buildBody(
      form({
        scheduleType: 'later',
        sendDate: '2026-10-05',
        sendTime: '09:30',
        timezone: 'Asia/Kolkata',
        overrides: {},
      }),
    );
    expect(later).toMatchObject({
      scheduleType: 'later',
      sendDate: '2026-10-05',
      sendTime: '09:30',
      timezone: 'Asia/Kolkata',
    });
    expect(later).not.toHaveProperty('templateOverrides');
    expect(buildBody(form({ overrides: { body: { '1': 'x' } } }))).toHaveProperty(
      'templateOverrides',
    );
  });
  it('share weights are sent only for ticked senders; the name is trimmed', () => {
    const b = buildBody(form({ name: '  x  ', senderKeys: ['a'], shares: { a: 2, z: 9 } }));
    expect(b.senderShare).toEqual({ a: 2 });
    expect(b.name).toBe('x');
  });
});

describe('what stops the form', () => {
  it('needs a name, a template and, for later, a date and time', () => {
    expect(problems(EMPTY_FORM)).toEqual(['name', 'template']);
    expect(problems(form())).toEqual([]);
    expect(problems(form({ scheduleType: 'later' }))).toEqual(['schedule']);
    expect(problems(form({ name: '  ' }))).toEqual(['name']);
  });
});

describe('schedule defaults', () => {
  it('today in the zone and half an hour ahead, crossing midnight where the zone is ahead', () => {
    const now = new Date('2026-10-02T18:50:00Z');
    expect(defaultSchedule(now, 'UTC')).toEqual({ sendDate: '2026-10-02', sendTime: '19:20' });
    expect(defaultSchedule(now, 'Asia/Kolkata')).toEqual({
      sendDate: '2026-10-03',
      sendTime: '00:50',
    });
  });
});

describe('preview text', () => {
  it('fills named and positional tokens with samples and leaves unknown ones as written', () => {
    expect(fillSamples('Hi {{name}}, order {{order_id}} {{nope}}', {})).toBe(
      'Hi John, order ORD-12 {{nope}}',
    );
    expect(fillSamples('Hi {{1}} {{2}}', { '1': 'first_name' })).toBe('Hi John {{2}}');
  });
  it('reads both shapes of the variable map', () => {
    expect(slotMap({ header: [{ num: 1, key: 'name' }], body: [{ num: 2, key: 'city' }] })).toEqual(
      { '1': 'name', '2': 'city' },
    );
    expect(slotMap({ '1': 'name' })).toEqual({ '1': 'name' });
    expect(slotMap(null)).toEqual({});
  });
  const tpl = (o: Partial<ComposeTemplate> = {}): ComposeTemplate => ({
    id: 't1',
    name: 'promo',
    header: 'Sale {{1}}',
    body: 'Hi {{1}}',
    footer: 'STOP',
    category: 'marketing',
    type: 'standard',
    language: 'en_US',
    buttons: [{ type: 'url', text: 'Shop' }, { type: 'url' }],
    variableMap: { body: [{ num: 1, key: 'first_name' }], header: [{ num: 1, key: 'name' }] },
    attachmentType: null,
    attachmentUrl: null,
    senderLabel: 'Main',
    twilioReady: false,
    ...o,
  });
  it('the bubble: header, body, footer, category, buttons with text, and media kind', () => {
    const p = previewOf(tpl({ attachmentType: 'IMAGE' }));
    expect(p).toMatchObject({
      header: 'Sale John',
      body: 'Hi John',
      footer: 'STOP',
      category: 'Marketing',
      media: 'image',
    });
    expect(p.buttons).toHaveLength(1);
    expect(previewOf(tpl({ attachmentType: 'none', body: '' })).media).toBeNull();
    expect(previewOf(tpl({ body: '' })).body).toBe('(empty body)');
  });
  it('the option label shows the number and the Twilio mark', () => {
    expect(templateOptionLabel(tpl(), false)).toBe('promo · Main');
    expect(templateOptionLabel(tpl(), true)).toBe('promo · Main · plain text only');
    expect(templateOptionLabel(tpl({ twilioReady: true, senderLabel: null }), true)).toBe(
      'promo ✓ Twilio ready',
    );
  });
});

describe('audience helpers', () => {
  it('toggle adds and removes', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('search matches name or phone; the display name falls back', () => {
    expect(matchesSearch({ name: 'Asha Rao', phone: '+91 98' }, 'rao')).toBe(true);
    expect(matchesSearch({ name: 'Asha', phone: '+91 98765' }, '9876')).toBe(true);
    expect(matchesSearch({ name: 'Asha', phone: '' }, 'zzz')).toBe(false);
    expect(matchesSearch({ name: 'x', phone: '' }, '  ')).toBe(true);
    expect(contactName({ id: 'abcdef1234', name: '  ', firstName: 'A', lastName: 'B' })).toBe(
      'A B',
    );
    expect(contactName({ id: 'abcdef1234', name: null, firstName: null, lastName: null })).toBe(
      'Contact #abcdef12',
    );
  });
});
