import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AIAG_BUILDER_DEFAULTS,
  type AiagAssistant,
  type AiagPickerResponse,
  type CreateAiagAssistantInput,
  type ListAiagAssistantsQuery,
  type ListAiagAssistantsResponse,
  type UpdateAiagAssistantInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TRAINING_FILE_STORE,
  type TrainingFileStore,
} from '../../infra/providers/ai-agents-training/training-file-store.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  AssistantsRepository,
  type AssistantRow,
  type AssistantWrite,
} from './assistants.repository';
import { SourcesRepository } from './sources.repository';
import { SOURCE_REQUESTED } from './source-events';
import { toAssistant, toPickerItem } from './training.mapper';
import { copyName, copySlug, slugBase, uniqueSlug } from './training-rules';

export const MODULE_KEY = 'ai_chat_assistants';

/** Fields whose change is worth a line in the audit trail; the prompt is long, so only the fact that it changed is kept. */
const AUDITED: ReadonlyArray<keyof AssistantRow> = [
  'name',
  'status',
  'tone',
  'language',
  'aiProvider',
  'aiModel',
  'replyMaxTokens',
  'temperature',
  'handoffEnabled',
  'handoffKeyword',
];
const TEXT_FIELDS: ReadonlyArray<keyof AssistantRow> = [
  'greeting',
  'systemPrompt',
  'fallbackMessage',
  'handoffMessage',
];

/**
 * The assistants of AI Training: list with stats, the picker, builder save, duplicate and delete (TW-AIAG-001..004, 011, 012).
 *
 * Every write is one transaction that also writes its audit row and its outbox event. Reference wrote neither.
 */
@Injectable()
export class AssistantsService {
  private readonly logger = new Logger(AssistantsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AssistantsRepository,
    private readonly sources: SourcesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(TRAINING_FILE_STORE) private readonly files: TrainingFileStore,
  ) {}

  async list(query: ListAiagAssistantsQuery): Promise<ListAiagAssistantsResponse> {
    const orgId = RequestContextStore.orgId();
    const afterId = query.cursor ? decodeCursor(query.cursor).id : null;
    const { rows, stats } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, orgId, { limit: query.limit, afterId }),
      stats: await this.repo.stats(tx, orgId),
    }));
    const { items, page } = buildPage(rows, query.limit);
    return { data: items.map(toAssistant), page, stats };
  }

  async picker(): Promise<AiagPickerResponse> {
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx((tx) => this.repo.picker(tx, orgId));
    return { data: rows.map(toPickerItem) };
  }

  async get(uuid: string): Promise<AiagAssistant> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Assistant', uuid);
    return toAssistant(row);
  }

  async create(input: CreateAiagAssistantInput): Promise<AiagAssistant> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      await this.repo.lockSlugs(tx, ctx.orgId);
      const slug = uniqueSlug(
        slugBase(input.name),
        await this.repo.slugsLike(tx, ctx.orgId, slugBase(input.name)),
      );
      const id = await this.repo.insert(tx, ctx.orgId, ctx.userId, slug, fromInput(input));
      const created = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.record(tx, created, 'insert', 'ai_assistant.created');
      return created;
    });
    return toAssistant(row);
  }

  async update(uuid: string, input: UpdateAiagAssistantInput): Promise<AiagAssistant> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      // Reference created a NEW assistant when the id was not found (another workspace's, a deleted one). Fixed: it is a 404.
      if (!current) throw AppError.notFound('Assistant', uuid);
      const ok = await this.repo.update(
        tx,
        orgId,
        current.id,
        merge(current, input),
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Assistant');
      const saved = (await this.repo.findById(tx, orgId, current.id))!;
      await this.record(tx, saved, 'update', 'ai_assistant.updated', diff(current, saved));
      return saved;
    });
    return toAssistant(row);
  }

  /**
   * A copy named "<name> (copy)", paused, with the original's entries. Reference's copy pointed at the SAME stored file as the
   * original, so deleting either entry deleted the file under the other; here every file is copied.
   */
  async duplicate(uuid: string): Promise<AiagAssistant> {
    const ctx = RequestContextStore.require();
    const copiedKeys: string[] = [];
    try {
      const row = await this.db.tx(async (tx) => {
        const src = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!src) throw AppError.notFound('Assistant', uuid);
        const id = await this.repo.insert(tx, ctx.orgId, ctx.userId, copySlug(src.slug), {
          ...writeOf(src),
          name: copyName(src.name),
          status: 'paused',
        });
        const pendingIds: number[] = [];
        for (const s of await this.sources.ownedBy(tx, ctx.orgId, src.id)) {
          const filePath = s.filePath ? await this.files.copy(ctx.orgId, s.filePath) : null;
          if (filePath) copiedKeys.push(filePath);
          const newId = await this.sources.insert(tx, ctx.orgId, {
            assistantId: id,
            userId: ctx.userId,
            kind: s.kind,
            label: s.label,
            url: s.url,
            filePath,
            content: s.content,
            question: s.question,
            answer: s.answer,
            status: s.status,
            tokensEstimate: s.tokensEstimate,
            error: s.error,
          });
          if (s.status === 'processing') pendingIds.push(newId);
        }
        const withCount = (await this.repo.findById(tx, ctx.orgId, id))!;
        await this.record(tx, withCount, 'insert', 'ai_assistant.created', undefined, {
          duplicatedFrom: src.uuid,
        });
        for (const sid of pendingIds) await this.requestIngest(tx, sid);
        return withCount;
      });
      return toAssistant(row);
    } catch (err) {
      // The transaction rolled back: the files copied for it belong to no entry.
      await Promise.all(
        copiedKeys.map((k) => this.files.remove(ctx.orgId, k).catch(() => undefined)),
      );
      throw err;
    }
  }

  /** Deletes the assistant; its entries go with it (foreign key cascade) and so do their stored files. */
  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    const keys = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      if (!current) throw AppError.notFound('Assistant', uuid);
      const fileKeys = await this.sources.fileKeysOf(tx, orgId, current.id);
      await this.repo.delete(tx, orgId, current.id);
      await this.record(tx, current, 'delete', 'ai_assistant.deleted');
      return fileKeys;
    });
    // After the commit: a file removed for a delete that then rolled back would be lost for good. A failure leaves an orphan
    // file, never an entry; it is logged without the key.
    for (const key of keys) {
      await this.files.remove(orgId, key).catch(() => {
        this.logger.warn(
          { orgId },
          'a knowledge file could not be removed after its assistant was deleted',
        );
      });
    }
  }

  private async requestIngest(tx: Tx, sourceId: number): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: 'ai_training_sources',
      aggregateId: sourceId,
      eventType: SOURCE_REQUESTED,
      payload: {},
    });
  }

  private async record(
    tx: Tx,
    row: AssistantRow,
    action: 'insert' | 'update' | 'delete',
    eventType: string,
    delta?: Record<string, { old: unknown; new: unknown }>,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action, delta });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      payload: { uuid: row.uuid, name: row.name, status: row.status, ...extra },
    });
  }
}

