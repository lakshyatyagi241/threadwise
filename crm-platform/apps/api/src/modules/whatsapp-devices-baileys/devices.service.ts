import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  PERSONAL_WA_NOTICE_VERSION,
  type CreateDeviceInput,
  type DeleteDeviceResult,
  type DisconnectResult,
  type ListDevicesQuery,
  type ListDevicesResponse,
  type PersonalDeviceDetail,
  type UpdateDeviceInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChannelRegistryService } from '../chat-conversations';
import {
  DeviceControlService,
  NodeWorkerStatus,
  WORKER_NO_ANSWER,
  WORKER_NOT_RUNNING,
} from '../node-bridge-runtime';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import { DeviceLimits } from './device-limits.service';
import {
  PILOT_DEVICE_CAP,
  effectiveDeviceCap,
  guessRegion,
  splitDevicePhone,
} from './device-rules';
import { toDevice, toDeviceDetail } from './devices.mapper';
import { DevicesRepository, type DeviceRow } from './devices.repository';
import { HistoryImportService } from './history-import.service';
import { RiskNoticeService } from './risk-notice.service';

const MODULE = 'devices';

/** States in which a socket may be open or a pairing is under way: a disconnect has something to stop. */
const LIVE_STATES = ['awaiting_qr', 'awaiting_pairing_code', 'connecting', 'connected'];
/** States from which the number may be edited (no session can exist). */
const NUMBER_EDITABLE_STATES = ['created', 'error', 'logged_out'];

