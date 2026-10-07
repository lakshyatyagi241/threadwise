import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor, type Cursor } from '../../../common/pagination/cursor';

const { apiKeys } = schema;

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface NewBearerKey {
  name: string;
  keyPrefix: string;
  keyHash: string;
  userId: number | null;
  createdBy: number | null;
}

/** The workspace's `bearer` keys (Reference's customer keys). The signed partner keys in the same table are not this domain's console. */
@Injectable()
export class ApiKeysRepository {
  /** Serialises key creation per workspace for the length of the transaction: the cap check and the insert must not interleave. */
  async lockForCreate(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`api_keys:${orgId}`}))`);
  }

  async countActive(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM api_keys WHERE org_id = ${orgId} AND kind = 'bearer' AND status = 'active'`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async insert(tx: Tx, orgId: number, key: NewBearerKey): Promise<ApiKeyRow> {
    const [row] = await tx
      .insert(apiKeys)
      .values({
        orgId,
        uuid: crypto.randomUUID(),
        name: key.name,
        keyPrefix: key.keyPrefix,
        keyHash: key.keyHash,
        kind: 'bearer',
        signingSecretEnc: null,
        // 0 = no cap of its own: the plan and the platform ceiling decide (TW-API-006).
        rateLimitPerMinute: 0,
        userId: key.userId,
        createdBy: key.createdBy,
      })
      .returning();
    return row!;
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ApiKeyRow | undefined> {
    const [row] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.uuid, uuid), eq(apiKeys.kind, 'bearer')))
      .limit(1);
    return row;
  }

  /** Newest first; `limit + 1` rows so the caller can answer `hasMore` without a COUNT. */
  async list(
    tx: Tx,
    orgId: number,
    opts: { limit: number; cursor?: string; order: 'asc' | 'desc' },
  ): Promise<ApiKeyRow[]> {
    const conditions = [eq(apiKeys.orgId, orgId), eq(apiKeys.kind, 'bearer')];
    if (opts.cursor) {
      const c: Cursor = decodeCursor(opts.cursor);
      const before = opts.order === 'desc';
      conditions.push(
        or(
          before ? lt(apiKeys.createdAt, c.createdAt) : sql`${apiKeys.createdAt} > ${c.createdAt}`,
          and(
            eq(apiKeys.createdAt, c.createdAt),
            before ? lt(apiKeys.id, c.id) : sql`${apiKeys.id} > ${c.id}`,
          ),
        )!,
      );
    }
    return tx
      .select()
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(
        opts.order === 'desc' ? desc(apiKeys.createdAt) : apiKeys.createdAt,
        opts.order === 'desc' ? desc(apiKeys.id) : apiKeys.id,
      )
      .limit(opts.limit + 1);
  }

  /** Marks the key revoked. Idempotent: a revoked key keeps its first `revoked_at`. */
  async revoke(tx: Tx, orgId: number, id: number): Promise<ApiKeyRow> {
    const [row] = await tx
      .update(apiKeys)
      .set({
        status: 'revoked',
        revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())`,
      })
      .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, id)))
      .returning();
    return row!;
  }
}
