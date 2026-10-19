import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CALL_RECORDING_RETENTION_DEFAULT_DAYS,
  ERROR_CODES,
  type CallRecordingSettings,
  type UpdateCallRecordingSettingsInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { CallRecordingRepository, type RecordingSettingsRow } from './call-recording.repository';
import { caller } from './calling-support';

const MODULE = 'call_recording_settings';

/** sha-256 of the notice exactly as stored: the proof of what an operator read to a person. */
export const noticeSha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** The saved row merged over the defaults. Recording is OFF until a workspace turns it on (decision D7). */
export function mergeRecordingSettings(
  row: RecordingSettingsRow | null,
  defaultDays: number = CALL_RECORDING_RETENTION_DEFAULT_DAYS,
): CallRecordingSettings {
  return {
    enabled: row?.enabled ?? false,
    consentMode: row?.consentMode ?? 'confirmed',
    retentionDays: row?.retentionDays ?? defaultDays,
    noticeText: row?.noticeText ?? null,
    noticeVersion: row?.noticeVersion ?? 0,
    rowVersion: row?.rowVersion ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The workspace's rules for recording calls (BL-144): the switch (off by default), how consent is obtained, the notice an operator
 * reads (versioned, each version hashed), and how many days a recording is kept. Anyone who can take calls reads the rules (the panel
 * needs the notice); `call.recordings.manage` writes them. Same plan gate as the rest of calling (`waba_calling`).
 */
@Injectable()
export class CallRecordingSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallRecordingRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plans: PlanEntitlementService,
  ) {}

  async get(): Promise<CallRecordingSettings> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    return this.read(orgId);
  }

  /** For the gate and the sweep: no request context, no plan check. */
  async read(orgId: number): Promise<CallRecordingSettings> {
    const { row, defaultDays } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      row: await this.repo.getSettings(tx, orgId),
      // The platform default window (retention dashboard) for a workspace that never chose its own.
      defaultDays: await this.repo.platformDefaultDays(tx),
    }));
    return mergeRecordingSettings(row, defaultDays);
  }

  async update(input: UpdateCallRecordingSettingsInput): Promise<CallRecordingSettings> {
    const { orgId, userId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    await this.db.tx(async (tx) => {
      const before = await this.repo.getSettings(tx, orgId);
      if ((before === null) !== (input.rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Call recording settings');
      }
      const text = input.noticeText.trim();
      const changed = text !== '' && text !== (before?.noticeText ?? '');
      let version = before?.noticeVersion ?? 0;
      if (changed) {
        version += 1;
        await this.repo.addNoticeVersion(tx, orgId, version, text, noticeSha256(text), userId);
      }
      if (input.enabled && (text === '' || version === 0)) {
        throw new AppError(
          ERROR_CODES.CALL_RECORDING_SETTINGS_INVALID,
          'Write the recording notice before switching recording on.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'noticeText', message: 'The recording notice is required.' }],
        );
      }
      const ok = await this.repo.saveSettings(
        tx,
        orgId,
        {
          enabled: input.enabled,
          consentMode: input.consentMode,
          retentionDays: input.retentionDays,
          // Cleared text is stored as none; the versions already used stay in `call_recording_notice_versions`.
          noticeText: text === '' ? null : text,
          noticeVersion: version,
        },
        userId,
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Call recording settings');
      const was = mergeRecordingSettings(before, await this.repo.platformDefaultDays(tx));
      await this.audit.record(tx, {
        module: MODULE,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        // Field names and values of switches only; the notice text is a workspace document, referenced by its version.
        delta: {
          ...(was.enabled !== input.enabled && {
            enabled: { old: was.enabled, new: input.enabled },
          }),
          ...(was.consentMode !== input.consentMode && {
            consentMode: { old: was.consentMode, new: input.consentMode },
          }),
          ...(was.retentionDays !== input.retentionDays && {
            retentionDays: { old: was.retentionDays, new: input.retentionDays },
          }),
          ...(was.noticeVersion !== version && {
            noticeVersion: { old: was.noticeVersion, new: version },
          }),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: orgId,
        eventType: 'call.recording.settings_changed',
        payload: {
          enabled: input.enabled,
          consentMode: input.consentMode,
          retentionDays: input.retentionDays,
          noticeVersion: version,
        },
      });
    });
    return this.read(orgId);
  }
}
