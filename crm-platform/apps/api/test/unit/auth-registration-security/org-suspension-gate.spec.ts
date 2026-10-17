import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { AccountGateGuard } from '../../../src/modules/auth/guards/account-gate.guard';
import { suspendedPathAllowed } from '../../../src/modules/auth/guards/suspended-paths';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';

const ctx = (over: Partial<RequestContext> & Record<string, unknown> = {}) =>
  ({
    requestId: 'r',
    orgId: 7,
    actorType: 'user',
    actorId: 1,
    userId: 1,
    ...over,
  }) as RequestContext;

const activeUser = {
  suspended: false,
  emailUnverified: false,
  emailBlocking: false,
  mfaEnrolmentRequired: false,
  passwordChangeRequired: false,
  mfaEnabled: false,
  isAdmin: false,
  isOwner: true,
};

function guardFor(opts: { suspended: boolean; routeOpts?: { suspended?: boolean } }) {
  const orgs = { isSuspended: vi.fn().mockResolvedValue(opts.suspended) };
  const gates = { stateFor: vi.fn().mockResolvedValue(activeUser) };
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === 'auth:allow-while-gated' ? opts.routeOpts : false,
    ),
  };
  const guard = new AccountGateGuard(reflector as never, gates as never, orgs as never);
  const run = (url: string, method: string, c: RequestContext) =>
    RequestContextStore.run(c, () =>
      guard.canActivate({
        getType: () => 'http',
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, url, method }) }),
      } as never),
    );
  return { run, orgs, gates };
}

