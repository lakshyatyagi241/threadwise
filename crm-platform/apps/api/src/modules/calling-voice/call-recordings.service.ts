import { Injectable, Logger } from '@nestjs/common';
import {
  CALL_RECORDING_MAX_BYTES,
  ERROR_CODES,
  type RecordingResult,
  type SetRecordingHoldInput,
} from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore, type OpenedMedia } from '../../infra/providers/chat-conversations/media';
import { AuditService } from '../../kernel/audit/audit.service';
import { CallsRepository } from './calls.repository';
import { CallRecordingRepository } from './call-recording.repository';
import { CallRecordingSettingsService } from './call-recording-settings.service';
import { CallRecordingConsentService, consentRequired } from './call-recording-consent.service';
import { caller, notFound, unprocessable } from './calling-support';

/** A recording shorter than this is an empty file (the recorder never got audio): nothing is stored (TW-CALL-019 rule 1). */
export const MIN_RECORDING_BYTES = 256;

/**
 * The operator's recording of a call (TW-CALL-019). The operator's browser mixes both voices and uploads one file when the call ends;
 * the server never hears the audio. Reference put the file on the public disk under a guessable URL; here it goes into the tenant's
 * private media store under a generated key and is read only through `open`, by a person of the workspace.
 */
@Injectable()
export class CallRecordingsService {
  private readonly logger = new Logger(CallRecordingsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly media: ChatMediaStore,
    private readonly recRepo: CallRecordingRepository,
    private readonly settings: CallRecordingSettingsService,
    private readonly consent: CallRecordingConsentService,
    private readonly audit: AuditService,
  ) {}

  async store(
    callUuid: string,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<RecordingResult> {
    const { orgId } = caller();
    if (file.buffer.length < MIN_RECORDING_BYTES) {
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        'The recording is empty.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (file.buffer.length > CALL_RECORDING_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        'The recording is larger than 50 MB.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    // No audio is kept before the ConsentGate allows it (BL-144): the switch is on, the notice was delivered, the person agreed.
    const rules = await this.settings.read(orgId);
    if (!rules.enabled) {
      throw unprocessable(
        'CALL_RECORDING_DISABLED',
        'Call recording is switched off for this workspace.',
      );
    }
    const before = await this.db.tx((tx) => this.recRepo.stateByUuid(tx, orgId, callUuid));
    if (!before) throw notFound('CALL_NOT_FOUND', 'Call');
    if ((await this.consent.decide(orgId, before, true)).decision !== 'allow') throw consentRequired();
    if (before.legalHold && before.recordingPath) {
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_ON_HOLD,
        'This call has a recording on legal hold; it cannot be replaced.',
        HttpStatus.CONFLICT,
      );
    }

    let stored;
    try {
      stored = await this.media.store({
        orgId,
        filename: file.originalname || 'call.webm',
        buffer: file.buffer,
        allow: ['media'],
        displayName: `call-${call.uuid}.webm`,
      });
    } catch (err) {
      this.logger.warn({ orgId, err }, 'a call recording was refused by the media store');
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        err instanceof AppError ? err.message : 'The recording could not be stored.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const previous = call.recordingPath;
    try {
      await this.db.tx(async (tx) => {
        // Checked again under the row lock: a refusal that arrived while the file was being stored wins.
        const now = await this.recRepo.stateByUuid(tx, orgId, callUuid, true);
        if (!now || now.consentStatus !== 'granted') throw consentRequired();
        await this.recRepo.writeStored(tx, orgId, call.id, stored.key);
        await this.repo.logEvent(tx, orgId, call.id, 'recording_stored', {
          size: stored.size,
          mime: stored.mime,
        });
      });
    } catch (err) {
      await this.media.remove(orgId, stored.key).catch(() => undefined);
      throw err;
    }
    // A second upload replaces the first (TW-CALL-019 rule 2): the old file must not stay behind unreachable.
    if (previous && previous !== stored.key)
      await this.media.remove(orgId, previous).catch(() => undefined);
    return { url: `/v2/calling/calls/${call.uuid}/recording` };
  }

  /** The recording's bytes for a person of the workspace; null when the call has none. */
  async open(
    callUuid: string,
    range?: { start: number; end?: number },
  ): Promise<{ media: OpenedMedia; mime: string; name: string } | null> {
    const { orgId } = caller();
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    if (!call.recordingPath) return null;
    const media = await this.media.open(orgId, call.recordingPath, range);
    return media ? { media, mime: 'audio/webm', name: `call-${call.uuid}.webm` } : null;
  }

  /** Deletes one recording by hand (`call.recordings.manage`). The call row stays; a legal hold refuses. */
  async remove(callUuid: string): Promise<void> {
    const { orgId } = caller();
    await this.db.tx(async (tx) => {
      const st = await this.recRepo.stateByUuid(tx, orgId, callUuid, true);
      if (!st) throw notFound('CALL_NOT_FOUND', 'Call');
      if (!st.recordingPath) throw notFound('CALL_NOT_FOUND', 'Recording');
      if (st.legalHold) {
        throw new AppError(
          ERROR_CODES.CALL_RECORDING_ON_HOLD,
          'This recording is on legal hold. Lift the hold first.',
          HttpStatus.CONFLICT,
        );
      }
      await this.media.remove(orgId, st.recordingPath);
      await this.recRepo.writeRemoved(tx, orgId, st.id, 'manual');
      await this.repo.logEvent(tx, orgId, st.id, 'recording_deleted', { reason: 'manual' });
      await this.audit.record(tx, {
        module: 'wa_calls',
        recordId: st.id,
        action: 'delete',
        delta: { recording: { old: 'stored', new: 'deleted' } },
      });
    });
  }

  /** Places or lifts a legal hold on one recording (key `privacy.requests.manage`); audited with its reason. */
  async setHold(callUuid: string, input: SetRecordingHoldInput): Promise<void> {
    const { orgId } = caller();
    await this.db.tx(async (tx) => {
      const st = await this.recRepo.stateByUuid(tx, orgId, callUuid, true);
      if (!st) throw notFound('CALL_NOT_FOUND', 'Call');
      if (!st.recordingPath) throw notFound('CALL_NOT_FOUND', 'Recording');
      await this.recRepo.writeHold(tx, orgId, st.id, input.hold, input.reason ?? null);
      await this.repo.logEvent(
        tx,
        orgId,
        st.id,
        input.hold ? 'recording_hold_set' : 'recording_hold_lifted',
        {},
      );
      await this.audit.record(tx, {
        module: 'wa_calls',
        recordId: st.id,
        action: 'update',
        delta: {
          recordingLegalHold: { old: st.legalHold, new: input.hold },
          holdReason: { old: st.holdReason, new: input.hold ? (input.reason ?? null) : null },
        },
      });
    });
  }
}
