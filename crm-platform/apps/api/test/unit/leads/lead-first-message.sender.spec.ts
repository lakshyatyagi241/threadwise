import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, SPEED_TO_LEAD_OFF, type SpeedToLead } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { SenderRefused, SenderThrottled } from '../../../src/modules/broadcasts';
import {
  LeadFirstMessageSender,
  verdictOfEngineError,
  type Preparation,
} from '../../../src/modules/leads/lead-first-message.sender';
import type { FirstReplyRow } from '../../../src/modules/leads/lead-first-replies.repository';

/**
 * What differs per channel: which template and sender, how the text is made from the contact, and how a refusal of the dispatcher or
 * of an engine is read. The collaborators are replaced; whether a message may go at all is the service's spec.
 */

const ORG = 7;
const NOW = new Date('2026-10-16T10:00:00Z');
const TEMPLATE = '33333333-3333-4333-8333-333333333333';

const reply = (channel: FirstReplyRow['channel']): FirstReplyRow => ({
  id: 1,
  uuid: '11111111-1111-4111-8111-111111111111',
  leadEventId: 10,
  leadEventUuid: '22222222-2222-4222-8222-222222222222',
  isTest: false,
  sourceId: 3,
  contactId: 5,
  channel,
  status: 'sending',
  reason: null,
  dueAt: NOW,
  expiresAt: NOW,
  attempts: 1,
  sentAt: null,
  leadReceivedAt: new Date('2026-10-14T05:59:00Z'),
  createdAt: new Date('2026-10-14T06:00:00Z'),
});

const contact = (patch: Record<string, unknown> = {}) =>
  ({
    id: 5,
    uuid: '55555555-5555-4555-8555-555555555555',
    name: 'Ada Lovelace',
    phone: '+919876543210',
    email: 'ada@example.test',
    ...patch,
  }) as never;

const config = (
  channel: SpeedToLead['channel'],
  patch: Partial<SpeedToLead> = {},
): SpeedToLead => ({
  ...SPEED_TO_LEAD_OFF,
  enabled: true,
  channel,
  templateId: TEMPLATE,
  ...patch,
});

const template = (patch: Record<string, unknown> = {}) => ({
  id: 99,
  uuid: TEMPLATE,
  templateName: 'welcome',
  language: 'en',
  templateType: 'standard',
  templateBody: 'Hi {{1}}, thanks for asking.',
  header: null,
  attachmentType: 'none',
  attachmentFile: null,
  parameterFormat: 'POSITIONAL',
  variableMap: { body: [{ num: 1, key: 'first_name' }] },
  buttons: [],
  headerLocation: null,
  status: 'approved',
  metaStatus: 'APPROVED',
  pausedUntil: null,
  providerConfigId: 41,
  ...patch,
});

interface Setup {
  tpl?: ReturnType<typeof template> | null;
  tplChannel?: string;
  channels?: Array<{ uuid: string; kind: string; status: string; wabaConfigId: number | null }>;
  firstName?: string;
  templatePurpose?: string;
  enqueue?: () => Promise<unknown>;
  smsSender?: { id: number; uuid: string; label: string; phoneDigits: string } | undefined;
  mailbox?: { id: number; uuid: string; label: string; address: string } | undefined;
  engine?: { open: (...a: unknown[]) => Promise<unknown> } | undefined;
  emailRender?: unknown;
}

