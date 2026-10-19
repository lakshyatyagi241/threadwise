import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { isSealed, openIfSealed } from '../../../src/common/crypto/secret-columns';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PushSubscriptionsService } from '../../../src/modules/notifications/push-subscriptions.service';
import { WebPushSender } from '../../../src/modules/notifications/web-push.sender';
import type { PushTarget } from '../../../src/modules/notifications/push-subscriptions.repository';
import { FakeWebPushProvider, useVapidEnv } from '../../support/web-push-fakes';

/** Encryption audit E7: the Web Push auth secret is sealed at rest; a row written before this change (plaintext) still sends. */
const key = randomBytes(32).toString('base64');
const crypto = new CryptoService({
  get: (n: string) => (n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : key),
} as unknown as ConfigService<never, true>);

describe('sealed-or-plain reads', () => {
  it('opens a sealed blob and passes a legacy plaintext value through', () => {
    const sealed = crypto.encrypt('auth-secret_abc-123');
    expect(isSealed(sealed)).toBe(true);
    expect(openIfSealed(crypto, sealed)).toBe('auth-secret_abc-123');
    expect(isSealed('auth-secret_abc-123')).toBe(false);
    expect(openIfSealed(crypto, 'auth-secret_abc-123')).toBe('auth-secret_abc-123');
  });
});

describe('push subscription auth secret', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = useVapidEnv();
  });
  afterAll(() => restore());

  it('is stored sealed when a browser subscribes', async () => {
    const stored: Array<{ auth: string }> = [];
    const repo = {
      upsert: vi.fn(async (_tx: unknown, _o: number, _u: number, input: { auth: string }) => {
        stored.push(input);
        return { id: 1, uuid: 'u', label: 'Browser', createdAt: new Date(), lastUsedAt: null };
      }),
      dropOthersOnEndpoint: vi.fn(async () => 0),
      trimToCap: vi.fn(async () => 0),
    };
    const service = new PushSubscriptionsService(
      { tx: async (fn: (tx: unknown) => unknown) => fn({}) } as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      crypto,
    );
    await RequestContextStore.run(
      { requestId: 'r', orgId: 1, actorType: 'user', actorId: 2, userId: 2 },
      () =>
        service.subscribe(
          { endpoint: 'https://push.example.test/e', keys: { p256dh: 'pk', auth: 'plain-auth-1' } },
          undefined,
        ),
    );
    expect(stored[0]!.auth).not.toContain('plain-auth-1');
    expect(crypto.decrypt(stored[0]!.auth)).toBe('plain-auth-1');
  });

  const target = (auth: string): PushTarget => ({
    id: 1,
    uuid: 'u',
    endpoint: 'https://push.example.test/e',
    p256dh: 'pk',
    auth,
    failureCount: 0,
  });

  it('is opened before the push service sees it, for sealed and for legacy plaintext rows alike', async () => {
    const provider = new FakeWebPushProvider();
    const sender = new WebPushSender(provider, {} as never, {} as never, crypto);
    await sender.send([target(crypto.encrypt('sealed-auth')), target('legacy-auth')], {
      title: 't',
      body: 'b',
      tag: 'x',
      test: true,
    } as never);
    expect(provider.sent.map((s) => s.target.auth)).toEqual(['sealed-auth', 'legacy-auth']);
  });
});
