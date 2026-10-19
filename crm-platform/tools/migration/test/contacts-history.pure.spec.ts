import { describe, expect, it } from 'vitest';
import { contacts } from '../transform/contacts';
import type { Ctx } from '../transform/types';

const ctx = {
  fallbackAt: '2026-06-01T00:00:00.000Z',
  defaultCountryCode: '91',
  idx: {
    hasUsers: false,
    defaultStage: 'new',
    optionLabel: new Map<string, string>(),
    stageByKey: new Map([['lead', { kind: 'stage', value: 'lead' }]]),
    stageByLabel: new Map([
      ['stage:lead', { kind: 'stage', value: 'lead' }],
      ['stage:new', { kind: 'stage', value: 'new' }],
    ]),
  },
  ref: () => undefined,
} as unknown as Ctx;
const out = (d: object) =>
  contacts.transform({ _id: 'c1', first_name: 'Asha', ...d } as never, ctx) as any;

describe('contact lifecycle history', () => {
  it('keeps the stage, the previous stage and both dates exactly', () => {
    const o = out({
      lifecycle_stage: 'lead',
      lifecycle_stage_date: new Date('2026-02-01T09:30:00Z'),
      previous_lifecycle_stage: 'new',
      previous_lifecycle_stage_date: new Date('2026-01-15T08:00:00Z'),
    });
    expect(o.rows[0].row).toMatchObject({
      lifecycle_stage: 'lead',
      lifecycle_stage_date: '2026-02-01T09:30:00.000Z',
      previous_lifecycle_stage: 'new',
      previous_lifecycle_stage_date: '2026-01-15T08:00:00.000Z',
    });
    expect(o.soft.filter((s: { code: string }) => s.code === 'BAD_DATE')).toEqual([]);
  });
  it('reports a stage date it cannot read instead of dropping it silently', () => {
    const o = out({ lifecycle_stage: 'lead', lifecycle_stage_date: 'not a date' });
    expect(o.rows[0].row.lifecycle_stage_date).toBeNull();
    expect(o.soft).toContainEqual(
      expect.objectContaining({ code: 'BAD_DATE', detail: 'not a date' }),
    );
  });
  it('keeps the web-analytics values of the contact in data, under their own keys', () => {
    const o = out({
      channel: 'WhatsApp',
      bot_name: 'Test bot',
      module_type: 'WhatsApp Chatbot',
      module_name: 'Test bot',
      platform: 'WhatsApp',
      source: 'WhatsApp Direct',
    });
    expect(o.rows[0].row.source).toBe('WhatsApp Direct');
    expect(o.rows[0].row.data).toMatchObject({
      channel: 'WhatsApp',
      bot_name: 'Test bot',
      module_type: 'WhatsApp Chatbot',
      module_name: 'Test bot',
      platform: 'WhatsApp',
    });
  });
});

describe('empty subscription values', () => {
  it('stay empty: nothing is defaulted to subscribed', () => {
    const o = out({
      whatsapp_subscription_status: '',
      email_subscription_status: '',
      sms_subscription_status: '',
    });
    expect(o.rows[0].row).toMatchObject({
      whatsapp_subscription_status: null,
      email_subscription_status: null,
      sms_subscription_status: null,
      is_unsubscribed: false,
    });
  });
});

describe('attribution evidence', () => {
  it('keeps the current and the first touch exactly, channel and module type included', async () => {
    const { attributionEvidence } = await import('../transform/leads');
    const ev = attributionEvidence(
      {
        _id: 'a1',
        contact_id: 'c1',
        source: 'WhatsApp Direct',
        channel: 'WhatsApp',
        platform: 'WhatsApp',
        module_name: 'Test bot',
        module_type: 'WhatsApp Chatbot',
        created_at: new Date('2026-05-01T10:00:00Z'),
        first_touch: {
          source: 'Geta (Import)',
          channel: 'API',
          module_type: 'Contacts',
          raw_utm_source: null,
        },
      },
      'a1',
    ) as any;
    expect(ev.legacy.waboo.current).toMatchObject({
      source: 'WhatsApp Direct',
      channel: 'WhatsApp',
      module_type: 'WhatsApp Chatbot',
      module_name: 'Test bot',
      platform: 'WhatsApp',
      created_at: '2026-05-01T10:00:00.000Z',
    });
    expect(ev.legacy.waboo.firstTouch).toEqual({
      source: 'Geta (Import)',
      channel: 'API',
      module_type: 'Contacts',
    });
  });
});

describe('contact-level web-analytics values', () => {
  it('keeps module, module_type, module_name, platform, channel, bot_name and every source exactly, empty strings included', () => {
    const a = out({
      source: 'Social Media',
      channel: 'WhatsApp',
      bot_name: 'Test bot',
      module: 'chatbot',
      module_type: 'Whatsapp Chatbot',
      module_name: 'Test bot',
      platform: 'WhatsApp',
    });
    expect(a.rows[0].row.source).toBe('Social Media');
    expect(a.rows[0].row.data).toMatchObject({
      channel: 'WhatsApp',
      bot_name: 'Test bot',
      module: 'chatbot',
      module_type: 'Whatsapp Chatbot',
      module_name: 'Test bot',
      platform: 'WhatsApp',
    });
    const b = out({ source: 'WhatsApp Direct', channel: '', bot_name: '' });
    expect(b.rows[0].row.source).toBe('WhatsApp Direct');
    expect(b.rows[0].row.data).toMatchObject({ channel: '', bot_name: '' });
  });
});
