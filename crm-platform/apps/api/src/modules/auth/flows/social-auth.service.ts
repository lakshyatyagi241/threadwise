import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type LoginResponse,
  type SocialCallbackRequest,
  type SocialProvider,
  type SocialStartQuery,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  downloadProviderAvatar,
  type DownloadedAvatar,
} from '../../../infra/providers/auth-registration-security/avatar-download';
import {
  SOCIAL_OAUTH_PROVIDERS,
  type SocialOAuthProvider,
  type SocialProfile,
} from '../../../infra/providers/auth-registration-security/social-oauth.port';
import { AuthSettingsService } from '../platform/auth-settings.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { TenantDirectory } from '../platform/tenant-directory';
import { AuthAuditService } from '../security/auth-audit.service';
import { PasswordService } from '../security/password.service';
import { randomToken } from '../support/crypto-utils';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { slugify, slugWithSuffix } from '../support/text';
import { LoginService, type ClientMeta } from './login.service';
import { SignupService } from './signup.service';

/** The provider a social failure is about, for the screen to name (`errors[].path === 'provider'`). */
const providerDetail = (provider: SocialProvider) => [{ path: 'provider', message: provider }];

interface OAuthState {
  provider: SocialProvider;
  mode: 'login' | 'signup';
  orgSlug: string | null;
  orgName: string | null;
  redirectUri: string;
}

