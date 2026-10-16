import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadFirstReplyService } from '../../../src/modules/leads/lead-first-reply.service';
import type { FirstReplyRow } from '../../../src/modules/leads/lead-first-replies.repository';
import type { Preparation } from '../../../src/modules/leads/lead-first-message.sender';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';

/**
 * The decisions of the first message, in order, with every collaborator replaced: what is asked, what is written, and above all what is
 * NOT done (a message that is held or blocked is never delivered). The database side (the unique key, RLS, the cascade) is the e2e spec.
 */

const NOW = new Date('2026-10-14T06:00:00Z'); // Wednesday 11:30 in Kolkata
const ORG = 7;

const row = (patch: Partial<FirstReplyRow> = {}): FirstReplyRow => ({
  id: 1,
  uuid: '11111111-1111-4111-8111-111111111111',
  leadEventId: 10,
  leadEventUuid: '22222222-2222-4222-8222-222222222222',
  isTest: false,
  sourceId: 3,
  contactId: 5,
  channel: 'whatsapp',
  status: 'sending',
  reason: null,
  dueAt: NOW,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  attempts: 1,
  sentAt: null,
  ...patch,
});

const speed = (patch: Record<string, unknown> = {}) => ({
  enabled: true,
  channel: 'whatsapp',
  templateId: '33333333-3333-4333-8333-333333333333',
  senderId: null,
  delayMinutes: 0,
  businessHoursOnly: false,
  ...patch,
});

const source = (cfg: Record<string, unknown> | null = speed(), status = 'active') => ({
  id: 3,
  uuid: '44444444-4444-4444-8444-444444444444',
  status,
  defaults: cfg === null ? {} : { speedToLead: cfg },
});

const contact = {
  id: 5,
  uuid: '55555555-5555-4555-8555-555555555555',
  phone: '+919876543210',
  email: 'a@b.test',
  name: 'Ada',
};

interface Setup {
  /** The instant the worker looks at (default: Wednesday 11:30 in Kolkata). */
  now?: Date;
  row?: FirstReplyRow;
  source?: ReturnType<typeof source> | undefined;
  noContact?: boolean;
  hours?: { hours: unknown; timezone: string };
  prepare?: Preparation;
  hold?: { until: string } | null;
  gate?: { decision: string; reason: string };
  deliver?: () => Promise<unknown>;
}

function make(s: Setup = {}) {
  const deliver = vi.fn(s.deliver ?? (async () => ({ kind: 'sent' })));
  const prepared: Preparation = s.prepare ?? {
    kind: 'ready',
    prepared: {
      purpose: 'marketing_messaging',
      target: { phone: contact.phone, email: null },
      deliver: deliver as never,
    },
  };
  const finish = vi.fn(async () => undefined);
  const activities = vi.fn(async () => ({ id: 1, uuid: 'x' }));
  const audit = vi.fn(async () => undefined);
  const emit = vi.fn(async () => undefined);
  const check = vi.fn(async () =>
    s.hold
      ? {
          decision: 'hold',
          reason: 'quiet_hours',
          until: s.hold.until,
          zone: null,
          zoneSource: 'workspace',
        }
      : { decision: 'allow' },
  );
  const gate = vi.fn(async () => s.gate ?? { decision: 'allow', reason: 'granted' });
  const prepare = vi.fn(async () => prepared);
  const svc = new LeadFirstReplyService(
    {
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}),
      privileged: async (fn: (tx: unknown) => unknown) => fn({}),
    } as never,
    { byId: async () => s.row ?? row(), finish, claimOne: async () => true } as never,
    { findById: async () => ('source' in s ? s.source : source()) } as never,
    {} as never,
    { prepare } as never,
    { businessHours: async () => s.hours ?? { hours: null, timezone: 'UTC' } } as never,
    { check: gate } as never,
    { check } as never,
    { findById: async () => (s.noContact ? undefined : contact) } as never,
    { insert: activities } as never,
    { record: audit } as never,
    { emit } as never,
  );
  vi.useFakeTimers({ now: s.now ?? NOW, toFake: ['Date'] });
  return { svc, deliver, finish, activities, audit, emit, check, gate, prepare };
}

afterEach(() => vi.useRealTimers());

const lastFinish = (m: ReturnType<typeof make>) =>
  (m.finish.mock.calls.at(-1) as unknown[])[3] as {
    status: string;
    reason: string | null;
    channel: string;
    dueAt?: Date;
    sentAt?: Date;
  };

