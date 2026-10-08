import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CampaignAiGenerateInput,
  type CampaignAiGenerateResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  CAMPAIGN_AI_PORT,
  type CampaignAiPort,
} from '../../infra/providers/campaigns/campaign-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { CAMPAIGN_AI_SYSTEM_PROMPT, briefLines, parseCampaignCopy } from './campaign-ai-rules';

/**
 * "Build with AI" (WD-CAMP-002): a brief in, a campaign's name, message, footer, call-to-action and up to three quick replies out.
 * The key is the workspace's own when its plan allows one, else the platform's; the platform's key is asked for the monthly allowance
 * first and the tokens are written to the ledger either way. Nothing is stored: the builder pastes the answer into its own fields.
 */
@Injectable()
export class CampaignAiService {
  private readonly logger = new Logger(CampaignAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(CAMPAIGN_AI_PORT) private readonly ai: CampaignAiPort,
  ) {}

  async generate(input: CampaignAiGenerateInput): Promise<CampaignAiGenerateResponse> {
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
        systemPrompt: CAMPAIGN_AI_SYSTEM_PROMPT,
        userPrompt: briefLines(input).join('\n'),
        maxTokens: await this.keys.capMaxTokens(input.provider, 1200),
        temperature: 0.7,
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
          this.logger.warn({ err: String(err) }, '[CAMP] the AI token ledger write failed'),
        );
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[CAMP] campaign copy generation failed');
    }
    if (text.trim() === '') {
      throw new AppError(
        ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
        'AI provider returned no content — check API key + model id.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const campaign = parseCampaignCopy(text);
    if (!campaign) {
      this.logger.warn({ raw: text.slice(0, 400) }, '[CAMP] bad JSON from the model');
      throw new AppError(
        ERROR_CODES.CAMP_AI_BAD_JSON,
        'Model output was not valid JSON. Try again or refine the brief.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'raw', message: text.slice(0, 600) }],
      );
    }
    return { campaign, model: input.model };
  }
}
