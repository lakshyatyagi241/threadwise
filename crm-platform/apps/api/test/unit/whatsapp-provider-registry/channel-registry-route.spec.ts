import { describe, expect, it, vi } from 'vitest';
import { ChannelError, type ChannelRuntime } from '../../../src/infra/providers/chat-conversations';
import { MetaCloudChannelAdapter } from '../../../src/infra/providers/whatsapp';
import {
  authContextOf,
  profileOf,
  wabaAuthOf,
  type InboundMediaFetcher,
  type OutboundMediaUploader,
} from '../../../src/infra/providers/whatsapp/media';
import type { OutboundSendGuard } from '../../../src/infra/providers/whatsapp/send-guard.port';
import type { WabaAdminPort } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaHttp,
  type WabaRegistryAuth,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import type { WabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';

/**
 * A WhatsApp channel linked to a number on a registry provider: the channel registry puts the number's resolved route in the opened
 * credentials (`registry`), and the adapter and the media pipeline send through it instead of Meta or Interakt.
 */
const ENV = {
  META_API_ENDPOINT: 'https://graph.test',
  META_API_VERSION: 'v25.0',
  INTERAKT_API_ENDPOINT: 'https://interakt.test/api',
  INTERAKT_API_VERSION: 'v25.0',
  WABA_HTTP_TIMEOUT_MS: 5_000,
  WABA_PROVIDER_ALLOW_PRIVATE_HOSTS: true,
} as unknown as WabaEnv;

const registry = (over: Partial<WabaRegistryAuth> = {}): WabaRegistryAuth => ({
  provider: 'registry',
  providerKey: 'pinnacle',
  baseUrl: 'https://api.pinnacle.io/wa',
  apiVersion: 'v24.0',
  headers: { 'x-api-key': 'partner-token-1234', 'x-waba-id': '100200' },
  credentialMode: 'platform_token',
  webhookMode: 'number_level_override',
  capabilities: { mediaUpload: false },
  ...over,
});

const channel = (r: WabaRegistryAuth | null): ChannelRuntime => ({
  orgId: 7,
  uuid: '22222222-2222-4222-8222-222222222222',
  kind: 'whatsapp_cloud',
  status: 'connected',
  externalId: '555000111',
  displayAddress: '+1 555-000-1111',
  settings: { metered: true },
  capabilityOverrides: {},
  credentials: {
    route: 'meta',
    accessToken: 'business-token',
    businessAccountId: '100200',
    phoneNumberId: '555000111',
    ...(r ? { registry: JSON.stringify(r) } : {}),
  },
});

function build(status = 200, body: unknown = { messages: [{ id: 'wamid.1' }] }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const http = new WabaHttp(ENV);
  http.fetchImpl = async (url, init) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  };
  const guard: OutboundSendGuard = {
    beforeSend: vi.fn(async () => undefined),
    withFooter: vi.fn(async ({ body: b }) => b),
  };
  const admin = {} as WabaAdminPort;
  const adapter = new MetaCloudChannelAdapter(
    http,
    admin,
    guard,
    {} as OutboundMediaUploader,
    {} as InboundMediaFetcher,
  );
  return { adapter, calls, http };
}

describe('a channel on a registry provider', () => {
  it('sends through the provider’s address, version and headers, and the business token never leaves', async () => {
    const { adapter, calls } = build();
    const sent = await adapter.send(channel(registry()), {
      kind: 'text',
      body: 'hello',
      to: '15550001111',
    } as never);
    expect(sent.providerMessageId).toBe('wamid.1');
    expect(calls[0]!.url).toBe('https://api.pinnacle.io/wa/v24.0/555000111/messages');
    expect(calls[0]!.headers).toMatchObject({
      'x-api-key': 'partner-token-1234',
      'x-waba-id': '100200',
    });
    expect(JSON.stringify(calls[0])).not.toContain('business-token');
  });

  it('without a registry route the same channel still goes to Meta (nothing changes for existing numbers)', async () => {
    const { adapter, calls } = build();
    await adapter.send(channel(null), { kind: 'text', body: 'hello', to: '15550001111' } as never);
    expect(calls[0]!.url).toBe('https://graph.test/v25.0/555000111/messages');
    expect(calls[0]!.headers.authorization).toBe('Bearer business-token');
  });

  it('a refused platform credential is the platform’s fault, not something the customer can fix by pasting a token', async () => {
    const { adapter } = build(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
    const err = await adapter
      .send(channel(registry()), { kind: 'text', body: 'hello', to: '15550001111' } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).providerFault).toBe(true);
    expect((err as ChannelError).needsReauth).toBe(false);
  });

  it('a garbage registry value in the credentials is ignored, not trusted', () => {
    const ch = channel(null);
    expect(
      authContextOf({ ...ch, credentials: { ...ch.credentials, registry: '{"provider":"x"}' } })
        .registry,
    ).toBeUndefined();
    expect(
      authContextOf({ ...ch, credentials: { ...ch.credentials, registry: 'not json' } }).registry,
    ).toBeUndefined();
  });
});

describe('the media pipeline on a registry provider', () => {
  it('reads address, version, credential mode and the upload capability from the route', () => {
    const ctx = authContextOf(channel(registry()));
    const http = new WabaHttp(ENV);
    const profile = profileOf(http, ctx.route, ctx.registry);
    expect(profile).toMatchObject({
      baseUrl: 'https://api.pinnacle.io/wa',
      apiVersion: 'v24.0',
      credentialMode: 'platform_token',
      capabilities: { mediaUpload: false },
    });
    expect(profile.buildHeaders(ctx)).toEqual({
      'x-api-key': 'partner-token-1234',
      'x-waba-id': '100200',
    });
    expect(wabaAuthOf(ctx)).toMatchObject({ provider: 'registry' });
    const withUpload = authContextOf(channel(registry({ capabilities: { mediaUpload: true } })));
    expect(profileOf(http, withUpload.route, withUpload.registry).capabilities.mediaUpload).toBe(
      true,
    );
  });

  it('the Meta route is unchanged without a registry route', () => {
    const ctx = authContextOf(channel(null));
    const profile = profileOf(new WabaHttp(ENV), ctx.route, ctx.registry);
    expect(profile).toMatchObject({
      baseUrl: 'https://graph.test',
      credentialMode: 'channel_token',
      capabilities: { mediaUpload: true },
    });
  });
});
