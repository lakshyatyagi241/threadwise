import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ApiKeyGuard } from '../../../src/modules/public-api/api-key.guard';

vi.mock('@node-rs/argon2', () => ({ verify: vi.fn(async () => true) }));

/**
 * The signed-key guard throttles the last-used write the way the bearer guard does: one write per interval per key, not one per call.
 */
describe('ApiKeyGuard last-used throttle', () => {
  it('passes the same minimum interval the bearer guard uses', async () => {
    const access = {
      assertNotLockedOut: vi.fn(async () => undefined),
      recordAuthFailure: vi.fn(async () => undefined),
      enforceRateLimit: vi.fn(async () => undefined),
      assertPlanFeatures: vi.fn(async () => undefined),
      touchLastUsed: vi.fn(async () => undefined),
    };
    const keyRow = {
      org_id: 7,
      id: 9,
      key_hash: 'hash',
      signing_secret_enc: 'enc',
      scopes: [],
      status: 'active',
      expires_at: null,
      rate_limit_per_minute: 60,
    };
    const db = {
      privileged: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ execute: async () => ({ rows: [keyRow] }) }),
      ),
    };
    const guard = new ApiKeyGuard(db as never, {} as never, {} as never, access as never);
    (guard as unknown as { verifySignature: () => void }).verifySignature = () => undefined;

    const request = {
      ip: '203.0.113.5',
      res: {},
      header: (name: string) => (name === 'authorization' ? 'ApiKey pfx.secret' : undefined),
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    const ok = await RequestContextStore.run(
      { requestId: 't', orgId: 0, actorType: 'system', actorId: null, userId: null } as never,
      () => guard.canActivate(context as never),
    );

    expect(ok).toBe(true);
    expect(access.touchLastUsed).toHaveBeenCalledWith(7, 9, 60);
  });
});
