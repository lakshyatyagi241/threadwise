import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  CONVERSATION_MESSAGE_STORE,
  type ConversationMessageStore,
} from './conversation-message-store';
import type { InboundOutcome, OutboundOutcome } from './conversation-outcomes';
import { languageDisplayName } from './language-detector';
import { TranslationService } from './translation.service';
import { translationAllowed } from './translation-settings.service';

export type { InboundOutcome, OutboundOutcome };

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

export interface OutboundInput {
  orgId: number;
  /** What the agent typed. */
  body: string;
  customerLanguage: string | null;
  isTemplate?: boolean;
  isForwarded?: boolean;
  alreadyTranslated?: boolean;
}

/** The unchanged-text outcome: nothing translated, nothing flagged. */
const asTyped = (body: string): OutboundOutcome => ({
  body,
  original: null,
  language: null,
  isTranslated: false,
});

/** One message as the thread payload carries it (WD-I18N-038). */
export interface ThreadTranslationFields {
  translatedBody: string | null;
  detectedLanguage: string | null;
  isTranslated: boolean;
}

/**
 * The translation fields of a thread payload. While translation is not live (plan below the feature, or the switch
 * off) the stored translation is hidden and `isTranslated` is false, but the detected language is still returned and
 * nothing is deleted: turning translation back on shows the old readings again.
 */
export function visibleTranslation(
  live: boolean,
  m: ThreadTranslationFields,
): ThreadTranslationFields {
  return live
    ? m
    : { translatedBody: null, detectedLanguage: m.detectedLanguage, isTranslated: false };
}

/**
 * Conversation translation (WD-I18N-036..039): the decisions about inbound and outbound messages. The inbox domain
 * (not built yet) calls `translateInboundMessage` after it stores a message and `translateOutboundMessage` in the send
 * worker before the branding footer, and `threadView` when it builds a thread payload. Messages are reached through
 * `ConversationMessageStore`. Everything decides with explicit workspace context and never throws: a failed
 * translation means the text is simply not translated.
 */
@Injectable()
export class ConversationTranslationService {
  private readonly logger = new Logger(ConversationTranslationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly translation: TranslationService,
    @Inject(CONVERSATION_MESSAGE_STORE) private readonly messages: ConversationMessageStore,
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

  /**
   * WD-I18N-036 for a stored message: detects, stores the reading and pins the language. Only inbound messages with
   * text that are not already translated are touched; returns what was stored, or null when nothing was.
   */
  async translateInboundMessage(orgId: number, messageId: number): Promise<InboundOutcome | null> {
    try {
      const m = await this.messages.load(orgId, messageId);
      if (!m || m.direction !== 'in') return null;
      const outcome = await this.translateInbound({
        orgId,
        body: m.body ?? '',
        pinnedLanguage: m.customerLanguage,
        alreadyTranslated: m.isTranslated,
      });
      if (outcome) await this.messages.saveInbound(orgId, m, outcome);
      return outcome;
    } catch (err) {
      this.logger.warn({ err, messageId }, 'inbound translation could not be stored');
      return null;
    }
  }

  /**
   * WD-I18N-037 for a stored message: the text to deliver (translated into the customer's language, or exactly as
   * typed). The agent's original is stored beside it when the text was translated.
   */
  async translateOutboundMessage(
    orgId: number,
    messageId: number,
  ): Promise<OutboundOutcome | null> {
    try {
      const m = await this.messages.load(orgId, messageId);
      if (!m || m.direction !== 'out') return null;
      const outcome = await this.translateOutbound({
        orgId,
        body: m.body ?? '',
        customerLanguage: m.customerLanguage,
        isTemplate: m.isTemplate,
        isForwarded: m.isForwarded,
        alreadyTranslated: m.isTranslated,
      });
      if (outcome.isTranslated) await this.messages.saveOutbound(orgId, m, outcome);
      return outcome;
    } catch (err) {
      this.logger.warn({ err, messageId }, 'outbound translation could not be stored');
      return null;
    }
  }

  /** WD-I18N-038. The gate is read once for the whole thread, not once per message. */
  async threadView<T extends ThreadTranslationFields>(
    orgId: number,
    messages: readonly T[],
  ): Promise<T[]> {
    const { enabled } = await this.config(orgId);
    return messages.map((m) => ({ ...m, ...visibleTranslation(enabled, m) }));
  }
}
