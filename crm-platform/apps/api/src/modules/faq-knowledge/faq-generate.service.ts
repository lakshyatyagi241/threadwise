import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type FaqGenerateResult,
  type GenerateFaqVariationsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FAQ_AI_PORT,
  FaqAiError,
  type FaqAiPort,
} from '../../infra/providers/faq-knowledge/faq-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { FaqConfigService } from './faq-config.service';
import { FaqRepository } from './faq.repository';
import { parseSuggestions, suggestionPrompt } from './faq.rules';

const AI_PROVIDER = 'openrouter';

/**
 * "Auto generate": a cheap chat model writes how customers might phrase the question. Nothing is saved: the person reads the
 * suggestions and adds the ones they want, so a model's mistake never reaches the matcher unseen. Uses the same key resolution,
 * allowance guard and ledger as the embeddings.
 */
@Injectable()
export class FaqGenerateService {
  private readonly logger = new Logger(FaqGenerateService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FaqRepository,
    private readonly config: FaqConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(FAQ_AI_PORT) private readonly ai: FaqAiPort,
  ) {}

  async suggest(uuid: string, input: GenerateFaqVariationsInput): Promise<FaqGenerateResult> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    if (!cfg.engineEnabled) {
      throw new AppError(
        ERROR_CODES.FAQ_ENGINE_DISABLED,
        'FAQ answering is switched off for the whole platform right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { faq, existing } = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid, cfg.embeddingModel);
      if (!row) throw AppError.notFound('FAQ', uuid);
      const vars = await this.repo.listVariations(tx, orgId, row.id, cfg.embeddingModel);
      return { faq: row, existing: vars.map((v) => v.text) };
    });

    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      throw new AppError(
        ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE,
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (resolved.source === 'admin') await this.meter.guard(orgId);

    const prompt = suggestionPrompt(faq.question, existing, input.count);
    try {
      const out = await this.ai.complete({
        apiKey: resolved.key,
        model: cfg.generationModel,
        question: faq.question,
        existing,
        count: input.count,
        system: prompt.system,
        user: prompt.user,
      });
      await this.meter
        .record(orgId, {
          provider: AI_PROVIDER,
          model: cfg.generationModel,
          promptTokens: out.promptTokens,
          completionTokens: out.completionTokens,
          billedAgainst: resolved.source,
        })
        .catch((err) => this.logger.warn({ orgId, err }, 'faq generation usage not recorded'));
      return {
        suggestions: parseSuggestions(out.text, [faq.question, ...existing], input.count),
        model: cfg.generationModel,
      };
    } catch (err) {
      if (err instanceof FaqAiError) {
        throw new AppError(
          ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE,
          err.kind === 'auth'
            ? 'The AI provider refused the saved key.'
            : 'The AI provider could not write suggestions right now. Try again in a moment.',
          err.kind === 'auth' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
        );
      }
      throw err;
    }
  }
}
