import { V1_BULK_CODE } from '../../../src/modules/developer-rest-api-v1/resources/bulk/bulk-codes';
import { describe, expect, it } from 'vitest';
import {
  v1CreateBroadcastSchema,
  v1CreateCampaignSchema,
  v1CreateScheduledSchema,
  ERROR_CODES,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  contactDigits,
  normalizeTime,
  parseWallClock,
  publicFieldName,
  rate,
  refusalAs,
  scheduledDigits,
  scheduledRunParts,
  senderKeyCandidates,
} from '../../../src/modules/developer-rest-api-v1/resources/bulk/bulk-input';
import {
  statisticsOf,
  toV1Campaign,
  wireStatus,
} from '../../../src/modules/developer-rest-api-v1/resources/bulk/campaigns.mapper';
import { toV1Broadcast } from '../../../src/modules/developer-rest-api-v1/resources/bulk/broadcasts.mapper';
import type { CampaignRow } from '../../../src/modules/campaigns';

const U = '3f2c1a8e-6d1b-4c2a-9a55-0b7d8e1f2a34';

describe('WD-API-095: numbers and sender ids', () => {
  it('keeps only digits, drops numbers under 8 digits, collapses duplicates', () => {
    expect(
      contactDigits(['+1 415 555 0100', '14155550100', '12345', 'call me', '(91) 98765-43210']),
    ).toEqual(['14155550100', '919876543210']);
  });

  it('scheduled numbers have no minimum length', () => {
    expect(scheduledDigits(['+91 98765-43210', '919876543210', '', 'abc', '12'])).toEqual([
      '919876543210',
      '12',
    ]);
  });

  it('a full sender key is itself, a bare uuid is tried on every engine, anything else is nobody', () => {
    expect(senderKeyCandidates(`WABA:${U}`)).toEqual([`waba:${U}`]);
    expect(senderKeyCandidates(U)).toEqual([
      `baileys:${U}`,
      `waba:${U}`,
      `twilio:${U}`,
      `sms:${U}`,
    ]);
    expect(senderKeyCandidates('cfg_4')).toEqual([]);
    expect(senderKeyCandidates('12')).toEqual([]);
    expect(senderKeyCandidates(null)).toEqual([]);
  });
});

describe('dates', () => {
  it('reads a wall clock with and without an offset', () => {
    expect(parseWallClock('2026-12-01 09:00')).toEqual({
      date: '2026-12-01',
      time: '09:00',
      offsetMinutes: null,
    });
    expect(parseWallClock('2026-12-01T09:00:30+05:30')).toEqual({
      date: '2026-12-01',
      time: '09:00',
      offsetMinutes: 330,
    });
    expect(parseWallClock('2026-12-01')?.time).toBe('00:00');
    expect(parseWallClock('2026-02-30 10:00')).toBeNull();
    expect(parseWallClock('tomorrow')).toBeNull();
    expect(parseWallClock('2026-12-01 25:00')).toBeNull();
  });

  it('a scheduled run time without an offset is the wall clock in the zone; with an offset it is that instant shown in the zone', () => {
    expect(scheduledRunParts('2026-12-01 09:00', 'Asia/Kolkata')).toEqual({
      date: '2026-12-01',
      time: '09:00',
    });
    expect(scheduledRunParts('2026-12-01T09:00:00Z', 'Asia/Kolkata')).toEqual({
      date: '2026-12-01',
      time: '14:30',
    });
    expect(scheduledRunParts('2026-12-01T23:30:00-05:00', 'UTC')).toEqual({
      date: '2026-12-02',
      time: '04:30',
    });
  });

  it('normalises 12 and 24 hour times', () => {
    expect(normalizeTime('2:30 PM')).toBe('14:30');
    expect(normalizeTime('12:05 am')).toBe('00:05');
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('25:00')).toBeNull();
  });
});

describe('rates', () => {
  it('are percents with two decimals and 0 for an empty base', () => {
    expect(rate(80, 100)).toBe(80);
    expect(rate(1, 3)).toBe(33.33);
    expect(rate(5, 0)).toBe(0);
  });
});

