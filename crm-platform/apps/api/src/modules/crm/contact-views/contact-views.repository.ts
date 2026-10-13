import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { ViewAccessType, ViewShareMode } from '@crm/contracts';
import { schema, type Tx } from '@crm/db';

const { contactViews, contactViewFavorites, contactViewUsers, users } = schema;

export interface ContactViewRow {
  id: number;
  uuid: string;
  name: string;
  filter: Record<string, unknown>;
  position: number;
  isShared: boolean;
  shareMode: ViewShareMode;
  accessType: ViewAccessType;
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
      shareMode: contactViews.shareMode,
      accessType: contactViews.accessType,
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

  /** Every view visible to `userId`: their own, the ones shared with everyone, and the ones shared with them by name. */
  async listVisible(tx: Tx, orgId: number, userId: number | null): Promise<ContactViewRow[]> {
    const visibility = userId
      ? or(
          eq(contactViews.shareMode, 'everyone'),
          eq(contactViews.createdBy, userId),
          and(
            eq(contactViews.shareMode, 'selected'),
            sql`exists (select 1 from ${contactViewUsers} cvu
                 where cvu.org_id = ${contactViews.orgId} and cvu.view_id = ${contactViews.id} and cvu.user_id = ${userId})`,
          ),
        )!
      : eq(contactViews.shareMode, 'everyone');

    const rows = await this.baseQuery(tx)
      .where(and(eq(contactViews.orgId, orgId), visibility))
      .orderBy(asc(contactViews.position), asc(contactViews.id));
    return rows as ContactViewRow[];
  }

  /** Is this 'selected' view shared with this person by name? */
  async isSharedWith(tx: Tx, orgId: number, viewId: number, userId: number): Promise<boolean> {
    const rows = await tx
      .select({ userId: contactViewUsers.userId })
      .from(contactViewUsers)
      .where(
        and(
          eq(contactViewUsers.orgId, orgId),
          eq(contactViewUsers.viewId, viewId),
          eq(contactViewUsers.userId, userId),
        ),
      );
    return rows.length > 0;
  }

  /** The people each given view is shared with, as user uuids. */
  async sharedUserUuids(tx: Tx, orgId: number, viewIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (viewIds.length === 0) return out;
    const rows = await tx
      .select({ viewId: contactViewUsers.viewId, uuid: users.uuid })
      .from(contactViewUsers)
      .innerJoin(
        users,
        and(eq(users.orgId, contactViewUsers.orgId), eq(users.id, contactViewUsers.userId)),
      )
      .where(and(eq(contactViewUsers.orgId, orgId), inArray(contactViewUsers.viewId, viewIds)));
    for (const r of rows) out.set(r.viewId, [...(out.get(r.viewId) ?? []), r.uuid]);
    return out;
  }

  /** User uuids to ids; an id that is not a person of this workspace is simply missing from the answer. */
  async userIdsByUuid(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const rows = await tx
      .select({ id: users.id, uuid: users.uuid })
      .from(users)
      .where(and(eq(users.orgId, orgId), inArray(users.uuid, uuids)));
    return new Map(rows.map((r) => [r.uuid, r.id]));
  }

  /** Makes the people a view is shared with exactly `userIds`. */
  async replaceSharedUsers(
    tx: Tx,
    orgId: number,
    viewId: number,
    userIds: number[],
  ): Promise<void> {
    await tx
      .delete(contactViewUsers)
      .where(and(eq(contactViewUsers.orgId, orgId), eq(contactViewUsers.viewId, viewId)));
    if (userIds.length > 0)
      await tx
        .insert(contactViewUsers)
        .values(userIds.map((userId) => ({ orgId, viewId, userId })));
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
      shareMode: ViewShareMode;
      accessType: ViewAccessType;
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
