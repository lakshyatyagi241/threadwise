import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type CreatePricingFaqRequest,
  type PricingFaq,
  type PricingFaqListResponse,
  type PublicFaqListResponse,
  type UpdatePricingFaqRequest,
  createPricingFaqRequestSchema,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService } from '../auth';
import { PlanStore } from './plan-store';

interface FaqRow {
  uuid: string;
  question: string;
  answer: string;
  sort_order: number;
  placement: PricingFaq['placement'];
  is_active: boolean;
  row_version: number;
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = sql`uuid, question, answer, sort_order, placement, is_active, row_version, created_at, updated_at`;
const iso = (v: string | Date) => new Date(v).toISOString();

const toItem = (r: FaqRow): PricingFaq => ({
  id: r.uuid,
  question: r.question,
  answer: r.answer,
  sortOrder: Number(r.sort_order),
  placement: r.placement,
  isActive: r.is_active,
  rowVersion: Number(r.row_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/**
 * Pricing FAQs (WD-PLAN-009): the operator's CRUD and the three readers. The table is readable by every connection (RLS
 * `read_all`) and writable only on a privileged connection, so reads use the plain pool and every write goes through PlanStore.
 * Improvements over WaDesk, all deliberate: the update takes the fields it changes (a missing checkbox no longer switches a FAQ
 * off), every write is audited, and the public pricing page reads this table instead of a separate CMS copy.
 */
@Injectable()
export class PricingFaqService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlanStore,
    private readonly audit: AuthAuditService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  async list(): Promise<PricingFaqListResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT ${COLUMNS} FROM pricing_faqs ORDER BY sort_order, id`,
    );
    return { data: (res.rows as unknown as FaqRow[]).map(toItem) };
  }

  /** `all`: the in-app plan picker (every active FAQ). `pricing` / `home`: that placement plus `both`. */
  async readers(audience: 'all' | 'pricing' | 'home'): Promise<PublicFaqListResponse> {
    const res = await this.db.primary.execute(
      audience === 'all'
        ? sql`SELECT uuid, question, answer FROM pricing_faqs WHERE is_active ORDER BY sort_order, id`
        : sql`SELECT uuid, question, answer FROM pricing_faqs
              WHERE is_active AND placement IN (${audience}, 'both') ORDER BY sort_order, id`,
    );
    return {
      data: (res.rows as unknown as Array<{ uuid: string; question: string; answer: string }>).map(
        (r) => ({
          id: r.uuid,
          question: r.question,
          answer: r.answer,
        }),
      ),
    };
  }

  async create(input: CreatePricingFaqRequest): Promise<PricingFaq> {
    const body = createPricingFaqRequestSchema.parse(input);
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const order = body.sortOrder ?? (await this.nextOrder(tx));
      const res = await tx.execute(sql`
        INSERT INTO pricing_faqs (question, answer, sort_order, placement, is_active)
        VALUES (${body.question}, ${body.answer}, ${order}, ${body.placement}, ${body.isActive})
        RETURNING ${COLUMNS}`);
      const row = res.rows[0] as unknown as FaqRow;
      await this.record(tx, 'platform.plan.faq_created', operatorId, {
        id: row.uuid,
        question: row.question,
      });
      return toItem(row);
    });
  }

  async update(uuid: string, patch: UpdatePricingFaqRequest): Promise<PricingFaq> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const stored = await this.lock(tx, uuid);
      if (Number(stored.row_version) !== patch.rowVersion)
        throw AppError.rowVersionConflict('PricingFaq');
      const next = {
        question: patch.question ?? stored.question,
        answer: patch.answer ?? stored.answer,
        sortOrder: patch.sortOrder ?? Number(stored.sort_order),
        placement: patch.placement ?? stored.placement,
        isActive: patch.isActive ?? stored.is_active,
      };
      const res = await tx.execute(sql`
        UPDATE pricing_faqs SET question = ${next.question}, answer = ${next.answer}, sort_order = ${next.sortOrder},
               placement = ${next.placement}, is_active = ${next.isActive}
        WHERE uuid = ${uuid}::uuid RETURNING ${COLUMNS}`);
      const row = res.rows[0] as unknown as FaqRow;
      await this.record(tx, 'platform.plan.faq_updated', operatorId, {
        id: uuid,
        fields: Object.keys(patch).filter((k) => k !== 'rowVersion'),
      });
      return toItem(row);
    });
  }

  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const stored = await this.lock(tx, uuid);
      await tx.execute(sql`DELETE FROM pricing_faqs WHERE uuid = ${uuid}::uuid`);
      await this.record(tx, 'platform.plan.faq_deleted', operatorId, {
        id: uuid,
        question: stored.question,
      });
    });
  }

  private async nextOrder(tx: Tx): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(sort_order), 0) + 1 AS n FROM pricing_faqs`,
    );
    return Math.min(9999, Number((res.rows[0] as { n: number }).n));
  }

  private async lock(tx: Tx, uuid: string): Promise<FaqRow> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM pricing_faqs WHERE uuid = ${uuid}::uuid FOR UPDATE`,
    );
    const row = res.rows[0] as unknown as FaqRow | undefined;
    if (!row) throw AppError.notFound('FAQ');
    return row;
  }

  private async record(
    tx: Tx,
    event: string,
    operatorId: number,
    payload: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload,
    });
  }
}
