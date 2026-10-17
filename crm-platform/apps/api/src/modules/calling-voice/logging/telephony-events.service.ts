import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  CALL_RECORDING_MODE_METHOD,
  TELEPHONY_CALL_STATUSES,
  type CallEntrySource,
  type TelephonyCallStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';
import { QUEUES } from '../../../infra/queue/queues';
import { ConsentGate } from '../../contact-consent';
import { ContactResolverService, ContactsService } from '../../crm';
import { CallRecordingSettingsService } from '../call-recording-settings.service';
import { CallLoggingSettingsService } from './call-logging-settings.service';
import { CallLogEntriesRepository, type NewEntry } from './call-log-entries.repository';
import { CallLogEntriesService, runAsSystem } from './call-log-entries.service';
import {
  checkStartedAt,
  e164Of,
  outcomeFromTelephony,
  telephonyExternalId,
} from './call-logging.rules';
import type { TelephonyJob } from './telephony-webhook.service';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;

export type TelephonyApplyResult = 'created' | 'duplicate' | 'ignored';

/**
 * Applies one finished call a provider reported (the worker side of the signed callback). The business's own line is the whole point of
 * a telephony connection, so unlike a personal phone EVERY call on it is a business call and is kept, with or without a contact; what
 * the workspace's "create contacts from unknown callers" switch decides here is only whether a stranger becomes a contact.
 *
 *  - the handler and the contact of a call WE placed (click-to-call) come back from the placement kept when it was placed, and the
 *    entry's source is `web_click_to_call`; any other call is `telephony`, with no handler (the provider does not tell us who answered);
 *  - a recording reference is kept only if the ConsentGate allows recording this call (the workspace switch is on, and the connection's
 *    owner attests the notice is played, in the "announcement" consent mode); otherwise the call is logged without it. Audio is never fetched;
 *  - idempotent: the entry is unique on (source, connection + the provider's call id).
 */
@Injectable()
export class TelephonyEventsService {
  private readonly logger = new Logger(TelephonyEventsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly entries: CallLogEntriesService,
    private readonly repo: CallLogEntriesRepository,
    private readonly contactsService: ContactsService,
    private readonly resolver: ContactResolverService,
    private readonly settings: CallLoggingSettingsService,
    private readonly recordingSettings: CallRecordingSettingsService,
    private readonly gate: ConsentGate,
  ) {}

  async apply(job: TelephonyJob): Promise<TelephonyApplyResult> {
    const { orgId, connectionUuid, event } = job;
    if (!(TELEPHONY_CALL_STATUSES as readonly string[]).includes(event.status)) return 'ignored';
    const startedAt = new Date(event.startedAt);
    if (checkStartedAt(startedAt) === 'too_old' || Number.isNaN(startedAt.getTime())) {
      return 'ignored';
    }
    const cc = await runAsSystem(orgId, () => this.resolver.defaultCountryCode());
    // The recording rules read the workspace's settings on their own connection, before the transaction opens.
    const recordingRules = event.recordingRef ? await this.recordingSettings.read(orgId) : null;

    return runAsSystem(orgId, () =>
      this.db.txAs({ orgId, userId: null }, async (tx) => {
        const conn = await this.connection(tx, orgId, connectionUuid);
        if (!conn || conn.status !== 'active') return 'ignored' as const;

        const placed = await this.placement(tx, orgId, conn.id, event.callId);
        const phone = e164Of(event.customerNumber, cc) ?? placed?.customerPhone ?? null;
        const contactId =
          placed?.contactId ?? (await this.contactOf(tx, orgId, phone, placed?.userId ?? null));
        const ourPhone = e164Of(event.ourNumber, cc);
        const source: CallEntrySource = placed ? 'web_click_to_call' : 'telephony';

        const recording = await this.recordingOf(orgId, conn, event.recordingRef, recordingRules, {
          contactId,
          phone,
        });

        const { entry, created } = await this.entries.write(tx, orgId, {
          source,
          direction: event.direction,
          outcome: outcomeFromTelephony(event.status as TelephonyCallStatus, event.durationSec),
          startedAt,
          durationSec: event.durationSec,
          contactId,
          customerPhone: phone,
          ourPhone,
          numberLabel: conn.label,
          handlerUserId: placed?.userId ?? null,
          notes: null,
          externalId: telephonyExternalId(connectionUuid, event.callId),
          telephonyConnectionId: conn.id,
          recording,
          createdBy: placed?.userId ?? null,
          activitySource: 'system',
        } satisfies NewEntry & { activitySource: 'user' | 'system' });

        await tx.execute(sql`
          UPDATE telephony_connections SET last_event_at = now() WHERE org_id = ${orgId} AND id = ${conn.id}`);
        if (placed) {
          await tx.execute(
            sql`DELETE FROM telephony_click_calls WHERE org_id = ${orgId} AND id = ${placed.id}`,
          );
        }
        this.logger.debug({ orgId, entry: entry.uuid, created }, '[CALL] telephony call applied');
        return created ? ('created' as const) : ('duplicate' as const);
      }),
    );
  }

