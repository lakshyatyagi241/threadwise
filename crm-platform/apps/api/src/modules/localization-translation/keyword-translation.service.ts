import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  KEYWORD_RULE_STORE,
  type KeywordContent,
  type KeywordRule,
  type KeywordRuleStore,
  type TranslatedRule,
} from './keyword-rule-store';
import {
  matchesTranslation,
  targetsFor,
  withCanonical,
  type TranslatedKeyword,
  type TranslationMap,
} from './keyword-translation';
import { TranslationService } from './translation.service';

export interface BackfillOptions {
  /** One workspace only. */
  orgId?: number;
  /** Re-translate rules that already have translations. */
  force?: boolean;
  /** Called after each rule, for a progress line. */
  onRule?: (rule: KeywordRule, error: Error | null) => void;
}

export interface BackfillResult {
  /** Rules visited. */
  total: number;
  translated: number;
  failed: number;
  failures: Array<{ id: string; keyword: string; message: string }>;
}

export interface InboundLookup<R extends TranslatedKeyword> {
  orgId: number;
  message: string;
  /** Active rules that already hold stored translations. */
  candidates: readonly R[];
  /**
   * The auto-reply domain's own exact/contains match, re-run on the English translation of the message. This domain
   * never matches rules itself; it only supplies the translation.
   */
  matchCanonical: (english: string) => Promise<R | null>;
}

const PAGE = 50;
const lower = (s: string) => s.trim().toLowerCase();

/**
 * Multilingual auto-reply (WD-I18N-032, 033, 034): translating a rule's keyword and reply texts ahead of time, the
 * backfill over existing rules, and the two translation steps of the inbound lookup. The auto-reply domain owns the
 * rules and the matcher and calls this service; the rules are reached through `KeywordRuleStore`.
 *
 * Deviations from WaDesk, each deliberate:
 *   - the fan-out runs with bounded concurrency (WaDesk's docblock promised parallel calls but ran one by one);
 *   - the universal fallback carries the workspace, so lockdown and data residency apply to webhook-driven lookups
 *     (WaDesk had no signed-in user there and skipped both);
 *   - a failed pair is cached for a minute, not a day, so a backfill re-run does retry what failed.
 * Reproduced on purpose: the fallback sends every unmatched inbound text to the provider (cached 24 hours), and a
 * failed target language is left out of a map rather than failing the rule.
 */
@Injectable()
export class KeywordTranslationService {
  private readonly logger = new Logger(KeywordTranslationService.name);

  constructor(
    private readonly translation: TranslationService,
    @Inject(KEYWORD_RULE_STORE) private readonly store: KeywordRuleStore,
  ) {}

  /**
   * WD-I18N-032. Translates the keyword (as one text, even when it holds several comma-separated phrases) and every
   * text variant with text into the target languages, and stores the maps. Media variants are language-neutral and
   * untouched. Source language: the rule's, else the workspace's, else English.
   */
  async translateForKeyword(
    rule: KeywordRule,
    targets?: readonly string[],
  ): Promise<TranslatedRule> {
    const ws = await this.store.workspaceLanguages(rule.orgId);
    const from = lower(rule.canonicalLanguage || ws.defaultLanguage || 'en');
    const to = targets ?? targetsFor(ws.autoTranslateLanguages);
    const ctx = { orgId: rule.orgId };

    const keyword = rule.keyword.trim();
    const keywordTranslations =
      keyword === ''
        ? {}
        : withCanonical(keyword, from, await this.translation.fanOut(keyword, from, to, ctx));

    const contentTranslations: Record<string, TranslationMap> = {};
    for (const c of rule.contents) {
      const text = (c.content ?? '').trim();
      if (c.contentType !== 'text' || text === '') continue;
      contentTranslations[c.id] = withCanonical(
        text,
        from,
        await this.translation.fanOut(text, from, to, ctx),
      );
    }

    const result: TranslatedRule = {
      canonicalLanguage: from,
      keywordTranslations,
      contentTranslations,
    };
    await this.store.save(rule, result);
    return result;
  }

  /** WD-I18N-033. Visits rules in pages of 50; a rule that throws is counted and reported, the run goes on. */
  async backfill(options: BackfillOptions = {}): Promise<BackfillResult> {
    const orgs = options.orgId !== undefined ? [options.orgId] : await this.store.workspaces();
    const result: BackfillResult = { total: 0, translated: 0, failed: 0, failures: [] };
    for (const orgId of orgs) {
      let after: string | null = null;
      for (;;) {
        const page = await this.store.scan({
          orgId,
          includeTranslated: options.force === true,
          after,
          limit: PAGE,
        });
        if (page.length === 0) break;
        for (const rule of page) {
          result.total += 1;
          try {
            await this.translateForKeyword(rule);
            result.translated += 1;
            options.onRule?.(rule, null);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            result.failed += 1;
            result.failures.push({ id: rule.id, keyword: rule.keyword, message: error.message });
            this.logger.warn({ err, rule: rule.id }, 'keyword translation failed');
            options.onRule?.(rule, error);
          }
        }
        after = page[page.length - 1]!.id;
        if (page.length < PAGE) break;
      }
    }
    return result;
  }

  /**
   * WD-I18N-034 stages 1.5a and 1.5b. First the stored translations (cheap, no provider call); then, when nothing
   * matched, one detect-and-translate call to English and the matcher's own match on the result. Returns the rule and
   * the language the customer wrote in, or null for no hit. A provider failure is simply no hit.
   */
  async resolveInbound<R extends TranslatedKeyword>(
    input: InboundLookup<R>,
  ): Promise<{ rule: R; language: string } | null> {
    for (const rule of input.candidates) {
      const language = matchesTranslation(rule, input.message);
      if (language !== null) return { rule, language };
    }
    const message = input.message.trim();
    if (message === '') return null;
    try {
      const det = await this.translation.detectAndTranslate(message, 'en', { orgId: input.orgId });
      if (det.language && det.language.toLowerCase() !== 'en' && det.text !== null) {
        const rule = await input.matchCanonical(det.text.toLowerCase());
        if (rule) return { rule, language: det.language };
      }
    } catch (err) {
      this.logger.warn({ err }, 'universal fallback failed; no translated match');
    }
    return null;
  }

  /**
   * WD-I18N-034 rule 3. The text of a reply variant in the customer's language: the stored translation, the original
   * when the customer writes the rule's own language, else a live translation (cached), and the original again if that
   * fails, so the customer always gets a reply.
   */
  async pickContent(
    variant: Pick<KeywordContent, 'content' | 'contentTranslations'>,
    language: string | null,
    canonicalLanguage: string | null,
    orgId: number,
  ): Promise<string> {
    const original = variant.content ?? '';
    if (!language || original === '') return original;
    const stored =
      variant.contentTranslations?.[language] ?? variant.contentTranslations?.[lower(language)];
    if (stored) return stored;
    const canonical = canonicalLanguage || 'en';
    if (lower(language) === lower(canonical)) return original;
    try {
      return (
        (await this.translation.translate(original, canonical, language, { orgId })) ?? original
      );
    } catch {
      return original;
    }
  }
}