function make(s: Setup = {}) {
  const enqueueOutbound = vi.fn(
    s.enqueue ?? (async () => ({ message: { id: 'm' }, replayed: false })),
  );
  const openConversationFor = vi.fn(async () => ({ id: 'thread-1' }));
  const sendText = vi.fn(async () => ({ providerMessageId: 'p1' }));
  const open = vi.fn(async () => ({ sendText }));
  const engineGet = vi.fn((name: string) =>
    'engine' in s ? s.engine : name === 'sms' || name === 'email' ? { open } : undefined,
  );
  const purposeOfTemplate = vi.fn(async () => s.templatePurpose ?? 'service_messaging');
  const sender = new LeadFirstMessageSender(
    { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
    {
      templateChannel: async () => s.tplChannel ?? 'whatsapp',
      smsSender: async () =>
        'smsSender' in s
          ? s.smsSender
          : { id: 8, uuid: 'sms-1', label: 'Sales', phoneDigits: '14155550100' },
      mailbox: async () =>
        'mailbox' in s
          ? s.mailbox
          : { id: 9, uuid: 'mb-1', label: 'Sales', address: 'sales@acme.test' },
    } as never,
    { findByUuid: async () => ('tpl' in s ? s.tpl : template()) } as never,
    {
      renderShared: async () =>
        s.emailRender ?? {
          kind: 'ok',
          subject: 'Welcome Ada',
          text: 'Hello Ada',
          purpose: 'marketing',
        },
    } as never,
    {
      baseContext: async () => ({
        attributeDefaults: new Map(),
        system: { today: '2026-10-16', businessName: 'Acme', companyName: 'Acme' },
      }),
      contactFor: async () => ({
        name: 'Ada Lovelace',
        firstName: s.firstName ?? 'Ada',
        middleName: null,
        lastName: 'Lovelace',
        title: null,
        phone: '+919876543210',
        countryCode: null,
        email: 'ada@example.test',
        address: null,
        language: null,
        groups: [],
        data: {},
      }),
    } as never,
    { purposeOfTemplate } as never,
    {
      list: async () =>
        s.channels ?? [
          { uuid: 'ch-1', kind: 'whatsapp_cloud', status: 'connected', wabaConfigId: 41 },
        ],
    } as never,
    { get: engineGet } as never,
    { openConversationFor, enqueueOutbound } as never,
  );
  return { sender, enqueueOutbound, openConversationFor, sendText, open, purposeOfTemplate };
}

const verdict = (p: Preparation) => (p.kind === 'verdict' ? p.verdict : null);

describe('WhatsApp', () => {
  it('is skipped when the contact has no phone', async () => {
    const m = make();
    const p = await m.sender.prepare(
      ORG,
      reply('whatsapp'),
      config('whatsapp'),
      contact({ phone: null }),
      NOW,
    );
    expect(verdict(p)).toEqual({ status: 'skipped', reason: 'no_contact_point' });
  });

  it.each([
    ['the template is gone', { tpl: null }],
    ['it is an SMS template', { tplChannel: 'sms' }],
    ['it is not approved', { tpl: template({ status: 'pending' }) }],
    [
      'it has a media header the contact cannot fill',
      { tpl: template({ attachmentType: 'image' }) },
    ],
    ['it is an authentication template', { tpl: template({ templateType: 'auth' }) }],
  ] as Array<[string, Setup]>)('is skipped as unavailable when %s', async (_n, setup) => {
    const p = await make(setup).sender.prepare(
      ORG,
      reply('whatsapp'),
      config('whatsapp'),
      contact(),
      NOW,
    );
    expect(verdict(p)).toEqual({ status: 'skipped', reason: 'template_unavailable' });
  });

  it('has no sender when the template number is not connected as a channel, and waits when it is disconnected', async () => {
    const none = await make({ channels: [] }).sender.prepare(
      ORG,
      reply('whatsapp'),
      config('whatsapp'),
      contact(),
      NOW,
    );
    expect(verdict(none)).toEqual({ status: 'skipped', reason: 'no_sender' });
    const other = await make({
      channels: [{ uuid: 'ch-2', kind: 'whatsapp_cloud', status: 'connected', wabaConfigId: 77 }],
    }).sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    expect(verdict(other)).toEqual({ status: 'skipped', reason: 'no_sender' });
    const down = await make({
      channels: [
        { uuid: 'ch-1', kind: 'whatsapp_cloud', status: 'disconnected', wabaConfigId: 41 },
      ],
    }).sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    expect(verdict(down)).toEqual({ status: 'held', reason: 'channel_unavailable' });
  });

  it('fills the variables from the contact through the template variable map and queues one template message keyed by the reply', async () => {
    const m = make();
    const p = await m.sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    expect(p.kind).toBe('ready');
    if (p.kind !== 'ready') return;
    // a utility template is a service message; the gate and the quiet hours see it as such
    expect(p.prepared.purpose).toBe('service_messaging');
    expect(m.enqueueOutbound).not.toHaveBeenCalled();
    await expect(p.prepared.deliver()).resolves.toEqual({ kind: 'sent' });
    expect(m.openConversationFor).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      'ch-1',
    );
    expect(m.enqueueOutbound).toHaveBeenCalledWith({
      conversationId: 'thread-1',
      clientMessageId: '11111111-1111-4111-8111-111111111111',
      content: {
        kind: 'template',
        name: 'welcome',
        language: 'en',
        variables: { '1': 'Ada' },
        body: 'Hi Ada, thanks for asking.',
        templateId: 99,
      },
      sender: { kind: 'bot' },
    });
  });

  it('a marketing template is a marketing message', async () => {
    const m = make({ templatePurpose: 'marketing_messaging' });
    const p = await m.sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    expect(p.kind === 'ready' && p.prepared.purpose).toBe('marketing_messaging');
  });

  it('a value the contact does not have is skipped, not sent empty (Meta would refuse it)', async () => {
    const p = await make({ firstName: '' }).sender.prepare(
      ORG,
      reply('whatsapp'),
      config('whatsapp'),
      contact(),
      NOW,
    );
    expect(verdict(p)).toEqual({ status: 'skipped', reason: 'missing_value' });
  });

  it('reads a refusal of the dispatcher as a verdict and lets anything else through as an error', async () => {
    const deny = new AppError(ERROR_CODES.CONSENT_SEND_DENIED, 'no', 422);
    const m = make({
      enqueue: async () => {
        throw deny;
      },
    });
    const p = await m.sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    if (p.kind !== 'ready') throw new Error('not ready');
    await expect(p.prepared.deliver()).resolves.toEqual({
      kind: 'verdict',
      verdict: { status: 'blocked', reason: 'no_consent' },
    });

    const boom = make({
      enqueue: async () => {
        throw new Error('database down');
      },
    });
    const q = await boom.sender.prepare(ORG, reply('whatsapp'), config('whatsapp'), contact(), NOW);
    if (q.kind !== 'ready') throw new Error('not ready');
    await expect(q.prepared.deliver()).rejects.toThrow('database down');
  });
});

