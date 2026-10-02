import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ListReviewsQuery,
  ListReviewsResponse,
  ModerateReviewInput,
  ReviewResponse,
  ReviewStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';

export const REVIEW_MODULE = 'product_reviews';

interface ReviewRow {
  id: number;
  uuid: string;
  createdAt: Date;
  createdAtIso: string;
  customerName: string | null;
  rating: number;
  body: string | null;
  status: ReviewStatus;
  productUuid: string | null;
  productName: string | null;
  productSlug: string | null;
}

type Raw = Record<string, unknown>;
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const toRow = (r: Raw): ReviewRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  customerName: (r.customer_name as string | null) ?? null,
  rating: Number(r.rating),
  body: (r.body as string | null) ?? null,
  status: r.status as ReviewStatus,
  productUuid: (r.product_uuid as string | null) ?? null,
  productName: (r.product_name as string | null) ?? null,
  productSlug: (r.product_slug as string | null) ?? null,
});

const toResponse = (r: ReviewRow): ReviewResponse => ({
  id: r.uuid,
  product: r.productUuid
    ? { id: r.productUuid, name: r.productName ?? '', slug: r.productSlug ?? '' }
    : null,
  customerName: r.customerName,
  rating: r.rating,
  body: r.body,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});

const SELECT = sql`
  SELECT r.id, r.uuid, r.created_at, to_char(r.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         r.customer_name, r.rating, r.body, r.status,
         p.uuid AS product_uuid, p.name AS product_name, p.slug AS product_slug
  FROM wa_product_reviews r
  LEFT JOIN wa_products p ON p.org_id = r.org_id AND p.id = r.product_id`;

/**
 * Moderation of the reviews customers post on the public shop (TW-CAT-027). They arrive `pending`; only approved ones show on
 * the product page. The shop writes them through `StorefrontProductsReader.createPendingReview`.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListReviewsQuery): Promise<ListReviewsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const after = cursor
        ? sql`AND (r.created_at, r.id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
        : sql``;
      const res = await tx.execute(sql`
        ${SELECT}
        WHERE r.org_id = ${ctx.orgId} AND r.status = ${query.status} ${after}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${query.limit + 1}`);
      const { items, page } = buildPage((res.rows as Raw[]).map(toRow), query.limit);
      const counts = await tx.execute(sql`
        SELECT status, count(*) AS n FROM wa_product_reviews WHERE org_id = ${ctx.orgId} GROUP BY status`);
      const by = Object.fromEntries(
        (counts.rows as Raw[]).map((r) => [r.status as string, Number(r.n)]),
      );
      return {
        data: items.map(toResponse),
        page,
        meta: {
          counts: {
            pending: by.pending ?? 0,
            approved: by.approved ?? 0,
            rejected: by.rejected ?? 0,
          },
        },
      };
    });
  }

  private async find(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<ReviewRow | undefined> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}::uuid
      ${forUpdate ? sql`FOR UPDATE OF r` : sql``}`);
    const row = res.rows[0] as Raw | undefined;
    return row ? toRow(row) : undefined;
  }

  async moderate(uuid: string, input: ModerateReviewInput): Promise<ReviewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Review', uuid);
      if (row.status !== input.status) {
        await tx.execute(
          sql`UPDATE wa_product_reviews SET status = ${input.status} WHERE org_id = ${ctx.orgId} AND id = ${row.id}`,
        );
        await this.audit.record(tx, {
          module: REVIEW_MODULE,
          recordId: row.id,
          action: 'update',
          delta: { status: { old: row.status, new: input.status } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: REVIEW_MODULE,
          aggregateId: row.id,
          eventType: 'product_review.moderated',
          payload: { uuid: row.uuid, status: input.status, previous: row.status },
        });
      }
      return toResponse({ ...row, status: input.status });
    });
  }

  /** A review that is already gone is a success (Reference was silent about it). */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.find(tx, ctx.orgId, uuid, true);
      if (!row) return;
      await this.audit.record(tx, {
        module: REVIEW_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { status: { old: row.status, new: null }, rating: { old: row.rating, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: REVIEW_MODULE,
        aggregateId: row.id,
        eventType: 'product_review.deleted',
        payload: { uuid: row.uuid },
      });
      await tx.execute(
        sql`DELETE FROM wa_product_reviews WHERE org_id = ${ctx.orgId} AND id = ${row.id}`,
      );
    });
  }
}
