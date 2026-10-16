import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CompanyBrief,
  type CompanyBriefResult,
  type CompanyBriefState,
  type GenerateCompanyBriefInput,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FLOW_AI_PORT,
  type FlowAiPort,
} from '../../infra/providers/flow-runtime-engine/flow-ai.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import {
  BRIEF_CACHE_MS,
  BRIEF_COOLDOWN_MS,
  BRIEF_MAX_COMPLETION_TOKENS,
  briefPrompt,
  factsHash,
  parseBrief,
  sourcesOf,
  type BriefFacts,
} from './brief-rules';
import { BriefFactsService } from './brief-facts.service';
import { CompanyBriefsRepository, type BriefRow } from './company-briefs.repository';

/**
 * The vendors a brief can be written by, best first: the workspace's own key for any of them wins over the platform's. Every one speaks
 * through the single-completion port (`FLOW_AI_PORT`), the same door the flow AI node uses.
 */
const PROVIDERS = ['anthropic', 'openai', 'gemini', 'mistral', 'deepseek', 'groq'] as const;
const DEFAULT_MODEL: Record<(typeof PROVIDERS)[number], string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.5-flash',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
};

interface ResolvedAi {
  provider: (typeof PROVIDERS)[number];
  model: string;
  key: string;
  source: 'workspace' | 'admin';
}

/**
 * "Generate brief" (BL-194). The facts come from `BriefFactsService` (what the caller may see, no personal details); the model writes the
 * brief through the AI key setup of the workspace (its own key first, then the platform's, metered like every other AI call); the brief
 * is stored per company and per person, which is also the cache. Rules, in the order they are applied on a request:
 *
 *   1. the company must be inside the caller's scope (404 otherwise), and the facts are read as the caller;
 *   2. the same facts within a day return the stored brief and call nothing (`regenerate` skips this);
 *   3. a second generation within 30 seconds is refused (429), so a double click or a loop costs one call;
 *   4. no key available is 422 COMPANY_BRIEF_AI_UNAVAILABLE and nothing is sent anywhere;
 *   5. the answer must be a brief; one that is not is 502 and the previous brief is kept.
 *
 * The audit trail records who generated a brief for which company, with the model and token counts, and never the facts or the text.
 */
@Injectable()
export class CompanyBriefsService {
  private readonly logger = new Logger(CompanyBriefsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CompanyBriefsRepository,
    private readonly facts: BriefFactsService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly audit: AuditService,
    @Inject(FLOW_AI_PORT) private readonly ai: FlowAiPort,
  ) {}

  /** Whether a brief can be made and the caller's latest one. Calls no model. */
  async state(uuid: string, scope: RecordScope): Promise<CompanyBriefState> {
    const ctx = RequestContextStore.require();
    const gathered = await this.facts.gather(uuid, scope);
    const hash = factsHash(gathered.facts);
    const [row, ai] = await Promise.all([
      this.db.tx((tx) => this.repo.find(tx, ctx.orgId, gathered.companyId, ctx.userId!)),
      this.resolveAi(ctx.orgId),
    ]);
    return {
      available: ai !== null,
      brief: row ? this.toBrief(row, hash, gathered.facts) : null,
      sources: sourcesOf(gathered.facts),
    };
  }

  async generate(
    uuid: string,
    scope: RecordScope,
    input: GenerateCompanyBriefInput,
  ): Promise<CompanyBriefResult> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId;
    if (!userId) throw AppError.forbidden('record.companies.read');
    const gathered = await this.facts.gather(uuid, scope);
    const hash = factsHash(gathered.facts);
    const existing = await this.db.tx((tx) =>
      this.repo.find(tx, ctx.orgId, gathered.companyId, userId),
    );

    const age = existing ? Date.now() - existing.updatedAt.getTime() : Infinity;
    if (existing && !input.regenerate && existing.inputHash === hash && age < BRIEF_CACHE_MS) {
      return { brief: this.toBrief(existing, hash, gathered.facts), cached: true };
    }
    if (existing && age < BRIEF_COOLDOWN_MS) {
      throw new AppError(
        ERROR_CODES.COMPANY_BRIEF_RATE_LIMITED,
        'A brief was written for this company a moment ago. Wait a little before asking again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resolved = await this.resolveAi(ctx.orgId);
    if (!resolved) {
      throw new AppError(
        ERROR_CODES.COMPANY_BRIEF_AI_UNAVAILABLE,
        'No AI key is available to this workspace, so a brief cannot be written. Ask an admin to add one.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        undefined,
        true,
      );
    }
    // Tokens billed to the platform's key count against the workspace's monthly allowance; its own key does not.
    if (resolved.source === 'admin') await this.meter.guard(ctx.orgId);

    const prompt = briefPrompt(gathered.facts, new Date().toISOString().slice(0, 10));
    let completion;
    try {
      completion = await this.ai.complete({
        provider: resolved.provider,
        model: resolved.model,
        apiKey: resolved.key,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        maxTokens: await this.keys.capMaxTokens(resolved.provider, BRIEF_MAX_COMPLETION_TOKENS),
        temperature: 0.3,
        json: true,
      });
    } catch (err) {
      this.logger.warn({ provider: resolved.provider, err: String(err) }, 'company brief failed');
      throw new AppError(
        ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED,
        'The AI service could not write the brief. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.meter
      .record(ctx.orgId, {
        provider: resolved.provider,
        model: resolved.model,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        billedAgainst: resolved.source,
      })
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, 'company brief usage not recorded'),
      );

    const content = parseBrief(completion.text);
    if (!content) {
      throw new AppError(
        ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED,
        'The AI service answered with something that is not a brief. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const saved = await this.db.tx(async (tx) => {
      const out = await this.repo.upsert(tx, ctx.orgId, {
        companyId: gathered.companyId,
        userId,
        inputHash: hash,
        content,
        provider: resolved.provider,
        model: resolved.model,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
      });
      await this.audit.record(tx, {
        module: 'company_briefs',
        recordId: gathered.companyId,
        action: out.replaced ? 'update' : 'insert',
        delta: {
          generated: {
            old: null,
            new: {
              provider: resolved.provider,
              model: resolved.model,
              billedAgainst: resolved.source,
              promptTokens: completion.promptTokens,
              completionTokens: completion.completionTokens,
              sources: sourcesOf(gathered.facts),
            },
          },
        },
      });
      return out.row;
    });
    return { brief: this.toBrief(saved, hash, gathered.facts), cached: false };
  }

  private toBrief(row: BriefRow, currentHash: string, facts: BriefFacts): CompanyBrief {
    return {
      id: row.uuid,
      content: row.content,
      sources: sourcesOf(facts),
      generatedAt: row.updatedAt.toISOString(),
      model: row.model,
      stale: row.inputHash !== currentHash,
    };
  }

  /** The workspace's own key first (any vendor), else the platform's; null when neither exists. */
  private async resolveAi(orgId: number): Promise<ResolvedAi | null> {
    for (const wanted of ['workspace', 'admin'] as const) {
      for (const provider of PROVIDERS) {
        const r = await this.keys.resolve(orgId, provider);
        if (r.key && r.source === wanted) {
          return { provider, model: r.model ?? DEFAULT_MODEL[provider], key: r.key, source: wanted };
        }
      }
    }
    return null;
  }
}
