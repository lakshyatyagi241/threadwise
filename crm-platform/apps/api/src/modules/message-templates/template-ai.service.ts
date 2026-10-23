import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type TplAiGenerateInput, type TplAiGenerateResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  CAMPAIGN_AI_PORT,
  type CampaignAiPort,
} from '../../infra/providers/campaigns/campaign-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { AiChargeService } from '../wallet-message-billing';
import {
  TEMPLATE_AI_SYSTEM_PROMPT,
  parseTemplateDraft,
  templateBriefLines,
} from './template-ai-rules';

/**
 * "Build with AI" on the template form (TW-TPL-016): a brief in, a template draft out (name, header, body, footer, buttons). The key is
 * the workspace's own when its plan allows one, else the platform's; the platform's key is asked for the monthly allowance and then the
 * wallet first (422 WALLET_EMPTY), the tokens are written to the ledger either way, and the wallet pays for the call when the
 * platform's key answered. Nothing is stored and nothing goes to Meta: the form fills its fields and the person
 * reviews the draft before it is submitted. The vendor call is the campaign builder's port.
 */
@Injectable()
export class TemplateAiService {
  private readonly logger = new Logger(TemplateAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly wallet: AiChargeService,
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
    // The platform's key is also paid for from the workspace's wallet: an empty wallet is refused before the vendor is called.
    await this.wallet.guardCall(orgId, resolved.source);

    // One id per vendor call; the request id is whatever `x-request-id` the caller sent, so it cannot name a charge.
    const usageId = randomUUID();
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
      // Inside the try on purpose: a vendor that failed above is never charged.
      await this.wallet.chargeCall({
        orgId,
        keySource: resolved.source,
        label: 'AI template builder',
        source: 'template_ai',
        usageId,
        provider: input.provider,
        model: input.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
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