/**
 * Google / Facebook sign-in (TW-AUTH-004), authorization-code flow.
 *
 * Differences from Reference that matter:
 *   - the OAuth `state` is single use and bound to the provider
 *   - the web origin of the redirect URI must match WEB_APP_URL
 *   - it NEVER creates a user inside an existing organization (that would let
 *     any Google account join any tenant); it links an existing, verified
 *     email, or, in signup mode, creates a brand-new organization
 *   - a Facebook email is never trusted as verified, so it cannot link
 *   - the result goes through the same MFA step-up as a password login
 *   - (provider, subject) is unique, so one social identity maps to one user
 *   - a returning identity signs in even when the provider no longer shares an email: the email is
 *     needed only to link or to create
 *   - the session is remembered (Reference always does), still subject to the "keep me signed in" policy
 *   - the provider's profile picture fills an empty avatar (stored, not linked)
 *
 * Every provider failure names the provider in `errors[]` (`path: 'provider'`) so the screen can say
 * which one failed.
 */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly webOrigin: string;
  private readonly byName: Map<string, SocialOAuthProvider>;
  /** Fetches a profile picture; replaced in tests so no real CDN is called. */
  avatarFetch: (url: string | null | undefined) => Promise<DownloadedAvatar | null> = (url) =>
    downloadProviderAvatar(url);

  constructor(
    @Inject(SOCIAL_OAUTH_PROVIDERS) providers: SocialOAuthProvider[],
    private readonly settings: AuthSettingsService,
    private readonly policy: SecurityPolicyService,
    private readonly tenants: TenantDirectory,
    private readonly db: DatabaseService,
    private readonly login: LoginService,
    private readonly signup: SignupService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = new URL(config.get('WEB_APP_URL', { infer: true })).origin;
    this.byName = new Map(providers.map((p) => [p.name, p]));
  }

  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_SOCIAL_UNAVAILABLE,
      'That sign-in method is not available.',
      HttpStatus.BAD_REQUEST,
    );
  }

  async start(provider: SocialProvider, query: SocialStartQuery): Promise<{ url: string }> {
    const adapter = this.byName.get(provider);
    const creds = await this.settings.socialCredentials(provider);
    if (!adapter || !creds) throw this.unavailable();

    if (new URL(query.redirectUri).origin !== this.webOrigin) {
      throw AppError.validation('Redirect address is not allowed', [
        { path: 'redirectUri', message: 'Origin not allowed.' },
      ]);
    }
    if (query.mode === 'login' && !query.orgSlug) {
      throw AppError.validation('Choose a workspace first', [
        { path: 'orgSlug', message: 'Required for sign-in.' },
      ]);
    }
    if (query.mode === 'signup') {
      if (!(await this.policy.registration()).publicRegistration) {
        throw new AppError(
          ERROR_CODES.AUTH_SIGNUP_CLOSED,
          'Registration is closed.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!query.orgName) {
        throw AppError.validation('Name your workspace first', [
          { path: 'orgName', message: 'Required for sign-up.' },
        ]);
      }
    }

    const state = randomToken(32);
    const payload: OAuthState = {
      provider,
      mode: query.mode,
      orgSlug: query.orgSlug ?? null,
      orgName: query.orgName ?? null,
      redirectUri: query.redirectUri,
    };
    await this.redis.setex(
      AuthKeys.socialState(state),
      Ttl.socialStateSeconds,
      JSON.stringify(payload),
    );
    return { url: adapter.authorizeUrl(creds, query.redirectUri, state) };
  }

  async callback(
    provider: SocialProvider,
    body: SocialCallbackRequest,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    // GETDEL: a state is consumed by the first callback, success or not.
    const raw = await this.redis.getdel(AuthKeys.socialState(body.state));
    const state = raw ? (JSON.parse(raw) as OAuthState) : null;
    if (!state || state.provider !== provider) {
      throw new AppError(
        ERROR_CODES.AUTH_SOCIAL_STATE_INVALID,
        'Sign-in expired. Please try again.',
        HttpStatus.BAD_REQUEST,
        providerDetail(provider),
      );
    }

    const adapter = this.byName.get(provider);
    const creds = await this.settings.socialCredentials(provider);
    if (!adapter || !creds) throw this.unavailable();

    let profile: SocialProfile;
    try {
      profile = await adapter.fetchProfile(creds, state.redirectUri, body.code);
    } catch (err) {
      this.logger.warn({ err, provider }, 'social profile fetch failed');
      throw new AppError(
        ERROR_CODES.AUTH_SOCIAL_FAILED,
        `Could not complete ${provider} sign-in. Please try again.`,
        HttpStatus.BAD_GATEWAY,
        providerDetail(provider),
      );
    }

    // Sign-up needs an address to create the account with. Sign-in does not: a returning identity is
    // found by (provider, subject), and the address matters only to link a first-time sign-in.
    if (state.mode === 'signup') {
      if (!profile.email) throw this.noEmail(provider);
      return this.completeSignup(provider, state, profile, meta, body.referralCode ?? null);
    }
    return this.completeLogin(provider, state, profile, meta);
  }

  private async completeLogin(
    provider: SocialProvider,
    state: OAuthState,
    profile: SocialProfile,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    const org = state.orgSlug ? await this.tenants.findOrgBySlug(state.orgSlug) : null;
    if (!org || org.status !== 'active') throw this.noAccount(provider);

    const found = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const byIdentity = await tx.execute(sql`
        SELECT u.id, u.uuid, u.email, u.full_name, u.status, COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM social_identities si
        JOIN users u ON u.org_id = si.org_id AND u.id = si.user_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE si.org_id = ${org.id} AND si.provider = ${provider} AND si.provider_subject = ${profile.subject}
      `);
      if (byIdentity.rows[0]) return byIdentity.rows[0];

      // First sign-in with this identity: it can only be linked through an address.
      if (!profile.email) return 'no_email' as const;
      // Link by email only when the provider vouches for the address.
      if (!profile.emailVerified) return undefined;
      const byEmail = await tx.execute(sql`
        SELECT u.id, u.uuid, u.email, u.full_name, u.status, COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM users u LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${org.id} AND u.email = ${profile.email}
      `);
      const user = byEmail.rows[0] as unknown as { id: number } | undefined;
      if (!user) return undefined;
      await tx.execute(sql`
        INSERT INTO social_identities (org_id, user_id, provider, provider_subject, email)
        VALUES (${org.id}, ${user.id}, ${provider}, ${profile.subject}, ${profile.email})
        ON CONFLICT (org_id, provider, provider_subject) DO NOTHING
      `);
      // The provider asserted the address, which is the same proof as the mail link.
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, email_verified_at) VALUES (${org.id}, ${user.id}, now())
        ON CONFLICT (org_id, user_id) DO UPDATE SET email_verified_at = COALESCE(user_security.email_verified_at, now())
      `);
      return byEmail.rows[0];
    });

    if (found === 'no_email') throw this.noEmail(provider);
    const user = found as unknown as
      | {
          id: number;
          uuid: string;
          email: string;
          full_name: string;
          status: string;
          mfa_enabled: boolean;
        }
      | undefined;
    if (!user) throw this.noAccount(provider);
    // A suspended person signs in like anyone else and is then held at the suspended screen by the
    // account gate (TW-AUTH-016), as Reference does.

    // Reference always remembers a social sign-in; the administrator's "keep me signed in" switch still wins.
    const remember = (await this.policy.policy()).rememberMeEnabled;
    // The picture is fetched while the session is being opened; it never fails the sign-in.
    const avatar = this.backfillAvatar(org.id, user.id, provider, profile.avatarUrl);

    const result = user.mfa_enabled
      ? await this.login.issueMfaChallenge({
          orgId: org.id,
          userId: user.id,
          remember,
          method: 'social',
        })
      : await this.login.completeLogin({
          org,
          user: { id: user.id, uuid: user.uuid, email: user.email, fullName: user.full_name },
          remember,
          mfaVerified: false,
          method: 'social',
          meta,
        });
    await avatar;
    return result;
  }

  private async completeSignup(
    provider: SocialProvider,
    state: OAuthState,
    profile: SocialProfile,
    meta: ClientMeta,
    referralCode: string | null,
  ): Promise<LoginResponse> {
    if (!(await this.policy.registration()).publicRegistration) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_CLOSED,
        'Registration is closed.',
        HttpStatus.FORBIDDEN,
      );
    }
    const email = profile.email!;
    const orgName = state.orgName ?? `${profile.name ?? 'My'} workspace`;
    const base = slugify(orgName);
    let slug = base;
    for (let i = 0; i < 6 && (await this.tenants.slugExists(slug)); i++)
      slug = slugWithSuffix(base);

    // Social accounts have no password; a random one nobody knows keeps the
    // password column non-null and the account unreachable by password until
    // the person uses "forgot password".
    const passwordHash = await this.passwords.hash(randomToken(36));
    const [avatar, securityPolicy] = await Promise.all([
      this.avatarFetch(profile.avatarUrl).catch(() => null),
      this.policy.policy(),
    ]);
    return this.signup.create(
      {
        orgName,
        slug,
        slugExplicit: false,
        fullName: profile.name ?? email.split('@')[0]!,
        email,
        phoneE164: null,
        passwordHash,
        // Reference dropped the referral on social sign-up (TW-AUTH-004 rule 6, TW-CPN-031 rule 4); here the callback carries it.
        referralCode,
      },
      {
        phoneVerified: false,
        emailVerified: profile.emailVerified,
        socialLink: { provider, subject: profile.subject, email },
        remember: securityPolicy.rememberMeEnabled,
        loginMethod: 'social',
        avatar,
      },
      meta,
    );
  }

  /** Stores the provider picture for an account that has none yet. Never throws. */
  private async backfillAvatar(
    orgId: number,
    userId: number,
    provider: SocialProvider,
    url: string | null,
  ): Promise<void> {
    if (!url) return;
    try {
      const existing = await this.db.txAs({ orgId, userId }, async (tx) =>
        tx.execute(sql`SELECT 1 FROM user_avatars WHERE org_id = ${orgId} AND user_id = ${userId}`),
      );
      if (existing.rows.length > 0) return;
      const avatar = await this.avatarFetch(url);
      if (!avatar) return;
      await this.db.txAs({ orgId, userId }, async (tx) => {
        // A person who uploaded one in the meantime keeps theirs.
        const stored = await tx.execute(sql`
          INSERT INTO user_avatars (org_id, user_id, mime, bytes, etag)
          VALUES (${orgId}, ${userId}, ${avatar.mime}, ${avatar.bytes}, ${avatar.etag})
          ON CONFLICT (org_id, user_id) DO NOTHING
          RETURNING 1
        `);
        if (stored.rows.length === 0) return;
        await this.audit.record(tx, {
          event: 'auth.avatar_updated',
          status: 'success',
          orgId,
          actorType: 'user',
          actorId: userId,
          recordId: userId,
          payload: { source: provider },
        });
      });
    } catch (err) {
      this.logger.warn({ err, provider }, 'social profile picture not stored');
    }
  }

  private noEmail(provider: SocialProvider): AppError {
    return new AppError(
      ERROR_CODES.AUTH_SOCIAL_NO_EMAIL,
      'That account did not share an email address. Use email and password instead.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      providerDetail(provider),
    );
  }

  private noAccount(provider: SocialProvider): AppError {
    // Deliberately vague: it must not reveal whether the workspace or the email exists.
    return new AppError(
      ERROR_CODES.AUTH_SOCIAL_NO_ACCOUNT,
      'No account matches that sign-in. Use your email and password, or ask an administrator to invite you.',
      HttpStatus.UNAUTHORIZED,
      providerDetail(provider),
    );
  }
}
