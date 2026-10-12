import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { jidUser, type GroupEvent, type GroupSnapshot } from '../node-bridge-runtime';
import { DeviceGroupsLegacyDirectory } from './device-groups-legacy-directory';
import {
  DeviceGroupsRepository,
  factsOf,
  type DeviceGroupRow,
  type WaDeviceGroupJoinRequest,
} from './device-groups.repository';
import { emitDeviceGroupEvents } from './device-groups-events';
import { eventsFor, type GroupEventDraft } from './device-groups-rules';

/**
 * A first read of more groups than this is a bulk import: every group still gets its `created` event (the inbox retitles its thread from
 * it) but marked `bulk`, and only the first carries `lead`, so the realtime push is ONE hint for the whole import, not one per group.
 */
export const BULK_IMPORT_GROUPS = 25;
/** Pending requests kept per group (the column check allows 1000). */
const REQUESTS_MAX = 1000;

export interface SyncOptions {
  /** `groups` is every group the account is in: a stored group missing from it was left. False: only these were re-read. */
  complete: boolean;
  /** The person whose create made a new row (kept on the row). */
  creatorId?: number | null;
}

export interface SyncResult {
  rows: DeviceGroupRow[];
  /** Groups newly marked as left by this read. */
  left: number;
}

const idsOf = (jid: string | null): { phone: string | null; lid: string | null } => {
  if (!jid) return { phone: null, lid: null };
  const user = jidUser(jid).replace(/\D+/g, '');
  if (jid.endsWith('@lid')) return { phone: null, lid: user || null };
  return { phone: user || null, lid: null };
};

/**
 * The directory of a personal number's groups (`wa_device_groups`), kept in step with what the socket reads. One code path serves the
 * worker (the runtime's `groups` and `group_event` callbacks, the periodic sweep) and the API (after a refresh, a create or a change made
 * from the screen), so a change never announces twice or not at all depending on how it arrived.
 *
 * A read is ONE short transaction: lock the number's rows, upsert what was read, mark what vanished (a complete read only), replace the
 * legacy storefront directory when the roster moved, and write the outbox events the difference calls for. WhatsApp is never called inside
 * it. Nothing here writes an audit row (a sync is not a person's action; the actions that cause one audit themselves).
 */
