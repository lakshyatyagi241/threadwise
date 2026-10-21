import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { pushSubscriptions } = schema;

/** What the person's own list may show. No endpoint, no keys, no raw user agent. */
export interface PushDeviceRow {
  uuid: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** What the sender needs. SECRETS: the endpoint and keys are read only to send, and never logged or returned. */
export interface PushTarget {
  id: number;
  orgId: number;
  userId: number;
  uuid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
}

/** What the sealed auth secret of a device is bound to (encryption audit E4): the person it belongs to. */
export const pushAuthContext = (orgId: number, userId: number): string =>
  `push_subscriptions.auth:${orgId}:${userId}`;

/** After this many failed pushes in a row (that are not "gone") a device is given up on. A success resets the count. */
export const PUSH_MAX_FAILURES = 10;

/** Data access for `push_subscriptions`. Every call is pinned to (org, user) by the caller's tenant transaction AND by the predicate. */
@Injectable()
export class PushSubscriptionsRepository {
  private readonly safe = {
    uuid: pushSubscriptions.uuid,
    label: pushSubscriptions.label,
    createdAt: pushSubscriptions.createdAt,
    lastUsedAt: pushSubscriptions.lastUsedAt,
  };

  private toDevice(r: {
    uuid: string;
    label: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): PushDeviceRow {
    return {
      uuid: r.uuid,
      label: r.label ?? 'Browser',
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    };
  }

  /**
   * Stores a device, or refreshes it when the same browser subscribes again: new keys, back to live, failures forgotten. The row's
   * identity is (org, user, sha256 of the endpoint), so the secret itself is never a lookup key.
   */
  async upsert(
    tx: Tx,
    orgId: number,
    userId: number,
    input: {
      endpoint: string;
      endpointHash: string;
      p256dh: string;
      auth: string;
      ua: string | null;
      label: string;
    },
  ): Promise<PushDeviceRow & { id: number }> {
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        orgId,
        userId,
        endpoint: input.endpoint,
        endpointHash: input.endpointHash,
        p256dh: input.p256dh,
        auth: input.auth,
        ua: input.ua,
        label: input.label,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.orgId, pushSubscriptions.userId, pushSubscriptions.endpointHash],
        set: {
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          ua: input.ua,
          label: input.label,
          revokedAt: null,
          failureCount: 0,
          lastErrorAt: null,
        },
      })
      .returning({ id: pushSubscriptions.id, ...this.safe });
    return { id: Number(row!.id), ...this.toDevice(row!) };
  }

  /**
   * The same browser now belongs to someone else of this workspace (a shared computer, a sign-out and a sign-in): the previous person's
   * subscription for that endpoint goes, so their alerts stop appearing on the next person's screen.
   */
  async dropOthersOnEndpoint(
    tx: Tx,
    orgId: number,
    userId: number,
    endpointHash: string,
  ): Promise<number> {
    const res = await tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.endpointHash, endpointHash),
          ne(pushSubscriptions.userId, userId),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return res.length;
  }

  /** Keeps at most `cap` live devices for the person: the least recently used beyond it are deleted (never `keepId`). Returns how many. */
  async trimToCap(
    tx: Tx,
    orgId: number,
    userId: number,
    keepId: number,
    cap: number,
  ): Promise<number> {
    const live = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.userId, userId),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .orderBy(
        desc(
          sql`greatest(coalesce(${pushSubscriptions.lastUsedAt}, '-infinity'::timestamptz), ${pushSubscriptions.updatedAt})`,
        ),
        desc(pushSubscriptions.id),
      );
    const doomed = live
      .map((r) => Number(r.id))
      .filter((id) => id !== keepId)
      .slice(Math.max(cap - 1, 0));
    if (doomed.length === 0) return 0;
    await tx
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.orgId, orgId), inArray(pushSubscriptions.id, doomed)));
    return doomed.length;
  }

  /** The person's live devices, oldest first. */
  async listLive(tx: Tx, orgId: number, userId: number): Promise<PushDeviceRow[]> {
    const rows = await tx
      .select(this.safe)
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.userId, userId),
          isNull(pushSubscriptions.revokedAt),
        ),
      )
      .orderBy(asc(pushSubscriptions.id));
    return rows.map((r) => this.toDevice(r));
  }

  /** Removes one of the person's own devices. False when it is not theirs or not there (the same answer for both). */
  async deleteOwn(tx: Tx, orgId: number, userId: number, uuid: string): Promise<boolean> {
    const res = await tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.uuid, uuid),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return res.length > 0;
  }

  /** The devices to push to, with their secrets. `only` narrows a retry to the devices that failed. */
  async liveTargets(
    tx: Tx,
    orgId: number,
    userId: number,
    only?: readonly number[],
  ): Promise<PushTarget[]> {
    if (only && only.length === 0) return [];
    const rows = await tx
      .select({
        id: pushSubscriptions.id,
        orgId: pushSubscriptions.orgId,
        userId: pushSubscriptions.userId,
        uuid: pushSubscriptions.uuid,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        failureCount: pushSubscriptions.failureCount,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.orgId, orgId),
          eq(pushSubscriptions.userId, userId),
          isNull(pushSubscriptions.revokedAt),
          only ? inArray(pushSubscriptions.id, [...only]) : undefined,
        ),
      )
      .orderBy(asc(pushSubscriptions.id));
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      orgId: Number(r.orgId),
      userId: Number(r.userId),
    }));
  }

  /** The push service accepted the push. */
  async recordSuccess(tx: Tx, orgId: number, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(pushSubscriptions)
      .set({ lastUsedAt: sql`now()`, failureCount: 0, lastErrorAt: null })
      .where(and(eq(pushSubscriptions.orgId, orgId), inArray(pushSubscriptions.id, [...ids])));
  }

  /** A push failed. `revoke` stops all further sends to the device (the browser dropped it, or the keys no longer match). */
  async recordFailure(tx: Tx, orgId: number, id: number, revoke: boolean): Promise<void> {
    await tx
      .update(pushSubscriptions)
      .set({
        lastErrorAt: sql`now()`,
        failureCount: sql`${pushSubscriptions.failureCount} + 1`,
        ...(revoke ? { revokedAt: sql`coalesce(${pushSubscriptions.revokedAt}, now())` } : {}),
      })
      .where(and(eq(pushSubscriptions.orgId, orgId), eq(pushSubscriptions.id, id)));
  }

  /** Revoked devices older than `cutoff`, across workspaces (the daily prune; call inside a privileged transaction). */
  async pruneRevoked(tx: Tx, cutoff: Date): Promise<number> {
    const res = await tx
      .delete(pushSubscriptions)
      .where(lt(pushSubscriptions.revokedAt, cutoff))
      .returning({ id: pushSubscriptions.id });
    return res.length;
  }
}
