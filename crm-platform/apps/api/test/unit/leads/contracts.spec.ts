import { describe, expect, it } from 'vitest';
import {
  createLeadSourceSchema,
  leadOwnerRuleSchema,
  listLeadEventsQuerySchema,
  previewLeadMappingSchema,
  updateLeadSourceSchema,
  ERROR_CODES,
  DEAL_SOURCES,
  NOTIFICATION_TYPES,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
} from '@crm/contracts';

const uuid = '5c1e7a40-1111-4222-8333-444455556666';
const uuid2 = '5c1e7a40-1111-4222-8333-444455556667';

describe('lead source contracts (L-04, L-05, L-12)', () => {
  it('a name is enough: the rest takes its defaults', () => {
    const r = createLeadSourceSchema.parse({ name: 'Zapier' });
    expect(r).toMatchObject({ kind: 'webhook', mapping: {}, rawRetentionDays: 30 });
    expect(r.defaults.owner).toEqual({ mode: 'unassigned', userIds: [] });
    expect(r.defaults.deal.enabled).toBe(false);
    expect(r.defaults.notify).toEqual({ owner: true, userIds: [] });
  });

  it('only the webhook kind is created through the API today', () => {
    expect(createLeadSourceSchema.safeParse({ name: 'x', kind: 'tiktok' }).success).toBe(false);
  });

  it('a shared secret has a minimum length; retention is 1 to 365 days', () => {
    expect(createLeadSourceSchema.safeParse({ name: 'x', secret: 'short' }).success).toBe(false);
    expect(
      createLeadSourceSchema.safeParse({ name: 'x', secret: 'long-enough-secret' }).success,
    ).toBe(true);
    expect(createLeadSourceSchema.safeParse({ name: 'x', rawRetentionDays: 0 }).success).toBe(
      false,
    );
    expect(createLeadSourceSchema.safeParse({ name: 'x', rawRetentionDays: 366 }).success).toBe(
      false,
    );
  });

  it('the mapping is strict and its custom keys are property keys', () => {
    expect(
      createLeadSourceSchema.safeParse({ name: 'x', mapping: { phone: 'tel', unknown: 'x' } })
        .success,
    ).toBe(false);
    expect(
      createLeadSourceSchema.safeParse({ name: 'x', mapping: { customFields: { 'Bad Key': 'a' } } })
        .success,
    ).toBe(false);
    expect(
      createLeadSourceSchema.safeParse({ name: 'x', mapping: { customFields: { budget: 'b' } } })
        .success,
    ).toBe(true);
    expect(
      createLeadSourceSchema.safeParse({ name: 'x', mapping: { phone: 'a\u0000b' } }).success,
    ).toBe(false);
  });

  it('an owner rule is consistent with its mode', () => {
    expect(leadOwnerRuleSchema.safeParse({ mode: 'fixed', userIds: [uuid] }).success).toBe(true);
    expect(leadOwnerRuleSchema.safeParse({ mode: 'fixed', userIds: [] }).success).toBe(false);
    expect(leadOwnerRuleSchema.safeParse({ mode: 'fixed', userIds: [uuid, uuid2] }).success).toBe(
      false,
    );
    expect(leadOwnerRuleSchema.safeParse({ mode: 'round_robin', userIds: [uuid] }).success).toBe(
      false,
    );
    expect(
      leadOwnerRuleSchema.safeParse({ mode: 'round_robin', userIds: [uuid, uuid2] }).success,
    ).toBe(true);
    expect(leadOwnerRuleSchema.safeParse({ mode: 'unassigned', userIds: [uuid] }).success).toBe(
      false,
    );
  });

  it('an update carries the version it was based on; a secret may be cleared with null', () => {
    expect(updateLeadSourceSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateLeadSourceSchema.parse({ rowVersion: 2, secret: null }).secret).toBeNull();
    expect(updateLeadSourceSchema.parse({ rowVersion: 2 }).secret).toBeUndefined();
  });

  it('the preview takes a draft mapping, a payload or an event', () => {
    expect(previewLeadMappingSchema.parse({ payload: { a: 1 } }).payload).toEqual({ a: 1 });
    expect(previewLeadMappingSchema.safeParse({ eventId: 'nope' }).success).toBe(false);
  });

  it('events list: limit is bounded, status is one of ours, isTest reads a query string', () => {
    expect(listLeadEventsQuerySchema.parse({}).limit).toBe(25);
    expect(listLeadEventsQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(listLeadEventsQuerySchema.safeParse({ status: 'weird' }).success).toBe(false);
    expect(
      listLeadEventsQuerySchema.parse({ status: 'needs_review', isTest: 'false' }),
    ).toMatchObject({
      status: 'needs_review',
      isTest: false,
    });
  });
});

describe('what the lead pipeline adds to the shared registries', () => {
  it('registers the deal source, the notification type, the plan keys and the error codes', () => {
    expect(DEAL_SOURCES).toContain('lead_ad');
    expect(NOTIFICATION_TYPES).toContain('new_lead');
    expect(PLAN_FEATURE_KEYS).toContain('lead_sources');
    expect(PLAN_LIMIT_KEYS).toContain('lead_sources');
    for (const code of [
      'LEAD_SOURCE_NAME_TAKEN',
      'LEAD_MAPPING_INVALID',
      'LEAD_DEFAULTS_INVALID',
      'LEAD_EVENT_NOT_RETRYABLE',
      'LEAD_PAYLOAD_PURGED',
      'LEAD_SOURCE_PAUSED',
    ]) {
      expect(ERROR_CODES).toHaveProperty(code, code);
    }
  });
});
