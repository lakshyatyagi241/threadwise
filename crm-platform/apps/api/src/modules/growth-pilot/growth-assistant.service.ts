import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type BroadcastAssistantInput,
  type BroadcastRecommendation,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  LEAD_SCORING_AI_PORT,
  LeadScoringAiError,
  type LeadScoringAiPort,
} from '../../infra/providers/lead-scoring/lead-scoring-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { AI_PROVIDER, LeadScoringConfigService, maskPii } from '../lead-scoring';
import { GrowthGateService } from './growth-gate.service';
import { GrowthService } from './growth.service';
import { GrowthRepository } from './growth.repository';
import { assistantPrompt, parseRecommendation, type AssistantCandidates } from './growth.rules';

const MAX_TOKENS = 700;

/**
 * "Suggest the best broadcast for my goal." It only recommends: it picks one audience (a contact group) and one approved template from
 * what the workspace really has, weighing each template by the replies it really got, and explains why. It sends nothing and creates
 * nothing; a person takes the choice to the campaign wizard. Both ids in the answer must be ones it was given.
 */
@Injectable()
export class GrowthAssistantService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    private readonly gate: GrowthGateService,
    private readonly growth: GrowthService,
    private readonly config: LeadScoringConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(LEAD_SCORING_AI_PORT) private readonly ai: LeadScoringAiPort,
  ) {}

  async recommend(orgId: number, input: BroadcastAssistantInput): Promise<BroadcastRecommendation> {
    await this.gate.require(orgId, 'broadcast_assistant');
    const cfg = await this.config.getFresh();
    if (!cfg.platformEnabled) {
      throw new AppError(
        ERROR_CODES.LSC_PLATFORM_DISABLED,
        'AI is switched off for the whole platform right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const found = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      audiences: await this.repo.audienceCandidates(tx, orgId),
      templates: await this.repo.templateCandidates(tx, orgId),
      rates: await this.repo.templateReplyRates(tx, orgId),
    }));
    if (found.audiences.length === 0 || found.templates.length === 0) {
      throw new AppError(
        ERROR_CODES.GRW_ASSISTANT_FAILED,
        'There is no audience group (5 or more contacts) or no approved template to choose from yet.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const times = await this.growth.sendTimesIn(orgId).catch(() => null);
    const candidates: AssistantCandidates = {
      audiences: found.audiences,
      templates: found.templates.map((t) => {
        const r = found.rates.get(t.internalId);
        return {
          id: t.id,
          name: t.name,
          category: t.category,
          body: t.body,
          sent: r?.sent ?? 0,
          replyRate24h: r?.replyRate24h ?? null,
        };
      }),
      bestHours: times?.bestHours ?? [],
    };

    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      throw new AppError(
        ERROR_CODES.LSC_NO_KEY,
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (resolved.source === 'admin') await this.meter.guard(orgId);

    const prompt = assistantPrompt(maskPii(input.goal), candidates);
    let completion;
    try {
      completion = await this.ai.complete({
        apiKey: resolved.key,
        model: cfg.model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: await this.keys.capMaxTokens(AI_PROVIDER, MAX_TOKENS),
      });
    } catch (err) {
      if (err instanceof LeadScoringAiError) {
        throw new AppError(
          ERROR_CODES.GRW_ASSISTANT_FAILED,
          err.kind === 'auth'
            ? 'The AI provider refused the saved key.'
            : 'The AI provider could not answer right now. Try again in a moment.',
          err.kind === 'auth' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
        );
      }
      throw err;
    }
    // Paid for either way.
    await this.meter
      .record(orgId, {
        provider: AI_PROVIDER,
        model: cfg.model,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        billedAgainst: resolved.source,
      })
      .catch(() => undefined);
    const parsed = parseRecommendation(completion.text, candidates);
    if (!parsed) {
      throw new AppError(
        ERROR_CODES.GRW_ASSISTANT_FAILED,
        'The AI answered something that is not a usable recommendation. Try again, or rephrase the goal.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      ...parsed,
      considered: {
        audiences: candidates.audiences.length,
        templates: candidates.templates.length,
      },
    };
  }
}
