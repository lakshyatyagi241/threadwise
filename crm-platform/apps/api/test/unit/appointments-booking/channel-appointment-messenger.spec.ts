import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import type { BookingMessage } from '../../../src/infra/providers/appointments-booking';
import { SenderThrottled } from '../../../src/modules/broadcasts';
import {
  ChannelAppointmentMessenger,
  outcomeOfEngineError,
  uuidOfKey,
} from '../../../src/modules/appointments-booking/channel-appointment-messenger';

/**
 * What the messenger decides for one booking message: the address, the quiet hours (HOLD, never deny), the ConsentGate, the sender and
 * the template. The collaborators are replaced with fakes: no real WhatsApp, SMS or email provider is ever called here.
 */

const ORG = 7;
const CONTACT_UUID = '55555555-5555-4555-8555-555555555555';
const TEMPLATE_UUID = '33333333-3333-4333-8333-333333333333';
const START = '2026-11-10T10:00:00.000Z';

const message = (patch: Partial<BookingMessage> = {}): BookingMessage => ({
  orgId: ORG,
  appointmentId: '11111111-1111-4111-8111-111111111111',
  event: 'reminder',
  channel: 'whatsapp',
  to: { name: 'Ada', phone: '+919876543210', email: 'ada@example.test' },
  body: 'Reminder: Consultation tomorrow',
  subject: 'Reminder',
  waTemplateId: null,
  variableMap: null,
  idempotencyKey: 'apptrem:a:1:before:1440:whatsapp',
  contactId: CONTACT_UUID,
  variables: { name: 'Ada', type: 'Consultation', date: 'Tuesday', time: '10:00' },
  purpose: 'service',
  notAfter: START,
  ...patch,
});

const template = (patch: Record<string, unknown> = {}) => ({
  id: 99,
  uuid: TEMPLATE_UUID,
  templateName: 'visit_reminder',
  language: 'en',
  templateType: 'standard',
  templateBody: 'Hi {{1}}, your {{2}} is on {{3}}.',
  header: null,
  attachmentType: 'none',
  parameterFormat: 'POSITIONAL',
  buttons: [],
  status: 'approved',
  metaStatus: 'APPROVED',
  pausedUntil: null,
  providerConfigId: 41,
  ...patch,
});

interface Setup {
  channels?: Array<{ uuid: string; kind: string; status: string; wabaConfigId: number | null }>;
  tpl?: ReturnType<typeof template> | null;
  contact?: { id: number; uuid: string } | undefined;
  gate?: { decision: string; reason: string };
  templatePurpose?: string;
  window?: { decision: string; until?: string };
  lastInboundAt?: Date | null;
  enqueue?: () => Promise<unknown>;
  mailRow?: Record<string, unknown> | undefined;
  engineSend?: () => Promise<unknown>;
  noEngine?: boolean;
  /** The workspace owner's choice for the channel (BL-350). Default: on, no default sender. */
  channelGate?: { enabled: boolean; defaultSenderId: number | null };
}

function make(s: Setup = {}) {
  const gateCheck = vi.fn(
    async (..._a: unknown[]) => s.gate ?? { decision: 'allow', reason: 'ok' },
  );
  const purposeOfTemplate = vi.fn(
    async (..._a: unknown[]) => s.templatePurpose ?? 'service_messaging',
  );
  const windowCheck = vi.fn(async (..._a: unknown[]) => s.window ?? { decision: 'allow' });
  const enqueueOutbound = vi.fn(
    (..._a: unknown[]) =>
      (s.enqueue ?? (async () => ({ message: { id: 'msg-1' }, replayed: false })))() as Promise<{
        message: { id: string };
      }>,
  );
  const openConversationFor = vi.fn(async (..._a: unknown[]) => ({
    id: 'thread-1',
    lastInboundAt: 'lastInboundAt' in s ? s.lastInboundAt : null,
  }));
  const sendText = vi.fn((..._a: unknown[]) =>
    (s.engineSend ?? (async () => ({ providerMessageId: 'p1' })))(),
  );
  const open = vi.fn(async (..._a: unknown[]) => ({ sendText }));
  const engines = {
    get: vi.fn((n: string) =>
      s.noEngine ? undefined : n === 'email' ? { open } : undefined,
    ),
  };
  const tx = {
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes('mail_mailboxes')) {
        return {
          rows:
            'mailRow' in s
              ? s.mailRow
                ? [s.mailRow]
                : []
              : [{ id: 9, address: 'sales@acme.test', label: 'Sales' }],
        };
      }
      return { rows: [] };
    },
  };
  const channelGate = vi.fn(
    async (..._a: unknown[]) => s.channelGate ?? { enabled: true, defaultSenderId: null },
  );
  const messenger = new ChannelAppointmentMessenger(
    { txAs: async (_c: unknown, fn: (t: unknown) => unknown) => fn(tx) } as never,
    {
      findByUuid: async () => ('contact' in s ? s.contact : { id: 5, uuid: CONTACT_UUID }),
    } as never,
    { check: gateCheck, purposeOfTemplate } as never,
    { check: windowCheck } as never,
    {
      list: async () =>
        s.channels ?? [
          { uuid: 'ch-cloud', kind: 'whatsapp_cloud', status: 'connected', wabaConfigId: 41 },
        ],
    } as never,
    engines as never,
    { findByUuid: async () => ('tpl' in s ? s.tpl : template()) } as never,
    { gate: channelGate } as never,
    { openConversationFor, enqueueOutbound } as never,
  );
  return {
    messenger,
    gateCheck,
    windowCheck,
    enqueueOutbound,
    openConversationFor,
    sendText,
    open,
    purposeOfTemplate,
    engines,
    channelGate,
  };
}