@Injectable()
export class DeviceGroupsSyncService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DeviceGroupsRepository,
    private readonly outbox: OutboxService,
    private readonly legacy: DeviceGroupsLegacyDirectory,
  ) {}

  /** Worker side: its own tenant transaction. */
  async applySnapshots(
    orgId: number,
    deviceId: number,
    groups: GroupSnapshot[],
    opts: SyncOptions,
  ): Promise<SyncResult> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.applySnapshotsTx(tx, orgId, deviceId, groups, opts),
    );
  }

  async applySnapshotsTx(
    tx: Tx,
    orgId: number,
    deviceId: number,
    groups: GroupSnapshot[],
    opts: SyncOptions,
  ): Promise<SyncResult> {
    const seen = new Map<string, GroupSnapshot>();
    for (const g of groups) if (g.groupId) seen.set(g.groupId, g);
    const existing = await this.repo.forSync(
      tx,
      orgId,
      deviceId,
      opts.complete ? null : [...seen.keys()],
    );
    const before = new Map(existing.map((r) => [r.group_jid, r]));
    const fresh = [...seen.keys()].filter((k) => !before.has(k)).length;
    const bulk = opts.complete && existing.length === 0 && fresh > BULK_IMPORT_GROUPS;
    let announced = 0;
    const now = new Date();
    const devicePhone = seen.size > 0 ? await this.devicePhone(tx, orgId, deviceId) : null;

    const rows: DeviceGroupRow[] = [];
    for (const g of seen.values()) {
      const prev = before.get(g.groupId) ?? null;
      const after = await this.repo.upsertSnapshot(
        tx,
        orgId,
        deviceId,
        g,
        now,
        opts.creatorId ?? null,
      );
      rows.push(after);
      const drafts = eventsFor(prev ? factsOf(prev) : null, factsOf(after)).map((d) =>
        bulk
          ? {
              ...d,
              extra: { ...d.extra, bulk: true, ...(announced++ === 0 ? { lead: true } : {}) },
            }
          : d,
      );
      await emitDeviceGroupEvents(this.outbox, tx, orgId, after, drafts);
      // The storefront directory: only when something it shows moved (new group, subject, size, members, or the number came back).
      const moved =
        !prev ||
        prev.left_at !== null ||
        prev.subject !== after.subject ||
        prev.size !== after.size ||
        rosterKey(prev) !== rosterKey(after);
      if (moved) {
        await this.legacy.syncGroup(
          tx,
          orgId,
          devicePhone,
          {
            groupId: after.group_jid,
            subject: after.subject,
            size: after.size,
            members: after.participants.map((p) => ({ phone: p.phone, admin: p.admin !== null })),
          },
          now,
        );
      }
    }

    let left = 0;
    if (opts.complete) {
      for (const r of existing) {
        if (seen.has(r.group_jid) || r.left_at !== null) continue;
        // Gone from a complete list and we did not see the event: left from the phone, or removed. Whether it was a removal is unknown here,
        // so no "removed" notice is raised from this path (the participants event is what says so).
        const after = await this.repo.markLeft(tx, orgId, r.id, now);
        await emitDeviceGroupEvents(
          this.outbox,
          tx,
          orgId,
          after,
          eventsFor(factsOf(r), factsOf(after), { removed: false }),
        );
        left++;
      }
    }
    return { rows, left };
  }

  /**
   * One change as it happened (`groups.update`, `group-participants.update`, `group.join-request`). What the change alone proves is applied
   * at once; people joining or leaving are left to the re-read the runtime schedules a few seconds later (it is the one that diffs the
   * roster, so nothing is announced twice). A group never seen before is also left to that read.
   */
  async applyEvent(orgId: number, deviceId: number, event: GroupEvent): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.repo.findByJid(tx, orgId, deviceId, event.groupId, true);
      if (!row) return;
      const now = new Date();
      const drafts = await this.apply(tx, orgId, deviceId, row, event, now);
      if (drafts) await emitDeviceGroupEvents(this.outbox, tx, orgId, drafts.row, drafts.events);
    });
  }

  private async apply(
    tx: Tx,
    orgId: number,
    deviceId: number,
    row: DeviceGroupRow,
    event: GroupEvent,
    now: Date,
  ): Promise<{ row: DeviceGroupRow; events: GroupEventDraft[] } | null> {
    const was = factsOf(row);
    if (event.kind === 'update') {
      if (row.left_at) return null;
      const after = await this.repo.applyPatch(tx, orgId, row.id, event.patch, now);
      return { row: after, events: eventsFor(was, factsOf(after)) };
    }

    if (event.kind === 'participants') {
      if (!event.selfAffected) return null;
      if (event.action === 'remove') {
        if (row.left_at) return null; // we left through the API: already recorded
        const self = await this.devicePhone(tx, orgId, deviceId);
        const authorUser = event.author ? jidUser(event.author).replace(/\D+/g, '') : null;
        // Someone else removed us. No author, or our own number as the author, is a leave made on the phone: not a removal.
        const removed = authorUser !== null && authorUser !== '' && authorUser !== self;
        const after = await this.repo.markLeft(tx, orgId, row.id, now);
        return { row: after, events: eventsFor(was, factsOf(after), { removed }) };
      }
      if ((event.action === 'promote' || event.action === 'demote') && !row.left_at) {
        const after = await this.repo.setAdmin(tx, orgId, row.id, event.action === 'promote');
        return { row: after, events: eventsFor(was, factsOf(after)) };
      }
      return null;
    }

    // join_request
    if (row.left_at) return null;
    const mine = row.join_requests.filter((r) => r.jid !== event.participant);
    let next: WaDeviceGroupJoinRequest[] = mine;
    if (event.action === 'created') {
      const ids = idsOf(event.participant);
      next = [
        ...mine,
        {
          jid: event.participant,
          phone: ids.phone,
          lid: ids.lid,
          name: null,
          requestedAt: now.toISOString(),
        },
      ].slice(-REQUESTS_MAX);
    }
    if (next.length === row.join_requests.length && event.action !== 'created') return null;
    const after = await this.repo.setJoinRequests(tx, orgId, row.id, next);
    return { row: after, events: eventsFor(was, factsOf(after)) };
  }

  private async devicePhone(tx: Tx, orgId: number, deviceId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT phone_digits FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`,
    );
    return (res.rows[0] as { phone_digits: string | null } | undefined)?.phone_digits ?? null;
  }
}

/** The roster as the legacy directory sees it: who, and whether an admin (names do not matter there). */
const rosterKey = (r: DeviceGroupRow): string =>
  r.participants
    .map((p) => `${p.phone ?? p.jid}:${p.admin ? 1 : 0}`)
    .sort()
    .join('|');
