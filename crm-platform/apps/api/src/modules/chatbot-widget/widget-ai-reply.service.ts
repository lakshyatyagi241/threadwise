import { Inject, Injectable, Logger } from '@nestjs/common';
import { isWalletEmpty } from '../../common/errors/wallet-empty';
import { stableUsageId } from '../../common/stable-usage-id';
import { AI_CHAT_PORT, type AiChatPort } from '../../infra/providers/chatbot-widget/ai-chat.port';
import { AiChargeService } from '../wallet-message-billing';
import { EMPTY_REPLY_FALLBACK, ERROR_FALLBACK, fullSystemPrompt, userPrompt } from './ai-prompt';
import {
  LANGUAGE_HINT,
  type AssistantProfile,
  type InboxLine,
  type KnowledgeSource,
  type LanguageHint,
} from './_shims/tokens';

export interface ReplyInput {
  orgId: number;
  assistant: AssistantProfile;
  knowledge: readonly KnowledgeSource[];
  /** The knowledge is the best matches for the message, not the whole base. */
  grounded?: boolean;
  /** The last turns of the thread, oldest first, without the message being answered. */
  history: readonly InboxLine[];
  visitorMessage: string;
  /** The id of the visitor's stored message being answered: it names this reply for the wallet, so the reply is charged once. */
  messageId: number;
}

/**
 * The assistant's single-shot reply (TW-WGT-016). Nothing here holds a database transaction: the vendor call can take
 * seconds, so the caller reads what it needs first and writes the result after.
 *
 * Always answers with text: a blank completion gives the assistant's fallback message (or a built-in line), and a vendor
 * error or timeout gives the same, so the visitor is never left staring at "Typing...".
 *
 * The call is made on the platform's own key (the workspace has none here), so the workspace's wallet pays for it: asked before the
 * vendor, charged after. A workspace whose wallet is empty gets the fallback message for its visitors instead of an error. The platform's
 * own workspaces are never charged.
 */
@Injectable()
export class WidgetAiReplyService {
  private readonly logger = new Logger(WidgetAiReplyService.name);

  constructor(
    @Inject(AI_CHAT_PORT) private readonly ai: AiChatPort,
    @Inject(LANGUAGE_HINT) private readonly language: LanguageHint,
    private readonly charge: AiChargeService,
  ) {}

  async reply(input: ReplyInput): Promise<string> {
    const { assistant } = input;
    try {
      // Before the vendor (and before the language hint, which can be a paid translation): an empty wallet cannot spend the platform's key.
      try {
        await this.charge.guardCall(input.orgId, 'admin');
      } catch (err) {
        if (!isWalletEmpty(err)) throw err;
        this.logger.warn({ assistantId: assistant.id }, '[WGT] wallet empty, using the fallback');
        return assistant.fallbackMessage || ERROR_FALLBACK;
      }
      // The language hint is best effort: a failure there must not cost the visitor their answer.
      const hint = await this.language
        .replyLanguage(input.orgId, input.visitorMessage.trim())
        .catch(() => null);
      const systemPrompt = fullSystemPrompt(
        assistant,
        input.knowledge,
        hint,
        input.grounded === true,
      );
      const user = userPrompt(input.history, input.visitorMessage);
      const answer = await this.ai.complete({
        provider: assistant.aiProvider,
        model: assistant.aiModel,
        orgId: input.orgId,
        systemPrompt,
        userPrompt: user,
        maxTokens: assistant.replyMaxTokens || 400,
        temperature: assistant.temperature ?? 0.7,
      });
      const text = answer?.text ?? null;
      if (answer) {
        // The vendor answered (even with nothing to say, it billed the prompt). Never throws. The vendor's own token counts when its
        // answer has them, else 4 characters a token as the other estimates here.
        const prompt = answer.promptTokens ?? 0;
        const completion = answer.completionTokens ?? 0;
        const counted = prompt + completion > 0;
        await this.charge.chargeCall({
          orgId: input.orgId,
          keySource: 'admin',
          label: 'AI website chatbot',
          source: 'widget_ai',
          usageId: stableUsageId('widget_ai', input.messageId),
          provider: assistant.aiProvider,
          model: assistant.aiModel,
          promptTokens: counted ? prompt : Math.ceil((systemPrompt.length + user.length) / 4),
          completionTokens: counted ? completion : Math.ceil((text ?? '').length / 4),
        });
      }
      if (!text || text.trim() === '') {
        this.logger.warn({ assistantId: assistant.id }, '[WGT] empty AI reply, using the fallback');
        return assistant.fallbackMessage || EMPTY_REPLY_FALLBACK;
      }
      return text.trim();
    } catch (err) {
      this.logger.error({ assistantId: assistant.id, err: String(err) }, '[WGT] AI reply failed');
      return assistant.fallbackMessage || ERROR_FALLBACK;
    }
  }
}
