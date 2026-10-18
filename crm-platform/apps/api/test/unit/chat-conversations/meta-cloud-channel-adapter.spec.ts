import { describe, expect, it, vi } from 'vitest';
import {
  ChannelError,
  type ChannelRuntime,
  type OutboundEnvelope,
} from '../../../src/infra/providers/chat-conversations';
import {
  MetaCloudChannelAdapter,
  PROVIDER_CREDENTIALS_REJECTED,
} from '../../../src/infra/providers/whatsapp';
import type {
  InboundMediaFetcher,
  OutboundMediaUploader,
} from '../../../src/infra/providers/whatsapp/media';
import type { OutboundSendGuard } from '../../../src/infra/providers/whatsapp/send-guard.port';
import type { WabaAdminPort } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import type { WabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { FX, graphError, graphFixture } from '../../fixtures/whatsapp';

/**
 * The WhatsApp channel adapter over the platform's one WhatsApp client. `WabaHttp` is the real class with `fetch` replaced, so what is
 * asserted is the request that would have left (address, version, auth headers, body) and what a refusal becomes.
 */

const ENV = {
  META_API_ENDPOINT: 'https://graph.test',
  META_API_VERSION: 'v25.0',
  INTERAKT_API_ENDPOINT: 'https://interakt.test/api',
  INTERAKT_API_VERSION: 'v25.0',
  WABA_HTTP_TIMEOUT_MS: 5_000,
} as unknown as WabaEnv;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function build(
  answer: (call: Call) => Response | Promise<Response> = () => json(200, graphFixture('send-ok')),
) {
  const calls: Call[] = [];
  const http = new WabaHttp(ENV);
  http.fetchImpl = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return answer(call);
  };
  const guard: OutboundSendGuard = {
    beforeSend: vi.fn(async () => undefined),
    withFooter: vi.fn(async ({ body }) => `${body}\n\nSent via Test`),
  };
  const uploader = {
    prepare: vi.fn(async () => ({
      kind: 'image',
      mime: 'image/jpeg',
      voice: false,
      via: 'id',
      mediaId: 'MEDIA-1',
      cached: false,
    })),
    forget: vi.fn(async () => undefined),
  } as unknown as OutboundMediaUploader & {
    prepare: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };
  const admin = {
    getPhone: vi.fn(),
    getWabaDetails: vi.fn(),
    getSubscribedApps: vi.fn(),
    inspectToken: vi.fn(),
  } as unknown as WabaAdminPort &
    Record<
      'getPhone' | 'getWabaDetails' | 'getSubscribedApps' | 'inspectToken',
      ReturnType<typeof vi.fn>
    >;
  const adapter = new MetaCloudChannelAdapter(
    http,
    admin,
    guard,
    uploader,
    {} as InboundMediaFetcher,
    () => new Date('2026-10-03T10:00:00Z'),
  );
  return { adapter, calls, guard, uploader, admin };
}

const meta = (over: Partial<ChannelRuntime> = {}): ChannelRuntime => ({
  orgId: 7,
  uuid: '22222222-2222-4222-8222-222222222222',
  kind: 'whatsapp_cloud',
  status: 'connected',
  externalId: FX.phoneNumberId,
  displayAddress: '+1 555-000-1111',
  settings: { metered: true },
  capabilityOverrides: {},
  credentials: {
    route: 'meta',
    accessToken: FX.accessToken,
    businessAccountId: FX.wabaId,
    phoneNumberId: FX.phoneNumberId,
  },
  ...over,
});

const interakt = (): ChannelRuntime =>
  meta({
    credentials: {
      route: 'interakt',
      authKey: 'partner-key-0123456789',
      businessAccountId: FX.wabaId,
      phoneNumberId: FX.phoneNumberId,
    },
  });

const text = (body = 'hi', ref = 'ref-1'): OutboundEnvelope => ({
  kind: 'text',
  to: '+91 98765 43210',
  clientReference: ref,
  attempt: 1,
  body,
});

