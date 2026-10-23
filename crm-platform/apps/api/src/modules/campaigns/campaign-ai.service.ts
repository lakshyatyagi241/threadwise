import { randomUUID } from 'node:crypto';
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
import { AiChargeService } from '../wallet-message-billing';
import { CAMPAIGN_AI_SYSTEM_PROMPT, briefLines, parseCampaignCopy } from './campaign-ai-rules';

/**
 * "Build with AI" (TW-CAMP-002): a brief in, a campaign's name, message, footer, call-to-action and up to three quick replies out.
 * The key is the workspace's own when its plan allows one, else the platform's; the platform's key is asked for the monthly allowance and
 * then the wallet first (422 WALLET_EMPTY), the tokens are written to the ledger either way, and the wallet pays for the call when the
 * platform's key answered. Nothing is stored: the builder pastes the answer into its own fields.
 */
@Injectable()
export class CampaignAiService {
  private readonly logger = new Logger(CampaignAiService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly wallet: AiChargeService,
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
      // Inside the try on purpose: a vendor that failed above is never charged.
      await this.wallet.chargeCall({
        orgId,
        keySource: resolved.source,
        label: 'AI campaign writer',
        source: 'campaign_ai',
        usageId,
        provider: input.provider,
        model: input.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
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