/** A create's input with the wizard's starting values where a field was left out. */
function fromInput(i: CreateAiagAssistantInput): AssistantWrite {
  return {
    name: i.name,
    greeting: i.greeting ?? null,
    systemPrompt: i.systemPrompt ?? null,
    tone: i.tone ?? AIAG_BUILDER_DEFAULTS.tone,
    language: i.language ?? AIAG_BUILDER_DEFAULTS.language,
    aiProvider: i.aiProvider ?? AIAG_BUILDER_DEFAULTS.aiProvider,
    aiModel: i.aiModel ?? AIAG_BUILDER_DEFAULTS.aiModel,
    replyMaxTokens: i.replyMaxTokens ?? AIAG_BUILDER_DEFAULTS.replyMaxTokens,
    temperature: i.temperature ?? AIAG_BUILDER_DEFAULTS.temperature,
    fallbackMessage: i.fallbackMessage ?? null,
    handoffEnabled: i.handoffEnabled ?? AIAG_BUILDER_DEFAULTS.handoffEnabled,
    handoffKeyword: i.handoffKeyword ?? null,
    handoffMessage: i.handoffMessage ?? null,
    status: i.status ?? AIAG_BUILDER_DEFAULTS.status,
  };
}

const writeOf = (r: AssistantRow): AssistantWrite => ({
  name: r.name,
  greeting: r.greeting,
  systemPrompt: r.systemPrompt,
  tone: r.tone,
  language: r.language,
  aiProvider: r.aiProvider,
  aiModel: r.aiModel,
  replyMaxTokens: r.replyMaxTokens,
  temperature: r.temperature,
  fallbackMessage: r.fallbackMessage,
  handoffEnabled: r.handoffEnabled,
  handoffKeyword: r.handoffKeyword,
  handoffMessage: r.handoffMessage,
  status: r.status,
});

/** A save over the stored row: a field the payload leaves out keeps its stored value; one sent as null/blank clears it. */
function merge(cur: AssistantRow, i: UpdateAiagAssistantInput): AssistantWrite {
  const base = writeOf(cur);
  return {
    name: i.name,
    greeting: i.greeting === undefined ? base.greeting : i.greeting,
    systemPrompt: i.systemPrompt === undefined ? base.systemPrompt : i.systemPrompt,
    tone: i.tone ?? base.tone,
    language: i.language ?? base.language,
    aiProvider: i.aiProvider ?? base.aiProvider,
    aiModel: i.aiModel ?? base.aiModel,
    replyMaxTokens: i.replyMaxTokens ?? base.replyMaxTokens,
    temperature: i.temperature ?? base.temperature,
    fallbackMessage: i.fallbackMessage === undefined ? base.fallbackMessage : i.fallbackMessage,
    handoffEnabled: i.handoffEnabled ?? base.handoffEnabled,
    handoffKeyword: i.handoffKeyword === undefined ? base.handoffKeyword : i.handoffKeyword,
    handoffMessage: i.handoffMessage === undefined ? base.handoffMessage : i.handoffMessage,
    status: i.status ?? base.status,
  };
}

function diff(
  a: AssistantRow,
  b: AssistantRow,
): Record<string, { old: unknown; new: unknown }> | undefined {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of AUDITED) if (a[k] !== b[k]) out[k] = { old: a[k], new: b[k] };
  for (const k of TEXT_FIELDS) if (a[k] !== b[k]) out[k] = { old: '[changed]', new: '[changed]' };
  return Object.keys(out).length ? out : undefined;
}
