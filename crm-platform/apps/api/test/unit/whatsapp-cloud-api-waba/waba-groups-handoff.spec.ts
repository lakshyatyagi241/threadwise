import { describe, expect, it } from 'vitest';
import {
  EMPTY_GROUP,
  applyGroupDelivery,
  applyGroupEntry,
  groupStatusRank,
  type GroupFacts,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-group-rules';
import {
  formSubmissionOf,
  paymentUpdatesOf,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-handoff-rules';
import {
  HISTORY_CAP,
  historyItems,
  syncedContacts,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-coexistence-rules';

const NOW = new Date('2026-10-03T10:00:00Z');
const row = (patch: Partial<GroupFacts> = {}): GroupFacts => ({
  ...EMPTY_GROUP,
  meta: {},
  ...patch,
});

describe('group lifecycle (TW-WABA-040)', () => {
  it('stores subject, invite link and the creation time once, and keeps a failed creation visible', () => {
    const made = applyGroupEntry(
      'group_lifecycle_update',
      {
        group_id: 'g1',
        type: 'group_create',
        subject: 'Team',
        invite_link: 'https://chat.whatsapp.com/x',
        timestamp: 1_700_000_000,
      },
      null,
      NOW,
    );
    expect('next' in made && made.next).toMatchObject({
      subject: 'Team',
      inviteLink: 'https://chat.whatsapp.com/x',
      creationTimestamp: new Date(1_700_000_000_000),
    });
    const again = applyGroupEntry(
      'group_lifecycle_update',
      { group_id: 'g1', timestamp: 1_800_000_000, errors: [{ code: 1, title: 'boom' }] },
      'next' in made ? made.next : null,
      NOW,
    );
    expect('next' in again && again.next.creationTimestamp).toEqual(new Date(1_700_000_000_000));
    expect('next' in again && again.next.meta.last_error).toEqual({ code: 1, title: 'boom' });
  });

  it('deletes the row on group_delete', () => {
    expect(
      applyGroupEntry(
        'group_lifecycle_update',
        { group_id: 'g1', type: 'group_delete' },
        row(),
        NOW,
      ),
    ).toEqual({
      delete: true,
    });
  });

  it('counts participants (at least one per event, never below zero) and tracks join requests', () => {
    const add = applyGroupEntry(
      'group_participants_update',
      { type: 'group_participants_add', added_participants: [{}, {}, {}] },
      row({ participantCount: 1 }),
      NOW,
    );
    expect('next' in add && add.next.participantCount).toBe(4);
    const leave = applyGroupEntry(
      'group_participants_update',
      { type: 'group_participants_remove', removed_participants: [{}, {}] },
      row({ participantCount: 1 }),
      NOW,
    );
    expect('next' in leave && leave.next.participantCount).toBe(0);
    const asked = applyGroupEntry(
      'group_participants_update',
      { type: 'group_join_request_created', join_request_id: 'r1', wa_id: '9198', timestamp: 5 },
      row(),
      NOW,
    );
    const pending = 'next' in asked ? asked.next : row();
    expect(pending.meta.join_requests).toEqual({ r1: { wa_id: '9198', created_at: '5' } });
    const revoked = applyGroupEntry(
      'group_participants_update',
      { type: 'group_join_request_revoked', join_request_id: 'r1' },
      pending,
      NOW,
    );
    expect('next' in revoked && revoked.next.meta.join_requests).toEqual({});
  });

  it('takes a settings change only where Meta says it was applied, and follows suspension', () => {
    const r = applyGroupEntry(
      'group_settings_update',
      {
        group_subject: { text: 'New', update_successful: true },
        group_description: { text: 'Lost', update_successful: false },
      },
      row({ subject: 'Old', description: 'Kept' }),
      NOW,
    );
    expect('next' in r && r.next).toMatchObject({ subject: 'New', description: 'Kept' });
    const sus = applyGroupEntry(
      'group_status_update',
      { type: 'group_suspend', timestamp: 9 },
      row(),
      NOW,
    );
    expect('next' in sus && sus.next.suspended).toBe(true);
    const clear = applyGroupEntry(
      'group_status_update',
      { type: 'group_suspend_cleared' },
      'next' in sus ? sus.next : row(),
      NOW,
    );
    expect('next' in clear && clear.next.suspended).toBe(false);
  });
});

describe('group delivery (TW-WABA-039)', () => {
  const st = (participant: string, status: string, pricing: Record<string, unknown> = {}) => ({
    id: 'w1',
    status,
    recipient_participant_id: participant,
    conversation: { origin: { type: 'service' }, pricing },
  });

  it('folds three participants into one tally with billable and free counts', () => {
    let d = applyGroupDelivery(undefined, 'queued', st('a', 'sent', { billable: true })).delivery;
    d = applyGroupDelivery(
      d,
      'sent',
      st('b', 'delivered', { type: 'free_group_customer_service' }),
    ).delivery;
    const last = applyGroupDelivery(d, 'sent', st('c', 'read', { billable: true }));
    expect(last.delivery).toMatchObject({
      delivered_to: 3,
      billable_count: 2,
      free_count: 1,
      category: 'service',
    });
    expect(last.status).toBe('read');
  });

  it('never moves a participant or the bubble backwards, and a repeat is not a second recipient', () => {
    const read = applyGroupDelivery(undefined, 'queued', st('a', 'read'));
    const late = applyGroupDelivery(read.delivery, read.status, st('a', 'sent'));
    expect(late.delivery.participants.a?.status).toBe('read');
    expect(late.delivery.delivered_to).toBe(1);
    expect(late.status).toBe('read');
    expect(groupStatusRank('failed')).toBeLessThan(groupStatusRank('sent'));
  });
});

describe('hand-offs on the shared callback (TW-WABA-043)', () => {
  it('reads a form submission and keeps unparsable answers', () => {
    const msg = {
      id: 'wamid.f1',
      from: '+91 98000 00001',
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { response_json: JSON.stringify({ flow_token: 'tok', city: 'Pune' }) },
      },
    };
    expect(formSubmissionOf(msg, 'Asha')).toMatchObject({
      providerMessageId: 'wamid.f1',
      from: '919800000001',
      name: 'Asha',
      flowToken: 'tok',
      response: { city: 'Pune' },
    });
    const bad = formSubmissionOf(
      { ...msg, interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'not json' } } },
      null,
    );
    expect(bad?.response).toEqual({ raw: 'not json' });
    expect(formSubmissionOf({ id: 'x', type: 'text' }, null)).toBeNull();
  });

  it('finds payment statuses and ignores delivery statuses', () => {
    const found = paymentUpdatesOf({
      statuses: [
        { id: 'p1', type: 'payment', status: 'captured' },
        { id: 'm1', status: 'delivered' },
      ],
    });
    expect(found.map((p) => p.providerMessageId)).toEqual(['p1']);
  });
});