const DAY = 24 * 3_600_000;

describe('uuidOfKey', () => {
  it('is the same id for the same key and a valid UUID', () => {
    expect(uuidOfKey('k')).toBe(uuidOfKey('k'));
    expect(uuidOfKey('k')).not.toBe(uuidOfKey('k2'));
    expect(uuidOfKey('k')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('address checks', () => {
  it('skips a channel the contact has no number or address for', async () => {
    const { messenger, gateCheck } = make();
    expect(
      await messenger.send(message({ to: { name: 'A', phone: null, email: 'a@b.test' } })),
    ).toEqual({
      status: 'skipped',
      reason: 'no_contact_point',
    });
    expect(
      await messenger.send(
        message({ channel: 'email', to: { name: 'A', phone: '+1555', email: null } }),
      ),
    ).toEqual({ status: 'skipped', reason: 'no_contact_point' });
    expect(gateCheck).not.toHaveBeenCalled();
  });

  it('skips WhatsApp when the booking has no contact (the message lands in the contact thread)', async () => {
    const { messenger } = make({ contact: undefined });
    expect(await messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'no_contact_point',
    });
  });

  it('skips a channel the port does not deliver on', async () => {
    const { messenger } = make();
    expect(await messenger.send(message({ channel: 'telegram' }))).toEqual({
      status: 'skipped',
      reason: 'no_channel',
    });
  });
});

describe('WhatsApp', () => {
  it('sends an approved template on the Cloud API number it belongs to, filling {{1}}.. in order, once per key', async () => {
    const { messenger, enqueueOutbound } = make();
    const res = await messenger.send(message({ waTemplateId: TEMPLATE_UUID }));
    expect(res.status).toBe('sent');
    const call = enqueueOutbound.mock.calls[0]![0] as {
      clientMessageId: string;
      content: { kind: string; variables: Record<string, string>; body: string };
      sender: { kind: string };
    };
    expect(call.content.kind).toBe('template');
    expect(call.content.variables).toEqual({ '1': 'Ada', '2': 'Consultation', '3': 'Tuesday' });
    expect(call.content.body).toBe('Hi Ada, your Consultation is on Tuesday.');
    expect(call.clientMessageId).toBe(uuidOfKey('apptrem:a:1:before:1440:whatsapp'));
    expect(call.sender.kind).toBe('bot');
  });

  it("asks the gate with the TEMPLATE's purpose, so a marketing-category template is gated as marketing", async () => {
    const { messenger, gateCheck, purposeOfTemplate } = make({
      templatePurpose: 'marketing_messaging',
    });
    await messenger.send(message({ waTemplateId: TEMPLATE_UUID }));
    expect(purposeOfTemplate).toHaveBeenCalled();
    expect(gateCheck.mock.calls[0]![3]).toBe('marketing_messaging');
    expect(gateCheck.mock.calls[0]![2]).toBe('whatsapp_cloud');
  });

  it('skips free text outside the 24 hour window on the Cloud API: it needs an approved template', async () => {
    const { messenger, enqueueOutbound } = make({ lastInboundAt: new Date(Date.now() - 2 * DAY) });
    expect(await messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'template_required',
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('sends free text inside the window', async () => {
    const { messenger, enqueueOutbound } = make({
      lastInboundAt: new Date(Date.now() - 3_600_000),
    });
    expect((await messenger.send(message())).status).toBe('sent');
    expect((enqueueOutbound.mock.calls[0]![0] as { content: { kind: string } }).content.kind).toBe(
      'text',
    );
  });

  it('sends free text to a QR number anywhere', async () => {
    const { messenger, enqueueOutbound } = make({
      channels: [{ uuid: 'ch-qr', kind: 'whatsapp_qr', status: 'connected', wabaConfigId: null }],
    });
    expect((await messenger.send(message())).status).toBe('sent');
    expect(enqueueOutbound).toHaveBeenCalledOnce();
  });

  it('skips a template that cannot be filled or sent, and says no sender when WhatsApp is not connected at all', async () => {
    const paused = make({ tpl: template({ status: 'draft' }) });
    expect(await paused.messenger.send(message({ waTemplateId: TEMPLATE_UUID }))).toEqual({
      status: 'skipped',
      reason: 'template_unavailable',
    });
    const none = make({ channels: [] });
    expect(await none.messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'no_sender',
    });
  });

  it('holds when the number is not connected right now', async () => {
    const { messenger } = make({
      channels: [{ uuid: 'ch', kind: 'whatsapp_cloud', status: 'disconnected', wabaConfigId: 41 }],
    });
    expect(await messenger.send(message({ waTemplateId: TEMPLATE_UUID }))).toEqual({
      status: 'held',
      reason: 'channel_unavailable',
    });
  });

  it("turns the dispatcher's refusals into outcomes", async () => {
    const wallet = make({
      lastInboundAt: new Date(),
      enqueue: async () => {
        throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty');
      },
    });
    expect(await wallet.messenger.send(message())).toEqual({
      status: 'held',
      reason: 'wallet_empty',
    });
    const optOut = make({
      lastInboundAt: new Date(),
      enqueue: async () => {
        throw new AppError(ERROR_CODES.CONSENT_OPTED_OUT, 'opted out');
      },
    });
    expect(await optOut.messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'opted_out',
    });
    const boom = make({
      lastInboundAt: new Date(),
      enqueue: async () => {
        throw new Error('socket hang up +919876543210');
      },
    });
    const res = await boom.messenger.send(message());
    expect(res).toEqual({ status: 'failed', reason: 'provider_error' });
    expect(JSON.stringify(res)).not.toContain('919876543210');
  });
});

describe('Email, and the removed SMS', () => {
  it('SMS is not a channel of appointment messages: it is never delivered and nothing is asked first', async () => {
    const { messenger, open, gateCheck, channelGate } = make();
    expect(await messenger.send(message({ channel: 'sms' as never }))).toEqual({
      status: 'skipped',
      reason: 'no_channel',
    });
    expect(open).not.toHaveBeenCalled();
    expect(gateCheck).not.toHaveBeenCalled();
    expect(channelGate).not.toHaveBeenCalled();
  });

  it('sends an email with its subject from a shared mailbox', async () => {
    const { messenger, sendText } = make();
    expect((await messenger.send(message({ channel: 'email' }))).status).toBe('sent');
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ada@example.test', header: 'Reminder' }),
    );
  });

  it('skips with no_sender when no mailbox is connected, or the engine is not there', async () => {
    expect(
      await make({ mailRow: undefined }).messenger.send(message({ channel: 'email' })),
    ).toEqual({
      status: 'skipped',
      reason: 'no_sender',
    });
    expect(await make({ noEngine: true }).messenger.send(message({ channel: 'email' }))).toEqual({
      status: 'skipped',
      reason: 'no_sender',
    });
  });

  it('reads an engine refusal as an outcome, and a throttled mailbox as a hold', async () => {
    expect(outcomeOfEngineError(new SenderThrottled('hourly cap', 1000))).toEqual({
      status: 'held',
      reason: 'channel_unavailable',
    });
    expect(outcomeOfEngineError(new Error('The contact opted out of email.'))).toEqual({
      status: 'skipped',
      reason: 'opted_out',
    });
    const failing = make({
      engineSend: async () => {
        throw new Error('smtp 550 to ada@example.test');
      },
    });
    const res = await failing.messenger.send(message({ channel: 'email' }));
    expect(res).toEqual({ status: 'failed', reason: 'provider_error' });
  });
});

describe('quiet hours: HOLD, never deny', () => {
  const hold = (until: string) => ({
    decision: 'hold',
    reason: 'quiet_hours',
    until,
    zone: 'UTC',
    zoneSource: 'utc',
  });

  it('holds a reminder until the quiet hours end, when that still leaves time before the booking', async () => {
    const { messenger, enqueueOutbound, gateCheck } = make({
      lastInboundAt: new Date(),
      window: hold('2026-11-10T07:00:00.000Z'),
    });
    expect(await messenger.send(message())).toEqual({
      status: 'held',
      reason: 'quiet_hours',
      holdUntil: '2026-11-10T07:00:00.000Z',
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(gateCheck).not.toHaveBeenCalled();
  });

  it('skips a reminder that quiet hours would push to the booking or past it', async () => {
    const { messenger } = make({
      lastInboundAt: new Date(),
      window: hold('2026-11-10T09:58:00.000Z'),
    });
    expect(await messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'quiet_hours_too_late',
    });
    const past = make({ lastInboundAt: new Date(), window: hold('2026-11-10T12:00:00.000Z') });
    expect(await past.messenger.send(message())).toEqual({
      status: 'skipped',
      reason: 'quiet_hours_too_late',
    });
  });

  it('always holds a follow-up, however long', async () => {
    const { messenger } = make({
      lastInboundAt: new Date(),
      window: hold('2026-11-11T03:00:00.000Z'),
    });
    expect(
      await messenger.send(message({ event: 'follow_up', purpose: 'follow_up', notAfter: null })),
    ).toEqual({
      status: 'held',
      reason: 'quiet_hours',
      holdUntil: '2026-11-11T03:00:00.000Z',
    });
  });

  it('does not hold a confirmation or a cancellation: the person asked for it', async () => {
    const { messenger, windowCheck } = make({
      lastInboundAt: new Date(),
      window: hold('2026-11-10T07:00:00.000Z'),
    });
    expect((await messenger.send(message({ event: 'confirmation' }))).status).toBe('sent');
    expect(windowCheck).not.toHaveBeenCalled();
  });
});

describe('the ConsentGate', () => {
  it.each([
    ['withdrawn', 'opted_out'],
    ['on_dnc_list', 'do_not_call'],
    ['subject_minor', 'minor'],
    ['no_consent_recorded', 'no_consent'],
  ])('a %s denial skips the send as %s and delivers nothing', async (reason, code) => {
    const { messenger, sendText } = make({ gate: { decision: 'deny', reason } });
    expect(await messenger.send(message({ channel: 'email' }))).toEqual({
      status: 'skipped',
      reason: code,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('asks as a service message for a reminder and as marketing for a follow-up (email)', async () => {
    const a = make();
    await a.messenger.send(message({ channel: 'email' }));
    expect(a.gateCheck.mock.calls[0]![3]).toBe('service_messaging');
    const b = make();
    await b.messenger.send(
      message({ channel: 'email', event: 'follow_up', purpose: 'follow_up', notAfter: null }),
    );
    expect(b.gateCheck.mock.calls[0]![3]).toBe('marketing_messaging');
  });

  it('asks about the contact when there is one, else about the address', async () => {
    const a = make();
    await a.messenger.send(message({ channel: 'email' }));
    expect(a.gateCheck.mock.calls[0]![1]).toEqual({ type: 'contact', id: 5 });
    const b = make({ contact: undefined });
    await b.messenger.send(message({ channel: 'email', contactId: null }));
    expect(b.gateCheck.mock.calls[0]![1]).toEqual({ type: 'email', email: 'ada@example.test' });
  });
});

describe("the owner's channel choice (BL-350)", () => {
  it.each(['whatsapp', 'email'] as const)(
    'skips %s with channel_disabled when the owner has not switched it on, before anything else is asked',
    async (channel) => {
      const { messenger, gateCheck, windowCheck, enqueueOutbound, open, channelGate } = make({
        channelGate: { enabled: false, defaultSenderId: null },
      });
      expect(await messenger.send(message({ channel }))).toEqual({
        status: 'skipped',
        reason: 'channel_disabled',
      });
      expect(channelGate).toHaveBeenCalledWith(expect.anything(), ORG, channel);
      expect(gateCheck).not.toHaveBeenCalled();
      expect(windowCheck).not.toHaveBeenCalled();
      expect(enqueueOutbound).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('sends as before when the channel is on', async () => {
    const { messenger, open } = make({
      channelGate: { enabled: true, defaultSenderId: null },
    });
    expect(await messenger.send(message({ channel: 'email' }))).toEqual({ status: 'sent' });
    expect(open).toHaveBeenCalled();
  });

  it('the reserved voice channel is never delivered', async () => {
    const { messenger, channelGate } = make();
    expect(await messenger.send(message({ channel: 'voice' as never }))).toEqual({
      status: 'skipped',
      reason: 'no_channel',
    });
    expect(channelGate).not.toHaveBeenCalled();
  });
});
