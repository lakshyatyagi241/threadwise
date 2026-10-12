import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Request } from 'express';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { ApiKeyAccessService, effectiveRateLimit } from './api-key-access.service';

// Kept exported from here for the code and tests that import it by this path.
export { effectiveRateLimit };

interface ApiKeyRow {
  org_id: number;
  id: number;
  key_hash: string;
  signing_secret_enc: string;
  scopes: string[];
  status: string;
  expires_at: Date | null;
  rate_limit_per_minute: number;
}

/**
 * Authentication for /public/v1.
 *
 * Three independent checks, in this order:
 *   1. API key     — `Authorization: ApiKey <prefix>.<secret>`, argon2-verified
 *   2. Signature   — HMAC-SHA256 over `timestamp.METHOD.path.body`
 *   3. Rate limit  — per key, per minute, in Redis
 *
 * Why a signature on top of a bearer secret: the key alone is replayable. Any
 * proxy, log line or browser extension that ever saw a request could repeat it
 * indefinitely. Binding the request to a timestamp and a body digest makes a
 * captured request useless once the window closes.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    private readonly access: ApiKeyAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    const ip = request.ip ?? 'unknown';
    await this.access.assertNotLockedOut('signed', ip);

    const header = request.header('authorization');
    if (!header?.startsWith('ApiKey ')) {
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Missing API key', 401);
    }

    const [prefix, secret] = header.slice('ApiKey '.length).trim().split('.');
    if (!prefix || !secret) {
      await this.access.recordAuthFailure('signed', ip);
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Malformed API key', 401);
    }

    const key = await this.lookupKey(prefix);
    if (!key) {
      await this.access.recordAuthFailure('signed', ip);
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Unknown API key', 401);
    }
    if (key.status !== 'active' || (key.expires_at && new Date(key.expires_at) < new Date())) {
      await this.access.recordAuthFailure('signed', ip);
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'API key is revoked or expired', 401);
    }

    const secretOk = await verify(key.key_hash, secret).catch(() => false);
    if (!secretOk) {
      await this.access.recordAuthFailure('signed', ip);
      throw new AppError(ERROR_CODES.API_KEY_INVALID, 'Invalid API key', 401);
    }

    this.verifySignature(request, key);
    await this.access.enforceRateLimit(request.res, prefix, key.org_id, key.rate_limit_per_minute);

    const ctx = RequestContextStore.require();
    ctx.orgId = key.org_id;
    ctx.actorType = 'api_key';
    ctx.actorId = key.id;
    ctx.userId = null;

    await this.access.assertPlanFeatures(context, key.org_id);

    // Fire and forget: last_used_at is diagnostics, not correctness, and it
    // must not add latency or a failure mode to every API call.
    void this.access.touchLastUsed(key.org_id, key.id);

    return true;
  }

  private verifySignature(request: Request & { rawBody?: Buffer }, key: ApiKeyRow): void {
    const signature = request.header('x-signature');
    const timestamp = request.header('x-timestamp');

    if (!signature || !timestamp) {
      throw new AppError(
        ERROR_CODES.SIGNATURE_INVALID,
        'Missing X-Signature or X-Timestamp header',
        401,
      );
    }

    const windowSeconds = this.config.get('PUBLIC_API_HMAC_WINDOW_SECONDS', { infer: true });
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > windowSeconds) {
      throw new AppError(
        ERROR_CODES.SIGNATURE_EXPIRED,
        `Request timestamp outside the ${windowSeconds}s window`,
        401,
      );
    }

    const signingSecret = this.crypto.decrypt(key.signing_secret_enc);
    const body = request.rawBody?.toString('utf8') ?? '';
    const payload = `${timestamp}.${request.method.toUpperCase()}.${request.originalUrl}.${body}`;
    const expected = createHmac('sha256', signingSecret).update(payload).digest();

    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      throw new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', 401);
    }

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new AppError(ERROR_CODES.SIGNATURE_INVALID, 'Invalid signature', 401);
    }
  }

  /**
   * Privileged by necessity: the prefix has to resolve to an org before any
   * tenant context can exist. This is one of the four sanctioned uses of
   * privileged mode (see 0007_rls_policies.sql).
   */
  private async lookupKey(prefix: string): Promise<ApiKeyRow | undefined> {
    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`
        SELECT org_id, id, key_hash, signing_secret_enc, scopes, status::text AS status,
               expires_at, rate_limit_per_minute
        FROM api_keys
        WHERE key_prefix = ${prefix} AND kind = 'signed'
        LIMIT 1
      `),
    );
    return result.rows[0] as unknown as ApiKeyRow | undefined;
  }
}
