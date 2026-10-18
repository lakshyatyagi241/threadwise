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
