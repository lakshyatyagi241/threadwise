import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  IMPERSONATION_FORBIDDEN,
  impersonationVerdict,
  normalizeRoute,
} from '../../../src/modules/auth/guards/impersonation-rules';
import { ImpersonationGuard } from '../../../src/modules/auth/guards/impersonation.guard';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';

describe('impersonation rules (WD-WSP-033)', () => {
  it('normalizes the route the way the other path gates do', () => {
    expect(normalizeRoute('/v2/Account/Password/?x=1')).toBe('account/password');
    expect(normalizeRoute('/api/v2/account/password')).toBe('account/password');
    expect(normalizeRoute('/account/password')).toBe('account/password');
  });

  describe('forbidden for every act-as session', () => {
    const forbidden: Array<[string, string]> = [
      ['POST', '/v2/account/password'],
      ['POST', '/v2/account/email-change'],
      ['POST', '/v2/account/email-change/confirm'],
      ['POST', '/v2/account/mfa/setup'],
      ['POST', '/v2/account/mfa/enable'],
      ['POST', '/v2/account/mfa/disable'],
      ['POST', '/v2/account/mfa/recovery-codes'],
      ['GET', '/v2/account/sessions'],
      ['POST', '/v2/account/sessions/revoke-others'],
      ['DELETE', '/v2/account/sessions/3f1c'],
      ['DELETE', '/v2/account'],
      ['GET', '/v2/developer/keys'],
      ['POST', '/v2/developer/keys'],
      ['DELETE', '/v2/developer/keys/abc'],
      ['GET', '/v2/ai/provider-keys'],
      ['POST', '/v2/auth/workspaces/switch'],
      ['GET', '/v2/platform/workspaces'],
      ['POST', '/v2/platform/workspaces/abc/impersonate'],
      ['GET', '/v2/platform/auth/session'],
      ['GET', '/v2/platform'],
    ];
    it.each(forbidden)('refuses %s %s even when the session can write', (method, url) => {
      expect(impersonationVerdict(url, method, false)).toBe('forbidden');
      expect(impersonationVerdict(url, method, true)).toBe('forbidden');
    });

    it('does not catch neighbours that only share a prefix', () => {
      expect(impersonationVerdict('/v2/account/profile', 'PATCH', false)).toBe('allow');
      expect(impersonationVerdict('/v2/account/avatar', 'POST', false)).toBe('allow');
      expect(impersonationVerdict('/v2/account', 'GET', false)).toBe('allow'); // only DELETE is the account deletion
      expect(impersonationVerdict('/v2/platformer', 'GET', false)).toBe('allow');
      expect(impersonationVerdict('/v2/auth/session', 'GET', false)).toBe('allow');
    });

    it('is a plain list: every rule explains itself', () => {
      for (const rule of IMPERSONATION_FORBIDDEN) expect(rule.why.length).toBeGreaterThan(5);
    });
  });

  describe('read-only sessions', () => {
    it('allow reads and refuse every write', () => {
      for (const m of ['GET', 'HEAD', 'OPTIONS']) {
        expect(impersonationVerdict('/v2/contacts', m, true)).toBe('allow');
      }
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(impersonationVerdict('/v2/contacts', m, true)).toBe('read_only');
      }
      expect(impersonationVerdict('/v2/contacts', 'post', true)).toBe('read_only');
    });

    it('can still stop themselves, and nothing else is exempt', () => {
      expect(impersonationVerdict('/v2/auth/impersonation/stop', 'POST', true)).toBe('allow');
      expect(impersonationVerdict('/v2/auth/impersonation/stop/', 'POST', true)).toBe('allow');
      expect(impersonationVerdict('/v2/auth/impersonation/redeem', 'POST', true)).toBe('read_only');
    });

    it('leave a write session free to write outside the forbidden list', () => {
      expect(impersonationVerdict('/v2/contacts', 'POST', false)).toBe('allow');
    });
  });
});

describe('ImpersonationGuard', () => {
  const guard = new ImpersonationGuard();
  const http = (method: string, url: string) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url }) }),
    }) as unknown as ExecutionContext;
  const ctxOf = (impersonation?: RequestContext['impersonation']): RequestContext => ({
    requestId: 'r',
    orgId: 1,
    actorType: 'user',
    actorId: 1,
    userId: 1,
    impersonation,
  });
  const session = (readOnly: boolean) => ({
    sessionId: 's',
    operatorId: 9,
    operatorUuid: 'u',
    readOnly,
    expiresAt: new Date(Date.now() + 60_000),
  });

  it('does nothing for a request that is not impersonating', () => {
    RequestContextStore.run(ctxOf(), () => {
      expect(guard.canActivate(http('DELETE', '/v2/account'))).toBe(true);
    });
  });

  it('answers WSP_IMPERSONATION_READ_ONLY (403) to a write in a read-only session', () => {
    RequestContextStore.run(ctxOf(session(true)), () => {
      expect(() => guard.canActivate(http('POST', '/v2/contacts'))).toThrowError(
        expect.objectContaining({ code: 'WSP_IMPERSONATION_READ_ONLY', status: 403 }),
      );
      expect(guard.canActivate(http('GET', '/v2/contacts'))).toBe(true);
    });
  });

  it('answers WSP_IMPERSONATION_FORBIDDEN (403) to the owner-only routes, read-only or not', () => {
    for (const ro of [true, false]) {
      RequestContextStore.run(ctxOf(session(ro)), () => {
        expect(() => guard.canActivate(http('POST', '/v2/account/password'))).toThrowError(
          expect.objectContaining({ code: 'WSP_IMPERSONATION_FORBIDDEN', status: 403 }),
        );
      });
    }
  });
});
