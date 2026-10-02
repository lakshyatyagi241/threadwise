import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { BRANDING_FOOTER_MAX } from '@crm/contracts';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { PlatformSettingsService } from '../platform/platform-settings.service';

/** The platform default footer setting (WaDesk: `platform_branding_footer`). */
export const PLATFORM_FOOTER_SETTING = 'platform.branding_footer';

/** Redis keys that version the cached footers. Bumping one drops every cached entry it covers. */
export const FooterKeys = {
  org: (orgId: number) => `auth:footer-v:${orgId}`,
  platform: 'auth:footer-v:platform',
} as const;

/**
 * Drops cached footers across every process: one workspace's, or (with no
 * `orgId`) all of them because the platform default changed. Callers run it
 * after their transaction commits; a failure is not an error because the cache
 * also expires on its own within `CACHE_MS`.
 */
export async function bustFooterCache(redis: Redis, orgId?: number): Promise<void> {
  try {
    await redis.incr(orgId === undefined ? FooterKeys.platform : FooterKeys.org(orgId));
  } catch {
    // the entry expires by itself
  }
}

/** How long a resolved footer is trusted without a version check failing: plan changes have no event. */
const CACHE_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;

/** Trimmed and cut to the limit in characters, not UTF-16 units: an emoji is one. */
export function capFooter(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length > BRANDING_FOOTER_MAX
    ? chars.slice(0, BRANDING_FOOTER_MAX).join('')
    : chars.join('');
}

/** The platform default from its saved value: never saved = "Sent via <app>", saved blank = none. */
export function platformFooterFrom(saved: unknown, appName: string): string | null {
  const text = saved === undefined || saved === null ? `Sent via ${appName}` : String(saved);
  return capFooter(text) || null;
}

/**
 * The resolution table in one place, so the send path and the screen that
 * previews it can never disagree: a plan that cannot remove branding always
 * gets the platform footer; one that can gets its own text, and nothing saved
 * (or blank) means no footer at all.
 */
export function pickFooter(input: {
  removesBranding: boolean;
  own: string | null | undefined;
  platform: string | null;
}): string | null {
  if (!input.removesBranding) return input.platform;
  if (input.own === null || input.own === undefined) return null;
  return capFooter(input.own) || null;
}

/**
 * The footer an organization's outgoing text messages carry (WD-AUTH-029).
 *
 *   plan cannot remove branding  ->  the platform default (`platform.branding_footer`)
 *   plan removes branding        ->  the workspace's own footer; nothing saved or
 *                                    blank means NO footer. The platform default
 *                                    is deliberately not a fallback there: that
 *                                    is what the paid feature sells.
 *
 * Applied to plain text only. Approved template content cannot be changed after
 * submission, so template sends never come through here.
 *
 * Resolution is cached per organization in this process, versioned by two
 * Redis counters (the organization's and the platform's) so a save anywhere
 * takes effect on the very next send everywhere. Any failure resolves to "no
 * footer": a lookup problem must never stop a message, and must never stamp
 * another workspace's footer on it.
 */
@Injectable()
export class BrandingFooterService {
  private readonly logger = new Logger(BrandingFooterService.name);
  private readonly appName: string;
  private readonly cache = new Map<
    number,
    { at: number; version: string; footer: string | null }
  >();

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: PlatformSettingsService,
    private readonly entitlements: PlanEntitlementService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  /** The platform default as saved; never set means "Sent via <app name>", saved blank means none. */
  async platformDefault(): Promise<string | null> {
    return platformFooterFrom(
      await this.settings.get<string>(PLATFORM_FOOTER_SETTING),
      this.appName,
    );
  }

  /** The footer for this organization, or null for none. Never throws. */
  async resolve(orgId: number): Promise<string | null> {
    if (!(orgId > 0)) return this.safePlatformDefault();
    try {
      const version = await this.version(orgId);
      const hit = this.cache.get(orgId);
      if (hit && hit.version === version && Date.now() - hit.at < CACHE_MS) return hit.footer;

      const footer = await this.compute(orgId);
      if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
      this.cache.set(orgId, { at: Date.now(), version, footer });
      return footer;
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not resolve the message footer; sending without one');
      return null;
    }
  }

  /** `body` plus `\n\n_<footer>_`; unchanged when there is no footer or it is already the last line. */
  async appendToBody(orgId: number, body: string): Promise<string> {
    const footer = await this.resolve(orgId);
    if (footer === null) return body;
    const needle = `\n\n_${footer}_`;
    return body.endsWith(needle) ? body : body + needle;
  }

  /**
   * The outbox consumer for `org.branding_footer.changed` and
   * `platform.branding_footer.changed`. The writers already bump the version
   * right after they commit, so the cache is correct without this; a worker
   * that drains the outbox calls it so a process that missed the bump (Redis
   * was unreachable at the time) still converges. Idempotent.
   */
  async onOutboxEvent(eventType: string, orgId: number | null): Promise<void> {
    if (eventType === 'org.branding_footer.changed' && orgId && orgId > 0) {
      await bustFooterCache(this.redis, orgId);
    } else if (eventType === 'platform.branding_footer.changed') {
      await bustFooterCache(this.redis);
    }
  }

  private async version(orgId: number): Promise<string> {
    const [own, platform] = await this.redis.mget(FooterKeys.org(orgId), FooterKeys.platform);
    return `${own ?? '0'}.${platform ?? '0'}`;
  }

  private async safePlatformDefault(): Promise<string | null> {
    try {
      return await this.platformDefault();
    } catch (err) {
      this.logger.warn({ err }, 'could not read the platform footer; sending without one');
      return null;
    }
  }

  private async compute(orgId: number): Promise<string | null> {
    const removesBranding = await this.entitlements.featureEnabled(orgId, 'remove_branding');
    if (!removesBranding) return this.platformDefault();

    const res = await this.db.txAs({ orgId, userId: null }, async (tx) =>
      tx.execute(
        sql`SELECT settings ->> 'messageFooter' AS footer FROM organizations WHERE id = ${orgId}`,
      ),
    );
    const own = (res.rows[0] as unknown as { footer: string | null } | undefined)?.footer;
    return pickFooter({ removesBranding, own, platform: null });
  }
}
