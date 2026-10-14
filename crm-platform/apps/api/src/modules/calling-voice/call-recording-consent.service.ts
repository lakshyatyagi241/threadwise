import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CALL_RECORDING_MODE_METHOD,
  ERROR_CODES,
  type CallRecordingGate,
  type ConsentGateResult,
  type RecordCallConsentInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { AuditService } from '../../kernel/audit/audit.service';
import { ConsentGate } from '../contact-consent';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { CallRecordingRepository, type RecordingState } from './call-recording.repository';
import { CallRecordingSettingsService } from './call-recording-settings.service';
import { CallsRepository } from './calls.repository';
import { caller, notFound, unprocessable } from './calling-support';

/**
 * Consent to record a call (BL-144). The operator tells the system what the person answered; the evidence (answer, method, time,
 * teammate, notice version and its sha-256) is kept on the call, and every recording decision goes through the ConsentGate with
 * purpose `call_recording`: `allow` only after the notice was delivered AND the person agreed. No audio is accepted otherwise.
 */
@Injectable()
export class CallRecordingConsentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallRecordingRepository,
    private readonly calls: CallsRepository,
    private readonly settings: CallRecordingSettingsService,
    private readonly gate: ConsentGate,
    private readonly audit: AuditService,
    private readonly plans: PlanEntitlementService,
    private readonly media: ChatMediaStore,
  ) {}

  /** The gate's answer for one call, from the evidence on its row. Also used by the upload. */
  async decide(orgId: number, state: RecordingState, enabled: boolean): Promise<ConsentGateResult> {
    return this.gate.check(
      orgId,
      state.contactId !== null
        ? { type: 'contact', id: state.contactId }
        : { type: 'phone', phone: state.customerPhone },
      'voice',
      'call_recording',
      'voice',
      {
        purposeEnabled: enabled,
        ...(state.consentStatus && state.noticeVersion
          ? { noticeEvidence: { delivered: true, consent: state.consentStatus } }
          : {}),
      },
    );
  }

  async gateFor(callUuid: string): Promise<CallRecordingGate> {
    const { orgId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const state = await this.db.tx((tx) => this.repo.stateByUuid(tx, orgId, callUuid));
    if (!state) throw notFound('CALL_NOT_FOUND', 'Call');
    return this.describe(orgId, state);
  }

  private async describe(orgId: number, state: RecordingState): Promise<CallRecordingGate> {
    const s = await this.settings.read(orgId);
    const verdict = await this.decide(orgId, state, s.enabled);
    return {
      decision: verdict.decision,
      reason: verdict.reason,
      consentMode: s.consentMode,
      noticeText: s.noticeText,
      noticeVersion: s.noticeVersion,
      consent: {
        status: state.consentStatus,
        method: state.consentMethod,
        at: state.consentAt,
        noticeVersion: state.noticeVersion,
        noticeSha256: state.noticeSha256,
      },
    };
  }

  /** The operator records the person's answer. Idempotent for the same answer; a later answer replaces an earlier one. */
  async record(callUuid: string, input: RecordCallConsentInput): Promise<CallRecordingGate> {
    const { orgId, userId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    const s = await this.settings.read(orgId);
    if (!s.enabled) {
      throw unprocessable(
        'CALL_RECORDING_DISABLED',
        'Call recording is switched off for this workspace.',
      );
    }
    if (input.method !== CALL_RECORDING_MODE_METHOD[s.consentMode]) {
      throw unprocessable(
        'CALL_RECORDING_CONSENT_INVALID',
        'That way of asking does not match the workspace setting.',
      );
    }
    let removeKey: string | null = null;
    const state = await this.db.tx(async (tx) => {
      const cur = await this.repo.stateByUuid(tx, orgId, callUuid, true);
      if (!cur) throw notFound('CALL_NOT_FOUND', 'Call');
      if (cur.status !== 'connecting' && cur.status !== 'active') {
        throw unprocessable('CALL_RECORDING_CONSENT_INVALID', 'The call is not live.');
      }
      if (cur.consentStatus === input.decision && cur.consentMethod === input.method) return cur;
      const sha = await this.repo.noticeSha(tx, orgId, s.noticeVersion);
      if (!sha) {
        throw unprocessable('CALL_RECORDING_DISABLED', 'The recording notice is missing.');
      }
      await this.repo.writeConsent(tx, orgId, cur.id, {
        status: input.decision,
        method: input.method,
        userId,
        noticeVersion: s.noticeVersion,
        noticeSha256: sha,
      });
      await this.calls.logEvent(tx, orgId, cur.id, `recording_consent_${input.decision}`, {
        method: input.method,
        noticeVersion: s.noticeVersion,
      });
      await this.audit.record(tx, {
        module: 'wa_calls',
        recordId: cur.id,
        action: 'update',
        delta: { recordingConsent: { old: cur.consentStatus, new: input.decision } },
      });
      // A withdrawal after a file was stored removes the file: consent that is gone cannot cover it.
      if (input.decision === 'declined' && cur.recordingPath && !cur.legalHold) {
        removeKey = cur.recordingPath;
        await this.repo.writeRemoved(tx, orgId, cur.id, 'consent_withdrawn');
        await this.calls.logEvent(tx, orgId, cur.id, 'recording_deleted', {
          reason: 'consent_withdrawn',
        });
      }
      return (await this.repo.stateByUuid(tx, orgId, callUuid)) as RecordingState;
    });
    if (removeKey) await this.media.remove(orgId, removeKey).catch(() => undefined);
    return this.describe(orgId, state);
  }
}

export const consentRequired = (): AppError =>
  new AppError(
    ERROR_CODES.CALL_RECORDING_CONSENT_REQUIRED,
    'This call may not be recorded: the person has not agreed.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
