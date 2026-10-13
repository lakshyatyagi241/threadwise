import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  WA_DEVICE_GROUP_EVENTS,
  WA_DEVICE_GROUP_PICTURE_MAX_BYTES,
  type ChangeWaGroupParticipantsInput,
  type CreateWaDeviceGroupBody,
  type CreateWaDeviceGroupResult,
  type HandleWaDeviceGroupJoinRequestsInput,
  type LeaveWaDeviceGroupInput,
  type UpdateWaDeviceGroupInput,
  type WaDeviceGroup,
  type WaDeviceGroupInviteLink,
  type WaDeviceGroupJoinBody,
  type WaDeviceGroupJoinPreview,
  type WaDeviceGroupJoinPreviewBody,
  type WaDeviceGroupJoinRequests,
  type WaDeviceGroupJoinRequestsResult,
  type WaDeviceGroupList,
  type WaDeviceGroupListByDeviceQuery,
  type WaDeviceGroupMembers,
  type WaDeviceGroupMembersQuery,
  type WaDeviceGroupsState,
  type WaDeviceGroupsSyncResult,
  type WaGroupParticipantResults,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  DeviceControlService,
  type GroupAction,
  type GroupResult,
  type GroupSnapshot,
} from '../node-bridge-runtime';
import { DevicesRepository, type DeviceRow } from './devices.repository';
import { emitDeviceGroupEvents } from './device-groups-events';
import {
  eventsFor,
  groupFailure,
  inviteUrlOf,
  personRefs,
  peopleOf,
  pictureKind,
  resultsFor,
  rosterAfter,
  tally,
  type GroupEventDraft,
  type PersonRef,
} from './device-groups-rules';
import {
  matchesMember,
  toDeviceGroupDto,
  toJoinRequestDto,
  toMemberDto,
} from './device-groups.mapper';
import {
  DeviceGroupsRepository,
  factsOf,
  type DeviceGroupRow,
  type WaDeviceGroupJoinRequest,
} from './device-groups.repository';
import { DeviceGroupsSyncService } from './device-groups-sync.service';

const MODULE = 'wa_device_groups';
/** A group read again within this long is answered from the directory: refresh is a button, not a poll. */
export const REFRESH_MIN_MS = 10_000;
/** Reading the whole list from WhatsApp, at most once per this many seconds per number. */
export const SYNC_MIN_SECONDS = 60;

interface Target {
  device: DeviceRow;
  group: DeviceGroupRow;
}

const unexpected = () =>
  new AppError(
    ERROR_CODES.WA_GROUP_UNAVAILABLE,
    'WhatsApp answered something unexpected. Try again.',
    HttpStatus.BAD_GATEWAY,
  );

/**
 * Managing the groups of a PERSONAL WhatsApp number (the unofficial engine; docs/specs/waba-groups-management.md is the official twin).
 * `wa_device_groups` is the one thing the screens read (kept by the worker's directory sync); WhatsApp is called to act, to refresh one
 * group, and to read a join-request queue or an invite code on demand.
 *
 * Every WhatsApp call goes through `DeviceControlService.groupAction`, which applies the unofficial gate and the per-number ban-safety
 * limiter (429 with `retryAfterS`) and relays to the worker that owns the socket, and happens OUTSIDE any database transaction; the write,
 * its audit row and its outbox events are then one short transaction. What the stored row says is checked BEFORE calling WhatsApp: a number
 * that is not an admin never reaches it for an admin-only change, and a group the number left is read-only (409 WA_GROUP_LEFT).
 *
 * Privacy: member numbers and the join-request queue only go to `wa.groups.manage` (the controller); the invite code only to the explicit
 * invite-link responses; neither is ever logged or written to an audit row or an event.
 */
@Injectable()
export class DeviceGroupsService {
  private readonly logger = new Logger(DeviceGroupsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly devices: DevicesRepository,
    private readonly repo: DeviceGroupsRepository,
    private readonly sync: DeviceGroupsSyncService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly control: DeviceControlService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------------

  /** Whether the Groups tab can act for this number, and what is left of its limits. */
  async state(deviceUuid: string): Promise<WaDeviceGroupsState> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    const connected = device.status === 'connected';
    const owned = connected ? await this.control.hasOwner(orgId, device.id) : false;
    const [view, lastSyncedAt] = await Promise.all([
      this.control.groupLimiter.peek(orgId, device.id),
      this.db.tx((tx) => this.repo.lastSyncedAt(tx, orgId, device.id)),
    ]);
    const { joinByLinkEnabled, ...limits } = view;
    return {
      deviceId: device.uuid,
      connected,
      reason: !connected ? 'not_connected' : owned ? 'ready' : 'worker_unavailable',
      limits,
      joinByLinkEnabled,
      lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    };
  }

