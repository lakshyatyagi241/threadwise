import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_CHAT_PORT, type AiChatPort } from '../../infra/providers/chatbot-widget/ai-chat.port';
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
  /** The last turns of the thread, oldest first, without the message being answered. */
  history: readonly InboxLine[];
  visitorMessage: string;
}

/**
 * The assistant's single-shot reply (WD-WGT-016). Nothing here holds a database transaction: the vendor call can take
 * seconds, so the caller reads what it needs first and writes the result after.
 *
 * Always answers with text: a blank completion gives the assistant's fallback message (or a built-in line), and a vendor
 * error or timeout gives the same, so the visitor is never left staring at "Typing...".
 */
@Injectable()
export class WidgetAiReplyService {
  private readonly logger = new Logger(WidgetAiReplyService.name);

  constructor(
    @Inject(AI_CHAT_PORT) private readonly ai: AiChatPort,
    @Inject(LANGUAGE_HINT) private readonly language: LanguageHint,
  ) {}

  async reply(input: ReplyInput): Promise<string> {
    const { assistant } = input;
    try {
      // The language hint is best effort: a failure there must not cost the visitor their answer.
      const hint = await this.language
        .replyLanguage(input.orgId, input.visitorMessage.trim())
        .catch(() => null);
      const text = await this.ai.complete({
        provider: assistant.aiProvider,
        model: assistant.aiModel,
        orgId: input.orgId,
        systemPrompt: fullSystemPrompt(assistant, input.knowledge, hint),
        userPrompt: userPrompt(input.history, input.visitorMessage),
        maxTokens: assistant.replyMaxTokens || 400,
        temperature: assistant.temperature ?? 0.7,
      });
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
