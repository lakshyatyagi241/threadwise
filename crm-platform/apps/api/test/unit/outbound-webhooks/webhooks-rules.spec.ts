import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS, createWebhookSchema, updateWebhookSchema } from '@crm/contracts';
import { sign, verify } from '../../../src/modules/outbound-webhooks/signing';
import { OUTBOX_TO_WEBHOOK, matches } from '../../../src/modules/outbound-webhooks/webhook-events';
import { normaliseEvents } from '../../../src/modules/outbound-webhooks/webhooks.service';

describe('webhook subscription matching', () => {
  it('matches the exact name or *, and an empty list means everything', () => {
    expect(matches(['contact_created'], 'contact_created')).toBe(true);
    expect(matches(['contact_created'], 'contact_updated')).toBe(false);
    expect(matches(['*'], 'task_created')).toBe(true);
    expect(matches([], 'task_created')).toBe(true);
    expect(matches(null, 'task_created')).toBe(true);
  });
  it('does no prefix or pattern matching', () => {
    expect(matches(['contact'], 'contact_created')).toBe(false);
    expect(matches(['contact_*'], 'contact_created')).toBe(false);
  });
  it('every catalogue event has an outbox source, and each source is a distinct event', () => {
    const names = Object.values(OUTBOX_TO_WEBHOOK);
    expect(new Set(names).size).toBe(names.length);
    for (const e of WEBHOOK_EVENTS) expect(names).toContain(e);
  });
  it('normalises the subscription: empty or * is *, duplicates go', () => {
    expect(normaliseEvents([])).toEqual(['*']);
    expect(normaliseEvents(['task_created', '*'])).toEqual(['*']);
    expect(normaliseEvents(['task_created', 'task_created', 'contact_created'])).toEqual([
      'task_created',
      'contact_created',
    ]);
  });
});

describe('webhook signing', () => {
  it('signs the timestamp and the body, and verifies', () => {
    const header = sign('s3cret', '1700000000', '{"a":1}');
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verify('s3cret', '1700000000', '{"a":1}', header)).toBe(true);
  });
  it('rejects another secret, body or timestamp', () => {
    const header = sign('s3cret', '1700000000', '{"a":1}');
    expect(verify('other', '1700000000', '{"a":1}', header)).toBe(false);
    expect(verify('s3cret', '1700000000', '{"a":2}', header)).toBe(false);
    expect(verify('s3cret', '1700000001', '{"a":1}', header)).toBe(false);
    expect(verify('s3cret', '1700000000', '{"a":1}', 'sha256=short')).toBe(false);
  });
});

describe('webhook contracts', () => {
  it('create defaults to every event and active, and refuses unknown events and long fields', () => {
    const ok = createWebhookSchema.parse({ url: 'https://example.com/hook' });
    expect(ok).toMatchObject({ events: [], active: true });
    expect(createWebhookSchema.safeParse({ url: 'https://x.io', events: ['nope'] }).success).toBe(
      false,
    );
    expect(
      createWebhookSchema.safeParse({ url: 'https://x.io', secret: 'a'.repeat(192) }).success,
    ).toBe(false);
    expect(createWebhookSchema.safeParse({ url: `https://x.io/${'a'.repeat(2050)}` }).success).toBe(
      false,
    );
  });
  it('update cannot set and clear the secret at once', () => {
    expect(updateWebhookSchema.safeParse({ secret: 'a', clearSecret: true }).success).toBe(false);
    expect(updateWebhookSchema.safeParse({ active: false }).success).toBe(true);
  });
});