  private async connection(tx: Tx, orgId: number, uuid: string) {
    const res = await tx.execute(sql`
      SELECT id, label, status, plays_recording_notice
      FROM telephony_connections WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r
      ? {
          id: Number(r.id),
          label: String(r.label),
          status: String(r.status),
          playsNotice: r.plays_recording_notice === true,
        }
      : null;
  }

  private async placement(tx: Tx, orgId: number, connectionId: number, callId: string) {
    const res = await tx.execute(sql`
      SELECT id, user_id, contact_id, customer_phone FROM telephony_click_calls
      WHERE org_id = ${orgId} AND connection_id = ${connectionId} AND external_id = ${callId}`);
    const r = rowsOf(res)[0];
    return r
      ? {
          id: Number(r.id),
          userId: r.user_id === null ? null : Number(r.user_id),
          contactId: r.contact_id === null ? null : Number(r.contact_id),
          customerPhone: r.customer_phone === null ? null : String(r.customer_phone),
        }
      : null;
  }

  /** The contact that owns the number (any: this is a system report), or a new one when the workspace asked for strangers to become contacts. */
  private async contactOf(
    tx: Tx,
    orgId: number,
    phone: string | null,
    ownerId: number | null,
  ): Promise<number | null> {
    if (!phone) return null;
    const hit = await this.repo.contactByPhone(tx, orgId, phone, phone.slice(1));
    if (hit) return hit.id;
    if (!(await this.settings.readIn(tx, orgId)).createContactsFromUnknownCallers) return null;
    const made = await this.contactsService.resolveOrCreateByIdentity(tx, orgId, {
      kind: 'phone',
      value: phone,
      source: 'telephony',
      ownerId,
    });
    return made.outcome === 'found' || made.outcome === 'created' ? made.contactId : null;
  }

  /** The reference to keep, or null: the ConsentGate answers for the `call_recording` purpose with the evidence the connection can give. */
  private async recordingOf(
    orgId: number,
    conn: { playsNotice: boolean },
    ref: string | null,
    rules: Awaited<ReturnType<CallRecordingSettingsService['read']>> | null,
    who: { contactId: number | null; phone: string | null },
  ): Promise<NewEntry['recording']> {
    if (!ref || !rules) return null;
    const announces =
      conn.playsNotice &&
      rules.enabled &&
      rules.consentMode === 'announcement' &&
      rules.noticeVersion > 0;
    const subject =
      who.contactId !== null
        ? ({ type: 'contact', id: who.contactId } as const)
        : who.phone
          ? ({ type: 'phone', phone: who.phone } as const)
          : null;
    if (!subject) return null;
    const verdict = await this.gate.check(orgId, subject, 'voice', 'call_recording', 'voice', {
      purposeEnabled: rules.enabled,
      ...(announces ? { noticeEvidence: { delivered: true, consent: 'granted' as const } } : {}),
    });
    if (verdict.decision !== 'allow') return null;
    return {
      ref,
      method: CALL_RECORDING_MODE_METHOD[rules.consentMode],
      noticeVersion: rules.noticeVersion,
    };
  }
}

/** Runs a reported call in the worker. A fault in the database retries; what the provider said is never a reason to retry. */
@Processor(QUEUES.TELEPHONY_INGEST, { concurrency: 4 })
export class TelephonyIngestProcessor extends WorkerHost {
  constructor(private readonly events: TelephonyEventsService) {
    super();
  }

  async process(job: Job<TelephonyJob>): Promise<{ result: TelephonyApplyResult }> {
    return { result: await this.events.apply(job.data) };
  }
}
