import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import {
  ERROR_CODES,
  isHistoryImportActive,
  type CancelHistoryImportResult,
  type HistoryImportMode,
  type HistoryImportResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  historyImportConfig,
  windowDaysOf,
} from '../../config/domains/whatsapp-history-import.env';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { toHistoryStatus } from './history-import.mapper';
import { HistoryImportRepository, type HistoryRunRow } from './history-import.repository';
import { DevicesRepository } from './devices.repository';

const MODULE = 'devices';

/**
 * The opt-in history import of a personal number, the API side (docs/specs/personal-whatsapp-connect.md section 14): the choice is
 * recorded when a pairing starts (before the scan: WhatsApp sends history only right after a link), the status is read from the run
 * row, and a cancel stops the run so the importer accepts no further batch. Every change is audited and emits an outbox event in the
 * same transaction. The importer itself (`HistoryImportSink`) runs in the worker and ends runs through `finishAs`.
 */
@Injectable()
export class HistoryImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly devices: DevicesRepository,
    private readonly repo: HistoryImportRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Records the choice of a pairing attempt, inside the pairing's own transaction. A new request ends the previous active run (it
   * would otherwise be fed by the new link); `none` only does that and clears the mode, so a re-link nobody opted into imports nothing.
   */
  async request(
    tx: Tx,
    orgId: number,
    deviceId: number,
    mode: HistoryImportMode,
    userId: number | null,
  ): Promise<void> {
    const superseded = await this.repo.cancelActive(tx, orgId, deviceId);
    if (superseded)
      await this.emit(tx, superseded, 'device.history_import_cancelled', { by: 'superseded' });
    if (mode === 'none') {
      await this.repo.setDeviceMode(tx, orgId, deviceId, 'none');
      return;
    }
    const cfg = historyImportConfig();
    const run = await this.repo.insert(tx, orgId, {
      deviceId,
      mode,
      requestedByUserId: userId,
      windowDays: windowDaysOf(mode, cfg),
      maxMessages: cfg.maxMessages,
      maxMessagesPerChat: cfg.maxMessagesPerChat,
      maxChats: cfg.maxChats,
    });
    await this.repo.setDeviceMode(tx, orgId, deviceId, mode);
    await this.audit.record(tx, {
      module: MODULE,
      recordId: deviceId,
      action: 'update',
      delta: { history_import: { old: null, new: mode } },
    });
    await this.emit(tx, run, 'device.history_import_requested', { mode });
  }

  async status(uuid: string): Promise<HistoryImportResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const device = await this.devices.findByUuid(tx, ctx.orgId, uuid);
      if (!device) throw AppError.notFound('Device', uuid);
      const run = await this.repo.latest(tx, ctx.orgId, device.id);
      return { deviceId: device.uuid, status: toHistoryStatus(run) };
    });
  }

  /** Stops an active run: the importer accepts nothing more, what was stored stays. 409 when nothing is running. */
  async cancel(uuid: string): Promise<CancelHistoryImportResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const device = await this.devices.findByUuid(tx, ctx.orgId, uuid, true);
      if (!device) throw AppError.notFound('Device', uuid);
      const active = await this.repo.active(tx, ctx.orgId, device.id, true);
      if (!active || !isHistoryImportActive(active.state as 'idle' | 'running')) {
        const latest = await this.repo.latest(tx, ctx.orgId, device.id);
        throw new AppError(
          ERROR_CODES.HISTORY_IMPORT_NOT_ACTIVE,
          'There is no import running for this number.',
          HttpStatus.CONFLICT,
          [{ path: 'state', message: toHistoryStatus(latest).state }],
        );
      }
      const run = await this.repo.finish(tx, ctx.orgId, active.id, 'cancelled', null);
      if (run) {
        await this.audit.record(tx, {
          module: MODULE,
          recordId: device.id,
          action: 'update',
          delta: { history_import: { old: active.state, new: 'cancelled' } },
        });
        await this.emit(tx, run, 'device.history_import_cancelled', { by: 'user' });
      }
      const latest = await this.repo.latest(tx, ctx.orgId, device.id);
      return { cancelled: run !== null, status: toHistoryStatus(latest) };
    });
  }

  /** Ends an idle or running run without a person (a disconnect, a failed link): same bookkeeping, system actor. */
  async cancelActiveIn(tx: Tx, orgId: number, deviceId: number, by: string): Promise<void> {
    const run = await this.repo.cancelActive(tx, orgId, deviceId);
    if (!run) return;
    await this.repo.setDeviceMode(tx, orgId, deviceId, 'none');
    await this.emit(tx, run, 'device.history_import_cancelled', { by });
  }

  /**
   * Ends a run from the worker (the sink or the sweep): its own system context and transaction. False when the run was no longer
   * active (a cancel won), which is not an error.
   */
  async finishAs(
    orgId: number,
    runId: number,
    state: 'done' | 'failed' | 'limit_reached',
    errorCode: string | null,
  ): Promise<HistoryRunRow | null> {
    return RequestContextStore.run(
      {
        requestId: `wa-history-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.db.txAs({ orgId, userId: null }, async (tx) => {
          const run = await this.repo.finish(tx, orgId, runId, state, errorCode);
          if (!run) return null;
          await this.audit.record(tx, {
            module: MODULE,
            recordId: run.device_id,
            action: 'update',
            delta: { history_import: { old: 'running', new: state } },
          });
          await this.emit(tx, run, 'device.history_import_finished', { state, errorCode });
          return run;
        }),
    );
  }

  /** Counts only: never a name, a number or a message text. */
  private async emit(
    tx: Tx,
    run: HistoryRunRow,
    eventType: string,
    extra: Record<string, unknown>,
  ) {
    const facts = await this.repo.deviceFacts(tx, run.org_id, run.device_id);
    return this.outbox.emit(tx, {
      aggregateModule: MODULE,
      aggregateId: run.device_id,
      eventType,
      payload: {
        runId: run.uuid,
        // For the realtime hint (the aggregate id is the internal one).
        deviceId: facts?.uuid ?? null,
        mode: run.mode,
        chats: run.chats_count,
        contacts: run.contacts_count,
        messages: run.messages_count,
        ...extra,
      },
    });
  }
}
