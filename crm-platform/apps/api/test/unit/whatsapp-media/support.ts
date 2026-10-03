import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { LocalDiskMediaStore } from '../../../src/infra/providers/chat-conversations/media/local-disk-media.store';
import { MediaTokenService } from '../../../src/infra/providers/chat-conversations/media/media-token.service';
import type { ChatMediaObjectGateway } from '../../../src/infra/providers/chat-conversations/media/media.ports';
import type { MediaProviderProfile } from '../../../src/infra/providers/whatsapp/media/media-provider';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';
import type { FakeGraph } from './fake-graph';

export const TOKEN = 'EAAB-channel-token-0123456789';
export const BSP_TOKEN = 'bsp-platform-token-abcdef';

/** A media store over a temp directory, with a stub bucket gateway. */
export async function makeStore(disk: 'local' | 'cloud' = 'local') {
  const dir = await mkdtemp(join(tmpdir(), 'crm-wamedia-'));
  const local = new LocalDiskMediaStore(dir);
  const gateway = {
    destination: vi.fn(async () => ({ disk })),
    put: vi.fn(async (key: string) => (disk === 'cloud' ? { key } : null)),
    remove: vi.fn(async () => undefined),
    url: vi.fn(async (key: string, ttl?: number) => `https://bucket.example/${key}?ttl=${ttl}&sig=SIGNED`),
  } as unknown as ChatMediaObjectGateway & Record<'destination' | 'put' | 'remove' | 'url', ReturnType<typeof vi.fn>>;
  const store = new ChatMediaStore(
    gateway,
    new UploadPolicyService(),
    local,
    new MediaTokenService(
      new CryptoService(new ConfigService({ CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') }) as never),
    ),
  );
  return { store, local, dir, gateway, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Direct Meta pointed at the fake: Authorization: Bearer from the channel's own token. */
export const metaProfile = (g: FakeGraph): MediaProviderProfile => ({
  baseUrl: g.graphUrl,
  apiVersion: 'v23.0',
  credentialMode: 'channel_token',
  buildHeaders: ({ channelToken }) => (channelToken ? { authorization: `Bearer ${channelToken}` } : {}),
  capabilities: { mediaUpload: true },
});

/** An Interakt-shaped provider: one platform token in custom headers, never an Authorization header. */
export const bspProfile = (g: FakeGraph, mediaUpload = false): MediaProviderProfile => ({
  baseUrl: g.graphUrl,
  apiVersion: 'v24.0',
  credentialMode: 'platform_token',
  buildHeaders: ({ wabaId }) => ({ 'x-access-token': BSP_TOKEN, 'x-waba-id': wabaId ?? '' }),
  capabilities: { mediaUpload },
});

export const channel = (over: Partial<{ orgId: number; uuid: string; externalId: string | null; credentials: Record<string, string | undefined> }> = {}) => ({
  orgId: 11,
  uuid: '11111111-1111-4111-8111-111111111111',
  externalId: '1000000001',
  credentials: { accessToken: TOKEN, appSecret: 'app-secret-9911', businessAccountId: '555' } as Record<string, string | undefined>,
  ...over,
});

/** Everything the Nest logger was asked to write, so a spec can search it for a secret. */
export function captureLogs(Logger: { overrideLogger(l: unknown): void }) {
  const lines: string[] = [];
  const push = (m: unknown, ...rest: unknown[]) => void lines.push(JSON.stringify([m, ...rest]));
  Logger.overrideLogger({ log: push, error: push, warn: push, debug: push, verbose: push, fatal: push });
  return {
    lines,
    restore: () => Logger.overrideLogger(['error', 'warn']),
  };
}
