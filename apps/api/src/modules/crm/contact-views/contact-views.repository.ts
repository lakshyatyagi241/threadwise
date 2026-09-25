import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { contactViews, contactViewFavorites, users } = schema;

export interface ContactViewRow {
  id: number;
  uuid: string;
  name: string;
  filter: Record<string, unknown>;
  position: number;
  isShared: boolean;
  createdBy: number | null;
  createdByUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Data access for `contact_views` (saved list views) and `contact_view_favorites`. */
@Injectable()
export class ContactViewsRepository {
  private selection() {
    return {
      id: contactViews.id,
      uuid: contactViews.uuid,
      name: contactViews.name,
      filter: contactViews.filter,
      position: contactViews.position,
      isShared: contactViews.isShared,
      createdBy: contactViews.createdBy,
      createdByUuid: users.uuid,
      rowVersion: contactViews.rowVersion,
      createdAt: contactViews.createdAt,
      updatedAt: contactViews.updatedAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contactViews)
      .leftJoin(
        users,
        and(eq(users.orgId, contactViews.orgId), eq(users.id, contactViews.createdBy)),
      );
  }

  /** Every view visible to `userId`: their own, plus every org-shared one. */
  async listVisible(tx: Tx, orgId: number, userId: number | null): Promise<ContactViewRow[]> {
    const visibility = userId
      ? or(eq(contactViews.isShared, true), eq(contactViews.createdBy, userId))!
      : eq(contactViews.isShared, true);

    const rows = await this.baseQuery(tx)
      .where(and(eq(contactViews.orgId, orgId), visibility))
      .orderBy(asc(contactViews.position), asc(contactViews.id));
    return rows as ContactViewRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactViewRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactViews.orgId, orgId), eq(contactViews.uuid, uuid)),
    );
    return rows[0] as ContactViewRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactViewRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactViews.orgId, orgId), eq(contactViews.id, id)),
    );
    return rows[0] as ContactViewRow | undefined;
  }

  async nextPosition(tx: Tx, orgId: number): Promise<number> {
    const rows = await tx
      .select({ max: sql<number>`coalesce(max(${contactViews.position}), -1)` })
      .from(contactViews)
      .where(eq(contactViews.orgId, orgId));
    return (rows[0]?.max ?? -1) + 1;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      name: string;
      filter: Record<string, unknown>;
      isShared: boolean;
      position: number;
      createdBy: number | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactViews)
      .values({ orgId, uuid: sql`gen_random_uuid()`, ...values })
      .returning({ id: contactViews.id, uuid: contactViews.uuid });
    return row!;
  }

  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(contactViews)
      .set(values)
      .where(
        and(
          eq(contactViews.orgId, orgId),
          eq(contactViews.id, id),
          eq(contactViews.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contactViews.id });
    return result.length > 0;
  }

  async reorder(tx: Tx, orgId: number, orderedIds: number[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(contactViews)
        .set({ position: index })
        .where(and(eq(contactViews.orgId, orgId), eq(contactViews.id, id)));
    }
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactViews)
      .where(and(eq(contactViews.orgId, orgId), eq(contactViews.id, id)))
      .returning({ id: contactViews.id });
    return result.length > 0;
  }

  async favoritedViewIds(
    tx: Tx,
    orgId: number,
    userId: number,
    viewIds: number[],
  ): Promise<Set<number>> {
    if (viewIds.length === 0) return new Set();
    const rows = await tx
      .select({ viewId: contactViewFavorites.viewId })
      .from(contactViewFavorites)
      .where(
        and(
          eq(contactViewFavorites.orgId, orgId),
          eq(contactViewFavorites.userId, userId),
          inArray(contactViewFavorites.viewId, viewIds),
        ),
      );
    return new Set(rows.map((r) => r.viewId));
  }

  async addFavorite(tx: Tx, orgId: number, viewId: number, userId: number): Promise<void> {
    await tx.insert(contactViewFavorites).values({ orgId, viewId, userId }).onConflictDoNothing();
  }

  async removeFavorite(tx: Tx, orgId: number, viewId: number, userId: number): Promise<void> {
    await tx
      .delete(contactViewFavorites)
      .where(
        and(
          eq(contactViewFavorites.orgId, orgId),
          eq(contactViewFavorites.viewId, viewId),
          eq(contactViewFavorites.userId, userId),
        ),
      );
  }
}
