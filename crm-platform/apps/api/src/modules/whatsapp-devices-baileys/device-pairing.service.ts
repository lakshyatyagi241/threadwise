import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  DEVICE_PAIRING_MIN_DIGITS,
  ERROR_CODES,
  type DeviceConnectionState,
  type DevicePairing,
  type DeviceStateReason,
  type PairingMethod,
  type PlanFeatureKey,
  type StartPairingInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { DeviceControlService, senderDigits } from '../node-bridge-runtime';
import type { DeviceCommandResult } from '../node-bridge-runtime';
import { DeviceLimits } from './device-limits.service';
import {
  blockedByOtherAttempt,
  deadlineMs,
  pairingRefusal,
  type AttemptRecord,
  type PairingRefusal,
} from './device-rules';
import { workerUnreachable } from './devices.service';
import { DevicesRepository } from './devices.repository';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { HistoryImportService } from './history-import.service';
import { RiskNoticeService } from './risk-notice.service';

const MODULE = 'devices';
/** The plan feature the `full` history choice needs. */
export const HISTORY_FULL_FEATURE = 'personal_history_full' satisfies PlanFeatureKey;
const CODE_VALID_S = 180;
/** The attempt record outlives its deadline a little, so the last poll still finds the final state. */
const ATTEMPT_GRACE_S = 15;

const attemptKey = (orgId: number, deviceId: number) => `wa:attempt:${orgId}:${deviceId}`;

const refusalMessage: Record<PairingRefusal, string> = {
  connected: 'This number is already linked. Disconnect it first, then connect it again.',
  healthy_session:
    'This number still has a saved WhatsApp session. Ask to link it again to forget the saved session and start over.',
  live_state:
    'A connection is already in progress for this number. Ask to link it again to start over.',
};

/**
 * Starting and reading a pairing (docs/specs/personal-whatsapp-connect.md sections 7 and 8). A start needs the CURRENT risk notice accepted
 * by THIS person, a device in a pairable state (R1: a healthy saved session is never wiped unless the caller says `relink`), room in the
 * rate limits, and no other person's attempt running; it is audited and emits `device.pairing_started` (no secret) before the worker is
 * asked. The QR and the code travel only in the response of the start and of the authenticated poll; they are never written to Postgres,
 * the outbox, the audit trail or the idempotency store, and never logged. The attempt record in Redis holds who started it and when.
 */
