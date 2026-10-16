import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type InboxRewriteAction,
  type InboxRewriteInput,
  type InboxRewriteResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  FLOW_AI_PORT,
  type FlowAiPort,
} from '../../infra/providers/flow-builder-editor/flow-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';

const INSTRUCTION = (action: InboxRewriteAction, language: string | undefined): string => {
  switch (action) {
    case 'condense':
      return 'Make the message shorter and more concise while keeping every important detail.';
    case 'fix':
      return 'Fix spelling, grammar and punctuation only. Do not change the wording otherwise.';
    case 'positive':
      return 'Rewrite the message in a more positive, upbeat and warm tone. Keep the meaning and do not promise anything new.';
    case 'translate':
      return `Translate the message into ${language ?? 'English'}.`;
  }
};

const SYSTEM_PROMPT =
  "You help a customer-support agent polish a chat message before sending it to a customer. Reply with the rewritten message only: no quotes, no preface, no explanation. Keep the message's language unless asked to translate, keep names, numbers, links and {{placeholders}} exactly, and keep WhatsApp-style formatting (*bold*, _italic_, ~strike~, '- ' and '1. ' lists).";

/**
 * The composer's AI button (rewrite, fix, tone, length). The key is the workspace's own when its plan allows one, else the platform's;
 * the platform's key is asked for the monthly allowance first and the tokens go to the ledger either way. Nothing is stored or sent:
 * the agent reads the result in the box and sends it, or not. The vendor call is the flow builder's text port (OpenAI, Anthropic, Gemini and OpenRouter), asked for plain text, not JSON. It reports no token counts, so the ledger gets an estimate (about four characters a token).
 */
@Injectable()
export class InboxAiService {
  private readonly logger = new Logger(InboxAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(FLOW_AI_PORT) private readonly ai: FlowAiPort,
  ) {}

  async rewrite(input: InboxRewriteInput): Promise<InboxRewriteResponse> {
    const orgId = RequestContextStore.require().orgId;
    const resolved = await this.keys.resolve(orgId, input.provider);
    if (resolved.key === null || resolved.source === 'none') {
      throw new AppError(
        ERROR_CODES.CAMP_AI_NO_KEY,
        'Admin has not enabled this provider in /admin/api-keys.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (resolved.source === 'admin') {
      try {
        await this.meter.guard(orgId);
      } catch {
        throw new AppError(
          ERROR_CODES.CAMP_AI_LIMIT_REACHED,
          'The monthly AI token allowance is used up.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    let text = '';
    try {
      const maxTokens = await this.keys.capMaxTokens(input.provider, 1200);
      const userPrompt = `${INSTRUCTION(input.action, input.language)}\n\nMessage:\n${input.text}`;
      text =
        (await this.ai.generate({
          provider: input.provider,
          model: input.model,
          apiKey: resolved.key,
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          maxTokens,
          temperature: 0.4,
          json: false,
        })) ?? '';
      await this.meter
        .record(orgId, {
          provider: input.provider,
          model: input.model,
          promptTokens: Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4),
          completionTokens: Math.ceil(text.length / 4),
          billedAgainst: resolved.source,
        })
        .catch((err: unknown) =>
          this.logger.warn({ err: String(err) }, '[INBOX] the AI token ledger write failed'),
        );
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[INBOX] message rewrite failed');
    }
    const out = text.trim();
    if (out === '') {
      throw new AppError(
        ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
        'AI provider returned no content — check API key + model id.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { text: out, model: input.model };
  }
}