describe('refusals', () => {
  it('maps a domain code to the WaDesk code and renames fields', () => {
    const src = new AppError(ERROR_CODES.BCAST_NO_RECIPIENTS, 'none', 422);
    const out = refusalAs(src, {
      [ERROR_CODES.BCAST_NO_RECIPIENTS]: V1_BULK_CODE.NO_RECIPIENTS,
    }) as AppError;
    expect(out.code).toBe('NO_RECIPIENTS');
    expect(out.getStatus()).toBe(422);

    const v = AppError.validation('x', [
      { path: 'senderKey', message: 'That number is not connected.' },
    ]);
    const mapped = refusalAs(v, {}, { validationAs: V1_BULK_CODE.CREATE_FAILED }) as AppError;
    expect(mapped.code).toBe('CREATE_FAILED');
    expect(mapped.details).toEqual([
      { path: 'device_id', message: 'That number is not connected.' },
    ]);
    expect(publicFieldName('templateIdA', { templateIdA: 'template_id_a' })).toBe('template_id_a');
    expect(publicFieldName('customMessage')).toBe('custom_message');
  });

  it('leaves plan refusals and unknown errors alone', () => {
    const plan = new AppError(ERROR_CODES.PLAN_LIMIT_REACHED, 'cap', 402);
    expect(refusalAs(plan, {}, { validationAs: V1_BULK_CODE.CREATE_FAILED })).toBe(plan);
    const boom = new Error('boom');
    expect(refusalAs(boom, {})).toBe(boom);
  });
});

describe('request schemas', () => {
  it('a broadcast needs recipients or a group', () => {
    expect(v1CreateBroadcastSchema.safeParse({ name: 'a', template_id: U }).success).toBe(false);
    expect(
      v1CreateBroadcastSchema.safeParse({ name: 'a', template_id: U, recipients: [] }).success,
    ).toBe(false);
    expect(
      v1CreateBroadcastSchema.safeParse({ name: 'a', template_id: U, group_id: U }).success,
    ).toBe(true);
    expect(
      v1CreateBroadcastSchema.safeParse({ name: 'a', template_id: U, recipients: ['1'] }).success,
    ).toBe(false);
  });

  it('a campaign: custom needs a message, later needs a date and time, the split is 10 to 90', () => {
    const base = {
      campaign_name: 'c',
      device_id: U,
      campaign_type: 'custom',
      schedule_type: 'now',
      contacts: ['14155550100'],
    };
    expect(v1CreateCampaignSchema.safeParse({ ...base, custom_message: 'hi' }).success).toBe(true);
    expect(v1CreateCampaignSchema.safeParse(base).success).toBe(false);
    expect(
      v1CreateCampaignSchema.safeParse({ ...base, custom_message: 'hi', schedule_type: 'later' })
        .success,
    ).toBe(false);
    expect(
      v1CreateCampaignSchema.safeParse({
        ...base,
        custom_message: 'hi',
        schedule_type: 'later',
        send_date: '2031-01-01',
        send_time: '9:30 AM',
      }).success,
    ).toBe(true);
    expect(
      v1CreateCampaignSchema.safeParse({ ...base, custom_message: 'hi', ab_split: 5 }).success,
    ).toBe(false);
    expect(
      v1CreateCampaignSchema.safeParse({ ...base, custom_message: 'hi', ab_split: 95 }).success,
    ).toBe(false);
    expect(
      v1CreateCampaignSchema.safeParse({ ...base, custom_message: 'hi', contacts: [] }).success,
    ).toBe(false);
    const flag = v1CreateCampaignSchema.parse({
      ...base,
      custom_message: 'hi',
      ab_testing: 'true',
    });
    expect(flag.ab_testing).toBe(true);
    // A template campaign does not need its template (WaDesk, kept).
    expect(v1CreateCampaignSchema.safeParse({ ...base, campaign_type: 'template' }).success).toBe(
      true,
    );
  });

  it('a scheduled message needs a message or a template', () => {
    const base = { name: 'n', recipients: ['919876543210'], run_at: '2031-01-01 10:00' };
    expect(v1CreateScheduledSchema.safeParse(base).success).toBe(false);
    expect(v1CreateScheduledSchema.safeParse({ ...base, message: 'hi' }).success).toBe(true);
    expect(v1CreateScheduledSchema.safeParse({ ...base, template_id: U }).success).toBe(true);
    expect(
      v1CreateScheduledSchema.safeParse({ ...base, message: 'hi', recipients: [] }).success,
    ).toBe(false);
  });
});

