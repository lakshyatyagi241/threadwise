import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import type { Request } from 'express';
import { ERROR_CODES, EXT_SHEETS_USE_PERMISSION } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { AccountGateService, orgSuspendedError } from '../auth';
import { ApiKeyAccessService } from '../public-api';
import { SHEETS_NEEDS_KEY, capabilitiesOf, type SheetsCallerState } from './sheets-access';
import { SheetsAppAccess } from './sheets-app-access.service';
import { SheetsKeyRepository } from './sheets-key.repository';
import {
  LAST_USED_EVERY_SECONDS,
  SHEETS_AUTH_FAILURES_PER_MINUTE,
  SHEETS_CAPABILITIES,
  SHEETS_KEY_RATE_PER_MINUTE,
  bearerToken,
  hashSheetsKey,
  looksLikeSheetsKey,
  type SheetsCapability,
} from './sheets-key.rules';

export type SheetsRequest = Request & { extSheets?: SheetsCallerState };

const CAPABILITY_WORDS: Record<SheetsCapability, string> = {
  readContacts: 'read contacts',
  writeContacts: 'create or edit contacts',
  readCatalog: 'read products and shops',
  writeCatalog: 'create or edit products and shops',
};

/**
 * Authentication of the add-on API (TW-EXT-004): `Authorization: Bearer <Sheets key>` and nothing else. The Apps Script client has no session,
 * so the key is the whole identity, and everything after it follows that member:
 *
 *   1. a failed-attempt throttle per address (Reference had none), then the key's shape, then its hash against the member's row;
 *   2. the member and the workspace must be active (a suspended member or workspace gets the same answer as in the app);
 *   3. the request runs as that member: their org, their id, their live grants. The member's role must hold `app.google-sheets.use`, so
 *      taking the permission from a role stops that role's keys at once;
 *   4. the add-on must be installed and active in the workspace, and the workspace's plan must still include the Marketplace;
 *   5. a per-key rate limit (on top of the plan's API ceiling);
 *   6. the route's capabilities: the install consent must cover them AND the role must hold them.
 *
 * A wrong, revoked, replaced or unknown key all answer the same 401, so a caller cannot tell which it was.
 */
@Injectable()
export class SheetsKeyGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly keys: SheetsKeyRepository,
    private readonly rbac: RbacService,
    private readonly gates: AccountGateService,
    private readonly access: SheetsAppAccess,
    private readonly apiAccess: ApiKeyAccessService,
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SheetsRequest>();
    const ip = request.ip ?? 'unknown';
    await this.assertNotLockedOut(ip);

    const token = bearerToken(request.header('authorization'));
    if (!token) {
      throw new AppError(
        ERROR_CODES.EXT_KEY_MISSING,
        'No key provided. Send your Sheets key as "Authorization: Bearer <key>".',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const owner = looksLikeSheetsKey(token)
      ? await this.db.privileged((tx) => this.keys.findOwner(tx, hashSheetsKey(token)))
      : undefined;
    if (!owner) {
      await this.recordFailure(ip);
      throw new AppError(
        ERROR_CODES.EXT_KEY_INVALID,
        'The key is missing, revoked or replaced. Create a new one in your account.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const gate = await this.gates.stateFor(owner.orgId, owner.userId);
    if (gate.orgSuspended) throw orgSuspendedError();
    if (gate.suspended) {
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        'Your account is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }

    // From here the request is the member's own: services read org, user and grants from the context, as for a session.
    const ctx = RequestContextStore.require();
    ctx.orgId = owner.orgId;
    ctx.actorType = 'user';
    ctx.actorId = owner.userId;
    ctx.userId = owner.userId;
    ctx.ip = ip;
    const grants = await this.rbac.grantsForUser(owner.orgId, owner.userId);
    ctx.grants = grants;
    const holds = (key: string) => this.rbac.can(grants, key).allowed;
    if (!holds(EXT_SHEETS_USE_PERMISSION)) throw AppError.forbidden(EXT_SHEETS_USE_PERMISSION);

    const install = await this.access.require(owner.orgId);
    await this.apiAccess.assertPlanFeatures(context, owner.orgId);
    await this.apiAccess.enforceRateLimit(
      request.res,
      `sheets:${owner.userId}`,
      owner.orgId,
      SHEETS_KEY_RATE_PER_MINUTE,
    );

    const can = capabilitiesOf(install, holds);
    const needs = this.reflector.getAllAndOverride<SheetsCapability[] | undefined>(
      SHEETS_NEEDS_KEY,
      [context.getHandler(), context.getClass()],
    );
    for (const cap of needs ?? []) {
      if (!install.grantedScopes.includes(SHEETS_CAPABILITIES[cap].scope)) {
        throw new AppError(
          ERROR_CODES.EXT_SCOPE_NOT_GRANTED,
          `The add-on was not given permission to ${CAPABILITY_WORDS[cap]} when it was installed. An admin can reinstall it to grant that.`,
          HttpStatus.FORBIDDEN,
        );
      }
      if (!can[cap]) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          `Your role does not allow you to ${CAPABILITY_WORDS[cap]}.`,
          HttpStatus.FORBIDDEN,
        );
      }
    }

    request.extSheets = { owner, install, can, holds };
    void this.touchLastUsed(owner.orgId, owner.settingsId);
    return true;
  }

  /** Diagnostics, not correctness: a failed write is not the caller's problem, and a hot key is written at most once a minute. */
  private async touchLastUsed(orgId: number, settingsId: number): Promise<void> {
    try {
      const fresh = await this.redis.set(
        `ext:sheets:touched:${orgId}:${settingsId}`,
        '1',
        'EX',
        LAST_USED_EVERY_SECONDS,
        'NX',
      );
      if (fresh !== 'OK') return;
      await this.db.txAs({ orgId }, (tx) => this.keys.touch(tx, orgId, settingsId));
    } catch {
      // best effort
    }
  }

  private failureKey(ip: string): string {
    return `ext:sheets:authfail:${ip}`;
  }

  private async assertNotLockedOut(ip: string): Promise<void> {
    const failures = Number(await this.redis.get(this.failureKey(ip)).catch(() => 0));
    if (failures >= SHEETS_AUTH_FAILURES_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many failed attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(ip: string): Promise<void> {
    const key = this.failureKey(ip);
    const n = await this.redis.incr(key).catch(() => 0);
    if (n === 1) await this.redis.expire(key, 60).catch(() => undefined);
  }
}
