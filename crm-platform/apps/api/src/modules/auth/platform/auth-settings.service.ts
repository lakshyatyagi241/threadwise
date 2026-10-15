import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import {
  AUTH_PAGE_EXTRA_KEYS,
  type AuthPageContent,
  type AuthPageName,
  type AuthPagesPatch,
  type AuthPagesResponse,
  type PlatformBrandingFooterResponse,
  type RegistrationConfigResponse,
  type SocialCaptchaSettingsPatch,
  type SocialCaptchaSettingsResponse,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import type { CaptchaConfig } from '../../../infra/providers/auth-registration-security/captcha.port';
import type {
  SocialCredentials,
  SocialProviderName,
} from '../../../infra/providers/auth-registration-security/social-oauth.port';
import {
  PLATFORM_FOOTER_SETTING,
  bustFooterCache,
  capFooter,
  platformFooterFrom,
  readSavedPlatformFooter,
} from '../security/branding-footer.service';
import { PlatformSettingsService } from './platform-settings.service';
import { RegistrationOtpService } from './registration-otp.service';
import { SecurityPolicyService } from './security-policy.service';

interface SocialDoc {
  enabled?: boolean;
  clientId?: string;
}
interface CaptchaDoc {
  enabled?: boolean;
  version?: 'v2' | 'v3';
  siteKey?: string;
  v3Threshold?: number;
}
interface PagesDoc {
  variant?: number;
  login?: AuthPageContent;
  register?: AuthPageContent;
  forgot?: AuthPageContent;
  extra?: {
    login?: Record<string, string>;
    register?: Record<string, string>;
    forgot?: Record<string, string>;
  };
}

/** What kind of media a URL points at, from its path: mp4/webm/... are video, .gif is a gif, the rest an image. */
export function guessMediaType(url: string): 'image' | 'gif' | 'video' {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // not an absolute URL: judge the raw text
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext && ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
  return ext === 'gif' ? 'gif' : 'image';
}

const SECRET_KEYS = {
  google: 'social.google.secret',
  facebook: 'social.facebook.secret',
  recaptcha: 'recaptcha.secret',
} as const;

/** Original defaults, used whenever a field is empty (clearing a field restores these). */
const PAGE_DEFAULTS: Record<
  AuthPageName,
  Required<Pick<AuthPageContent, 'eyebrow' | 'heading' | 'headingAccent' | 'subheading' | 'accent'>>
> = {
  login: {
    eyebrow: 'Team inbox for WhatsApp',
    heading: 'Every customer chat,',
    headingAccent: 'one calm workspace',
    subheading: 'Broadcasts, automations and a shared inbox for teams that answer fast.',
    accent: '#25D366',
  },
  register: {
    eyebrow: 'Start in minutes',
    heading: 'Set up your',
    headingAccent: 'workspace',
    subheading: 'Create your workspace, then bring your team and your first channel in.',
    accent: '#25D366',
  },
  forgot: {
    eyebrow: 'Account recovery',
    heading: 'Back in',
    headingAccent: 'a minute',
    subheading: 'Enter your email and we will send you a secure link to choose a new password.',
    accent: '#25D366',
  },
};

/**
 * Social sign-in, reCAPTCHA and auth-page copy: the guest-facing platform
 * settings of TW-AUTH-021/022/023, plus the public projection the guest pages
 * read. Secrets are write-only; responses carry only `hasSecret`.
 */
@Injectable()
export class AuthSettingsService {
  private readonly appName: string;

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly policy: SecurityPolicyService,
    private readonly otp: RegistrationOtpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  // --- reCAPTCHA ----------------------------------------------------------------

  /** null unless the toggle AND the site key AND the secret are all present. */
  async captchaConfig(): Promise<(CaptchaConfig & { siteKey: string }) | null> {
    const doc = (await this.settings.get<CaptchaDoc>('recaptcha')) ?? {};
    const secret = await this.settings.getSecret(SECRET_KEYS.recaptcha);
    if (!doc.enabled || !doc.siteKey || !secret) return null;
    return {
      version: doc.version === 'v3' ? 'v3' : 'v2',
      siteKey: doc.siteKey,
      secret,
      threshold: doc.v3Threshold ?? 0.5,
    };
  }

  // --- social ----------------------------------------------------------------------

  async socialCredentials(provider: SocialProviderName): Promise<SocialCredentials | null> {
    const doc = (await this.settings.get<SocialDoc>(`social.${provider}`)) ?? {};
    const secret = await this.settings.getSecret(SECRET_KEYS[provider]);
    if (!doc.enabled || !doc.clientId || !secret) return null;
    return { clientId: doc.clientId, clientSecret: secret };
  }

  async getSocialCaptchaSettings(): Promise<SocialCaptchaSettingsResponse> {
    const [g, f, c] = await Promise.all([
      this.settings.get<SocialDoc>('social.google'),
      this.settings.get<SocialDoc>('social.facebook'),
      this.settings.get<CaptchaDoc>('recaptcha'),
    ]);
    const [gs, fs, cs] = await Promise.all([
      this.settings.hasSecret(SECRET_KEYS.google),
      this.settings.hasSecret(SECRET_KEYS.facebook),
      this.settings.hasSecret(SECRET_KEYS.recaptcha),
    ]);
    const provider = (d: SocialDoc | undefined, hasSecret: boolean) => ({
      enabled: d?.enabled === true,
      clientId: d?.clientId ?? '',
      hasSecret,
      live: d?.enabled === true && Boolean(d?.clientId) && hasSecret,
    });
    return {
      google: provider(g, gs),
      facebook: provider(f, fs),
      recaptcha: {
        enabled: c?.enabled === true,
        version: c?.version === 'v3' ? 'v3' : 'v2',
        siteKey: c?.siteKey ?? '',
        hasSecret: cs,
        v3Threshold: c?.v3Threshold ?? 0.5,
        live: c?.enabled === true && Boolean(c?.siteKey) && cs,
      },
    };
  }

  /**
   * Partial update. A blank or omitted secret keeps the stored one, so saving
   * the form can never wipe a working credential.
   */
  async patchSocialCaptchaSettings(
    patch: SocialCaptchaSettingsPatch,
    operatorId: number,
  ): Promise<string[]> {
    const changed: string[] = [];

    for (const name of ['google', 'facebook'] as const) {
      const p = patch[name];
      if (!p) continue;
      const current = (await this.settings.get<SocialDoc>(`social.${name}`)) ?? {};
      const next: SocialDoc = {
        enabled: p.enabled ?? current.enabled ?? false,
        clientId: p.clientId !== undefined ? p.clientId.trim() : (current.clientId ?? ''),
      };
      await this.settings.set(`social.${name}`, next, operatorId);
      changed.push(`social.${name}`);
      if (p.clearSecret) {
        await this.settings.clearSecret(SECRET_KEYS[name]);
        changed.push(`social.${name}.secret_cleared`);
      } else if (p.clientSecret && p.clientSecret.trim()) {
        await this.settings.setSecret(SECRET_KEYS[name], p.clientSecret.trim(), operatorId);
        changed.push(`social.${name}.secret`);
      }
    }

    if (patch.recaptcha) {
      const p = patch.recaptcha;
      const current = (await this.settings.get<CaptchaDoc>('recaptcha')) ?? {};
      const next: CaptchaDoc = {
        enabled: p.enabled ?? current.enabled ?? false,
        version: p.version ?? current.version ?? 'v2',
        siteKey: p.siteKey !== undefined ? p.siteKey.trim() : (current.siteKey ?? ''),
        // A stored 0 is read back as the 0.5 default, so do not store a blank as 0.
        v3Threshold: p.v3Threshold ?? current.v3Threshold ?? 0.5,
      };
      await this.settings.set('recaptcha', next, operatorId);
      changed.push('recaptcha');
      if (p.clearSecret) {
        await this.settings.clearSecret(SECRET_KEYS.recaptcha);
        changed.push('recaptcha.secret_cleared');
      } else if (p.secret && p.secret.trim()) {
        await this.settings.setSecret(SECRET_KEYS.recaptcha, p.secret.trim(), operatorId);
        changed.push('recaptcha.secret');
      }
    }
    return changed;
  }

  // --- auth pages ---------------------------------------------------------------------

  async getAuthPages(): Promise<AuthPagesResponse> {
    return this.projectPages((await this.settings.get<PagesDoc>('auth.pages')) ?? {});
  }

  private projectPages(doc: PagesDoc): AuthPagesResponse {
    const variant = doc.variant && doc.variant >= 1 && doc.variant <= 6 ? doc.variant : 6;
    return {
      defaults: {
        login: PAGE_DEFAULTS.login,
        register: PAGE_DEFAULTS.register,
        forgot: PAGE_DEFAULTS.forgot,
      },
      variant,
      login: doc.login ?? {},
      register: doc.register ?? {},
      forgot: doc.forgot ?? {},
      extra: {
        login: doc.extra?.login ?? {},
        register: doc.extra?.register ?? {},
        forgot: doc.extra?.forgot ?? {},
      },
    };
  }

  /**
   * Edits are applied to the stored document under a row lock, so two operators
   * saving different pages at once both land: a read-modify-write outside the
   * lock would let the later save put back what the earlier one changed.
   */
  async patchAuthPages(patch: AuthPagesPatch, operatorId: number): Promise<AuthPagesResponse> {
    return this.settings.updateDocument<AuthPagesResponse>(
      'auth.pages',
      (stored) => {
        const current = this.projectPages(stored as PagesDoc);
        const next: AuthPagesResponse = {
          ...current,
          extra: {
            login: { ...current.extra.login },
            register: { ...current.extra.register },
            forgot: { ...current.extra.forgot },
          },
        };
        if (patch.variant) next.variant = patch.variant;

        for (const page of ['login', 'register', 'forgot'] as const) {
          const p = patch[page];
          if (!p) continue;
          // Empty string clears a field (the public projection then shows the default).
          const merged: AuthPageContent = { ...current[page] };
          for (const [k, v] of Object.entries(p)) {
            const key = k as keyof AuthPageContent;
            if (v === undefined) continue;
            if (v === '') delete merged[key];
            else (merged as Record<string, unknown>)[key] = v;
          }
          if (p.mediaUrl === '') {
            // No address, no kind: a leftover "video" must not follow the next address.
            delete merged.mediaType;
          } else if (p.mediaUrl !== undefined && p.mediaType === undefined) {
            // A new address without a stated kind: the old kind describes the old file.
            merged.mediaType = guessMediaType(p.mediaUrl);
          }
          next[page] = merged;
        }

        for (const page of patch.clearMedia ?? []) {
          const merged = { ...next[page] };
          delete merged.mediaUrl;
          delete merged.mediaType;
          next[page] = merged;
        }

        for (const page of ['login', 'register', 'forgot'] as const) {
          const extra = patch.extra?.[page];
          if (!extra) continue;
          const target = next.extra[page] ?? (next.extra[page] = {});
          for (const [k, v] of Object.entries(extra)) {
            if (!(AUTH_PAGE_EXTRA_KEYS as readonly string[]).includes(k)) {
              throw AppError.validation('Unknown auth page field', [
                { path: `extra.${page}.${k}`, message: 'Unknown field' },
              ]);
            }
            if (v === '') delete target[k];
            else target[k] = v;
          }
        }

        // The shipped defaults are code, not stored state.
        const { defaults: _defaults, ...doc } = next;
        void _defaults;
        return { next: doc, result: next };
      },
      operatorId,
    );
  }

  // --- platform message footer (TW-AUTH-029) --------------------------------------------------

  /** The footer workspaces on plans that cannot remove branding send with every text message. */
  async getPlatformBrandingFooter(): Promise<PlatformBrandingFooterResponse> {
    const saved = await readSavedPlatformFooter(this.settings);
    return {
      footer: platformFooterFrom(saved, this.appName) ?? '',
      isDefault: saved === undefined || saved === null,
    };
  }

  /** Blank is allowed and means no platform footer. Takes effect on the next send, everywhere. */
  async setPlatformBrandingFooter(
    footer: string,
    operatorId: number,
  ): Promise<{ before: string | null; after: string | null }> {
    const saved = await readSavedPlatformFooter(this.settings);
    const before = platformFooterFrom(saved, this.appName);
    const text = capFooter(footer);
    await this.settings.set(PLATFORM_FOOTER_SETTING, text, operatorId);
    await bustFooterCache(this.redis);
    return { before, after: text || null };
  }

  // --- public projection (guest pages) -----------------------------------------------------

  async publicConfig(): Promise<RegistrationConfigResponse> {
    const [registration, security, pages, captcha, google, facebook] = await Promise.all([
      this.policy.registration(),
      this.policy.policy(),
      this.getAuthPages(),
      this.captchaConfig(),
      this.socialCredentials('google'),
      this.socialCredentials('facebook'),
    ]);

    const TEXT_FIELDS = ['eyebrow', 'heading', 'headingAccent', 'subheading'] as const;
    const defaulted = (name: AuthPageName) => TEXT_FIELDS.filter((f) => !pages[name][f]);

    const resolve = (name: AuthPageName): AuthPageContent => {
      const d = PAGE_DEFAULTS[name];
      const c = pages[name];
      return {
        eyebrow: c.eyebrow || d.eyebrow,
        heading: c.heading || d.heading,
        headingAccent: c.headingAccent || d.headingAccent,
        subheading: c.subheading || d.subheading,
        accent: c.accent || d.accent,
        ...(c.mediaUrl ? { mediaUrl: c.mediaUrl, mediaType: c.mediaType ?? 'image' } : {}),
      };
    };

    return {
      appName: this.appName,
      registrationOpen: registration.publicRegistration,
      emailVerification: registration.emailVerification,
      trialDays: registration.trialDays,
      rememberMeEnabled: security.rememberMeEnabled,
      otp: { enabled: (await this.otp.statusFor(registration)).active },
      businessEmailOnly: registration.businessEmailOnly,
      phoneRequired: registration.requirePhoneVerification,
      captcha: captcha ? { version: captcha.version, siteKey: captcha.siteKey } : null,
      social: { google: google !== null, facebook: facebook !== null },
      defaultCountryIso: registration.defaultCountryIso,
      authPages: {
        variant: pages.variant,
        login: resolve('login'),
        register: resolve('register'),
        forgot: resolve('forgot'),
        defaulted: {
          login: defaulted('login'),
          register: defaulted('register'),
          forgot: defaulted('forgot'),
        },
        extra: { ...pages.extra, forgot: pages.extra.forgot ?? {} },
      },
      links: {
        terms: registration.termsUrl,
        privacy: registration.privacyUrl,
        cookies: registration.cookiesUrl,
      },
    };
  }
}