describe('suspended workspace gate', () => {
  it('blocks a member of a suspended workspace with the stable code', async () => {
    const { run } = guardFor({ suspended: true });
    const err = await run('/api/v2/contacts', 'GET', ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.WSP_ORG_SUSPENDED);
    expect((err as AppError).getStatus()).toBe(403);
  });

  it('blocks partner agents and API keys of the workspace too', async () => {
    const { run } = guardFor({ suspended: true });
    await expect(
      run('/v2/contacts', 'GET', ctx({ actorType: 'partner_agent', userId: null })),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      run('/v2/contacts', 'POST', ctx({ actorType: 'api_key', userId: null })),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('lets the allow-listed paths through without even asking the status', async () => {
    const { run, orgs } = guardFor({ suspended: true });
    await expect(run('/api/v2/support/tickets', 'POST', ctx())).resolves.toBe(true);
    await expect(run('/v2/auth/logout', 'POST', ctx())).resolves.toBe(true);
    await expect(run('/v2/billing/invoices', 'GET', ctx())).resolves.toBe(true);
    expect(orgs.isSuspended).not.toHaveBeenCalled();
  });

  it('billing is read-only while suspended', async () => {
    const { run } = guardFor({ suspended: true });
    await expect(run('/v2/billing/checkout', 'POST', ctx())).rejects.toBeInstanceOf(AppError);
  });

  it('lets a route marked allow-while-suspended through', async () => {
    const { run } = guardFor({ suspended: true, routeOpts: { suspended: true } });
    await expect(run('/v2/auth/session', 'GET', ctx())).resolves.toBe(true);
  });

  it('passes an active workspace', async () => {
    const { run } = guardFor({ suspended: false });
    await expect(run('/v2/contacts', 'GET', ctx())).resolves.toBe(true);
  });

  it('asks Redis about the workspace once per request, not again inside the gate state', async () => {
    const { run, orgs, gates } = guardFor({ suspended: false });
    await expect(run('/v2/contacts', 'GET', ctx())).resolves.toBe(true);
    expect(orgs.isSuspended).toHaveBeenCalledTimes(1);
    expect(gates.stateFor).toHaveBeenCalledWith(7, 1, { includeOrgSuspension: false });
  });

  it('never gates a platform operator', async () => {
    const { run, orgs } = guardFor({ suspended: true });
    await expect(
      run(
        '/v2/platform/workspaces',
        'GET',
        ctx({ actorType: 'platform_operator', orgId: 0, userId: null }),
      ),
    ).resolves.toBe(true);
    expect(orgs.isSuspended).not.toHaveBeenCalled();
  });

  it('lets an operator impersonation session through', async () => {
    const { run } = guardFor({ suspended: true });
    await expect(
      run(
        '/v2/contacts',
        'GET',
        ctx({
          impersonation: {
            sessionId: '00000000-0000-4000-8000-000000000001',
            operatorId: 3,
            operatorUuid: '00000000-0000-4000-8000-000000000002',
            readOnly: false,
            expiresAt: new Date('2099-01-01T00:00:00Z'),
          },
        }),
      ),
    ).resolves.toBe(true);
  });
});

describe('suspended path allow-list', () => {
  it.each([
    ['/v2/support/tickets/abc', 'GET', true],
    ['/api/v2/auth/session', 'GET', true],
    ['/v2/account/profile', 'GET', true],
    ['/v2/account/profile', 'PATCH', false],
    ['/v2/contacts', 'GET', false],
    ['/v2/broadcasts', 'POST', false],
    ['/', 'GET', false],
  ])('%s %s -> %s', (url, method, allowed) => {
    expect(suspendedPathAllowed(url, method)).toBe(allowed);
  });
});

describe('AccountGateService.stateFor and the workspace lookup', () => {
  function build() {
    const own = JSON.stringify({ ...activeUser });
    const redis = { get: vi.fn(async () => own), setex: vi.fn() };
    const orgs = { isSuspended: vi.fn().mockResolvedValue(true) };
    const svc = new AccountGateService({} as never, {} as never, redis as never, orgs as never);
    return { svc, orgs };
  }

  it('includes the workspace verdict by default (the flags a login returns need it)', async () => {
    const { svc, orgs } = build();
    expect(await svc.stateFor(7, 1)).toMatchObject({ orgSuspended: true });
    expect(orgs.isSuspended).toHaveBeenCalledTimes(1);
  });

  it('skips the workspace lookup when the caller says it has made it', async () => {
    const { svc, orgs } = build();
    const state = await svc.stateFor(7, 1, { includeOrgSuspension: false });
    expect(orgs.isSuspended).not.toHaveBeenCalled();
    expect(state).toEqual(activeUser);
    expect('orgSuspended' in state).toBe(false);
  });
});

describe('OrgSuspensionService cache', () => {
  function build(status: string) {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      setex: vi.fn(async (k: string, _t: number, v: string) => void store.set(k, v)),
      del: vi.fn(async (k: string) => void store.delete(k)),
    };
    const state = { status };
    const db = {
      txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ status: state.status }] }) }),
      ),
    };
    return { svc: new OrgSuspensionService(db as never, redis as never), db, redis, state };
  }

  it('reads the database once per window and caches the verdict', async () => {
    const { svc, db } = build('suspended');
    expect(await svc.isSuspended(7)).toBe(true);
    expect(await svc.isSuspended(7)).toBe(true);
    expect(db.txAs).toHaveBeenCalledTimes(1);
  });

  it('unsuspend takes effect right after invalidate', async () => {
    const { svc, state } = build('suspended');
    expect(await svc.isSuspended(7)).toBe(true);
    state.status = 'active';
    expect(await svc.isSuspended(7)).toBe(true); // still cached
    await svc.invalidate(7);
    expect(await svc.isSuspended(7)).toBe(false);
  });

  it('assertActive throws WSP_ORG_SUSPENDED and fails open on a database error', async () => {
    const { svc } = build('suspended');
    await expect(svc.assertActive(7)).rejects.toMatchObject({
      code: ERROR_CODES.WSP_ORG_SUSPENDED,
    });
    const broken = new OrgSuspensionService(
      {
        txAs: async () => {
          throw new Error('db down');
        },
      } as never,
      { get: async () => null, setex: async () => undefined } as never,
    );
    expect(await broken.isSuspended(7)).toBe(false);
  });

  it('ignores the platform pseudo-organization', async () => {
    const { svc, db } = build('suspended');
    expect(await svc.isSuspended(0)).toBe(false);
    expect(db.txAs).not.toHaveBeenCalled();
  });
});