const phoneInvalid = (): AppError =>
  new AppError(
    ERROR_CODES.DEVICE_PHONE_INVALID,
    'Enter the country code and the number, digits only.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

const isDuplicateDigits = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === '23505' &&
  String((err as { constraint?: string }).constraint ?? '').includes('phone_digits');

/** True when the control service could not reach a worker at all (none running, or the owning worker stayed silent). */
export const workerUnreachable = (r: { ok: boolean; message?: string }): boolean =>
  !r.ok && (r.message === WORKER_NOT_RUNNING || r.message === WORKER_NO_ANSWER);

/**
 * Personal WhatsApp numbers: list, detail, add, edit, disconnect and delete (docs/specs/personal-whatsapp-connect.md section 10). Every
 * route is behind the engine gate and a `wa.devices.*` key, resolves the device inside the caller's transaction (another workspace's uuid
 * is a 404), and writes audit and outbox in the same transaction as the change. The API never asserts a connection state: only the
 * worker's runtime writes those (the one exception, a disconnect nobody answered, is recorded as such).
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DevicesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notice: RiskNoticeService,
    private readonly limits: DeviceLimits,
    private readonly control: DeviceControlService,
    private readonly workers: NodeWorkerStatus,
    private readonly channels: ChannelRegistryService,
    private readonly planUsage: PlanUsageService,
    private readonly entitlements: PlanEntitlementService,
    private readonly history: HistoryImportService,
  ) {}

  // --- reading ---------------------------------------------------------------------------------------------------------------

  async list(query: ListDevicesQuery): Promise<ListDevicesResponse> {
    const ctx = RequestContextStore.require();
    const [planLimit, workers, historyFullAllowed] = await Promise.all([
      this.entitlements.limit(ctx.orgId, 'devices'),
      this.workers.read().catch(() => ({ workers: 0, devices: 0 })),
      this.entitlements.featureEnabled(ctx.orgId, 'personal_history_full'),
    ]);
    return this.db.tx(async (tx) => {
      const [page, used, notice] = await Promise.all([
        this.repo.list(tx, ctx.orgId, query),
        this.repo.count(tx, ctx.orgId),
        this.notice.statusIn(tx, ctx.orgId, ctx.userId),
      ]);
      return {
        data: page.rows.map(toDevice),
        page: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: query.limit },
        meta: {
          used,
          limit: effectiveDeviceCap(planLimit),
          planLimit,
          pilotCap: PILOT_DEVICE_CAP,
          noticeVersion: notice.version,
          noticeAccepted: notice.accepted,
          workerRunning: workers.workers > 0,
          historyFullAllowed,
        },
      };
    });
  }

  async get(uuid: string): Promise<PersonalDeviceDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => this.detail(tx, ctx.orgId, uuid));
  }

  private async detail(tx: Tx, orgId: number, uuid: string): Promise<PersonalDeviceDetail> {
    const row = await this.must(tx, orgId, uuid);
    return toDeviceDetail(row, (await this.repo.sessionRows(tx, orgId, row.id)) > 0);
  }

  /** The device of this workspace, or 404 (another workspace's uuid is not visible: RLS and the org predicate). */
  async must(tx: Tx, orgId: number, uuid: string, lock = false): Promise<DeviceRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid, lock);
    if (!row) throw AppError.notFound('Device', uuid);
    return row;
  }

  // --- adding ----------------------------------------------------------------------------------------------------------------

  async create(input: CreateDeviceInput): Promise<PersonalDeviceDetail> {
    const ctx = RequestContextStore.require();
    await this.limits.creation(ctx.orgId);
    const split = splitDevicePhone(input.countryCode, input.phone);
    if (!split) throw phoneInvalid();
    const region = input.region?.trim() ? input.region.trim() : guessRegion(split.countryCode);
    const uuid = randomUUID();

    return this.db.tx(async (tx) => {
      // One creation at a time per workspace: Reference checked the limit without a lock, so two parallel adds could both pass.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wadev:create:${ctx.orgId}`}, 0))`,
      );
      const consentId = await this.notice.ensure(
        tx,
        ctx.orgId,
        ctx.userId,
        input.acknowledgement,
        uuid,
      );

      const duplicate = await this.repo.findByDigits(tx, ctx.orgId, split.digits);
      if (duplicate) {
        throw new AppError(
          ERROR_CODES.DEVICE_ALREADY_EXISTS,
          'A device with that phone number already exists.',
          HttpStatus.CONFLICT,
          [{ path: 'existingId', message: duplicate.uuid }],
        );
      }

      // The plan's `devices` limit (the plan meter counts every row, so it sees creations that committed before this lock) and the
      // pilot cap (owner decision D3), whichever is lower.
      await this.planUsage.assertCanAdd(ctx.orgId, 'devices');
      const used = await this.repo.count(tx, ctx.orgId);
      if (used >= PILOT_DEVICE_CAP) {
        throw new AppError(
          ERROR_CODES.DEVICE_PILOT_CAP_REACHED,
          `A workspace can connect up to ${PILOT_DEVICE_CAP} personal numbers during the pilot. Delete one to add another.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [
            { path: 'used', message: String(used) },
            { path: 'limitValue', message: String(PILOT_DEVICE_CAP) },
          ],
        );
      }

      let assigneeId = ctx.userId;
      if (input.assigneeUserId) {
        const member = await this.repo.memberByUuid(tx, ctx.orgId, input.assigneeUserId);
        if (!member)
          throw AppError.validation('The assignee must be a member of this workspace.', [
            { path: 'assigneeUserId', message: 'not a member' },
          ]);
        assigneeId = member.id;
      }

      let id: number;
      try {
        id = await this.repo.insert(tx, ctx.orgId, {
          uuid,
          userId: ctx.userId!,
          assignedUserId: assigneeId,
          name: input.name,
          countryCode: split.countryCode,
          phone: split.phone,
          phoneDigits: split.digits,
          region,
          activateAfterPairing: input.activateAfterPairing,
          consentId,
        });
      } catch (err) {
        if (isDuplicateDigits(err)) {
          throw new AppError(
            ERROR_CODES.DEVICE_ALREADY_EXISTS,
            'A device with that phone number already exists.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      await this.audit.record(tx, {
        module: MODULE,
        recordId: id,
        action: 'insert',
        delta: {
          name: { old: null, new: input.name },
          connection_state: { old: null, new: 'created' },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: id,
        eventType: 'device.created',
        payload: {
          deviceId: uuid,
          name: input.name,
          region,
          noticeVersion: PERSONAL_WA_NOTICE_VERSION,
        },
      });
      return this.detail(tx, ctx.orgId, uuid);
    });
  }

  // --- editing ---------------------------------------------------------------------------------------------------------------

  async update(uuid: string, input: UpdateDeviceInput): Promise<PersonalDeviceDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.must(tx, ctx.orgId, uuid, true);
      if (input.rowVersion !== row.row_version) throw AppError.rowVersionConflict('Device');

      const patch: Parameters<DevicesRepository['update']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.name !== undefined && input.name !== row.device_name) {
        patch.name = input.name;
        delta.name = { old: row.device_name, new: input.name };
      }
      if (input.region !== undefined && input.region !== row.region) {
        patch.region = input.region === null || input.region === '' ? null : input.region;
        delta.region = { old: row.region, new: patch.region };
      }
      if (input.active !== undefined && input.active !== row.active) {
        patch.active = input.active;
        delta.active = { old: row.active, new: input.active };
      }
      if (input.assigneeUserId !== undefined) {
        const next =
          input.assigneeUserId === null
            ? null
            : await this.repo.memberByUuid(tx, ctx.orgId, input.assigneeUserId);
        if (input.assigneeUserId !== null && !next) {
          throw AppError.validation('The assignee must be a member of this workspace.', [
            { path: 'assigneeUserId', message: 'not a member' },
          ]);
        }
        const nextId = next ? (next as { id: number }).id : null;
        if (nextId !== row.assigned_user_id) {
          patch.assignedUserId = nextId;
          delta.assigned_user_id = { old: row.assigned_user_id, new: nextId };
        }
      }
      if (input.countryCode !== undefined || input.phone !== undefined) {
        const split = splitDevicePhone(
          input.countryCode ?? row.country_code ?? '',
          input.phone ?? row.phone_number,
        );
        if (!split) throw phoneInvalid();
        if (split.digits !== row.phone_digits) {
          // A number cannot move under a live or saved session: the row would diverge from the paired phone.
          if (
            !NUMBER_EDITABLE_STATES.includes(row.connection_state) ||
            (await this.repo.sessionRows(tx, ctx.orgId, row.id)) > 0
          ) {
            throw new AppError(
              ERROR_CODES.DEVICE_NUMBER_LOCKED,
              'The number cannot be changed while the device is linked. Disconnect it first.',
              HttpStatus.CONFLICT,
            );
          }
          const duplicate = await this.repo.findByDigits(tx, ctx.orgId, split.digits, row.id);
          if (duplicate) {
            throw new AppError(
              ERROR_CODES.DEVICE_ALREADY_EXISTS,
              'A device with that phone number already exists.',
              HttpStatus.CONFLICT,
              [{ path: 'existingId', message: duplicate.uuid }],
            );
          }
          patch.countryCode = split.countryCode;
          patch.phone = split.phone;
          patch.phoneDigits = split.digits;
          delta.phone = { old: row.phone_digits, new: split.digits };
        }
      }

      if (Object.keys(patch).length > 0) {
        let ok: boolean;
        try {
          ok = await this.repo.update(tx, ctx.orgId, row.id, row.row_version, patch);
        } catch (err) {
          if (isDuplicateDigits(err)) {
            throw new AppError(
              ERROR_CODES.DEVICE_ALREADY_EXISTS,
              'A device with that phone number already exists.',
              HttpStatus.CONFLICT,
            );
          }
          throw err;
        }
        if (!ok) throw AppError.rowVersionConflict('Device');
        await this.audit.record(tx, { module: MODULE, recordId: row.id, action: 'update', delta });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: row.id,
          eventType: patch.name !== undefined ? 'device.renamed' : 'device.updated',
          payload: { deviceId: uuid, changed: Object.keys(delta) },
        });
      }
      return this.detail(tx, ctx.orgId, uuid);
    });
  }

  // --- disconnecting and deleting ----------------------------------------------------------------------------------------------

  /**
   * Unlinks the number from the phone and forgets the saved session (the worker's `terminate`). If NO worker answers, the saved session
   * rows are removed here so a worker that comes back cannot restore and reconnect it, the row says `disconnected` (reason `user`) and
   * the answer carries `unlinked: false`: the screen asks the person to also remove the device in WhatsApp > Linked devices.
   */
  async disconnect(uuid: string): Promise<DisconnectResult> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.must(tx, ctx.orgId, uuid));
    const live = LIVE_STATES.includes(row.connection_state);

    let unlinked = false;
    let fallback = false;
    if (live) {
      const res = await this.control.terminate(ctx.orgId, row.id);
      if (res.ok && res.status === 'terminated') unlinked = true;
      else if (workerUnreachable(res)) fallback = true;
      else if (!res.ok && res.status === 'not_found') throw AppError.notFound('Device', uuid);
      else if (!res.ok)
        throw new AppError(
          ERROR_CODES.WA_WORKER_UNAVAILABLE,
          res.message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }

    const device = await this.db.tx(async (tx) => {
      const current = await this.must(tx, ctx.orgId, uuid, true);
      // An unlinked number receives no more history: an import still waiting or running is ended.
      await this.history.cancelActiveIn(tx, ctx.orgId, current.id, 'disconnect');
      // Nobody answered, or the device was not live but kept a saved session: the saved session goes either way.
      if (fallback || !live) await this.repo.deleteSession(tx, ctx.orgId, current.id);
      if (fallback) {
        await this.repo.markDisconnectedByUser(tx, ctx.orgId, current.id);
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: current.id,
          eventType: 'device.disconnected',
          payload: { state: 'disconnected', reason: 'user', previous: current.connection_state },
        });
      }
      await this.audit.record(tx, {
        module: MODULE,
        recordId: current.id,
        action: 'update',
        delta: {
          disconnect: {
            old: current.connection_state,
            new: unlinked ? 'unlinked' : 'session_removed',
          },
        },
      });
      const after = await this.must(tx, ctx.orgId, uuid);
      return toDevice(after);
    });
    return { device, unlinked };
  }

  /**
   * Deletes the number: the worker is asked to unlink first (it answers within 15 s, or nobody does), then in ONE transaction its open
   * conversations are closed, its inbox channel is switched off and the row goes (its saved session rows cascade). The plan slot is freed.
   */
  async remove(uuid: string): Promise<DeleteDeviceResult> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.must(tx, ctx.orgId, uuid));
    let unlinked = false;
    if (LIVE_STATES.includes(row.connection_state)) {
      const res = await this.control.terminate(ctx.orgId, row.id).catch(() => null);
      unlinked = res?.ok === true && res.status === 'terminated';
    }
    await this.db.tx(async (tx) => {
      const current = await this.must(tx, ctx.orgId, uuid, true);
      const { closedConversations } = await this.channels.retireDeviceChannel(tx, ctx.orgId, uuid);
      await this.repo.delete(tx, ctx.orgId, current.id);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: current.id,
        action: 'delete',
        delta: { name: { old: current.device_name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: current.id,
        eventType: 'device.deleted',
        payload: { deviceId: uuid, name: current.device_name, closedConversations },
      });
    });
    return { id: uuid, deleted: true, unlinked };
  }
}