describe('MetaCloudChannelAdapter: what it is', () => {
  const { adapter } = build();

  it('is live, takes no credentials of its own and has no per-channel webhook: the number belongs to the WABA domain', () => {
    expect(adapter.kind).toBe('whatsapp_cloud');
    expect(adapter.live).toBe(true);
    expect(adapter.publicWebhook).toBe(false);
    expect(adapter.credentialsSchema).toBeNull();
    expect(adapter.secretFields).toEqual([]);
    expect(adapter.externalIdOf()).toBeNull();
  });

  it('never verifies a delivery itself: the WABA webhook is the authenticated door', () => {
    expect(adapter.verifyInbound()).toBe(false);
  });

  it('reports the Cloud capabilities: 24 hour window, templates, all media, typing', () => {
    expect(adapter.capabilities()).toMatchObject({
      windowHours: 24,
      templates: true,
      reactions: true,
      typing: true,
    });
    expect(adapter.capabilities().media).toContain('document');
  });

  it('opens the 24 hour window from the last inbound message', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    expect(adapter.windowInfo(meta(), null, now)).toEqual({ open: false, expiresAt: null });
    expect(adapter.windowInfo(meta(), new Date('2026-10-03T09:00:00Z'), now).open).toBe(true);
    expect(adapter.windowInfo(meta(), new Date('2026-10-01T09:00:00Z'), now).open).toBe(false);
  });
});

