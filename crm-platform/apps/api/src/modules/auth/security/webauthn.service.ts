import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES, type PasskeyItem, type WebauthnOptionsResponse } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlatformStore } from '../platform/platform-store';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { AuthAuditService } from './auth-audit.service';

/** Whose passkeys: a workspace member, or a platform operator. Login only needs the ids; registration also needs the label. */
export type PasskeySubject =
  { pool: 'user'; orgId: number; userId: number } | { pool: 'operator'; operatorId: number };

export interface PasskeyAccount {
  /** Shown by the authenticator ("ana@acme.test"). */
  userName: string;
  displayName: string;
}

interface CredentialRow {
  uuid: string;
  credential_id: string;
  public_key: Buffer;
  counter: string | number;
  transports: string[] | null;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  name: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

/** More than this is a collection, not a second factor, and every one is a thing to keep safe. */
export const MAX_PASSKEYS = 10;

const iso = (v: Date | string): string => new Date(v).toISOString();

/**
 * Passkeys (WebAuthn) as a second factor, for workspace members and platform operators.
 *
 * Relying-party id and origin come from WEB_APP_URL (the browser talks to the web app, which proxies here), with
 * WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS to override. Challenges live in Redis for five minutes and are single use. A
 * signature counter that does not advance marks a cloned authenticator: that sign-in is refused and audited.
 *
 * The library does the cryptography (attestation "none", we do not need to know the make of the key); this class owns
 * where things are stored, the limits, and the audit trail.
 */
@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly origins: string[];

  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    const web = new URL(config.get('WEB_APP_URL', { infer: true }));
    this.rpID = config.get('WEBAUTHN_RP_ID', { infer: true }) ?? web.hostname;
    this.rpName = config.get('APP_NAME', { infer: true });
    const extra = (config.get('WEBAUTHN_ORIGINS', { infer: true }) ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    this.origins = [...new Set([web.origin, ...extra])];
  }

  // --- storage ----------------------------------------------------------------------------------------------