@Injectable()
export class DevicePairingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DevicesRepository,
    private readonly notice: RiskNoticeService,
    private readonly limits: DeviceLimits,
    private readonly control: DeviceControlService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly history: HistoryImportService,
    private readonly entitlements: PlanEntitlementService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
  ) {}

  startQr(uuid: string, input: StartPairingInput): Promise<DevicePairing> {
    return this.start(uuid, 'qr', input);
  }

  startCode(uuid: string, input: StartPairingInput): Promise<DevicePairing> {
    return this.start(uuid, 'code', input);
  }

  private async start(
    uuid: string,
    method: PairingMethod,
    input: StartPairingInput,
  ): Promise<DevicePairing> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden('wa.devices.pair');
    const userId = ctx.userId;
    const now = Date.now();

    const pre = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Device', uuid);
      await this.notice.ensure(tx, ctx.orgId, userId, input.acknowledgement, row.uuid);
      const sessionRows = await this.repo.sessionRows(tx, ctx.orgId, row.id);
      return { row, sessionRows, state: row.connection_state as DeviceConnectionState };
    });
    const row = pre.row;

    // The FULL import is a plan feature (owner decision 2026-10-14); `recent` is open to every workspace that may use personal numbers.
    // Refused before anything is counted or recorded, with the standard 422 PLAN_FEATURE_LOCKED (`errors[]` names the feature).
    if (input.importHistory === 'full') {
      await this.entitlements.assertFeature(
        ctx.orgId,
        HISTORY_FULL_FEATURE,
        'The full history import is not part of your plan. Choose the recent chats, or upgrade your plan.',
      );
    }

    const refusal = pairingRefusal({
      state: pre.state,
      sessionRows: pre.sessionRows,
      relink: input.relink,
    });
    if (refusal) {
      throw new AppError(
        ERROR_CODES.DEVICE_NOT_PAIRABLE,
        refusalMessage[refusal],
        HttpStatus.CONFLICT,
        [{ path: 'reason', message: refusal }],
      );
    }
    if (method === 'code') {
      const digits = row.phone_digits ?? senderDigits(row.country_code, row.phone_number);
      if (digits.length < DEVICE_PAIRING_MIN_DIGITS) {
        throw new AppError(
          ERROR_CODES.DEVICE_PHONE_INVALID,
          'Add the country code to the number to get a pairing code.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const current = await this.readAttempt(ctx.orgId, row.id);
    if (blockedByOtherAttempt({ attempt: current, state: pre.state, userId, now })) {
      const who = current
        ? await this.db.tx((tx) => this.repo.userName(tx, ctx.orgId, current.startedByUserId))
        : null;
      throw new AppError(
        ERROR_CODES.DEVICE_PAIRING_IN_PROGRESS,
        `${who ?? 'Someone'} started a connection ${Math.max(1, Math.round((now - (current?.startedAt ?? now)) / 1000))} seconds ago.`,
        HttpStatus.CONFLICT,
        [
          { path: 'startedBy', message: who ?? '' },
          {
            path: 'retryAfterS',
            message: String(Math.max(1, Math.ceil(((current?.deadlineAt ?? now) - now) / 1000))),
          },
        ],
      );
    }

    // Counted once the request is valid: a refusal above costs nothing, a start that then times out at the worker does count.
    await this.limits.pairingStart(ctx.orgId, row.id);

    const attempt: AttemptRecord = {
      attempt: randomUUID(),
      method,
      startedByUserId: userId,
      startedAt: now,
      deadlineAt: now + deadlineMs(method),
    };
    await this.redis.set(
      attemptKey(ctx.orgId, row.id),
      JSON.stringify(attempt),
      'EX',
      Math.ceil(deadlineMs(method) / 1000) + ATTEMPT_GRACE_S,
    );
    await this.db.tx(async (tx) => {
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'update',
        delta: { pairing: { old: null, new: `${method}${input.relink ? ' (relink)' : ''}` } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'device.pairing_started',
        payload: {
          deviceId: row.uuid,
          method,
          relink: input.relink,
          importHistory: input.importHistory,
        },
      });
      // The choice is on the device row BEFORE the worker is asked for a QR: the socket reads it when it is built (WhatsApp sends
      // history only to a companion that asked for it while registering). A re-link that does not choose again imports nothing.
      await this.history.request(tx, ctx.orgId, row.id, input.importHistory, userId);
    });

    const res =
      method === 'qr'
        ? await this.control.requestQr(ctx.orgId, row.id, { relink: input.relink })
        : await this.control.requestPairingCode(ctx.orgId, row.id, { relink: input.relink });
    if (!res.ok || res.status === 'connected') {
      await this.redis.del(attemptKey(ctx.orgId, row.id));
      // No QR was produced: nothing will be scanned, so the import that was asked for is over.
      await this.db.tx((tx) =>
        this.history.cancelActiveIn(tx, ctx.orgId, row.id, 'pairing_failed'),
      );
      await this.fail(res, uuid, ctx.orgId);
    }
    return this.view(uuid, attempt, userId);
  }

  /** `GET /v2/devices/:id/pairing`: the 2 s poll. 404 when no attempt is running or its record has expired. */
  async read(uuid: string): Promise<DevicePairing> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const r = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!r) throw AppError.notFound('Device', uuid);
      return r;
    });
    const attempt = await this.readAttempt(ctx.orgId, row.id);
    if (!attempt) {
      throw new AppError(
        ERROR_CODES.DEVICE_NO_PAIRING,
        'There is no connection attempt to show.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.view(uuid, attempt, ctx.userId ?? -1);
  }

  /** `DELETE /v2/devices/:id/pairing`: ends the attempt now. The runtime would abandon it at its deadline anyway. */
  async cancel(uuid: string): Promise<{ cancelled: boolean }> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const r = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!r) throw AppError.notFound('Device', uuid);
      return r;
    });
    const attempt = await this.readAttempt(ctx.orgId, row.id);
    if (!attempt) return { cancelled: false };
    await this.redis.del(attemptKey(ctx.orgId, row.id));
    if (['awaiting_qr', 'awaiting_pairing_code'].includes(row.connection_state)) {
      // An attempt ended before the scan wants no history; a link that already happened keeps its import running (cancel it on its own).
      await this.db.tx((tx) =>
        this.history.cancelActiveIn(tx, ctx.orgId, row.id, 'pairing_cancelled'),
      );
      // An unfinished pairing holds fewer than 3 session rows: the worker's terminate stops the socket and forgets them.
      await this.control.terminate(ctx.orgId, row.id).catch(() => undefined);
    }
    return { cancelled: true };
  }

  // --- the answer ------------------------------------------------------------------------------------------------------------

  /** The wizard's view of an attempt: the row's state, the runtime's progress, and (only while it is showing) the QR or the code. */
  private async view(uuid: string, attempt: AttemptRecord, userId: number): Promise<DevicePairing> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const r = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!r) throw AppError.notFound('Device', uuid);
      return r;
    });
    const live = await this.control.status(ctx.orgId, row.id);
    const state = row.connection_state;
    const now = Date.now();
    const showQr = state === 'awaiting_qr' && live?.qr;
    const showCode = state === 'awaiting_pairing_code' && live?.code;
    return {
      attempt: attempt.attempt,
      method: attempt.method,
      state: state as DevicePairing['state'],
      reason: (row.state_reason as DeviceStateReason | null) ?? null,
      label: live?.label ?? null,
      progress: live?.progress ?? 0,
      qr: showQr ? (live?.qr ?? null) : null,
      qrAgeMs: showQr && live?.qrAt ? Math.max(0, now - live.qrAt) : null,
      code: showCode ? (live?.code ?? null) : null,
      codeExpiresIn:
        showCode && live?.codeAt
          ? Math.max(0, CODE_VALID_S - Math.floor((now - live.codeAt) / 1000))
          : null,
      startedAt: new Date(attempt.startedAt).toISOString(),
      deadlineAt: new Date(attempt.deadlineAt).toISOString(),
      startedByMe: attempt.startedByUserId === userId,
    };
  }

  private async readAttempt(orgId: number, deviceId: number): Promise<AttemptRecord | null> {
    const raw = await this.redis.get(attemptKey(orgId, deviceId));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as AttemptRecord;
      return typeof v.attempt === 'string' && typeof v.startedByUserId === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  /** A command that did not produce a QR or a code, as the stable error the screen branches on. Never returns. */
  private async fail(res: DeviceCommandResult, uuid: string, orgId: number): Promise<never> {
    if (res.ok) {
      // `connected`: the worker holds a live socket for it, whatever the row said a moment ago.
      throw new AppError(
        ERROR_CODES.DEVICE_NOT_PAIRABLE,
        refusalMessage.connected,
        HttpStatus.CONFLICT,
        [{ path: 'reason', message: 'connected' }],
      );
    }
    if (workerUnreachable(res)) {
      throw new AppError(
        ERROR_CODES.WA_WORKER_UNAVAILABLE,
        'The connection service is not available. Try again in a few minutes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    switch (res.status) {
      case 'busy':
        throw new AppError(
          ERROR_CODES.DEVICE_PAIRING_IN_PROGRESS,
          'Another connection attempt is already in progress for this number.',
          HttpStatus.CONFLICT,
          [{ path: 'retryAfterS', message: '60' }],
        );
      case 'not_pairable':
        throw new AppError(
          ERROR_CODES.DEVICE_NOT_PAIRABLE,
          refusalMessage.healthy_session,
          HttpStatus.CONFLICT,
          [{ path: 'reason', message: 'healthy_session' }],
        );
      case 'not_found':
        throw AppError.notFound('Device', uuid);
      case 'timeout':
        throw new AppError(
          ERROR_CODES.DEVICE_PAIRING_TIMEOUT,
          'WhatsApp did not respond. Try again.',
          HttpStatus.GATEWAY_TIMEOUT,
        );
      default:
        // The engine may have been switched off between the gate and the worker: say that, not a generic failure.
        await this.gate.assertEnabledFor(orgId);
        if (/country code/i.test(res.message)) {
          throw new AppError(
            ERROR_CODES.DEVICE_PHONE_INVALID,
            'Add the country code to the number to get a pairing code.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        throw new AppError(
          ERROR_CODES.WA_WORKER_UNAVAILABLE,
          'The connection could not be started. Try again in a few minutes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
  }
}
