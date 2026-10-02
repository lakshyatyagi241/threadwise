import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { readInstEnv } from '../../../src/config/domains/install-update-licensing.env';
import { AppError } from '../../../src/common/errors/app-error';
import {
  DemoModeGuard,
  DemoSafe,
} from '../../../src/modules/install-update-licensing/demo-mode.guard';
import {
  DEMO_WRITE_ALLOWLIST,
  isWriteAllowedInDemo,
} from '../../../src/modules/install-update-licensing/demo-policy';

describe('demo policy (WD-INST-029: default-deny, exact allow-list)', () => {
  const ask = (method: string, routePath: string, demoSafe = false) =>
    isWriteAllowedInDemo({ method, routePath, demoSafe });

  it('lets every read through', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(ask(m, '/v2/contacts')).toBe(true);
  });

  it('refuses writes by default, on any API (staff, platform, public)', () => {
    expect(ask('POST', '/v2/contacts')).toBe(false);
    expect(ask('PATCH', '/v2/contacts/:id')).toBe(false);
    expect(ask('DELETE', '/v2/contacts/:id')).toBe(false);
    expect(ask('POST', '/public/v1/leads')).toBe(false);
  });

  it('closes what WaDesk left open: updater, roles and system routes are writes like any other', () => {
    expect(ask('POST', '/v2/platform/settings/senders')).toBe(false);
    expect(ask('POST', '/v2/setup/bootstrap')).toBe(false);
  });

  it('lets sign-in and session upkeep through, by exact method and path', () => {
    expect(ask('POST', '/v2/auth/login')).toBe(true);
    expect(ask('POST', '/v2/auth/refresh/')).toBe(true);
    expect(ask('POST', '/v2/auth/logout?x=1')).toBe(true);
    // same path, wrong method; and a lookalike path
    expect(ask('DELETE', '/v2/auth/login')).toBe(false);
    expect(ask('POST', '/v2/auth/login-as-anyone')).toBe(false);
  });

  it('never allow-lists anything that creates accounts or changes credentials', () => {
    const risky = [...DEMO_WRITE_ALLOWLIST].filter((r) =>
      /signup|password|mfa\/(setup|enable)|danger|register/.test(r),
    );
    expect(risky).toEqual([]);
  });

  it('honours the @DemoSafe opt-in', () => {
    expect(ask('POST', '/v2/contacts', true)).toBe(true);
  });
});

function http(
  method: string,
  path: string,
  handler: object = {},
  cls: object = class {},
): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ method, path, route: { path } }) }),
  } as unknown as ExecutionContext;
}

describe('DemoModeGuard', () => {
  const guard = (demo: boolean) =>
    new DemoModeGuard(new Reflector(), readInstEnv({ DEMO_MODE: demo ? 'true' : 'false' }));

  it('is inert when DEMO_MODE is off', () => {
    expect(guard(false).canActivate(http('DELETE', '/v2/contacts/:id'))).toBe(true);
  });

  it('refuses a blocked write with DEMO_MODE_BLOCKED (403)', () => {
    try {
      guard(true).canActivate(http('DELETE', '/v2/contacts/:id'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ERROR_CODES.DEMO_MODE_BLOCKED);
      expect((err as AppError).getStatus()).toBe(403);
    }
  });

  it('passes reads, allow-listed writes and @DemoSafe handlers', () => {
    expect(guard(true).canActivate(http('GET', '/v2/contacts'))).toBe(true);
    expect(guard(true).canActivate(http('POST', '/v2/auth/login'))).toBe(true);

    class Controller {
      @DemoSafe()
      create(): void {
        return undefined;
      }
    }
    const handler = Controller.prototype.create;
    expect(guard(true).canActivate(http('POST', '/v2/contacts', handler, Controller))).toBe(true);
  });

  it('ignores non-HTTP contexts (sockets, workers)', () => {
    const ws = { getType: () => 'ws' } as unknown as ExecutionContext;
    expect(guard(true).canActivate(ws)).toBe(true);
  });
});
