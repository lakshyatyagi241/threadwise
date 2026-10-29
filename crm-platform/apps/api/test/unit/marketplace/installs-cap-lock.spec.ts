import { describe, expect, it, vi } from 'vitest';
import type { InstallAppInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { InstallationsService } from '../../../src/modules/marketplace/installations.service';
import { miniAppManifest } from './fixtures';

/**
 * #1291: the installed-apps cap is counted again inside the insert transaction, after the workspace's limit lock is taken. The early
 * check outside the transaction reads the same count for two concurrent installs, so the transaction is what has to refuse the second.
 * These tests check the order and the decision with fakes; the concurrent case is a database test (not run here).
 */

const INSTALL: InstallAppInput = {
  acceptedScopes: ['contacts.read', 'deals.read'],
  credentials: {},
} as InstallAppInput;

function build(opts: { cap: number; installed: number }) {
  const order: string[] = [];
  const target = {
    appId: 11,
    appUuid: '11111111-1111-4111-8111-111111111111',
    versionId: 21,
    slug: 'quote-panel',
    name: 'Quote panel',
    kind: 'mini_app',
    version: '1.0.0',
    scopes: ['contacts.read', 'deals.read'],
    manifest: miniAppManifest(),
    recipe: null,
    pricing: { model: 'free' },
    sub: null,
    planFeature: null,
  };
  const insert = vi.fn(async () => {
    order.push('insert');
    throw new Error('stop after insert');
  });
  const lockLimit = vi.fn(async () => {
    order.push('lock');
  });
  const installedCount = vi.fn(async () => {
    order.push('count');
    return opts.installed;
  });
  const db = { tx: async (fn: (tx: unknown) => unknown) => fn({}) };
  const service = new InstallationsService(
    db as never,
    {
      byAppId: async () => null,
      insert,
      insertConsent: async () => undefined,
      byId: async () => null,
    } as never,
    {
      installable: async () => target,
      exists: async () => true,
      installedCount,
    } as never,
    { evaluator: async () => async () => null } as never,
    {
      limit: async () => opts.cap,
      lockLimit,
    } as never,
    {} as never,
    {} as never,
    { record: async () => undefined } as never,
    { emit: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      visibility: async () => ({}),
      evaluator: async () => async () => ({ access: 'included' }),
    } as never,
    {} as never,
    { get: () => 'https://app.example.test' } as never,
  );
  return { service, order, insert, lockLimit, installedCount };
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: 'r',
      orgId: 7,
      actorType: 'user',
      actorId: 3,
      userId: 3,
      grants: Object.assign(new Map(), {
        get: () => ({ effect: 'allow', scope: 'all' }),
      }) as never,
    },
    fn,
  );

describe('#1291 installed-apps cap is enforced under the limit lock', () => {
  it('refuses the install when the count taken under the lock has reached the cap, and inserts nothing', async () => {
    const { service, order, insert, lockLimit, installedCount } = build({ cap: 1, installed: 1 });
    const err = await run(() => service.install('quote-panel', INSTALL)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('PLAN_LIMIT_REACHED');
    expect(lockLimit).toHaveBeenCalledWith(expect.anything(), 7, 'installed_apps');
    expect(installedCount).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // The early check outside the transaction counts too; the decision that matters is the last count, taken under the lock.
    expect(order.slice(-2)).toEqual(['lock', 'count']);
  });

  it('takes the lock before it counts, and counts before it inserts, when there is room', async () => {
    const { service, order, insert } = build({ cap: 2, installed: 1 });
    await expect(run(() => service.install('quote-panel', INSTALL))).rejects.toThrow(
      'stop after insert',
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(order.slice(-3)).toEqual(['lock', 'count', 'insert']);
  });

  it('an unlimited plan (cap 0) is never refused by the count', async () => {
    const { service, insert } = build({ cap: 0, installed: 50 });
    await expect(run(() => service.install('quote-panel', INSTALL))).rejects.toThrow(
      'stop after insert',
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
