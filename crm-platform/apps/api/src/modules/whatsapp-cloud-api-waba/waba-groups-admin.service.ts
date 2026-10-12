import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type CreateWabaGroupInput,
  type HandleWabaGroupJoinRequestsInput,
  type RemoveWabaGroupParticipantsInput,
  type UpdateWabaGroupInput,
  type WabaGroup,
  type WabaGroupJoinRequestsResult,
  type WabaGroupList,
  type WabaGroupListQuery,
  type WabaGroupMembers,
  type WabaGroupParticipantsRemoved,
  type WabaGroupsState,
  type WabaGroupUpdateAccepted,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_GROUPS,
  type WabaGroupsPort,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-groups.port';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import {
  WabaApiError,
  translateConnectError,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { describeGroupFailure } from '../../infra/providers/whatsapp-cloud-api-waba/waba-group-errors';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { WabaConnectService } from './waba-connect.service';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { emitGroupEvents, GROUP_EVENTS, groupEventsFor } from './waba-group-events';
import { toGroupDto } from './waba-groups.mapper';
import { factsOf, WabaGroupsRepository, type WabaGroupRow } from './waba-groups.repository';

const MODULE = 'waba_groups';
/** Reference caches a definite eligibility answer for an hour per number. */
const ELIGIBLE_TTL_SECONDS = 3600;
/** Proposal from the spec (10): 30 changes a minute per number. Meta's own limit is not documented on the pages read; 131208 is the signal. */
export const GROUP_OPS_PER_MINUTE = 30;
const RETRY_DELAY_MS = 300;

interface Number_ {
  id: number;
  uuid: string;
  status: string;
  conn: WabaConnection | null;
  officialBusinessAccount: boolean | null;
}

const eligibleKey = (orgId: number, configId: number) =>
  `waba:groups:eligible:${orgId}:${configId}`;
