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

interface OAuthState {
  provider: SocialProvider;
  mode: 'login' | 'signup';
  orgSlug: string | null;
  orgName: string | null;
  redirectUri: string;
}

/**
 * Google / Facebook sign-in (WD-AUTH-004), authorization-code flow.
 *
 * Differences from WaDesk that matter:
 *   - the OAuth `state` is single use and bound to the provider
 *   - the web origin of the redirect URI must match WEB_APP_URL
 *   - it NEVER creates a user inside an existing organization (that would let
 *     any Google account join any tenant); it links an existing, verified
 *     email, or, in signup mode, creates a brand-new organization
 *   - a Facebook email is never trusted as verified, so it cannot link
 *   - the result goes through the same MFA step-up as a password login
 *   - (provider, subject) is unique, so one social identity maps to one user
 */
@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly webOrigin: string;
  private readonly byName: Map<string, SocialOAuthProvider>;

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
      );
    }
    if (!profile.email) {
      throw new AppError(
        ERROR_CODES.AUTH_SOCIAL_NO_EMAIL,
        'That account did not share an email address. Use email and password instead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return state.mode === 'signup'
      ? this.completeSignup(provider, state, profile, meta)
      : this.completeLogin(provider, state, profile, meta);
  }

  private async completeLogin(
    provider: SocialProvider,
    state: OAuthState,
    profile: SocialProfile,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    const org = state.orgSlug ? await this.tenants.findOrgBySlug(state.orgSlug) : null;
    if (!org || org.status !== 'active') throw this.noAccount();

    const found = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const byIdentity = await tx.execute(sql`
        SELECT u.id, u.uuid, u.email, u.full_name, u.status, COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM social_identities si
        JOIN users u ON u.org_id = si.org_id AND u.id = si.user_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE si.org_id = ${org.id} AND si.provider = ${provider} AND si.provider_subject = ${profile.subject}
      `);
      if (byIdentity.rows[0]) return byIdentity.rows[0];

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
    if (!user) throw this.noAccount();
    if (user.status !== 'active') {
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        'Your account is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.mfa_enabled) {
      return this.login.issueMfaChallenge({
        orgId: org.id,
        userId: user.id,
        remember: false,
        method: 'social',
      });
    }
    return this.login.completeLogin({
      org,
      user: { id: user.id, uuid: user.uuid, email: user.email, fullName: user.full_name },
      remember: false,
      mfaVerified: false,
      method: 'social',
      meta,
    });
  }

  private async completeSignup(
    provider: SocialProvider,
    state: OAuthState,
    profile: SocialProfile,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    if (!(await this.policy.registration()).publicRegistration) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_CLOSED,
        'Registration is closed.',
        HttpStatus.FORBIDDEN,
      );
    }
    const orgName = state.orgName ?? `${profile.name ?? 'My'} workspace`;
    const base = slugify(orgName);
    let slug = base;
    for (let i = 0; i < 6 && (await this.tenants.slugExists(slug)); i++)
      slug = slugWithSuffix(base);

    // Social accounts have no password; a random one nobody knows keeps the
    // password column non-null and the account unreachable by password until
    // the person uses "forgot password".
    const passwordHash = await this.passwords.hash(randomToken(36));
    const result = await this.signup.create(
      {
        orgName,
        slug,
        fullName: profile.name ?? profile.email!.split('@')[0]!,
        email: profile.email!,
        phoneE164: null,
        passwordHash,
        referralCode: null,
      },
      {
        phoneVerified: false,
        emailVerified: profile.emailVerified,
        socialLink: { provider, subject: profile.subject, email: profile.email },
      },
      meta,
    );
    return result;
  }

  private noAccount(): AppError {
    // Deliberately vague: it must not reveal whether the workspace or the email exists.
    return new AppError(
      ERROR_CODES.AUTH_SOCIAL_FAILED,
      'No account matches that sign-in. Use your email and password, or ask an administrator to invite you.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