describe('coexistence history and contacts (TW-WABA-045, 046)', () => {
  const own = new Set(['919112200000']);
  const history = (messages: unknown[], id = '919800000001') => ({
    history: [{ threads: [{ id, messages }] }],
  });

  it('reads both sides of a thread and describes media instead of copying it', () => {
    const { items } = historyItems(
      history([
        {
          id: 'a',
          from: '919800000001',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'hi' },
        },
        {
          id: 'b',
          from: '919112200000',
          to: '919800000001',
          timestamp: '1700000060',
          type: 'image',
          image: { caption: 'look' },
        },
        { from: '919800000001', timestamp: '1', type: 'text' },
      ]),
      own,
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ customer: '919800000001', outgoing: false, text: 'hi' });
    expect(items[1]).toMatchObject({ outgoing: true, text: '[Photo] look' });
  });

  it('stops at the cap and says so', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      from: '919800000001',
      timestamp: '1',
      type: 'text',
      text: { body: 'x' },
    }));
    const r = historyItems(history(many), own, 3);
    expect(r.items).toHaveLength(3);
    expect(r.capped).toBe(true);
    expect(HISTORY_CAP).toBe(2000);
  });

  it('syncs added contacts, collapses duplicates, never applies a remove', () => {
    const r = syncedContacts({
      state_sync: [
        {
          type: 'contact',
          action: 'add',
          contact: { full_name: 'Ravi K', phone_number: '+91 98000 00002' },
        },
        {
          type: 'contact',
          action: 'add',
          contact: { first_name: 'Ravi', phone_number: '919800000002' },
        },
        { type: 'contact', action: 'remove', contact: { phone_number: '919800000003' } },
        { type: 'other', contact: { phone_number: '919800000004' } },
        { type: 'contact', contact: { full_name: { name: 'Mina' }, phone_number: '919800000005' } },
      ],
    });
    expect(r.contacts).toEqual([
      { phone: '+919800000002', name: 'Ravi K' },
      { phone: '+919800000005', name: 'Mina' },
    ]);
    expect(r.removed).toBe(1);
  });
});

describe('template clicks (TW-WABA-053)', () => {
  it('sums every button of every day for the asked templates only', async () => {
    const { sumClicks } =
      await import('../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.client');
    expect(
      sumClicks(
        {
          data: [
            {
              data_points: [
                { template_id: '1', clicked: [{ count: 3 }, { count: 4 }] },
                { template_id: 1, clicked: [{ count: 2 }] },
                { template_id: '2', clicked: [{ count: 50 }] },
                { clicked: [{ count: 1 }] },
              ],
            },
          ],
        },
        ['1'],
      ),
    ).toBe(10);
    expect(sumClicks({}, ['1'])).toBe(0);
  });

  it('takes a window from the creation day, never more than 89 days back, to the start of tomorrow', async () => {
    const { clickWindow, insightsDisabled } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/waba-click-sync.service');
    const now = new Date('2026-10-03T10:00:00Z');
    const w = clickWindow(new Date('2026-10-01T15:00:00Z'), now);
    expect(new Date(w.start * 1000).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(new Date(w.end * 1000).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    const old = clickWindow(new Date('2025-01-01T00:00:00Z'), now);
    expect((w.end - old.start) / 86400).toBe(90);
    expect(insightsDisabled('Template insights are not enabled')).toBe(true);
    expect(insightsDisabled('Invalid token')).toBe(false);
    // The first import of this service loads Nest, the database layer and the connect service; a cold run can pass the default 5 s.
  }, 60_000);
});

describe('catalog orders (TW-WABA-042)', () => {
  it('prices in minor units: 10.99 x 2 and 5.00 x 1 make 2698, in the last line currency', async () => {
    const { cartOf, isOrderMessage } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/waba-order-rules');
    const cart = cartOf({
      type: 'order',
      order: {
        catalog_id: 'C1',
        text: 'gift wrap',
        product_items: [
          { product_retailer_id: 'A', quantity: 2, item_price: 10.99, currency: 'inr' },
          { product_retailer_id: 'B', quantity: 1, item_price: 5, currency: 'usd' },
          { product_retailer_id: '', quantity: 9, item_price: 1 },
        ],
      },
    });
    expect(cart).toMatchObject({
      totalMinor: 2698,
      currency: 'USD',
      catalogId: 'C1',
      note: 'gift wrap',
    });
    expect(cart?.lines).toHaveLength(2);
    expect(cartOf({ type: 'order', order: { product_items: [] } })).toBeNull();
    expect(isOrderMessage({ type: 'order' })).toBe(true);
    expect(isOrderMessage({ type: 'text' })).toBe(false);
  });
});