const asApiError = (e: unknown): WabaApiError =>
  e instanceof WabaApiError ? e : WabaApiError.network(e);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Managing the WhatsApp Cloud API groups of one connected number (BL-094 phases 1 and 2; docs/specs/waba-groups-management.md 9 and 10).
 * The mirror `waba_groups` (kept by `WabaGroupsService` from Meta's webhooks) is the one thing the screens read; Meta is called to act, to
 * refresh one group, to probe eligibility and to list the members on demand.
 *
 * Every Meta call happens OUTSIDE a database transaction (a slow Meta never holds a connection); the write, its audit row and its outbox
 * event are then one short transaction. Meta's create is not idempotent and is never retried; approve, reject, reset, update and delete
 * are retried once on a transient failure; removing people is not retried.
 */
@Injectable()
export class WabaGroupsAdminService {
  private readonly logger = new Logger(WabaGroupsAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaGroupsRepository,
    private readonly numbers: WabaConnectionsRepository,
    private readonly connections: WabaConnectService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    @Inject(WABA_GROUPS) private readonly meta: WabaGroupsPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- reads -------------------------------------------------------------------------------------

  /** Whether the number can use Groups at all. "Not eligible" is an answer here, not an error (the screen explains instead of failing). */
  async state(numberUuid: string, fresh: boolean): Promise<WabaGroupsState> {
    const { orgId } = RequestContextStore.require();
    const num = await this.number(numberUuid);
    const hint = num.officialBusinessAccount;
    const provider = num.provider;
    const out = (eligible: boolean, reason: WabaGroupsState['reason']): WabaGroupsState => ({
      eligible,
      reason,
      provider,
      officialBusinessAccount: hint,
    });

    if (num.status !== 'connected') return out(false, 'not_connected');
    if (!num.conn) return out(false, 'missing_credentials');
    if (!this.supported(num.conn)) return out(false, 'provider_unsupported');

    const key = eligibleKey(orgId, num.id);
    if (!fresh) {
      const cached = await this.redis.get(key).catch(() => null);
      if (cached === '1') return out(true, 'eligible');
      if (cached === '0') return out(false, 'not_eligible');
    }
    const answer = await this.meta.probe(num.conn);
    if (answer === 'unknown') return out(true, 'check_failed');
    // Only a definite answer is remembered: a network blip must not hide the feature for an hour.
    await this.redis
      .set(key, answer === 'eligible' ? '1' : '0', 'EX', ELIGIBLE_TTL_SECONDS)
      .catch(() => undefined);
    return out(answer === 'eligible', answer === 'eligible' ? 'eligible' : 'not_eligible');
  }

  async list(numberUuid: string, query: WabaGroupListQuery): Promise<WabaGroupList> {
    const { orgId } = RequestContextStore.require();
    const num = await this.number(numberUuid);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const withRequests = this.canManage();
    const { rows, stats } = await this.db.tx(async (tx) => ({
      rows: await this.repo.list(tx, orgId, num.id, query.limit, cursor),
      stats: await this.repo.stats(tx, orgId, num.id),
    }));
    const page = buildPage(
      rows.map((r) => ({ ...r, createdAt: r.created_at, createdAtIso: r.created_at_iso })),
      query.limit,
    );
    return {
      items: page.items.map((r) => toGroupDto(r, withRequests)),
      stats,
      page: page.page,
    };
  }

  /** The members, read from Meta on demand and never stored (personal data; Meta is the source). */
  async members(numberUuid: string, groupUuid: string): Promise<WabaGroupMembers> {
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    const info = await this.call(num, () =>
      this.meta.info(conn, group.group_id, ['participants', 'total_participant_count']),
    );
    return {
      members: info.participants.map((waId) => ({ waId })),
      total: info.totalParticipantCount ?? info.participants.length,
    };
  }

  /**
   * How many group records removing the number deletes (the `waba_groups` rows cascade with the number; D6). Not plan-gated on purpose: a
   * workspace whose plan lapsed still has the rows, and the person removing the number must be told.
   */
  async countFor(numberUuid: string): Promise<{ count: number }> {
    const { orgId } = RequestContextStore.require();
    const num = await this.number(numberUuid);
    const stats = await this.db.tx((tx) => this.repo.stats(tx, orgId, num.id));
    return { count: stats.groups };
  }

  // --- changes -----------------------------------------------------------------------------------

  async create(numberUuid: string, input: CreateWabaGroupInput): Promise<WabaGroup> {
    const { orgId, userId } = RequestContextStore.require();
    const num = await this.number(numberUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);

    // Meta's create is not idempotent: never retried. A lost answer is repaired by the `group_create` webhook, which upserts the row.
    const { groupId } = await this.call(
      num,
      () =>
        this.meta.create(conn, {
          subject: input.subject,
          description: input.description,
          joinApprovalMode: input.joinApprovalMode,
        }),
      { retry: false },
    );
    if (!groupId) {
      throw new AppError(
        ERROR_CODES.WABA_GROUP_META_REJECTED,
        'WhatsApp accepted the request but sent no group id. The group appears here once Meta confirms it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const now = new Date();
    const row = await this.db.tx(async (tx) => {
      const before = await this.repo.findByGroupId(tx, orgId, num.id, groupId, true);
      const saved = await this.repo.upsertCreated(tx, orgId, num.id, {
        groupId,
        subject: input.subject,
        description: input.description?.trim() ? input.description.trim() : null,
        joinApprovalMode: input.joinApprovalMode ?? null,
        userId,
        now,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: 'insert',
        delta: {
          event: { old: null, new: 'waba.group.create' },
          number: { old: null, new: num.uuid },
          joinApprovalMode: { old: null, new: input.joinApprovalMode ?? null },
        },
      });
      await emitGroupEvents(
        this.outbox,
        tx,
        orgId,
        saved,
        num.uuid,
        groupEventsFor('action', before ? factsOf(before) : null, factsOf(saved)),
      );
      return saved;
    });
    return toGroupDto(row, this.canManage());
  }

  /** Pull this group's state (and its link) from Meta. The link only changes when the second call worked. */
  async refresh(numberUuid: string, groupUuid: string): Promise<WabaGroup> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    const info = await this.call(num, () => this.meta.info(conn, group.group_id));
    const link = await this.meta.inviteLink(conn, group.group_id).catch(() => null);

    const row = await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, num.id, groupUuid, true);
      if (!before) throw this.notFound();
      const saved = await this.repo.applyRefresh(tx, orgId, before.id, {
        subject: info.subject,
        description: info.description,
        joinApprovalMode: info.joinApprovalMode,
        participantCount: info.totalParticipantCount,
        suspended: info.suspended,
        inviteLink: link,
        now: new Date(),
      });
      await emitGroupEvents(
        this.outbox,
        tx,
        orgId,
        saved,
        num.uuid,
        groupEventsFor('action', factsOf(before), factsOf(saved)),
      );
      return saved;
    });
    return toGroupDto(row, this.canManage());
  }

  /** Every link shared before now stops working (Meta). The link itself is never written to audit or logs. */
  async resetInviteLink(numberUuid: string, groupUuid: string): Promise<WabaGroup> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);
    const link = await this.call(num, () => this.meta.resetInviteLink(conn, group.group_id));

    const row = await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, orgId, num.id, groupUuid, true);
      if (!before) throw this.notFound();
      const saved = await this.repo.setInviteLink(tx, orgId, before.id, link, new Date());
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: 'update',
        delta: { event: { old: null, new: 'waba.group.link_reset' } },
      });
      await emitGroupEvents(this.outbox, tx, orgId, saved, num.uuid, [
        { type: GROUP_EVENTS.updated, extra: { changed: ['invite_link'] } },
      ]);
      return saved;
    });
    return toGroupDto(row, this.canManage());
  }

  /**
   * Subject and description. Nothing is written to the row on purpose: Meta confirms each field on `group_settings_update` and a subject
   * can land while the description fails, so the webhook is the only source of truth for what applied.
   */
  async update(
    numberUuid: string,
    groupUuid: string,
    input: UpdateWabaGroupInput,
  ): Promise<WabaGroupUpdateAccepted> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);
    await this.call(num, () =>
      this.meta.update(conn, group.group_id, {
        subject: input.subject,
        description: input.description,
      }),
    );
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: MODULE,
        recordId: group.id,
        action: 'update',
        delta: {
          event: { old: null, new: 'waba.group.update' },
          fields: {
            old: null,
            new: [
              input.subject !== undefined ? 'subject' : null,
              input.description !== undefined ? 'description' : null,
            ].filter(Boolean),
          },
        },
      }),
    );
    return { accepted: true };
  }

  async handleJoinRequests(
    numberUuid: string,
    groupUuid: string,
    input: HandleWabaGroupJoinRequestsInput,
  ): Promise<WabaGroupJoinRequestsResult> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);
    const ids = [...new Set(input.ids)];
    await this.call(num, () =>
      input.action === 'approve'
        ? this.meta.approveJoinRequests(conn, group.group_id, ids)
        : this.meta.rejectJoinRequests(conn, group.group_id, ids),
    );

    await this.db.tx(async (tx) => {
      const saved = await this.repo.removePending(tx, orgId, group.id, ids);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: group.id,
        action: 'update',
        delta: {
          event: { old: null, new: 'waba.group.join_requests' },
          action: { old: null, new: input.action },
          count: { old: null, new: ids.length },
        },
      });
      await emitGroupEvents(this.outbox, tx, orgId, saved, num.uuid, [
        {
          type: GROUP_EVENTS.joinRequest,
          extra: {
            handled: input.action === 'approve' ? 'approved' : 'rejected',
            count: ids.length,
          },
        },
      ]);
    });
    return { ok: true, handled: ids.length };
  }

  /** At most 8 per call (Meta). Not retried: a repeat after an unknown outcome could remove someone twice. The webhook corrects the count. */
  async removeParticipants(
    numberUuid: string,
    groupUuid: string,
    input: RemoveWabaGroupParticipantsInput,
  ): Promise<WabaGroupParticipantsRemoved> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);
    const participants = [...new Set(input.participants)];
    await this.call(num, () => this.meta.removeParticipants(conn, group.group_id, participants), {
      retry: false,
    });
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: MODULE,
        recordId: group.id,
        action: 'update',
        delta: {
          event: { old: null, new: 'waba.group.participants_remove' },
          count: { old: null, new: participants.length },
        },
      }),
    );
    return { ok: true, removed: participants.length };
  }

  /** Removes everyone, the business included, on Meta; then the row. The inbox thread stays. A deleted group cannot be recovered. */
  async delete(numberUuid: string, groupUuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    const { num, group } = await this.target(numberUuid, groupUuid);
    const conn = this.usable(num);
    await this.throttle(orgId, num.id);

    let retried = false;
    const attempt = () => this.meta.delete(conn, group.group_id);
    try {
      await this.call(num, attempt, {
        onRetry: () => {
          retried = true;
        },
      });
    } catch (e) {
      // A retry after a lost answer finds the group already gone: that is the outcome the person asked for.
      const gone = retried && e instanceof AppError && e.code === ERROR_CODES.WABA_GROUP_NOT_FOUND;
      if (!gone) throw e;
    }

    await this.db.tx(async (tx) => {
      await this.repo.delete(tx, orgId, group.id);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: group.id,
        action: 'delete',
        delta: { event: { old: null, new: 'waba.group.delete' } },
      });
      await emitGroupEvents(this.outbox, tx, orgId, group, num.uuid, [
        { type: GROUP_EVENTS.deleted, extra: {} },
      ]);
    });
  }

  // --- internals ---------------------------------------------------------------------------------

  private canManage(): boolean {
    const ctx = RequestContextStore.require();
    return Boolean(ctx.grants && this.rbac.can(ctx.grants, 'waba.groups.manage').allowed);
  }

  /** The number, inside the caller's workspace. Another workspace's id is "not found", never "forbidden". */
  private async number(uuid: string): Promise<Number_ & { provider: string }> {
    const { orgId } = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const resolved = await this.connections.resolveConnection(tx, orgId, { uuid });
      if (!resolved) return null;
      const row = await this.numbers.findByUuid(tx, orgId, uuid);
      return { resolved, row };
    });
    if (!found?.row) throw AppError.notFound('WhatsApp number', uuid);
    const { resolved, row } = found;
    const flag = row.meta_json?.is_official_business_account;
    const conn = resolved.conn as WabaConnection | null;
    return {
      id: resolved.id,
      uuid: resolved.uuid,
      status: resolved.status,
      conn,
      officialBusinessAccount: typeof flag === 'boolean' ? flag : null,
      provider: conn ? (conn.registry ? conn.registry.providerKey : conn.provider) : 'meta',
    };
  }

  private async target(numberUuid: string, groupUuid: string) {
    const { orgId } = RequestContextStore.require();
    const num = await this.number(numberUuid);
    const group = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, num.id, groupUuid));
    if (!group) throw this.notFound();
    return { num, group: group as WabaGroupRow };
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.WABA_GROUP_NOT_FOUND, 'Group not found.', HttpStatus.NOT_FOUND);
  }

  /**
   * Groups go straight to Meta's Graph host with the number's own Meta token (as Reference did), so the number's route label does not
   * matter: a number that Interakt only funds (credit line) still qualifies. A registry provider's number is refused (its route is not
   * known to pass the Groups API through), and so is any number without a Meta access token (an Interakt-only auth key is not one).
   */
  private supported(conn: WabaConnection): boolean {
    return !conn.registry && Boolean(conn.accessToken);
  }

  private usable(num: Number_): WabaConnection {
    if (num.status !== 'connected' || !num.conn) {
      throw new AppError(
        ERROR_CODES.WABA_NO_CREDENTIALS,
        'This WhatsApp number is missing its Meta credentials. Reconnect it and try again.',
        HttpStatus.CONFLICT,
      );
    }
    if (!this.supported(num.conn)) {
      throw new AppError(
        ERROR_CODES.WABA_GROUPS_PROVIDER_UNSUPPORTED,
        'Groups are only available on numbers connected directly to Meta. This number is reached through another provider.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return num.conn;
  }

  /** Per-number budget on changes; fails open on a Redis error like the other throttles. */
  private async throttle(orgId: number, configId: number): Promise<void> {
    try {
      const key = `waba:groups:ops:${orgId}:${configId}`;
      const res = await this.redis.multi().incr(key).expire(key, 60, 'NX').ttl(key).exec();
      const count = Number(res?.[0]?.[1] ?? 1);
      if (count > GROUP_OPS_PER_MINUTE) {
        throw new AppError(
          ERROR_CODES.WABA_GROUP_RATE_LIMITED,
          'Too many group operations from this number. Wait a moment and retry.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.logger.warn({ err: String(e) }, 'groups throttle failed open');
    }
  }

  /**
   * One Meta call. A transient failure is retried once (unless `retry: false`); every failure becomes an `AppError` with a stable code. A
   * 131215 also remembers "not eligible" for the number so the screen stops offering controls.
   */
  private async call<T>(
    num: Number_,
    fn: () => Promise<T>,
    opts: { retry?: boolean; onRetry?: () => void } = {},
  ): Promise<T> {
    try {
      return await fn();
    } catch (first) {
      const f = describeGroupFailure(asApiError(first));
      if (opts.retry !== false && f.transient) {
        opts.onRetry?.();
        await sleep(RETRY_DELAY_MS);
        try {
          return await fn();
        } catch (second) {
          throw await this.fail(num, asApiError(second));
        }
      }
      throw await this.fail(num, asApiError(first));
    }
  }

  private async fail(num: Number_, err: WabaApiError): Promise<AppError> {
    const f = describeGroupFailure(err);
    const { orgId } = RequestContextStore.require();
    const detail =
      f.metaCode !== null ? [{ path: 'metaCode', message: String(f.metaCode) }] : undefined;
    switch (f.kind) {
      case 'not_eligible':
        await this.redis
          .set(eligibleKey(orgId, num.id), '0', 'EX', ELIGIBLE_TTL_SECONDS)
          .catch(() => undefined);
        return new AppError(
          ERROR_CODES.WABA_GROUPS_NOT_ELIGIBLE,
          f.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
          detail,
        );
      case 'not_found':
        return new AppError(
          ERROR_CODES.WABA_GROUP_NOT_FOUND,
          f.message,
          HttpStatus.NOT_FOUND,
          detail,
        );
      case 'suspended':
        return new AppError(
          ERROR_CODES.WABA_GROUP_SUSPENDED,
          f.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
          detail,
        );
      case 'limit_reached':
        return new AppError(
          ERROR_CODES.WABA_GROUP_LIMIT_REACHED,
          f.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
          detail,
        );
      case 'rate_limited':
        return new AppError(
          ERROR_CODES.WABA_GROUP_RATE_LIMITED,
          f.message,
          HttpStatus.TOO_MANY_REQUESTS,
          detail,
        );
      case 'unavailable':
        return new AppError(
          ERROR_CODES.WABA_PROVIDER_UNAVAILABLE,
          f.message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      default:
        if (err.missingBusinessManagement || err.code === 190) {
          return new AppError(
            err.missingBusinessManagement
              ? ERROR_CODES.WABA_MISSING_PERMISSION
              : ERROR_CODES.WABA_PROVIDER_REJECTED,
            translateConnectError(err),
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        return new AppError(
          ERROR_CODES.WABA_GROUP_META_REJECTED,
          f.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
          detail,
        );
    }
  }
}