describe("send: through WabaHttp, on the number's own route", () => {
  it('Meta route: POST /{phone-number-id}/messages on the configured address and version with the bearer token, footer after the text', async () => {
    const { adapter, calls, guard } = build();
    const sent = await adapter.send(meta(), text('hello'));

    expect(sent.providerMessageId).toMatch(/^wamid\./);
    expect(sent.acceptedAt).toEqual(new Date('2026-10-03T10:00:00Z'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `https://graph.test/v25.0/${FX.phoneNumberId}/messages`,
      method: 'POST',
      headers: { authorization: `Bearer ${FX.accessToken}`, 'content-type': 'application/json' },
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '919876543210',
        type: 'text',
        text: { preview_url: false, body: 'hello\n\nSent via Test' },
      },
    });
    expect(guard.withFooter).toHaveBeenCalledWith({ orgId: 7, body: 'hello' });
    // The halt and the content screen run once, in the dispatcher: not again here.
    expect(guard.beforeSend).not.toHaveBeenCalled();
  });

  it('Interakt route: its own address, x-access-token and x-waba-id, and no bearer token', async () => {
    const { adapter, calls } = build();
    await adapter.send(interakt(), text());
    expect(calls[0]!.url).toBe(`https://interakt.test/api/v25.0/${FX.phoneNumberId}/messages`);
    expect(calls[0]!.headers).toMatchObject({
      'x-access-token': 'partner-key-0123456789',
      'x-waba-id': FX.wabaId,
      'x-phone-number-id': FX.phoneNumberId,
    });
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('a template, a location and a reaction are the Cloud API objects; none of them gets the footer', async () => {
    const { adapter, calls, guard } = build();
    await adapter.send(meta(), {
      kind: 'template',
      to: '919876543210',
      clientReference: 't1',
      attempt: 1,
      template: { name: 'order_update', language: 'en-US', variables: { '1': 'Asha' } },
    });
    await adapter.send(meta(), {
      kind: 'location',
      to: '919876543210',
      clientReference: 'l1',
      attempt: 1,
      location: { latitude: 1.5, longitude: 2.5, name: 'Here' },
    });
    await adapter.send(meta(), {
      kind: 'reaction',
      to: '919876543210',
      clientReference: 'r1',
      attempt: 1,
      reaction: { providerMessageId: 'wamid.9', emoji: '👍' },
    });
    expect(calls.map((c) => c.body?.type)).toEqual(['template', 'location', 'reaction']);
    expect(calls[0]!.body).toMatchObject({
      template: {
        name: 'order_update',
        language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }],
      },
    });
    expect(guard.withFooter).not.toHaveBeenCalled();
  });

  it('a file is got to WhatsApp by the media pipeline first, and the message names what it returned', async () => {
    const { adapter, calls, uploader } = build();
    const channel = meta();
    await adapter.send(channel, {
      kind: 'media',
      to: '919876543210',
      clientReference: 'm1',
      attempt: 1,
      media: { key: 'org/7/a.jpg', mediaKind: 'image', mime: 'image/jpeg', caption: 'look' },
    });
    expect(uploader.prepare).toHaveBeenCalledWith(
      channel,
      expect.objectContaining({ key: 'org/7/a.jpg', mediaKind: 'image' }),
    );
    expect(calls[0]!.body).toMatchObject({
      type: 'image',
      image: { id: 'MEDIA-1', caption: 'look' },
    });
  });

  it('a stale cached media id (Meta 131052/131053) is forgotten so the retry uploads again, and the failure keeps its code', async () => {
    const { adapter, uploader } = build(() => json(400, graphError('131052')));
    await expect(
      adapter.send(meta(), {
        kind: 'media',
        to: '919876543210',
        clientReference: 'm2',
        attempt: 1,
        media: { key: 'org/7/a.jpg', mediaKind: 'image', mime: 'image/jpeg' },
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_REJECTED', retryable: false });
    expect(uploader.forget).toHaveBeenCalledOnce();
  });
});

describe('send: what a refusal becomes', () => {
  const failWith = async (answer: () => Response | Promise<Response>, channel = meta()) => {
    const { adapter } = build(answer);
    return adapter.send(channel, text()).then(
      () => {
        throw new Error('expected the send to fail');
      },
      (e: unknown) => e as ChannelError,
    );
  };

  it('Meta 131047 (window closed) is permanent and says so', async () => {
    const err = await failWith(() => json(400, graphError('131047')));
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({
      code: 'SERVICE_WINDOW_CLOSED',
      retryable: false,
      needsReauth: false,
      providerCode: '131047',
    });
    expect(err.message).toContain('more than 24 hours');
  });

  it('Meta 190 (the token) is permanent and needs a person to paste a new one', async () => {
    const err = await failWith(() => json(401, graphError('190')));
    expect(err).toMatchObject({
      code: 'CHANNEL_AUTH_EXPIRED',
      retryable: false,
      needsReauth: true,
      providerFault: false,
    });
  });

  it("a rate limit is retryable with Meta's own wait; a 5xx with an HTML body is retryable too", async () => {
    expect(await failWith(() => json(429, graphError('130429')))).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterMs: 10_000,
    });
    const html = await failWith(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(html).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
  });

  it('a connection refused before anything was sent is retryable', async () => {
    const { adapter } = build(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    await expect(adapter.send(meta(), text())).rejects.toMatchObject({
      code: 'PROVIDER_UNREACHABLE',
      retryable: true,
    });
  });

  it('a send that times out is not retried: Meta may have accepted it (RF-01)', async () => {
    const { adapter } = build(() => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    await expect(adapter.send(meta(), text())).rejects.toMatchObject({
      code: 'PROVIDER_OUTCOME_UNKNOWN',
      retryable: false,
      outcomeMayHaveCommitted: true,
    });
  });

  it('a 200 without a message id is not retried (it may have been sent); a 200 with message_status failed is a rejection', async () => {
    expect(await failWith(() => json(200, graphFixture('send-no-id')))).toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
      retryable: false,
    });
    expect(
      await failWith(() => json(200, { messages: [{ id: 'wamid.x', message_status: 'failed' }] })),
    ).toMatchObject({ code: 'PROVIDER_REJECTED', retryable: false });
  });

  it('the access token never reaches an error message, even when Meta echoes it back', async () => {
    const err = await failWith(() =>
      json(400, {
        error: {
          message: `Invalid parameter ${FX.accessToken}`,
          code: 100,
          type: 'OAuthException',
        },
      }),
    );
    expect(err.message).not.toContain(FX.accessToken);
    expect(err.message).toContain('[redacted]');
  });

  it("on the Interakt route a refused credential is the platform's: it goes to error, not to needs_reauth", async () => {
    const err = await failWith(() => json(401, graphError('190')), interakt());
    expect(err).toMatchObject({
      code: PROVIDER_CREDENTIALS_REJECTED,
      retryable: false,
      needsReauth: false,
      providerFault: true,
    });
    expect(err.message).not.toContain('partner-key-0123456789');
  });

  it('a channel with no linked connection (no token, or no phone number id) is a permanent refusal that needs a person, before any call', async () => {
    const { adapter, calls } = build();
    for (const channel of [
      meta({ credentials: {} }),
      meta({ externalId: null, credentials: { route: 'meta', accessToken: FX.accessToken } }),
    ]) {
      await expect(adapter.send(channel, text())).rejects.toMatchObject({
        code: 'CHANNEL_CREDENTIALS_MISSING',
        retryable: false,
        needsReauth: true,
      });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('markRead', () => {
  it('posts the read receipt, with the typing indicator on request', async () => {
    const { adapter, calls } = build(() => json(200, graphFixture('mark-read-ok')));
    await adapter.markRead(meta(), 'wamid.IN1');
    await adapter.markRead(meta(), 'wamid.IN1', { typing: true });
    expect(calls[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.IN1',
    });
    expect(calls[1]!.body).toMatchObject({ typing_indicator: { type: 'text' } });
    expect(calls[0]!.url).toBe(`https://graph.test/v25.0/${FX.phoneNumberId}/messages`);
  });

  it('a refusal is a classified ChannelError', async () => {
    const { adapter } = build(() => json(401, graphError('190')));
    await expect(adapter.markRead(meta(), 'wamid.IN1')).rejects.toMatchObject({
      code: 'CHANNEL_AUTH_EXPIRED',
      needsReauth: true,
    });
  });
});

describe('checkHealth: the reads go through the WABA admin port', () => {
  const phone = {
    id: FX.phoneNumberId,
    verifiedName: 'Geta Academy',
    displayPhoneNumber: '+1 555-000-1111',
    qualityRating: 'GREEN',
    messagingLimitTier: 'TIER_1K',
    codeVerificationStatus: 'VERIFIED',
    nameStatus: 'APPROVED',
    accountMode: null,
    throughput: null,
    platformType: 'CLOUD_API',
    isOfficialBusinessAccount: null,
    isPinEnabled: null,
    lastOnboardedTime: null,
    status: 'CONNECTED',
  };

  it("a healthy number: ok, the snapshot carries what Meta said, and the token is the connection's", async () => {
    const { adapter, admin } = build();
    admin.getPhone.mockResolvedValue(phone);
    admin.getWabaDetails.mockResolvedValue({
      accountReviewStatus: 'APPROVED',
      businessVerificationStatus: 'verified',
    });
    admin.getSubscribedApps.mockResolvedValue(['Geta CRM']);
    admin.inspectToken.mockResolvedValue({
      isValid: true,
      userId: null,
      appId: FX.appId,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      wabaIds: [],
      expiresAt: null,
    });
    const verdict = await adapter.checkHealth(meta());
    expect(verdict).toMatchObject({ needsReauth: false, providerFault: false });
    expect(verdict.health).toMatchObject({
      ok: true,
      overall: 'healthy',
      displayName: 'Geta Academy',
      qualityRating: 'GREEN',
      webhook: { subscribed: true },
      token: { valid: true, expiresAt: null },
    });
    expect(admin.getPhone).toHaveBeenCalledWith(
      { provider: 'meta', accessToken: FX.accessToken },
      FX.phoneNumberId,
    );
    expect(admin.inspectToken).toHaveBeenCalledWith(FX.accessToken);
  });

  it('a token Meta refuses is a failed check that needs a new token, and no webhook subscription is a critical issue', async () => {
    const { adapter, admin } = build();
    admin.getPhone.mockRejectedValue(WabaApiError.fromResponse(401, graphError('190')));
    admin.getWabaDetails.mockRejectedValue(WabaApiError.fromResponse(401, graphError('190')));
    admin.getSubscribedApps.mockResolvedValue([]);
    admin.inspectToken.mockResolvedValue({
      isValid: false,
      userId: null,
      appId: null,
      scopes: [],
      wabaIds: [],
      expiresAt: null,
    });
    const verdict = await adapter.checkHealth(meta());
    expect(verdict.needsReauth).toBe(true);
    expect(verdict.health).toMatchObject({
      ok: false,
      overall: 'blocked',
      errorCode: 'CHANNEL_AUTH_EXPIRED',
    });
    expect(verdict.health.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['CHANNEL_AUTH_EXPIRED', 'NO_WEBHOOK_SUBSCRIPTION', 'TOKEN_INVALID']),
    );
  });

  it("on the Interakt route no token is inspected, and a refused partner key is the platform's fault", async () => {
    const { adapter, admin } = build();
    admin.getPhone.mockRejectedValue(WabaApiError.fromResponse(401, graphError('190')));
    admin.getWabaDetails.mockResolvedValue({
      accountReviewStatus: 'APPROVED',
      businessVerificationStatus: 'verified',
    });
    admin.getSubscribedApps.mockResolvedValue(['Geta CRM']);
    const verdict = await adapter.checkHealth(interakt());
    expect(admin.inspectToken).not.toHaveBeenCalled();
    expect(verdict).toMatchObject({ needsReauth: false, providerFault: true });
    expect(verdict.health.ok).toBe(false);
  });
});

describe('parseInbound: the normaliser the inbox reads a Cloud API change with', () => {
  it("turns a message and a delivery report of this number into normalised ones, and ignores another number's", () => {
    const { adapter } = build();
    const value = (phoneId: string) => ({
      metadata: { phone_number_id: phoneId },
      contacts: [{ wa_id: '919876543210', profile: { name: 'Asha' } }],
      messages: [
        {
          id: 'wamid.1',
          from: '919876543210',
          type: 'text',
          timestamp: '1760000000',
          text: { body: 'hi' },
        },
      ],
      statuses: [{ id: 'wamid.0', status: 'delivered', timestamp: '1760000100' }],
    });
    const payload = (phoneId: string) => ({
      entry: [{ changes: [{ field: 'messages', value: value(phoneId) }] }],
    });
    const mine = adapter.parseInbound(meta(), payload(FX.phoneNumberId));
    expect(mine.messages).toMatchObject([
      {
        providerMessageId: 'wamid.1',
        peerKey: '919876543210',
        peerName: 'Asha',
        kind: 'text',
        body: 'hi',
      },
    ]);
    expect(mine.receipts).toMatchObject([{ providerMessageId: 'wamid.0', status: 'delivered' }]);
    expect(adapter.parseInbound(meta(), payload('999')).messages).toEqual([]);
    expect(adapter.parseInbound(meta(), null)).toEqual({ messages: [], receipts: [], ignored: [] });
  });
});

describe('send: a WhatsApp group thread (g:<group id>) is addressed as a group', () => {
  const to = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';

  it('text is posted to the group id with recipient_type group', async () => {
    const { adapter, calls } = build();
    await adapter.send(meta(), { ...text('hi'), to });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/messages$/);
    expect(calls[0]!.body).toMatchObject({
      recipient_type: 'group',
      to: 'Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2',
      type: 'text',
    });
  });

  it('a reaction or interactive message is refused before the upload and any Graph call, not retryable', async () => {
    const { adapter, calls, uploader, guard } = build();
    const envelopes: OutboundEnvelope[] = [
      {
        kind: 'reaction',
        to,
        clientReference: 'ref-r',
        attempt: 1,
        reaction: { providerMessageId: 'wamid.1', emoji: '👍' },
      },
      {
        kind: 'interactive',
        to,
        clientReference: 'ref-i',
        attempt: 1,
        interactive: { type: 'location_request', body: 'Where?' },
      } as OutboundEnvelope,
    ];
    for (const envelope of envelopes) {
      const err = (await adapter.send(meta(), envelope).catch((e: unknown) => e)) as ChannelError;
      expect(err).toBeInstanceOf(ChannelError);
      expect(err.code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
      expect(err.retryable).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(uploader.prepare).not.toHaveBeenCalled();
    expect(guard.withFooter).not.toHaveBeenCalled();
  });
});