describe('the decisions of a first message', () => {
  it('sends when everything allows it, and writes the outcome, an audit row, an event and a timeline entry', async () => {
    const m = make();
    await m.svc.processOne(ORG, 1);
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(lastFinish(m)).toMatchObject({ status: 'sent', reason: null, channel: 'whatsapp' });
    expect(lastFinish(m).sentAt).toEqual(NOW);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.emit.mock.calls[0]![1]).toMatchObject({ eventType: 'lead.first_reply.sent' });
    expect(m.activities.mock.calls[0]![2]).toMatchObject({
      contactId: 5,
      activityType: 'speed_to_lead',
      title: 'First message sent by WhatsApp',
      source: 'system',
    });
  });

  it('switched off since it was scheduled: skipped, nothing prepared or sent', async () => {
    const m = make({ source: source(speed({ enabled: false })) });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'skipped', reason: 'disabled' });
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it('a paused source sends nothing', async () => {
    const m = make({ source: source(speed(), 'paused') });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'skipped', reason: 'source_paused' });
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it('a message that waited more than a day is dropped as expired', async () => {
    const m = make({ row: row({ expiresAt: new Date(NOW.getTime() - 1) }) });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'failed', reason: 'expired' });
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it('a contact that no longer exists leaves nothing to send to', async () => {
    const m = make({ noContact: true });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'skipped', reason: 'no_contact_point' });
  });

  it('a row some other worker already finished is left alone', async () => {
    const m = make({ row: row({ status: 'sent' }) });
    await m.svc.processOne(ORG, 1);
    expect(m.finish).not.toHaveBeenCalled();
    expect(m.deliver).not.toHaveBeenCalled();
  });

  describe('business hours', () => {
    const hours = {
      hours: {
        days: Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [
            d,
            { enabled: true, from: '09:00', to: '17:00' },
          ]),
        ),
      },
      timezone: 'Asia/Kolkata',
    };

    it('inside them it goes on', async () => {
      const m = make({ source: source(speed({ businessHoursOnly: true })), hours });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m).status).toBe('sent');
    });

    it('outside them it is held until they open, not sent and not dropped', async () => {
      const m = make({
        now: new Date('2026-10-14T13:00:00Z'),
        source: source(speed({ businessHoursOnly: true })),
        hours,
      });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'held', reason: 'outside_business_hours' });
      expect(lastFinish(m).dueAt).toEqual(new Date('2026-10-15T03:30:00Z'));
      expect(m.deliver).not.toHaveBeenCalled();
    });

    it('the setting off means the hours are not looked at', async () => {
      const m = make({ now: new Date('2026-10-14T13:00:00Z'), hours });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m).status).toBe('sent');
    });
  });

  it('quiet hours hold a marketing message: held with its time, never delivered, and asked about the right address', async () => {
    const m = make({ hold: { until: '2026-10-14T20:00:00.000Z' } });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'held', reason: 'quiet_hours' });
    expect(lastFinish(m).dueAt).toEqual(new Date('2026-10-14T20:00:00.000Z'));
    expect(m.deliver).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
    expect(m.check.mock.calls[0]![2]).toMatchObject({ contactId: 5, phone: '+919876543210' });
  });

  it('a service message (a utility template) is never asked about the quiet hours', async () => {
    const m = make({
      prepare: {
        kind: 'ready',
        prepared: {
          purpose: 'service_messaging',
          target: { phone: contact.phone, email: null },
          deliver: async () => ({ kind: 'sent' }),
        },
      },
      hold: { until: '2026-10-14T20:00:00.000Z' },
    });
    await m.svc.processOne(ORG, 1);
    expect(m.check).not.toHaveBeenCalled();
    expect(lastFinish(m).status).toBe('sent');
  });

  describe('the consent gate decides and is never overridden', () => {
    it.each([
      ['withdrawn', 'opted_out'],
      ['subject_minor', 'minor'],
      ['no_consent_recorded', 'no_consent'],
    ])('a denial (%s) is blocked as %s and nothing is delivered', async (denial, reason) => {
      const m = make({ gate: { decision: 'deny', reason: denial } });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'blocked', reason });
      expect(m.deliver).not.toHaveBeenCalled();
      expect(m.activities.mock.calls[0]![2]).toMatchObject({
        title: 'First message by WhatsApp not sent',
      });
    });

    it('asks about the contact, on the consent channel of the message and with the purpose it was prepared with', async () => {
      const m = make({ source: source(speed({ channel: 'email' })) });
      await m.svc.processOne(ORG, 1);
      expect(m.gate.mock.calls[0]).toEqual([
        ORG,
        { type: 'contact', id: 5 },
        'email',
        'marketing_messaging',
      ]);
    });
  });

  describe('what the channel says', () => {
    it('a template or sender that is not there is skipped for good', async () => {
      const m = make({
        prepare: { kind: 'verdict', verdict: { status: 'skipped', reason: 'no_sender' } },
      });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'skipped', reason: 'no_sender' });
    });

    it('a channel that is down holds the message for ten minutes', async () => {
      const m = make({
        prepare: { kind: 'verdict', verdict: { status: 'held', reason: 'channel_unavailable' } },
      });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'held', reason: 'channel_unavailable' });
      expect(lastFinish(m).dueAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    });

    it('a refusal at delivery (plan, wallet) is recorded as such', async () => {
      const m = make({
        deliver: async () => ({
          kind: 'verdict',
          verdict: { status: 'blocked', reason: 'plan_limit' },
        }),
      });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'blocked', reason: 'plan_limit' });
    });

    it('a delivery that throws is failed and not retried blindly', async () => {
      const m = make({
        deliver: async () => {
          throw new Error('boom: +919876543210');
        },
      });
      await m.svc.processOne(ORG, 1);
      expect(lastFinish(m)).toMatchObject({ status: 'failed', reason: 'internal_error' });
      expect(m.deliver).toHaveBeenCalledTimes(1);
      // the error text (which can carry a number) is in no row and no timeline entry
      expect(
        JSON.stringify([m.finish.mock.calls, m.activities.mock.calls, m.emit.mock.calls]),
      ).not.toContain('9876543210');
    });
  });

  it('uses the source as it is now: a channel changed while it waited applies', async () => {
    const m = make({
      row: row({ channel: 'whatsapp' }),
      source: source(speed({ channel: 'sms' })),
    });
    await m.svc.processOne(ORG, 1);
    expect((m.prepare.mock.calls[0] as unknown[])[1]).toMatchObject({ channel: 'sms' });
    expect(lastFinish(m).channel).toBe('sms');
  });

  it('a message still held for the same reason writes nothing new: no second audit row, event or timeline entry', async () => {
    const m = make({
      row: row({ reason: 'quiet_hours' }),
      hold: { until: '2026-10-14T21:00:00.000Z' },
    });
    await m.svc.processOne(ORG, 1);
    expect(lastFinish(m)).toMatchObject({ status: 'held', reason: 'quiet_hours' });
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.emit).not.toHaveBeenCalled();
    expect(m.activities).not.toHaveBeenCalled();
  });
});