describe('SMS', () => {
  const sms = {
    tplChannel: 'sms',
    tpl: template({ templateBody: 'Hi {{first_name}}, we got your enquiry.', variableMap: null }),
  };

  it('renders the template against the contact (no variable map: the merge tags are read from the text)', async () => {
    const m = make(sms);
    const p = await m.sender.prepare(ORG, reply('sms'), config('sms'), contact(), NOW);
    if (p.kind !== 'ready') throw new Error(JSON.stringify(p));
    // SMS has no template categories: it is marketing until a person recorded otherwise
    expect(p.prepared.purpose).toBe('marketing_messaging');
    await p.prepared.deliver();
    expect(m.open).toHaveBeenCalledWith(ORG, expect.objectContaining({ engine: 'sms', id: 8 }));
    const sent = (
      m.sendText.mock.calls[0] as unknown as [
        {
          to: string;
          text: string;
          clientReference: string;
        },
      ]
    )[0];
    expect(sent.to).toBe('919876543210');
    expect(sent.text).toBe('Hi Ada, we got your enquiry.');
    // never mistaken for a campaign or broadcast recipient by the engines and receipt handlers
    expect(sent.clientReference).toBe('lead-first-1-5');
    expect(sent.clientReference).not.toMatch(/^(bcast|camp)-/);
  });

  it('needs a number on the contact, a connected sender and an SMS template', async () => {
    const noPhone = await make(sms).sender.prepare(
      ORG,
      reply('sms'),
      config('sms'),
      contact({ phone: null }),
      NOW,
    );
    expect(verdict(noPhone)).toEqual({ status: 'skipped', reason: 'no_contact_point' });
    const noSender = await make({ ...sms, smsSender: undefined }).sender.prepare(
      ORG,
      reply('sms'),
      config('sms'),
      contact(),
      NOW,
    );
    expect(verdict(noSender)).toEqual({ status: 'skipped', reason: 'no_sender' });
    const noEngine = await make({ ...sms, engine: undefined }).sender.prepare(
      ORG,
      reply('sms'),
      config('sms'),
      contact(),
      NOW,
    );
    expect(verdict(noEngine)).toEqual({ status: 'skipped', reason: 'no_sender' });
    const wrong = await make({ ...sms, tplChannel: 'whatsapp' }).sender.prepare(
      ORG,
      reply('sms'),
      config('sms'),
      contact(),
      NOW,
    );
    expect(verdict(wrong)).toEqual({ status: 'skipped', reason: 'template_unavailable' });
  });

  it('reads what the engine says when it cannot send', async () => {
    const m = make(sms);
    m.sendText.mockRejectedValueOnce(
      new SenderRefused("You've reached your plan's limit of 10 SMS messages a month."),
    );
    const p = await m.sender.prepare(ORG, reply('sms'), config('sms'), contact(), NOW);
    if (p.kind !== 'ready') throw new Error('not ready');
    await expect(p.prepared.deliver()).resolves.toEqual({
      kind: 'verdict',
      verdict: { status: 'blocked', reason: 'plan_limit' },
    });
  });
});