const row = (over: Partial<CampaignRow>): CampaignRow =>
  ({
    id: 1,
    uuid: U,
    name: 'Spring',
    type: 'custom',
    status: 'completed',
    provider: 'baileys',
    deviceId: null,
    abTesting: false,
    abSplit: 50,
    templateUuid: null,
    flowUuid: null,
    scheduleType: 'scheduled',
    sendDate: '2031-03-10',
    sendTime: '09:00:00',
    timezone: 'Asia/Kolkata',
    totalRecipients: 4,
    metaClickedCount: 0,
    completedAt: null,
    createdAt: new Date('2031-01-01T00:00:00Z'),
    updatedAt: new Date('2031-01-01T00:00:00Z'),
    counts: {
      sent: 50,
      delivered: 40,
      read: 10,
      responded: 5,
      clicked: 2,
      failed: 1,
      terminal: 4,
      total: 4,
    },
    ...over,
  }) as CampaignRow;

describe('campaign mapper', () => {
  it('cancelled is stopped; rates are rounded percents; scheduled_for is the send time in the campaign zone', () => {
    expect(wireStatus('cancelled')).toBe('stopped');
    const c = toV1Campaign({ row: row({}), senderKey: `baileys:${U}` });
    expect(c.metrics).toEqual({
      delivery_rate: 80,
      read_rate: 25,
      click_rate: 4,
      response_rate: 10,
    });
    expect(c.scheduled_for).toBe('2031-03-10T03:30:00.000Z');
    expect(c.device_id).toBe(`baileys:${U}`);
  });

  it('the create answer is the stored row: all zero, no scheduled_for (WD-API-087 rule 7)', () => {
    const c = toV1Campaign({ row: row({}), senderKey: null }, { asStored: true });
    expect(Object.values(c.counts).every((n) => n === 0)).toBe(true);
    expect(Object.values(c.metrics).every((n) => n === 0)).toBe(true);
    expect(c.scheduled_for).toBeNull();
  });

  it('statistics: active is a running campaign, sums and rates come from every campaign', () => {
    const s = statisticsOf([
      row({ status: 'completed' }),
      row({ id: 2, status: 'completed' }),
      row({
        id: 3,
        status: 'scheduled',
        counts: {
          sent: 0,
          delivered: 0,
          read: 0,
          responded: 0,
          clicked: 0,
          failed: 0,
          terminal: 0,
          total: 0,
        },
      }),
      row({ id: 4, status: 'running' }),
    ]);
    expect(s.campaigns).toEqual({ total: 4, active: 1, completed: 2, scheduled: 1, failed: 0 });
    expect(s.messages.sent).toBe(150);
    expect(s.rates.delivery_rate).toBe(80);
    expect(statisticsOf([]).campaigns.total).toBe(0);
  });
});

describe('broadcast mapper', () => {
  it('pending is what is neither sent nor failed, floored at 0', () => {
    const b = toV1Broadcast({
      id: U,
      name: 'b',
      status: 'processing',
      provider: 'baileys',
      senderKey: null,
      templateId: U,
      timezone: 'UTC',
      scheduledAt: null,
      completedAt: null,
      totalRecipients: 10,
      successCount: 6,
      deliveredCount: 4,
      readCount: 2,
      clickedCount: 1,
      failCount: 1,
      rowVersion: 1,
      createdAt: '2031-01-01T00:00:00.000Z',
      updatedAt: '2031-01-01T00:00:00.000Z',
    });
    expect(b.counts).toEqual({ sent: 6, delivered: 4, read: 2, failed: 1, clicked: 1, pending: 3 });
    expect(b.device_id).toBeNull();
  });
});