describe('schedule (the outbox consumer)', () => {
  const event = (patch: Record<string, unknown> = {}): OutboxEvent =>
    ({
      id: '1',
      orgId: ORG,
      aggregateModule: 'leads',
      aggregateId: '10',
      eventType: 'lead.created',
      payload: {
        leadEventId: '22222222-2222-4222-8222-222222222222',
        leadSourceId: '44444444-4444-4444-8444-444444444444',
        test: false,
        ...patch,
      },
    }) as OutboxEvent;

  function build(cfg: Record<string, unknown> | null, inserted: boolean) {
    const insertOnce = vi.fn(async () => (inserted ? row({ status: 'scheduled' }) : null));
    const claimOne = vi.fn(async () => false);
    const audit = vi.fn(async () => undefined);
    const emit = vi.fn(async () => undefined);
    const svc = new LeadFirstReplyService(
      {
        txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}),
        privileged: async (fn: (tx: unknown) => unknown) => fn({}),
      } as never,
      { insertOnce, claimOne } as never,
      { findByUuid: async () => (cfg === null ? undefined : source(cfg)) } as never,
      { findByUuid: async () => ({ id: 10, isTest: false, contactId: 5 }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { record: audit } as never,
      { emit } as never,
    );
    return { svc, insertOnce, claimOne, audit, emit };
  }

  it('does nothing for a source that has speed-to-lead off (the default)', async () => {
    const b = build(speed({ enabled: false }), true);
    await b.svc.schedule(event());
    expect(b.insertOnce).not.toHaveBeenCalled();
  });

  it('does nothing for a test lead', async () => {
    const b = build(speed(), true);
    await b.svc.schedule(event({ test: true }));
    expect(b.insertOnce).not.toHaveBeenCalled();
  });

  it('schedules one message due after the delay, with an audit row and an event', async () => {
    const b = build(speed({ delayMinutes: 20 }), true);
    await b.svc.schedule(event());
    const call = b.insertOnce.mock.calls[0]! as unknown as [
      unknown,
      number,
      { dueAt: Date; expiresAt: Date; channel: string },
    ];
    expect(call[2].channel).toBe('whatsapp');
    expect(call[2].dueAt.getTime() - Date.now()).toBeGreaterThan(19 * 60_000);
    expect(call[2].expiresAt.getTime() - call[2].dueAt.getTime()).toBe(86_400_000);
    expect(b.audit).toHaveBeenCalledTimes(1);
    expect(b.emit.mock.calls[0]![1]).toMatchObject({ eventType: 'lead.first_reply.scheduled' });
    // a delay means no immediate attempt
    expect(b.claimOne).not.toHaveBeenCalled();
  });

  it('with no delay tries at once', async () => {
    const b = build(speed({ delayMinutes: 0 }), true);
    await b.svc.schedule(event());
    expect(b.claimOne).toHaveBeenCalledTimes(1);
  });

  it('a lead that already has its message (a redelivered event) schedules and writes nothing', async () => {
    const b = build(speed(), false);
    await b.svc.schedule(event());
    expect(b.audit).not.toHaveBeenCalled();
    expect(b.emit).not.toHaveBeenCalled();
    expect(b.claimOne).not.toHaveBeenCalled();
  });
});
