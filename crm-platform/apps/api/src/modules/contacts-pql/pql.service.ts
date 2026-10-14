import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema } from '@crm/db';
import {
  ERROR_CODES,
  segmentKindForFieldType,
  fieldTypeSchema,
  type PqlRequest,
  type PqlResult,
  type SegmentGroup,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  LEAD_SCORING_AI_PORT as PQL_AI_PORT,
  LeadScoringAiError,
  type LeadScoringAiPort,
} from '../../infra/providers/lead-scoring/lead-scoring-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import {
  PQL_AI_PROVIDER,
  PQL_MAX_COMPLETION_TOKENS,
  parsePql,
  pqlPrompt,
  type PqlCatalog,
} from './pql.prompt';
import { pruneRules } from './pql.prune';

const { tags, contactGroups, users, statusOptions, fields } = schema;

/** A very cheap model is enough: the answer is a small JSON tree over a catalog the prompt lists. */
export const PQL_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const PER_USER_PER_MINUTE = 30;
const CATALOG_CAP = 300;

/**
 * Plain English contact search. Sends the model the query and the workspace's NAMES (tags, groups, owners, stages, custom field keys),
 * never a contact row. The answer is a segment rule tree that is validated against the shared schema and pruned to what exists; the
 * existing contact list compiles it, so RLS, owner scope and field permissions apply exactly as for any other filter.
 */
@Injectable()
export class PqlService {
  private readonly logger = new Logger(PqlService.name);
  /** Per process: a cap on one user's spend, not a precise global limit. */
  private readonly recent = new Map<number, number[]>();

  constructor(
    private readonly db: DatabaseService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(PQL_AI_PORT) private readonly ai: LeadScoringAiPort,
  ) {}

  async translate(input: PqlRequest): Promise<PqlResult> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    this.throttle(ctx.userId ?? 0);

    const resolved = await this.keys.resolve(orgId, PQL_AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      throw new AppError(
        ERROR_CODES.PQL_NO_KEY,
        'English search is not set up: no OpenRouter key is available.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (resolved.source === 'admin') await this.meter.guard(orgId);

    const catalog = await this.loadCatalog(orgId);
    const model = process.env.PQL_MODEL?.trim() || PQL_DEFAULT_MODEL;
    const prompt = pqlPrompt(input.query, catalog, new Date().toISOString().slice(0, 10));

    let completion;
    try {
      completion = await this.ai.complete({
        apiKey: resolved.key,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: await this.keys.capMaxTokens(PQL_AI_PROVIDER, PQL_MAX_COMPLETION_TOKENS),
      });
    } catch (err) {
      const kind = err instanceof LeadScoringAiError ? err.kind : 'provider';
      throw new AppError(
        ERROR_CODES.PQL_PROVIDER_FAILED,
        kind === 'auth'
          ? 'The AI provider refused the key.'
          : 'English search could not reach the AI provider. Try again in a moment.',
        kind === 'auth' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
      );
    }
    await this.meter
      .record(orgId, {
        provider: PQL_AI_PROVIDER,
        model,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        billedAgainst: resolved.source,
      })
      .catch((err) => this.logger.warn({ orgId, err }, 'pql usage not recorded'));

    const parsed = parsePql(completion.text);
    if (!parsed) {
      throw new AppError(
        ERROR_CODES.PQL_PROVIDER_FAILED,
        'English search got an answer it could not use. Try rewording the search.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!parsed.rules) return parsed;
    const pruned = pruneRules(parsed.rules as unknown as SegmentGroup, catalog);
    return {
      rules: pruned.rules as PqlResult['rules'],
      // The model's sentence describes every condition it wrote; once any was dropped it would overstate the filter.
      summary: pruned.dropped.length > 0 ? '' : parsed.summary,
      ignored: [...parsed.ignored, ...pruned.dropped.map((f) => `unknown ${f}`)].slice(0, 10),
    };
  }

  private throttle(userId: number): void {
    const now = Date.now();
    const hits = (this.recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= PER_USER_PER_MINUTE) {
      throw new AppError(
        ERROR_CODES.PLAN_LIMIT_REACHED,
        'Too many English searches this minute. Wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    hits.push(now);
    this.recent.set(userId, hits);
    // Idle users would otherwise stay in the map for the life of the process.
    if (this.recent.size > 1000) {
      for (const [id, times] of this.recent) {
        if (times.every((t) => now - t >= 60_000)) this.recent.delete(id);
      }
    }
  }

  private async loadCatalog(orgId: number): Promise<PqlCatalog> {
    return this.db.txAs({ orgId }, async (tx) => {
      const [tagRows, groupRows, ownerRows, optionRows, fieldRows] = await Promise.all([
        tx
          .select({ id: tags.uuid, name: tags.name })
          .from(tags)
          .where(eq(tags.orgId, orgId))
          .orderBy(asc(tags.name))
          .limit(CATALOG_CAP),
        tx
          .select({ id: contactGroups.uuid, name: contactGroups.name })
          .from(contactGroups)
          .where(eq(contactGroups.orgId, orgId))
          .orderBy(asc(contactGroups.name))
          .limit(CATALOG_CAP),
        tx
          .select({ id: users.uuid, name: users.fullName })
          .from(users)
          .where(and(eq(users.orgId, orgId), eq(users.status, 'active')))
          .orderBy(asc(users.fullName))
          .limit(CATALOG_CAP),
        tx
          .select({
            group: statusOptions.optionGroup,
            value: statusOptions.value,
            label: statusOptions.label,
          })
          .from(statusOptions)
          .where(
            and(
              eq(statusOptions.orgId, orgId),
              eq(statusOptions.moduleKey, 'contacts'),
              eq(statusOptions.isActive, true),
              inArray(statusOptions.optionGroup, ['lifecycle_stage', 'status', 'contact_status']),
            ),
          )
          .orderBy(asc(statusOptions.position)),
        tx
          .select({ key: fields.key, label: fields.label, type: fields.fieldType })
          .from(fields)
          .where(
            and(
              eq(fields.orgId, orgId),
              eq(fields.moduleKey, 'contacts'),
              eq(fields.isActive, true),
              eq(fields.isSystem, false),
            ),
          )
          .orderBy(asc(fields.position))
          .limit(CATALOG_CAP),
      ]);
      const customFields: PqlCatalog['customFields'] = [];
      for (const f of fieldRows) {
        const type = fieldTypeSchema.safeParse(f.type);
        const kind = type.success ? segmentKindForFieldType(type.data) : undefined;
        if (kind) customFields.push({ key: f.key, label: f.label, kind });
      }
      return {
        tags: tagRows.map((t) => ({ id: t.id, name: String(t.name) })),
        groups: groupRows,
        owners: ownerRows,
        stages: optionRows.filter((o) => o.group === 'lifecycle_stage'),
        statuses: optionRows.filter((o) => o.group !== 'lifecycle_stage'),
        customFields,
      };
    });
  }
}
