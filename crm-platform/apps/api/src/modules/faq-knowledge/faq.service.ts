import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type AddFaqVariationsInput,
  type BulkFaqEntriesInput,
  type CreateFaqEntryInput,
  type FaqBulkResult,
  type FaqEntry,
  type FaqEntryListResponse,
  type FaqVariation,
  type ListFaqEntriesQuery,
  type UpdateFaqEntryInput,
  type UpdateFaqVariationInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { FaqConfigService } from './faq-config.service';
import { FaqLogRepository } from './faq-log.repository';
import { toEntry, toSummary, toVariation } from './faq.mapper';
import { FaqRepository, type EntryRow, type EntryWrite } from './faq.repository';
import { sameKey, tidy } from './faq.rules';

export const MODULE_KEY = 'faqs';

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

const duplicateQuestion = (): AppError =>
  new AppError(
    ERROR_CODES.FAQ_DUPLICATE_QUESTION,
    'Another FAQ already has this question.',
    HttpStatus.CONFLICT,
    [{ path: 'question', message: 'Another FAQ already has this question.' }],
  );

const limitReached = (what: string, max: number): AppError =>
  new AppError(
    ERROR_CODES.FAQ_LIMIT_REACHED,
    `This workspace is at its limit of ${max} ${what}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/**
 * FAQ entries and their variations (the management side). Every write is one transaction that also writes its audit row and its
 * outbox event. The vectors are not made here: a new or edited phrasing is saved `pending` and the worker embeds it a few seconds
 * later (FaqEmbedWorker), so a save never waits on an AI vendor and never fails because one is down.
 */
@Injectable()
export class FaqService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FaqRepository,
    private readonly logs: FaqLogRepository,
    private readonly config: FaqConfigService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------

  async list(query: ListFaqEntriesQuery): Promise<FaqEntryListResponse> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    const afterId = query.cursor ? decodeCursor(query.cursor).id : null;
    const { rows, stats } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, orgId, {
        limit: query.limit,
        afterId,
        search: query.search,
        status: query.status,
        category: query.category,
        indexing: query.indexing,
        model: cfg.embeddingModel,
      }),
      stats: await this.repo.stats(tx, orgId, cfg.embeddingModel),
    }));
    const { items, page } = buildPage(rows, query.limit);
    return { data: items.map(toSummary), page, stats };
  }

  async get(uuid: string): Promise<FaqEntry> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid, cfg.embeddingModel);
      if (!row) throw AppError.notFound('FAQ', uuid);
      return toEntry(row, await this.repo.listVariations(tx, orgId, row.id, cfg.embeddingModel));
    });
  }

  // --- entries ------------------------------------------------------------------------------------------------------

  async create(input: CreateFaqEntryInput): Promise<FaqEntry> {
    const ctx = RequestContextStore.require();
    const cfg = await this.engineOn();
    try {
      return await this.db.tx(async (tx) => {
        if ((await this.repo.countFaqs(tx, ctx.orgId)) >= cfg.maxFaqs)
          throw limitReached('FAQs', cfg.maxFaqs);
        const write = await this.writeOf(tx, ctx.orgId, input);
        if (await this.repo.questionTaken(tx, ctx.orgId, write.question, null))
          throw duplicateQuestion();
        const extra = this.freshTexts(write.question, input.variations);
        if (1 + extra.length > cfg.maxVariationsPerFaq)
          throw limitReached('variations per FAQ', cfg.maxVariationsPerFaq);
        const id = await this.repo.insertEntry(tx, ctx.orgId, ctx.userId, write);
        await this.repo.syncQuestionVariation(tx, ctx.orgId, id, write.question);
        await this.repo.insertVariations(tx, ctx.orgId, id, extra, 'manual');
        if (input.resolveLogId) {
          const log = await this.logs.findByUuid(tx, ctx.orgId, input.resolveLogId);
          if (log) {
            await this.logs.resolve(tx, ctx.orgId, log.internalId);
            if (log.query) await this.logs.resolveSameQuery(tx, ctx.orgId, log.query);
          }
        }
        const created = (await this.repo.findById(tx, ctx.orgId, id, cfg.embeddingModel))!;
        await this.record(tx, created, 'insert', 'faq.created');
        return toEntry(
          created,
          await this.repo.listVariations(tx, ctx.orgId, id, cfg.embeddingModel),
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateQuestion();
      throw err;
    }
  }

  async update(uuid: string, input: UpdateFaqEntryInput): Promise<FaqEntry> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.engineOn();
    try {
      return await this.db.tx(async (tx) => {
        const current = await this.repo.findByUuid(tx, orgId, uuid, cfg.embeddingModel);
        if (!current) throw AppError.notFound('FAQ', uuid);
        const write = await this.writeOf(tx, orgId, input);
        if (
          sameKey(write.question) !== sameKey(current.question) &&
          (await this.repo.questionTaken(tx, orgId, write.question, current.id))
        ) {
          throw duplicateQuestion();
        }
        const ok = await this.repo.updateEntry(tx, orgId, current.id, write, input.rowVersion);
        if (!ok) throw AppError.rowVersionConflict('FAQ');
        if (write.question !== current.question) {
          await this.repo.syncQuestionVariation(tx, orgId, current.id, write.question);
        }
        const saved = (await this.repo.findById(tx, orgId, current.id, cfg.embeddingModel))!;
        await this.record(tx, saved, 'update', 'faq.updated', diff(current, saved));
        return toEntry(
          saved,
          await this.repo.listVariations(tx, orgId, saved.id, cfg.embeddingModel),
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateQuestion();
      throw err;
    }
  }

  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid, cfg.embeddingModel);
      if (!row) throw AppError.notFound('FAQ', uuid);
      await this.repo.deleteMany(tx, orgId, [row.id]);
      await this.record(tx, row, 'delete', 'faq.deleted');
    });
  }

  async bulk(input: BulkFaqEntriesInput): Promise<FaqBulkResult> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    return this.db.tx(async (tx) => {
      const found = await this.repo.idsByUuids(tx, orgId, input.ids);
      const ids = found.map((f) => f.id);
      let affected = 0;
      if (input.action === 'delete') {
        const rows: EntryRow[] = [];
        for (const f of found) {
          const r = await this.repo.findById(tx, orgId, f.id, cfg.embeddingModel);
          if (r) rows.push(r);
        }
        affected = await this.repo.deleteMany(tx, orgId, ids);
        for (const r of rows) await this.record(tx, r, 'delete', 'faq.deleted');
      } else {
        const status = input.action === 'pause' ? 'paused' : 'active';
        affected = await this.repo.setStatus(tx, orgId, ids, status);
        for (const f of found) {
          const r = await this.repo.findById(tx, orgId, f.id, cfg.embeddingModel);
          if (r)
            await this.record(tx, r, 'update', 'faq.updated', {
              status: { old: status === 'paused' ? 'active' : 'paused', new: status },
            });
        }
      }
      return { affected };
    });
  }

  // --- variations ---------------------------------------------------------------------------------------------------

  /** Adds phrasings; one the FAQ already has (ignoring case and spacing) is skipped. Returns the ones that were new. */
  async addVariations(uuid: string, input: AddFaqVariationsInput): Promise<FaqVariation[]> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.engineOn();
    return this.db.tx(async (tx) => {
      const faq = await this.repo.findByUuid(tx, orgId, uuid, cfg.embeddingModel);
      if (!faq) throw AppError.notFound('FAQ', uuid);
      const texts = this.freshTexts(faq.question, input.texts);
      const have = await this.repo.variationCount(tx, orgId, faq.id);
      if (have + texts.length > cfg.maxVariationsPerFaq) {
        // Take what fits and say so: a partial add of a generated batch beats refusing the whole batch.
        const room = Math.max(0, cfg.maxVariationsPerFaq - have);
        if (room === 0) throw limitReached('variations per FAQ', cfg.maxVariationsPerFaq);
        texts.length = room;
      }
      const created = await this.repo.insertVariations(tx, orgId, faq.id, texts, input.source);
      if (created.length > 0) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: faq.id,
          action: 'update',
          delta: { variations: { old: have, new: have + created.length } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: faq.id,
          eventType: 'faq.variations_added',
          payload: { uuid: faq.uuid, added: created.length, source: input.source },
        });
      }
      return created.map(toVariation);
    });
  }

  async updateVariation(
    faqUuid: string,
    variationUuid: string,
    input: UpdateFaqVariationInput,
  ): Promise<FaqVariation> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.engineOn();
    try {
      return await this.db.tx(async (tx) => {
        const faq = await this.repo.findByUuid(tx, orgId, faqUuid, cfg.embeddingModel);
        if (!faq) throw AppError.notFound('FAQ', faqUuid);
        const v = await this.repo.findVariation(tx, orgId, faq.id, variationUuid);
        if (!v) throw AppError.notFound('Variation', variationUuid);
        if (v.source === 'question') {
          throw AppError.validation('The question itself is edited on the FAQ.', [
            { path: 'text', message: 'Edit the FAQ question instead.' },
          ]);
        }
        const text = tidy(input.text);
        if (!(await this.repo.updateVariationText(tx, orgId, v.id, text, input.rowVersion))) {
          throw AppError.rowVersionConflict('Variation');
        }
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: faq.id,
          action: 'update',
          delta: { variation: { old: '[changed]', new: '[changed]' } },
        });
        const next = await this.repo.findVariation(tx, orgId, faq.id, variationUuid);
        return toVariation(next!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'The FAQ already has this variation.',
          HttpStatus.CONFLICT,
          [{ path: 'text', message: 'The FAQ already has this variation.' }],
        );
      }
      throw err;
    }
  }

  async removeVariation(faqUuid: string, variationUuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    await this.db.tx(async (tx) => {
      const faq = await this.repo.findByUuid(tx, orgId, faqUuid, cfg.embeddingModel);
      if (!faq) throw AppError.notFound('FAQ', faqUuid);
      const v = await this.repo.findVariation(tx, orgId, faq.id, variationUuid);
      if (!v) throw AppError.notFound('Variation', variationUuid);
      if (v.source === 'question') {
        throw AppError.validation('The question itself cannot be removed here.', [
          { path: 'id', message: 'Delete the FAQ instead.' },
        ]);
      }
      await this.repo.deleteVariation(tx, orgId, v.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: faq.id,
        action: 'update',
        delta: { variation: { old: '[removed]', new: null } },
      });
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------------------

  private async engineOn() {
    const cfg = await this.config.get();
    if (!cfg.engineEnabled) {
      throw new AppError(
        ERROR_CODES.FAQ_ENGINE_DISABLED,
        'FAQ answering is switched off for the whole platform right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return cfg;
  }

  /** The phrasings worth saving: tidy, no repeats, none equal to the question (it is already a variation). */
  private freshTexts(question: string, texts: readonly string[]): string[] {
    const seen = new Set([sameKey(question)]);
    const out: string[] = [];
    for (const t of texts) {
      const k = sameKey(t);
      if (k === '' || seen.has(k)) continue;
      seen.add(k);
      out.push(tidy(t));
    }
    return out;
  }

  private async writeOf(
    tx: Tx,
    orgId: number,
    i: {
      question: string;
      answerType: 'text' | 'flow';
      answerText?: string | null;
      flowId?: string | null;
      category?: string | null;
      status?: 'active' | 'paused';
      thresholdOverride?: number | null;
    },
  ): Promise<EntryWrite> {
    let flowId: number | null = null;
    if (i.answerType === 'flow') {
      const flow = await this.repo.flowByUuid(tx, orgId, i.flowId!);
      if (!flow) {
        throw new AppError(
          ERROR_CODES.FAQ_FLOW_NOT_FOUND,
          'That flow is not in this workspace.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'flowId', message: 'Pick a flow from this workspace.' }],
        );
      }
      flowId = flow.id;
    }
    return {
      question: tidy(i.question),
      answerType: i.answerType,
      answerText: i.answerType === 'text' ? (i.answerText ?? '').trim() : null,
      flowId,
      category: i.category ? tidy(i.category) : null,
      status: i.status ?? 'active',
      thresholdOverride: i.thresholdOverride ?? null,
    };
  }

  private async record(
    tx: Tx,
    row: EntryRow,
    action: 'insert' | 'update' | 'delete',
    eventType: string,
    delta?: Record<string, { old: unknown; new: unknown }>,
  ): Promise<void> {
    await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action, delta });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      payload: {
        uuid: row.uuid,
        question: row.question,
        status: row.status,
        answerType: row.answerType,
      },
    });
  }
}

/** Fields whose change is worth an audit line; the answer text is long, so only the fact that it changed is kept. */
function diff(
  a: EntryRow,
  b: EntryRow,
): Record<string, { old: unknown; new: unknown }> | undefined {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of [
    'question',
    'answerType',
    'category',
    'status',
    'thresholdOverride',
    'flowId',
  ] as const) {
    if (a[k] !== b[k]) out[k] = { old: a[k], new: b[k] };
  }
  if (a.answerText !== b.answerText) out.answerText = { old: '[changed]', new: '[changed]' };
  return Object.keys(out).length ? out : undefined;
}
