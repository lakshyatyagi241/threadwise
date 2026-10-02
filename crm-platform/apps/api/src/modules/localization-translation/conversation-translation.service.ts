import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { languageDisplayName } from './language-detector';
import { TranslationService } from './translation.service';
import { translationAllowed } from './translation-settings.service';

export interface ConversationTranslationConfig {
  /** The plan includes translation AND the workspace switch is on. */
  enabled: boolean;
  /** The language the team reads and writes. */
  teamLanguage: string;
}

export interface InboundInput {
  orgId: number;
  body: string;
  /** The language already pinned to the conversation, if any. */
  pinnedLanguage: string | null;
  alreadyTranslated?: boolean;
}

/** What to store on the message and the conversation. Nothing here writes: the inbox domain owns those rows. */
export interface InboundOutcome {
  detectedLanguage: string | null;
  /** The team-language reading, only when the message is in another language. */
  translatedBody: string | null;
  isTranslated: boolean;
  /** Set only when the conversation had no language yet; later messages never move it. */
  pinLanguage: string | null;
}

export interface OutboundInput {
  orgId: number;
  /** What the agent typed. */
  body: string;
  customerLanguage: string | null;
  isTemplate?: boolean;
  isForwarded?: boolean;
  alreadyTranslated?: boolean;
}

export interface OutboundOutcome {
  /** What to deliver. */
  body: string;
  /** The agent's original, kept for the thread view; set only when the text was translated. */
  original: string | null;
  /** The language delivered, set only when translated. */
  language: string | null;
  isTranslated: boolean;
}

/** The unchanged-text outcome: nothing translated, nothing flagged. */
const asTyped = (body: string): OutboundOutcome => ({
  body,
  original: null,
  language: null,
  isTranslated: false,
});

/**
 * Conversation translation (WD-I18N-036..039): the decisions about inbound and outbound messages, separated from the
 * inbox so they can be tested and reused. The inbox domain (not built yet) calls `translateInbound` after storing a
 * message and `translateOutbound` in the send worker before the branding footer, and persists the outcome. Both
 * decide with explicit workspace context; neither throws, a failed translation means the text is simply not translated.
 */
@Injectable()
export class ConversationTranslationService {
  private readonly logger = new Logger(ConversationTranslationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly translation: TranslationService,
  ) {}

  /** The gate every conversation feature checks: plan AND workspace switch (WD-I18N-038 reads it for display too). */
  async config(orgId: number): Promise<ConversationTranslationConfig> {
    const [entitlements, row] = await Promise.all([
      this.plans.forOrg(orgId),
      this.db.txAs({ orgId, userId: null }, (tx) =>
        tx.execute(
          sql`SELECT default_language, inbox_translate FROM workspace_settings WHERE org_id = ${orgId}`,
        ),
      ),
    ]);
    const s = row.rows[0] as
      { default_language: string | null; inbox_translate: boolean } | undefined;
    return {
      enabled: translationAllowed(entitlements) && (s?.inbox_translate ?? true),
      teamLanguage: (s?.default_language ?? 'en').trim().toLowerCase() || 'en',
    };
  }

  /** WD-I18N-036. */
  async translateInbound(input: InboundInput): Promise<InboundOutcome | null> {
    const body = input.body.trim();
    if (!body || input.alreadyTranslated) return null;
    try {
      const config = await this.config(input.orgId);
      if (!config.enabled) return null;

      const r = await this.translation.detectAndTranslate(body, config.teamLanguage, {
        orgId: input.orgId,
      });
      const detected = r.language?.toLowerCase() ?? null;
      const foreign = !!detected && detected !== config.teamLanguage && !!r.text;
      return {
        detectedLanguage: detected,
        translatedBody: foreign ? r.text : null,
        isTranslated: foreign,
        pinLanguage: detected && !input.pinnedLanguage ? detected : null,
      };
    } catch (err) {
      this.logger.warn({ err }, 'inbound translation failed; the message is kept untranslated');
      return null;
    }
  }

  /** WD-I18N-037. */
  async translateOutbound(input: OutboundInput): Promise<OutboundOutcome> {
    const body = input.body.trim();
    if (
      !body ||
      input.alreadyTranslated ||
      input.isForwarded ||
      input.isTemplate || // templates keep the language they were approved in
      !input.customerLanguage
    ) {
      return asTyped(input.body);
    }
    try {
      const config = await this.config(input.orgId);
      const target = input.customerLanguage.toLowerCase();
      if (!config.enabled || target === config.teamLanguage) return asTyped(input.body);

      const r = await this.translation.detectAndTranslate(body, target, { orgId: input.orgId });
      // Already in the customer's language (an AI or keyword reply), or nothing came back: send as typed.
      if (!r.text || r.language?.toLowerCase() === target) return asTyped(input.body);
      return { body: r.text, original: input.body, language: target, isTranslated: true };
    } catch (err) {
      this.logger.warn({ err }, 'outbound translation failed; the original text is sent');
      return asTyped(input.body);
    }
  }

  /**
   * WD-I18N-039. One sentence for the AI agent or chat widget prompt so it answers in the customer's own language
   * (which makes `translateOutbound` a no-op). Null when there is nothing to add.
   */
  async languageHint(orgId: number, customerLanguage: string | null): Promise<string | null> {
    if (!customerLanguage) return null;
    try {
      const config = await this.config(orgId);
      const lang = customerLanguage.toLowerCase();
      if (!config.enabled || lang === config.teamLanguage) return null;
      return `The customer writes in ${languageDisplayName(lang)} (${lang}). Reply entirely in ${languageDisplayName(lang)}, naturally and in full.`;
    } catch {
      return null;
    }
  }
}
