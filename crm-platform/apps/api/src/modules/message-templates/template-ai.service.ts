import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type TplAiGenerateInput, type TplAiGenerateResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  CAMPAIGN_AI_PORT,
  type CampaignAiPort,
} from '../../infra/providers/campaigns/campaign-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import {
  TEMPLATE_AI_SYSTEM_PROMPT,
  parseTemplateDraft,
  templateBriefLines,
} from './template-ai-rules';

/**
 * "Build with AI" on the template form (TW-TPL-016): a brief in, a template draft out (name, header, body, footer, buttons). The key is
 * the workspace's own when its plan allows one, else the platform's; the platform's key is asked for the monthly allowance first and the
 * tokens are written to the ledger either way. Nothing is stored and nothing goes to Meta: the form fills its fields and the person
 * reviews the draft before it is submitted. The vendor call is the campaign builder's port.
 */
@Injectable()
export class TemplateAiService {
  private readonly logger = new Logger(TemplateAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(CAMPAIGN_AI_PORT) private readonly ai: CampaignAiPort,
  ) {}

  async generate(input: TplAiGenerateInput): Promise<TplAiGenerateResponse> {
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
      const result = await this.ai.complete({
        provider: input.provider,
        model: input.model,
        apiKey: resolved.key,
        systemPrompt: TEMPLATE_AI_SYSTEM_PROMPT,
        userPrompt: templateBriefLines(input).join('\n'),
        maxTokens: await this.keys.capMaxTokens(input.provider, 1600),
        temperature: 0.6,
      });
      text = result.text;
      await this.meter
        .record(orgId, {
          provider: input.provider,
          model: input.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          billedAgainst: resolved.source,
        })
        .catch((err: unknown) =>
          this.logger.warn({ err: String(err) }, '[TPL] the AI token ledger write failed'),
        );
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[TPL] template generation failed');
    }
    if (text.trim() === '') {
      throw new AppError(
        ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
        'AI provider returned no content — check API key + model id.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const template = parseTemplateDraft(text);
    if (!template || template.body === '') {
      this.logger.warn({ raw: text.slice(0, 400) }, '[TPL] bad JSON from the model');
      throw new AppError(
        ERROR_CODES.CAMP_AI_BAD_JSON,
        'Model output was not valid JSON. Try again or refine the brief.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'raw', message: text.slice(0, 600) }],
      );
    }
    return { template, model: input.model };
  }
}