  async list(
    deviceUuid: string,
    query: WaDeviceGroupListByDeviceQuery,
  ): Promise<WaDeviceGroupList> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const { rows, stats } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, orgId, device.id, query, cursor),
      stats: await this.repo.stats(tx, orgId, device.id),
    }));
    const page = buildPage(
      rows.map((r) => ({ ...r, createdAt: r.created_at, createdAtIso: r.created_at_iso })),
      query.limit,
    );
    return { items: page.items.map(toDeviceGroupDto), stats, page: page.page };
  }

  async get(deviceUuid: string, groupUuid: string): Promise<WaDeviceGroup> {
    const { group } = await this.target(deviceUuid, groupUuid);
    return toDeviceGroupDto(group);
  }

  /** The members, from the cached roster (the directory keeps it; refresh re-reads it). Numbers are personal data: manage only. */
  async members(
    deviceUuid: string,
    groupUuid: string,
    query: WaDeviceGroupMembersQuery,
  ): Promise<WaDeviceGroupMembers> {
    const { device, group } = await this.target(deviceUuid, groupUuid);
    const all = group.participants.filter((p) => matchesMember(p, query.q));
    const start = decodeOffset(query.cursor);
    const slice = all.slice(start, start + query.limit);
    const next = start + query.limit;
    return {
      members: slice.map((p) => toMemberDto(p, device.phone_digits)),
      total: query.q ? all.length : group.size,
      page: {
        nextCursor: next < all.length ? encodeOffset(next) : null,
        hasMore: next < all.length,
        limit: query.limit,
      },
    };
  }

  /** The people waiting to be let in. `fresh` asks WhatsApp now (the recovery path for a missed event); admin only. */
  async joinRequests(
    deviceUuid: string,
    groupUuid: string,
    fresh: boolean,
  ): Promise<WaDeviceGroupJoinRequests> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    if (!fresh || group.left_at) return { requests: group.join_requests.map(toJoinRequestDto) };
    this.needAdmin(group);
    this.ready(device);
    const res = await this.run(device, { type: 'join_requests', groupJid: group.group_jid });
    if (!('requests' in res)) throw unexpected();
    const next: WaDeviceGroupJoinRequest[] = res.requests.map((r) => ({
      jid: r.jid,
      phone: r.phone,
      lid: r.lid,
      name: r.name,
      requestedAt: r.requestedAt,
    }));
    const saved = await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
      if (!before) throw this.notFound();
      const after = await this.repo.setJoinRequests(tx, orgId, before.id, next);
      await emitDeviceGroupEvents(
        this.outbox,
        tx,
        orgId,
        after,
        eventsFor(factsOf(before), factsOf(after)),
      );
      return after;
    });
    return { requests: saved.join_requests.map(toJoinRequestDto) };
  }

  // --- directory refresh -----------------------------------------------------------------------------------------------------

  /** Re-reads one group from WhatsApp. Within ten seconds of the last read the stored answer is returned as it is. */
  async refresh(deviceUuid: string, groupUuid: string): Promise<WaDeviceGroup> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    if (group.left_at) return toDeviceGroupDto(group);
    if (group.synced_at && Date.now() - group.synced_at.getTime() < REFRESH_MIN_MS) {
      return toDeviceGroupDto(group);
    }
    this.ready(device);
    let snapshot: GroupSnapshot;
    try {
      const res = await this.run(device, { type: 'metadata', groupJid: group.group_jid });
      if (!('group' in res)) throw unexpected();
      snapshot = res.group;
    } catch (e) {
      if (e instanceof AppError && e.code === ERROR_CODES.WA_GROUP_NOT_FOUND) {
        // WhatsApp no longer knows this group for the number: it left or was removed. Keep the row, read-only (D5).
        const row = await this.db.tx(async (tx) => {
          const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
          if (!before || before.left_at) return before;
          const after = await this.repo.markLeft(tx, orgId, before.id, new Date());
          await emitDeviceGroupEvents(
            this.outbox,
            tx,
            orgId,
            after,
            eventsFor(factsOf(before), factsOf(after), { removed: false }),
          );
          return after;
        });
        return toDeviceGroupDto(row ?? group);
      }
      throw e;
    }
    const row = await this.db.tx(async (tx) => {
      const res = await this.sync.applySnapshotsTx(tx, orgId, device.id, [snapshot], {
        complete: false,
      });
      return res.rows[0] ?? group;
    });
    return toDeviceGroupDto(row);
  }

  /** Reads the whole list now (the tab's "Refresh"). At most once a minute per number; the limiter still applies. */
  async syncAll(deviceUuid: string): Promise<WaDeviceGroupsSyncResult> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    this.ready(device);
    const key = `wa:grpsync:${orgId}:${device.id}`;
    const claimed = await this.redis.set(key, '1', 'EX', SYNC_MIN_SECONDS, 'NX').catch(() => 'OK');
    if (claimed !== 'OK') {
      const stats = await this.db.tx((tx) => this.repo.stats(tx, orgId, device.id));
      return { groups: stats.groups - stats.left, left: 0, throttled: true };
    }
    try {
      const res = await this.run(device, { type: 'list' });
      if (!('groups' in res)) throw unexpected();
      const out = await this.db.tx((tx) =>
        this.sync.applySnapshotsTx(tx, orgId, device.id, res.groups, { complete: true }),
      );
      return { groups: out.rows.length, left: out.left, throttled: false };
    } catch (e) {
      await this.redis.del(key).catch(() => undefined);
      throw e;
    }
  }

  // --- changes ---------------------------------------------------------------------------------------------------------------

  async create(
    deviceUuid: string,
    input: CreateWaDeviceGroupBody,
  ): Promise<CreateWaDeviceGroupResult> {
    const { orgId, userId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    const { people, invalid } = peopleOf(input.numbers, device.phone_digits);
    this.numbersOk(people, invalid);
    this.ready(device);

    const subject = input.subject.trim();
    const description = input.description?.trim() ? input.description.trim() : undefined;
    const res = await this.run(device, {
      type: 'create',
      subject,
      participants: people.map((p) => p.digits),
      ...(description !== undefined ? { description } : {}),
    });
    if (!('group' in res)) throw unexpected();
    const created = res;

    const row = await this.db.tx(async (tx) => {
      const out = await this.sync.applySnapshotsTx(tx, orgId, device.id, [created.group], {
        complete: false,
        creatorId: userId,
      });
      const saved = out.rows[0];
      if (!saved) throw unexpected();
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: 'insert',
        delta: {
          event: { old: null, new: 'wa.group.create' },
          device: { old: null, new: device.uuid },
          people: { old: null, new: people.length },
        },
      });
      return saved;
    });
    return {
      group: toDeviceGroupDto(row),
      participants: resultsFor('add', people, created.participants ?? []),
      descriptionSet: description === undefined ? true : created.descriptionSet === true,
    };
  }

  /**
   * Subject, description and the group's settings. Each changed field is its own WhatsApp call (at most six, only for fields that differ
   * from the stored row); when a later one fails the earlier ones are kept (stored, audited) and the failure is what the caller sees.
   */
  async update(
    deviceUuid: string,
    groupUuid: string,
    input: UpdateWaDeviceGroupInput,
  ): Promise<WaDeviceGroup> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);

    const steps: Array<{ field: string; action: GroupAction; apply: Record<string, unknown> }> = [];
    const jid = group.group_jid;
    if (input.subject !== undefined && input.subject !== (group.subject ?? '')) {
      steps.push({
        field: 'subject',
        action: { type: 'subject', groupJid: jid, subject: input.subject },
        apply: { subject: input.subject },
      });
    }
    if (input.description !== undefined && input.description !== (group.description ?? '')) {
      steps.push({
        field: 'description',
        action: { type: 'description', groupJid: jid, description: input.description },
        apply: { description: input.description },
      });
    }
    if (input.announce !== undefined && input.announce !== group.announce) {
      steps.push({
        field: 'announce',
        action: {
          type: 'settings',
          groupJid: jid,
          setting: input.announce ? 'announcement' : 'not_announcement',
        },
        apply: { announce: input.announce },
      });
    }
    if (input.restrict !== undefined && input.restrict !== group.restrict_info) {
      steps.push({
        field: 'restrict',
        action: {
          type: 'settings',
          groupJid: jid,
          setting: input.restrict ? 'locked' : 'unlocked',
        },
        apply: { restrict: input.restrict },
      });
    }
    if (input.memberAddMode !== undefined && input.memberAddMode !== group.member_add_mode) {
      steps.push({
        field: 'memberAddMode',
        action: { type: 'member_add_mode', groupJid: jid, mode: input.memberAddMode },
        apply: { memberAddMode: input.memberAddMode },
      });
    }
    if (input.joinApproval !== undefined && input.joinApproval !== group.join_approval) {
      steps.push({
        field: 'joinApproval',
        action: { type: 'join_approval', groupJid: jid, enabled: input.joinApproval },
        apply: { joinApproval: input.joinApproval },
      });
    }
    if (steps.length === 0) return toDeviceGroupDto(group);

    // A plain member may edit the subject, description and picture unless the group is "admins only edit"; everything else is admin only.
    const textOnly = steps.every((s) => s.field === 'subject' || s.field === 'description');
    if (!group.is_admin && !(textOnly && !group.restrict_info)) throw this.notAdmin();
    this.ready(device);

    const applied: Record<string, unknown> = {};
    let failure: unknown = null;
    for (const s of steps) {
      try {
        await this.run(device, s.action);
        Object.assign(applied, s.apply);
      } catch (e) {
        failure = e;
        break;
      }
    }
    if (Object.keys(applied).length > 0) {
      await this.db.tx(async (tx) => {
        const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
        if (!before) return;
        const after = await this.repo.setSettings(tx, orgId, before.id, applied, new Date());
        await this.audit.record(tx, {
          module: MODULE,
          recordId: after.id,
          action: 'update',
          delta: {
            event: { old: null, new: 'wa.group.update' },
            fields: { old: null, new: Object.keys(applied) },
          },
        });
        await emitDeviceGroupEvents(
          this.outbox,
          tx,
          orgId,
          after,
          eventsFor(factsOf(before), factsOf(after)),
        );
      });
    }
    if (failure) throw failure;
    return toDeviceGroupDto((await this.target(deviceUuid, groupUuid)).group);
  }

  /** The group picture (JPEG or PNG up to 5 MB, checked on the bytes). WhatsApp re-encodes it; a copy is not stored here. */
  async setPicture(
    deviceUuid: string,
    groupUuid: string,
    file: { buffer: Buffer; size: number } | undefined,
  ): Promise<WaDeviceGroup> {
    if (!file || file.size === 0) {
      throw AppError.validation('Send the picture as the multipart field "file".', [
        { path: 'file', message: 'required' },
      ]);
    }
    if (file.size > WA_DEVICE_GROUP_PICTURE_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The picture is larger than 5 MB.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'file', message: 'too_large' }],
      );
    }
    if (!pictureKind(file.buffer)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The picture must be a JPEG or a PNG image.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'file', message: 'unsupported_type' }],
      );
    }
    return this.picture(deviceUuid, groupUuid, {
      type: 'picture',
      groupJid: '',
      data: file.buffer,
    });
  }

  async removePicture(deviceUuid: string, groupUuid: string): Promise<WaDeviceGroup> {
    return this.picture(deviceUuid, groupUuid, { type: 'picture', groupJid: '', remove: true });
  }

  private async picture(
    deviceUuid: string,
    groupUuid: string,
    action: Extract<GroupAction, { type: 'picture' }>,
  ): Promise<WaDeviceGroup> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    if (!group.is_admin && group.restrict_info) throw this.notAdmin();
    this.ready(device);
    await this.run(device, { ...action, groupJid: group.group_jid });
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
      if (!row) return;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          event: { old: null, new: action.remove ? 'wa.group.picture_remove' : 'wa.group.picture' },
        },
      });
      await emitDeviceGroupEvents(this.outbox, tx, orgId, row, [
        { type: WA_DEVICE_GROUP_EVENTS.updated, extra: { changed: ['picture'] } },
      ]);
    });
    return toDeviceGroupDto((await this.target(deviceUuid, groupUuid)).group);
  }

  /** Add, promote or demote people. Partial success is a success: the answer says what became of each number. */
  async changeParticipants(
    deviceUuid: string,
    groupUuid: string,
    input: ChangeWaGroupParticipantsInput,
  ): Promise<WaGroupParticipantResults> {
    const { group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    // Adding is open to every member while the group lets members add; promoting and demoting are always admin only.
    if (
      !group.is_admin &&
      !(input.action === 'add' && group.member_add_mode === 'all_member_add')
    ) {
      throw this.notAdmin();
    }
    return this.participants(deviceUuid, groupUuid, input.action, input.numbers);
  }

  async removeParticipants(
    deviceUuid: string,
    groupUuid: string,
    numbers: string[],
  ): Promise<WaGroupParticipantResults> {
    const { group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    this.needAdmin(group);
    return this.participants(deviceUuid, groupUuid, 'remove', numbers);
  }

  private async participants(
    deviceUuid: string,
    groupUuid: string,
    change: 'add' | 'remove' | 'promote' | 'demote',
    numbers: string[],
  ): Promise<WaGroupParticipantResults> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    const { people, invalid } = peopleOf(numbers, device.phone_digits);
    this.numbersOk(people, invalid);
    this.ready(device);
    const asked: PersonRef[] = personRefs(people, group.participants);

    const res = await this.run(device, {
      type: 'participants',
      groupJid: group.group_jid,
      participants: asked.map((p) => p.jid ?? p.digits),
      change,
    });
    if (!('participants' in res)) throw unexpected();
    const results = resultsFor(change, asked, res.participants ?? []);
    const done = asked.filter((p) =>
      results.results.some((r) => r.number === p.number && r.outcome === 'ok'),
    );

    await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
      if (!before) return;
      let after = before;
      if (done.length > 0) {
        const next = rosterAfter(before.participants, change, done);
        after = await this.repo.setRoster(
          tx,
          orgId,
          before.id,
          next.roster,
          before.size + next.sizeDelta,
        );
      }
      await this.audit.record(tx, {
        module: MODULE,
        recordId: before.id,
        action: 'update',
        delta: {
          event: { old: null, new: `wa.group.participants_${change}` },
          asked: { old: null, new: asked.length },
          done: { old: null, new: results.okCount },
        },
      });
      await emitDeviceGroupEvents(
        this.outbox,
        tx,
        orgId,
        after,
        eventsFor(factsOf(before), factsOf(after)),
      );
    });
    return results;
  }

  /** Approves or rejects people waiting to join. The answer says what became of each; the handled ones leave the stored queue. */
  async handleJoinRequests(
    deviceUuid: string,
    groupUuid: string,
    input: HandleWaDeviceGroupJoinRequestsInput,
  ): Promise<WaDeviceGroupJoinRequestsResult> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    this.needAdmin(group);
    this.ready(device);
    const jids = [...new Set(input.jids)];
    const res = await this.run(device, {
      type: 'join_request_update',
      groupJid: group.group_jid,
      participants: jids,
      action: input.action,
    });
    if (!('participants' in res)) throw unexpected();

    const known = new Map(group.join_requests.map((r) => [r.jid, r]));
    const status = new Map((res.participants ?? []).map((s) => [s.jid, s.status]));
    const results = tally(
      jids.map((jid) => {
        const code = status.get(jid) ?? null;
        const phone = known.get(jid)?.phone ?? null;
        return {
          number: phone && /^\d{6,15}$/.test(phone) ? `+${phone}` : null,
          outcome: code === null ? 'failed' : code === '200' || code === '' ? 'ok' : 'failed',
          code,
        } as const;
      }),
    );
    const handled = new Set(jids.filter((j, i) => results.results[i]!.outcome === 'ok'));

    await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
      if (!before) return;
      const after = await this.repo.setJoinRequests(
        tx,
        orgId,
        before.id,
        before.join_requests.filter((r) => !handled.has(r.jid)),
      );
      await this.audit.record(tx, {
        module: MODULE,
        recordId: before.id,
        action: 'update',
        delta: {
          event: { old: null, new: 'wa.group.join_requests' },
          action: { old: null, new: input.action },
          done: { old: null, new: results.okCount },
        },
      });
      await emitDeviceGroupEvents(
        this.outbox,
        tx,
        orgId,
        after,
        eventsFor(factsOf(before), factsOf(after)),
      );
    });
    return results;
  }

  /** The invite link. Held code first (it stays valid until revoked); WhatsApp is asked only when none is stored. Admin only. */
  async inviteLink(deviceUuid: string, groupUuid: string): Promise<WaDeviceGroupInviteLink> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    this.needAdmin(group);
    const stored = await this.db.tx((tx) => this.repo.inviteCodeOf(tx, orgId, group.id));
    if (stored) {
      await this.auditLink(group.id, 'wa.group.invite_link_read');
      return { code: stored, url: inviteUrlOf(stored) };
    }
    this.ready(device);
    const res = await this.run(device, { type: 'invite', groupJid: group.group_jid });
    const code = 'code' in res ? res.code : '';
    if (!code) throw unexpected();
    await this.db.tx(async (tx) => {
      await this.repo.setInviteCode(tx, orgId, group.id, code);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: group.id,
        action: 'read',
        delta: { event: { old: null, new: 'wa.group.invite_link_read' } },
      });
    });
    return { code, url: inviteUrlOf(code) };
  }

  /** Every link shared before now stops working. The code is never written to audit, events or logs. */
  async resetInviteLink(deviceUuid: string, groupUuid: string): Promise<WaDeviceGroupInviteLink> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    this.needAdmin(group);
    this.ready(device);
    const res = await this.run(device, { type: 'revoke_invite', groupJid: group.group_jid });
    const code = 'code' in res ? res.code : '';
    if (!code) throw unexpected();
    await this.db.tx(async (tx) => {
      const row = await this.repo.setInviteCode(tx, orgId, group.id, code);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { event: { old: null, new: 'wa.group.invite_link_reset' } },
      });
      await emitDeviceGroupEvents(this.outbox, tx, orgId, row, [
        { type: WA_DEVICE_GROUP_EVENTS.updated, extra: { changed: ['invite_link'] } },
      ]);
    });
    return { code, url: inviteUrlOf(code) };
  }

  /** What an invite link points at, without joining. Counts toward the join-by-link cap. Off unless the platform enables it. */
  async joinPreview(
    deviceUuid: string,
    input: WaDeviceGroupJoinPreviewBody,
  ): Promise<WaDeviceGroupJoinPreview> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    this.joinEnabled();
    this.ready(device);
    const res = await this.run(device, { type: 'get_invite_info', code: input.invite });
    if (!('invite' in res)) throw unexpected();
    const existing = await this.db.tx((tx) =>
      this.repo.findByJid(tx, orgId, device.id, res.invite.groupId),
    );
    return {
      subject: res.invite.subject,
      size: res.invite.size,
      alreadyMember: existing !== null && existing.left_at === null,
      approvalRequired: res.invite.joinApproval,
    };
  }

  /** Joins by invite link. The highest ban-risk action: own cap, a confirmed risk, off by default. */
  async join(
    deviceUuid: string,
    input: WaDeviceGroupJoinBody,
  ): Promise<{
    status: 'joined' | 'requested';
    group: WaDeviceGroup | null;
  }> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    this.joinEnabled();
    this.ready(device);
    const res = await this.run(device, { type: 'accept_invite', code: input.invite });
    if (!('joined' in res)) throw unexpected();
    const { groupId, requested } = res.joined;

    let row: DeviceGroupRow | null = null;
    if (groupId && !requested) {
      row = await this.db.tx((tx) => this.repo.findByJid(tx, orgId, device.id, groupId));
      if (!row || row.left_at) {
        // The directory learns of the group within seconds on its own; read it now so the answer carries it (best effort).
        try {
          const meta = await this.run(device, { type: 'metadata', groupJid: groupId });
          if ('group' in meta) {
            const snapshot = meta.group;
            row =
              (
                await this.db.tx((tx) =>
                  this.sync.applySnapshotsTx(tx, orgId, device.id, [snapshot], { complete: false }),
                )
              ).rows[0] ?? null;
          }
        } catch (e) {
          this.logger.debug(
            { orgId, deviceId: device.id, err: String(e) },
            'join: group read failed',
          );
        }
      }
    }
    await this.db.tx(async (tx) => {
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row?.id ?? device.id,
        action: 'update',
        delta: {
          event: { old: null, new: 'wa.group.join_by_link' },
          status: { old: null, new: requested ? 'requested' : 'joined' },
        },
      });
    });
    return {
      status: requested ? 'requested' : 'joined',
      group: row ? toDeviceGroupDto(row) : null,
    };
  }

  /** Leaves the group. Cannot be undone from here; the row stays, read-only (D5), and the inbox thread with it. */
  async leave(
    deviceUuid: string,
    groupUuid: string,
    _input: LeaveWaDeviceGroupInput,
  ): Promise<WaDeviceGroup> {
    const { orgId } = RequestContextStore.require();
    const { device, group } = await this.target(deviceUuid, groupUuid);
    this.active(group);
    this.ready(device);
    try {
      await this.run(device, { type: 'leave', groupJid: group.group_jid });
    } catch (e) {
      // WhatsApp no longer has the number in this group: the outcome the person asked for.
      if (!(e instanceof AppError && e.code === ERROR_CODES.WA_GROUP_NOT_FOUND)) throw e;
    }
    const row = await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, device.id, groupUuid, true);
      if (!before) throw this.notFound();
      const after = await this.repo.markLeft(tx, orgId, before.id, new Date());
      await this.audit.record(tx, {
        module: MODULE,
        recordId: after.id,
        action: 'update',
        delta: { event: { old: null, new: 'wa.group.leave' } },
      });
      const drafts: GroupEventDraft[] = before.left_at
        ? []
        : eventsFor(factsOf(before), factsOf(after), { removed: false });
      await emitDeviceGroupEvents(this.outbox, tx, orgId, after, drafts);
      return after;
    });
    return toDeviceGroupDto(row);
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  /** The number, inside the caller's workspace. Another workspace's id is "not found", never "forbidden". */
  private async device(uuid: string): Promise<DeviceRow> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.devices.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Device', uuid);
    return row;
  }

  private async target(deviceUuid: string, groupUuid: string): Promise<Target> {
    const { orgId } = RequestContextStore.require();
    const device = await this.device(deviceUuid);
    const group = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, device.id, groupUuid));
    if (!group) throw this.notFound();
    return { device, group };
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.WA_GROUP_NOT_FOUND, 'Group not found.', HttpStatus.NOT_FOUND);
  }

  private notAdmin(): AppError {
    return new AppError(
      ERROR_CODES.WA_GROUP_NOT_ADMIN,
      'This number is not an admin of the group, so it cannot do this. Ask an admin to make it one.',
      HttpStatus.FORBIDDEN,
    );
  }

  private needAdmin(group: DeviceGroupRow): void {
    if (!group.is_admin) throw this.notAdmin();
  }

  /** A group the number left, or was removed from, is read-only. */
  private active(group: DeviceGroupRow): void {
    if (group.left_at) {
      throw new AppError(
        ERROR_CODES.WA_GROUP_LEFT,
        'This number is no longer in the group, so it is read-only.',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Refused before any WhatsApp call: the number is not connected (the limiter is not spent on it). */
  private ready(device: DeviceRow): void {
    if (device.status !== 'connected') {
      throw new AppError(
        ERROR_CODES.WA_GROUP_DEVICE_NOT_READY,
        'This number is not connected right now. Connect it, or wait for it to reconnect, and try again.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private joinEnabled(): void {
    if (!this.control.groupLimiter.limits.joinByLinkEnabled) {
      throw new AppError(
        ERROR_CODES.WA_GROUP_JOIN_BY_LINK_DISABLED,
        'Joining a group by invite link is switched off on this platform.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private numbersOk(people: PersonRef[], invalid: string[]): void {
    if (invalid.length > 0 || people.length === 0) {
      throw new AppError(
        ERROR_CODES.WA_GROUP_INVALID_NUMBER,
        invalid.length > 0
          ? 'A number is the connected number itself. WhatsApp adds the connected number to its own groups, and it cannot add or remove itself here (use Leave).'
          : 'Add at least one phone number.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        invalid.map((n) => ({ path: 'numbers', message: n })),
      );
    }
  }

  /** One WhatsApp group call through the control service. Anything but success becomes a problem+json error with a stable code. */
  private async run(device: DeviceRow, action: GroupAction): Promise<GroupResult> {
    const { orgId } = RequestContextStore.require();
    const res = await this.control.groupAction(orgId, device.id, action);
    if (res.ok && res.status === 'group') return res.result;
    throw groupFailure(res);
  }

  private async auditLink(id: number, event: string): Promise<void> {
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'read',
        delta: { event: { old: null, new: event } },
      }),
    );
  }
}

// --- the members' cursor ---------------------------------------------------------------------------------------------------------

/** The roster is one capped jsonb array held in memory (at most 1024), so its cursor is a position in it, not a table offset. */
const encodeOffset = (n: number): string => Buffer.from(`m:${n}`, 'utf8').toString('base64url');
function decodeOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const m = /^m:(\d{1,5})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!m) throw AppError.validation('Invalid pagination cursor');
  return Number(m[1]);
}