describe('email', () => {
  it('sends the rendered template as typed text from a shared mailbox, with the subject as the header', async () => {
    const m = make();
    const p = await m.sender.prepare(ORG, reply('email'), config('email'), contact(), NOW);
    if (p.kind !== 'ready') throw new Error(JSON.stringify(p));
    expect(p.prepared.purpose).toBe('marketing_messaging');
    expect(p.prepared.target).toEqual({ phone: null, email: 'ada@example.test' });
    await p.prepared.deliver();
    expect(m.open).toHaveBeenCalledWith(ORG, expect.objectContaining({ engine: 'email', id: 9 }));
    expect(m.sendText).toHaveBeenCalledWith({
      to: 'ada@example.test',
      text: 'Hello Ada',
      header: 'Welcome Ada',
      clientReference: 'lead-first-1-5',
    });
  });

  it('needs an address, a shared mailbox and a template the workspace can use', async () => {
    const noMail = await make().sender.prepare(
      ORG,
      reply('email'),
      config('email'),
      contact({ email: null }),
      NOW,
    );
    expect(verdict(noMail)).toEqual({ status: 'skipped', reason: 'no_contact_point' });
    const noBox = await make({ mailbox: undefined }).sender.prepare(
      ORG,
      reply('email'),
      config('email'),
      contact(),
      NOW,
    );
    expect(verdict(noBox)).toEqual({ status: 'skipped', reason: 'no_sender' });
    for (const emailRender of [{ kind: 'not_found' }, { kind: 'archived' }]) {
      const p = await make({ emailRender }).sender.prepare(
        ORG,
        reply('email'),
        config('email'),
        contact(),
        NOW,
      );
      expect(verdict(p)).toEqual({ status: 'skipped', reason: 'template_unavailable' });
    }
  });

  it('an empty subject or body is not sent', async () => {
    const p = await make({
      emailRender: { kind: 'ok', subject: ' ', text: 'x', purpose: 'marketing' },
    }).sender.prepare(ORG, reply('email'), config('email'), contact(), NOW);
    expect(verdict(p)).toEqual({ status: 'skipped', reason: 'template_unavailable' });
  });
});

describe('the first message needs a template', () => {
  it('none chosen is skipped', async () => {
    const p = await make().sender.prepare(
      ORG,
      reply('whatsapp'),
      config('whatsapp', { templateId: null }),
      contact(),
      NOW,
    );
    expect(verdict(p)).toEqual({ status: 'skipped', reason: 'template_unavailable' });
  });
});

describe('verdictOfEngineError', () => {
  it('reads the sentences the engines throw, and guesses nothing else', () => {
    const cases: Array<[unknown, string, string]> = [
      [new Error('No sendable SMS number connected'), 'skipped', 'no_sender'],
      [new Error('No sendable mailbox is connected.'), 'skipped', 'no_sender'],
      [new Error('Your plan does not include Email.'), 'blocked', 'plan_limit'],
      [
        new SenderRefused("You've reached your plan's limit of 5 mails a month."),
        'blocked',
        'plan_limit',
      ],
      [new SenderRefused('This contact has opted out of messages.'), 'blocked', 'opted_out'],
      [
        new SenderRefused('This contact has no recorded consent for marketing messages.'),
        'blocked',
        'no_consent',
      ],
      [new SenderThrottled('mailbox is full for the hour', 60_000), 'held', 'channel_unavailable'],
      [new SenderRefused('Address bounced before'), 'failed', 'provider_error'],
      [new Error('socket hang up'), 'failed', 'provider_error'],
      ['a string', 'failed', 'provider_error'],
    ];
    for (const [err, status, reason] of cases) {
      expect(verdictOfEngineError(err), String(err)).toEqual({ status, reason });
    }
  });
});