  private async rows(subject: PasskeySubject): Promise<CredentialRow[]> {
    const cols = sql`uuid, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at`;
    if (subject.pool === 'user') {
      const res = await this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
        tx.execute(sql`
          SELECT ${cols} FROM webauthn_credentials
          WHERE org_id = ${subject.orgId} AND user_id = ${subject.userId} ORDER BY created_at, id
        `),
      );
      return res.rows as unknown as CredentialRow[];
    }
    const res = await this.store.tx(async (tx) =>
      tx.execute(sql`
        SELECT ${cols} FROM platform_webauthn_credentials
        WHERE operator_id = ${subject.operatorId} ORDER BY created_at, id
      `),
    );
    return res.rows as unknown as CredentialRow[];
  }

  private subjectKey(s: PasskeySubject): string {
    return s.pool === 'user' ? `${s.orgId}:${s.userId}` : String(s.operatorId);
  }

  private audited(
    s: PasskeySubject,
    event: string,
    status: 'success' | 'failure' | 'warning' | 'info',
    payload = {},
  ) {
    return this.audit.recordStandalone({
      event: s.pool === 'user' ? `auth.${event}` : `platform.auth.${event}`,
      status,
      ...(s.pool === 'user'
        ? { orgId: s.orgId, actorType: 'user' as const, actorId: s.userId, recordId: s.userId }
        : { actorType: 'platform_operator' as const, actorId: s.operatorId }),
      payload,
    });
  }

  async list(subject: PasskeySubject): Promise<PasskeyItem[]> {
    return (await this.rows(subject)).map((r) => ({
      id: r.uuid,
      name: r.name,
      createdAt: iso(r.created_at),
      lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null,
      deviceType: r.device_type,
      backedUp: r.backed_up,
      transports: r.transports ?? [],
    }));
  }

  async count(subject: PasskeySubject): Promise<number> {
    return (await this.rows(subject)).length;
  }

  // --- registration -----------------------------------------------------------------------------------------

  async registrationOptions(
    subject: PasskeySubject,
    account: PasskeyAccount,
  ): Promise<WebauthnOptionsResponse> {
    const existing = await this.rows(subject);
    if (existing.length >= MAX_PASSKEYS) throw this.limit();
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: account.userName,
      userDisplayName: account.displayName,
      // A stable opaque handle, never the email or an internal id.
      userID: new Uint8Array(
        createHash('sha256')
          .update(`passkey:${subject.pool}:${this.subjectKey(subject)}`)
          .digest(),
      ),
      attestationType: 'none',
      excludeCredentials: existing.map((r) => ({
        id: r.credential_id,
        transports: (r.transports ?? []) as AuthenticatorTransport[],
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: Ttl.webauthnChallengeSeconds * 1000,
    });
    await this.redis.setex(
      AuthKeys.webauthnRegistration(subject.pool, this.subjectKey(subject)),
      Ttl.webauthnChallengeSeconds,
      options.challenge,
    );
    return options as unknown as WebauthnOptionsResponse;
  }

  async register(
    subject: PasskeySubject,
    response: Record<string, unknown>,
    name: string,
  ): Promise<PasskeyItem> {
    const challenge = await this.redis.getdel(
      AuthKeys.webauthnRegistration(subject.pool, this.subjectKey(subject)),
    );
    if (!challenge) {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_SETUP_EXPIRED,
        'That took too long. Start again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn({ err }, 'passkey registration refused');
      throw this.invalid();
    }
    if (!verified.verified || !verified.registrationInfo) throw this.invalid();
    const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;

    if ((await this.count(subject)) >= MAX_PASSKEYS) throw this.limit();
    const transports = (credential.transports ?? []) as string[];
    // credential_id, public_key, counter, transports, device_type, backed_up, name
    const values = sql`
      ${credential.id}, ${Buffer.from(credential.publicKey)}::bytea, ${credential.counter},
      ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(transports)}::jsonb)), ${credentialDeviceType},
      ${credentialBackedUp}, ${name}
    `;
    try {
      const res =
        subject.pool === 'user'
          ? await this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
              tx.execute(sql`
                INSERT INTO webauthn_credentials
                  (org_id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
                VALUES (${subject.orgId}, ${subject.userId}, ${values})
                RETURNING uuid, name, created_at, last_used_at, device_type, backed_up, transports
              `),
            )
          : await this.store.tx(async (tx) =>
              tx.execute(sql`
                INSERT INTO platform_webauthn_credentials
                  (operator_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
                VALUES (${subject.operatorId}, ${values})
                RETURNING uuid, name, created_at, last_used_at, device_type, backed_up, transports
              `),
            );
      const row = res.rows[0] as unknown as CredentialRow;
      await this.audited(subject, 'passkey_added', 'info', { deviceType: credentialDeviceType });
      return {
        id: row.uuid,
        name: row.name,
        createdAt: iso(row.created_at),
        lastUsedAt: null,
        deviceType: row.device_type,
        backedUp: row.backed_up,
        transports: row.transports ?? [],
      };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'That passkey is already registered.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  async remove(subject: PasskeySubject, uuid: string): Promise<boolean> {
    const res =
      subject.pool === 'user'
        ? await this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
            tx.execute(sql`
              DELETE FROM webauthn_credentials
              WHERE org_id = ${subject.orgId} AND user_id = ${subject.userId} AND uuid = ${uuid}::uuid RETURNING 1
            `),
          )
        : await this.store.tx(async (tx) =>
            tx.execute(sql`
              DELETE FROM platform_webauthn_credentials
              WHERE operator_id = ${subject.operatorId} AND uuid = ${uuid}::uuid RETURNING 1
            `),
          );
    if (res.rows.length > 0) await this.audited(subject, 'passkey_removed', 'info');
    return res.rows.length > 0;
  }

  /** Two-factor was turned off: the passkeys go with it. */
  async removeAll(subject: PasskeySubject): Promise<number> {
    const res =
      subject.pool === 'user'
        ? await this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
            tx.execute(sql`
              DELETE FROM webauthn_credentials WHERE org_id = ${subject.orgId} AND user_id = ${subject.userId} RETURNING 1
            `),
          )
        : await this.store.tx(async (tx) =>
            tx.execute(sql`
              DELETE FROM platform_webauthn_credentials WHERE operator_id = ${subject.operatorId} RETURNING 1
            `),
          );
    if (res.rows.length > 0)
      await this.audited(subject, 'passkeys_removed_all', 'info', { count: res.rows.length });
    return res.rows.length;
  }

  // --- the second-factor step of sign-in ---------------------------------------------------------------

  /** `challengeKey` ties the options to one sign-in in progress (the hash of its MFA challenge token). */
  async loginOptions(
    subject: PasskeySubject,
    challengeKey: string,
  ): Promise<WebauthnOptionsResponse> {
    const rows = await this.rows(subject);
    if (rows.length === 0) throw this.invalid();
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: rows.map((r) => ({
        id: r.credential_id,
        transports: (r.transports ?? []) as AuthenticatorTransport[],
      })),
      userVerification: 'preferred',
      timeout: Ttl.webauthnChallengeSeconds * 1000,
    });
    await this.redis.setex(
      AuthKeys.webauthnLogin(challengeKey),
      Ttl.webauthnChallengeSeconds,
      options.challenge,
    );
    return options as unknown as WebauthnOptionsResponse;
  }

  /**
   * True when the assertion is valid for this person's credential and the counter advanced. The challenge is consumed first,
   * so one assertion can never be tried twice.
   */
  async verifyLogin(
    subject: PasskeySubject,
    challengeKey: string,
    response: Record<string, unknown>,
  ): Promise<boolean> {
    const challenge = await this.redis.getdel(AuthKeys.webauthnLogin(challengeKey));
    if (!challenge) return false;
    const credentialId = typeof response.id === 'string' ? response.id : '';
    const row = (await this.rows(subject)).find((r) => r.credential_id === credentialId);
    if (!row) return false;
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.counter),
          transports: (row.transports ?? []) as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn({ err }, 'passkey assertion refused');
      return false;
    }
    if (!result.verified) return false;

    const stored = Number(row.counter);
    const next = result.authenticationInfo.newCounter;
    // Authenticators that keep a counter must advance it; one that goes backwards (or stands still) was cloned or replayed.
    if ((stored > 0 || next > 0) && next <= stored) {
      await this.audited(subject, 'passkey_clone_suspected', 'warning', {
        stored,
        presented: next,
      });
      return false;
    }
    await (subject.pool === 'user'
      ? this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
          tx.execute(sql`
            UPDATE webauthn_credentials SET counter = ${next}, last_used_at = now()
            WHERE org_id = ${subject.orgId} AND credential_id = ${row.credential_id}
          `),
        )
      : this.store.tx(async (tx) =>
          tx.execute(sql`
            UPDATE platform_webauthn_credentials SET counter = ${next}, last_used_at = now()
            WHERE credential_id = ${row.credential_id}
          `),
        ));
    return true;
  }

  private invalid(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_PASSKEY_INVALID,
      'That passkey could not be verified.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private limit(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_PASSKEY_LIMIT,
      `You can register up to ${MAX_PASSKEYS} passkeys. Remove one first.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
