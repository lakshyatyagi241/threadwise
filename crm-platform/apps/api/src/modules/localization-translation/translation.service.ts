import { Inject, Injectable } from '@nestjs/common';
import {
  TRANSLATION_CACHE,
  type TranslationCache,
} from '../../infra/providers/localization-translation/redis-stores';
import type {
  DetectedTranslation,
  TranslationDriver,
} from '../../infra/providers/localization-translation/translation-driver.port';
import { lookupCommonPhrase } from './common-phrases';
import { detectScriptLanguage } from './language-detector';
import { ProviderRouterService, type TranslationContext } from './provider-router.service';
import { cacheKey, normalizeLang, type RoutePolicy } from './translation-policy';
import { TranslationUsageService } from './translation-usage.service';

const SUCCESS_TTL = 86_400;
/** A failure is remembered only briefly: a provider that was down a minute ago may be fine now. */
const FAILURE_TTL = 60;
/** The whole chain for one message may not take longer than this, however many drivers are configured. */
const CHAIN_BUDGET_MS = 10_000;
const FAILED = '__failed__';

/**
 * The one entry point for translating customer text (TW-I18N-021, 022).
 *
 * Layers, cheapest first: the offline dictionary, a 24-hour cache, then the provider chain. Providers are tried in
 * order until one answers; a call that reached a provider is recorded in the usage ledger against the workspace in
 * `ctx`. Nothing here throws on a provider problem: the caller gets null and sends the original text.
 *
 * Differences from Reference, each deliberate:
 *   - the workspace is passed in, not read from whoever is logged in, so residency and the ledger work for webhooks
 *     and jobs;
 *   - failures are cached for a minute, not a day;
 *   - the cache key includes the lockdown and residency state;
 *   - the chain is bounded to ten seconds in total;
 *   - `detect` answers from the script heuristic before it pays for a provider call.
 */
@Injectable()
export class TranslationService {
  constructor(
    private readonly router: ProviderRouterService,
    private readonly usage: TranslationUsageService,
    @Inject(TRANSLATION_CACHE) private readonly cache: TranslationCache,
  ) {}

  async translate(
    text: string,
    from: string,
    to: string,
    ctx: TranslationContext,
  ): Promise<string | null> {
    const clean = text.trim();
    if (!clean) return '';
    const src = normalizeLang(from);
    const dst = normalizeLang(to);
    if (src === dst) return clean;

    const known = lookupCommonPhrase(clean, src, dst);
    if (known) return known;

    const policy = await this.router.policy(ctx);
    const key = cacheKey('pair', `${src}:${dst}`, clean, policy);
    const cached = await this.cache.get(key);
    if (cached !== null) return cached === FAILED ? null : cached;

    const drivers = await this.router.drivers(policy);
    if (drivers.length === 0) return null;

    const started = Date.now();
    let tried = 0;
    for (const driver of drivers) {
      if (tried > 0 && Date.now() - started > CHAIN_BUDGET_MS) break;
      tried += 1;
      const out = await driver.translate(clean, src, dst);
      if (out) {
        await this.usage.record(ctx.orgId, {
          providerSlug: driver.slug,
          sourceLang: src,
          targetLang: dst,
          charsIn: [...clean].length,
          charsOut: [...out].length,
          wasFallback: tried > 1,
        });
        await this.cache.set(key, out, SUCCESS_TTL);
        return out;
      }
    }
    await this.cache.set(key, FAILED, FAILURE_TTL);
    return null;
  }

  /**
   * Detects the language and translates to `target` in one provider call. A driver that finds the language but no
   * text, or the reverse, contributes its half and the next driver is asked for the rest.
   */
  async detectAndTranslate(
    text: string,
    target: string,
    ctx: TranslationContext,
  ): Promise<DetectedTranslation> {
    const clean = text.trim();
    const dst = normalizeLang(target);
    if (!clean) return { language: null, text: null };

    const policy = await this.router.policy(ctx);
    const key = cacheKey('auto', dst, clean, policy);
    const cached = await this.cache.get(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as DetectedTranslation;
      } catch {
        /* a corrupt entry is a miss */
      }
    }

    const drivers = await this.router.drivers(policy);
    const merged: DetectedTranslation = { language: null, text: null };
    let servedBy: TranslationDriver | null = null;
    let tried = 0;
    let servedAt = 0;
    const started = Date.now();

    for (const driver of drivers) {
      if (tried > 0 && Date.now() - started > CHAIN_BUDGET_MS) break;
      tried += 1;
      const r = await driver.detectAndTranslate(clean, dst);
      if (!servedBy && (r.language || r.text)) {
        servedBy = driver;
        servedAt = tried;
      }
      merged.language ??= r.language;
      merged.text ??= r.text;
      if (merged.language && merged.text) break;
    }

    if (servedBy) {
      await this.usage.record(ctx.orgId, {
        providerSlug: servedBy.slug,
        sourceLang: merged.language ?? 'auto',
        targetLang: dst,
        charsIn: [...clean].length,
        charsOut: merged.text ? [...merged.text].length : 0,
        wasFallback: servedAt > 1 || tried > 1,
      });
    }
    await this.cache.set(
      key,
      JSON.stringify(merged),
      merged.language && merged.text ? SUCCESS_TTL : FAILURE_TTL,
    );
    return merged;
  }

  /**
   * The language of a text. Non-Latin scripts are answered offline for free; only Latin-script text (where a script
   * heuristic cannot tell Spanish from French) pays for a provider call. Reference always paid.
   */
  async detect(text: string, ctx: TranslationContext): Promise<string | null> {
    const script = detectScriptLanguage(text, '');
    if (script) return script;
    return (await this.detectAndTranslate(text, 'en', ctx)).language;
  }

  /**
   * Translates one text into many languages with bounded concurrency. Targets that fail are left out, so a partial
   * map is normal. (Reference did this one language at a time.)
   */
  async fanOut(
    text: string,
    from: string,
    targets: readonly string[],
    ctx: TranslationContext,
    concurrency = 4,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const queue = [...new Set(targets.map(normalizeLang))].filter((t) => t !== normalizeLang(from));
    const worker = async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
        const r = await this.translate(text, from, t, ctx);
        if (r) out[t] = r;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    return out;
  }

  /** The routing rules that would apply to this workspace now (exposed for the settings tab and tests). */
  policy(ctx: TranslationContext): Promise<RoutePolicy> {
    return this.router.policy(ctx);
  }
}
