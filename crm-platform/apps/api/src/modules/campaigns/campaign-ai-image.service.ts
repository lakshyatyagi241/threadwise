import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CampaignAiImageInput,
  type CampaignAiImageResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  CAMPAIGN_AI_IMAGE_PORT,
  CampaignAiImageRefusedError,
  type CampaignAiImagePort,
} from '../../infra/providers/campaigns/campaign-ai-image.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { MarketingMediaService } from '../broadcasts';
import { AiChargeService } from '../wallet-message-billing';
import { AI_IMAGE_TOKEN_EQUIVALENT, aiImageCostUsd, imagePromptOf } from './campaign-ai-rules';

/**
 * "Build with AI", the picture: a brief in, one generated image out, stored as a marketing upload so the builder can attach it to the
 * campaign. The key is the workspace's own when its plan allows one, else the platform's; the platform's key is asked for the monthly
 * allowance and then the wallet first (422 WALLET_EMPTY), and a flat token-equivalent is written to the ledger either way (an image is
 * priced per picture, not per token). When the platform's key drew the picture the wallet pays the vendor's per-picture price for the
 * model and size (`aiImageCostUsd`) plus the operator's markup. A refused prompt or a vendor failure writes, stores and charges nothing.
 */
@Injectable()
export class CampaignAiImageService {
  private readonly logger = new Logger(CampaignAiImageService.name);

  constructor(
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly wallet: AiChargeService,
    private readonly media: MarketingMediaService,
    @Inject(CAMPAIGN_AI_IMAGE_PORT) private readonly images: CampaignAiImagePort,
  ) {}

  async generate(input: CampaignAiImageInput): Promise<CampaignAiImageResponse> {
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

    // Nothing is drawn (or charged) when the picture could not be kept: a provider cannot fetch a file on local disk.
    if (!(await this.media.canStore())) {
      throw AppError.validation(
        'Files for messages need cloud object storage: ask the platform admin to turn it on, or paste a public address instead',
        [{ path: 'file', message: 'Storage is local.' }],
      );
    }

    // One id per vendor call; the request id is whatever `x-request-id` the caller sent, so it cannot name a charge.
    const usageId = randomUUID();
    let picture: { bytes: Buffer; mime: string };
    try {
      picture = await this.images.generate({
        provider: input.provider,
        model: input.model,
        apiKey: resolved.key,
        prompt: imagePromptOf(input),
        size: input.size,
      });
    } catch (err) {
      if (err instanceof CampaignAiImageRefusedError) {
        throw new AppError(
          ERROR_CODES.CAMP_AI_IMAGE_REFUSED,
          'The AI provider refused to draw this. Change the brief and try again.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      this.logger.warn({ err: String(err) }, '[CAMP] campaign image generation failed');
      throw new AppError(
        ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
        'AI provider returned no image — check API key + model id.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.meter
      .record(orgId, {
        provider: input.provider,
        model: input.model,
        promptTokens: 0,
        completionTokens: AI_IMAGE_TOKEN_EQUIVALENT,
        billedAgainst: resolved.source,
      })
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, '[CAMP] the AI token ledger write failed'),
      );
    // The vendor drew it, so it is paid for: by the picture, not by the token (the tokens above are only the allowance's unit).
    await this.wallet.chargeCall({
      orgId,
      keySource: resolved.source,
      label: 'AI campaign image',
      source: 'campaign_ai_image',
      usageId,
      provider: input.provider,
      model: input.model,
      promptTokens: 0,
      completionTokens: 0,
      reportedCostUsd: aiImageCostUsd(input.model, input.size),
    });

    const image = await this.media.upload({
      originalname: `ai-${Date.now()}.png`,
      buffer: picture.bytes,
    });
    return { image, model: input.model };
  }
}
