import { Injectable } from '@nestjs/common';
import {
  CALL_PLAYBACK_TTL_SECONDS,
  type CallLogSource,
  type CallOutcome,
  type CallAnalytics,
  type CallAnalyticsQuery,
  type CallLogDetail,
  type CallLogFilters,
  type CallLogList,
  type CallLogListQuery,
  type CallLogRow,
  type CallLogStatus,
  type CallPlayback,
  type CallRecordingConsentMethod,
  type CallRecordingLifecycle,
  type CallTimelineEntry,
  type RecordScope,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore, MediaTokenService } from '../../infra/providers/chat-conversations/media';
import { AuditService } from '../../kernel/audit/audit.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { dayWindow, eachDay, logWindow, recordingMime, timelineNote } from './call-logs.rules';
import { CallLogsRepository, type Viewer } from './call-logs.repository';
import { caller, notFound } from './calling-support';
import { notesPreview } from './logging/call-logging.rules';

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** The key that lets a person play recordings (`call.logs.read` only lets them read the log). */
export const PERM_RECORDINGS_PLAY = 'call.recordings.play';
const MODULE = 'wa_calls';
/** The plan feature of WhatsApp calling: it gates the WhatsApp-only parts of the call log, not the log. */
export const WHATSAPP_CALLING = 'waba_calling' as const;

/** The consent evidence, retention clock and hold of a call's recording (BL-144). */
export function toLifecycle(r: Row): CallRecordingLifecycle {
  const storedAt = iso(r.recording_stored_at);
  const stored = typeof r.recording_path === 'string' && r.recording_path !== '';
  const hold = r.recording_legal_hold === true;
  return {
    storedAt,
    expiresAt:
      stored && storedAt && !hold
        ? new Date(
            new Date(storedAt).getTime() + Number(r.retention_days ?? 90) * 86_400_000,
          ).toISOString()
        : null,
    legalHold: hold,
    holdReason: (r.recording_hold_reason as string | null) ?? null,
    deletedAt: iso(r.recording_deleted_at),
    deletedReason: (r.recording_deleted_reason as CallRecordingLifecycle['deletedReason']) ?? null,
    consent: {
      status: (r.recording_consent_status as 'granted' | 'declined' | null) ?? null,
      method: (r.recording_consent_method as CallRecordingConsentMethod | null) ?? null,
      at: iso(r.recording_consent_at),
      noticeVersion:
        r.recording_notice_version === null ? null : Number(r.recording_notice_version),
      noticeSha256: (r.recording_notice_sha256 as string | null) ?? null,
    },
  };
}

/** The row of the log as the screens read it. */
export function toLogRow(r: Row): CallLogRow {
  const inbound = r.direction === 'USER_INITIATED';
  return {
    id: String(r.uuid),
    direction: inbound ? 'inbound' : 'outbound',
    status: r.log_status as CallLogStatus,
    customerPhone: String((inbound ? r.from_phone : r.to_phone) ?? ''),
    ourPhone: String((inbound ? r.to_phone : r.from_phone) ?? ''),
    contactId: (r.contact_uuid as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    numberId: (r.number_uuid as string | null) ?? null,
    numberLabel: (r.number_label as string | null) ?? null,
    handlerType: (r.handler_type as CallLogRow['handlerType']) ?? null,
    handlerId: (r.handler_uuid as string | null) ?? null,
    handlerName: (r.handler_name as string | null) ?? null,
    startedAt: iso(r.started_at),
    durationSec: Number(r.duration_sec ?? 0),
    endReason: (r.end_reason as string | null) ?? null,
    hasRecording: r.has_recording === true,
    source: ((r.source as CallLogSource | undefined) ?? 'whatsapp') as CallLogSource,
    outcome: (r.outcome as CallOutcome | null | undefined) ?? null,
    notesPreview: notesPreview(r.notes as string | null | undefined),
  };
}

/**
 * The call log and the call analytics (TW-CALL-022 onward). Reference mirrored every call into `ai_call_logs` and read that; here the
 * log reads `wa_calls` (the source of truth) and its ledger `wa_call_events` directly, so there is no mirror to fall behind.
 *
 * Plan (BL-257): the list, its cards, the filters, the detail and the analytics are **not** plan-gated. They read every call the
 * person may see, so a workspace that only logs calls (by hand, from the mobile app or from a telephony provider) has the screen
 * without WhatsApp calling. What belongs to WhatsApp stays behind `waba_calling`: playing a recording (only WhatsApp calls have one
 * a person can play), the filter by WhatsApp number (`numberId`), and the numbers the filter bar offers (empty without the feature).
 * Calls a workspace made while it had WhatsApp calling stay readable if the feature is later switched off, like the contact's calls.
 * The record scope of `call.logs.read` decides whose calls a person sees; playing a recording needs `call.recordings.play` and is
 * written to the audit trail each time.
 */
@Injectable()
export class CallLogsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallLogsRepository,
    private readonly plans: PlanEntitlementService,
    private readonly audit: AuditService,
    private readonly tokens: MediaTokenService,
    private readonly media: ChatMediaStore,
  ) {}

  /** Who is asking. No plan check: the log of every source is open to anyone with `call.logs.read` (BL-257). */
  private viewer(scope: RecordScope): Viewer {
    const { orgId, userId } = caller();
    return { orgId, userId, scope };
  }

  /** A filter that only means something to WhatsApp calling (a WhatsApp number): refused with the plan-locked problem without it. */
  private async assertWhatsappFilter(v: Viewer, numberId: string | undefined): Promise<void> {
    if (numberId) await this.plans.assertFeature(v.orgId, WHATSAPP_CALLING);
  }

  async list(q: CallLogListQuery, scope: RecordScope, now = new Date()): Promise<CallLogList> {
    const v = this.viewer(scope);
    await this.assertWhatsappFilter(v, q.numberId);
    const w = logWindow(q, now);
    const filters = {
      start: w.start,
      end: w.end,
      status: q.status,
      direction: q.direction,
      numberUuid: q.numberId,
      agentUuid: q.agentId,
      q: q.q || undefined,
      source: q.source,
    };
    return this.db.tx(async (tx) => {
      const [selection, workspace] = await Promise.all([
        this.repo.selection(tx, v, filters),
        this.repo.workspaceTotals(tx, v),
      ]);
      const rows =
        selection.total === 0
          ? []
          : await this.repo.page(tx, v, filters, q.pageSize, (q.page - 1) * q.pageSize);
      return {
        rows: rows.map(toLogRow),
        page: q.page,
        pageSize: q.pageSize,
        total: selection.total,
        kpis: { workspace, selection },
      };
    });
  }

  async filters(scope: RecordScope): Promise<CallLogFilters> {
    const v = this.viewer(scope);
    // The WhatsApp numbers are offered only to a workspace that has WhatsApp calling; the teammates are those of every source.
    const whatsapp = await this.plans.featureEnabled(v.orgId, WHATSAPP_CALLING);
    return this.db.tx(async (tx) => ({
      numbers: whatsapp ? await this.repo.numbers(tx, v.orgId) : [],
      agents: await this.repo.agents(tx, v),
    }));
  }

  async detail(uuid: string, scope: RecordScope): Promise<CallLogDetail> {
    const v = this.viewer(scope);
    const found = await this.db.tx(async (tx) => {
      const r = await this.repo.byUuid(tx, v, uuid);
      if (!r) return null;
      return { r, events: await this.repo.timeline(tx, v.orgId, Number(r.id)) };
    });
    if (!found) return this.entryDetail(v, uuid);
    const { r, events } = found;
    const row = toLogRow(r);
    const timeline: CallTimelineEntry[] = events.map((e) => ({
      type: String(e.event_type),
      at: new Date(e.received_at as string).toISOString(),
      note: timelineNote(String(e.event_type), e.payload),
    }));
    return {
      call: {
        ...row,
        answeredAt: iso(r.answered_at),
        endedAt: iso(r.ended_at),
        failureReason: r.call_status === 'failed' ? row.endReason : null,
        conversationId: (r.conversation_uuid as string | null) ?? null,
      },
      timeline,
      recording: {
        available: row.hasRecording,
        mime: typeof r.recording_path === 'string' ? recordingMime(r.recording_path) : null,
        // The size is read from the store only when the recording is played; the list never touches the disk.
        sizeBytes: null,
        lifecycle: toLifecycle(r),
      },
    };
  }

  /**
   * The detail of a call that is not a WhatsApp call: who, when, how long, what came of it and what was written. Its timeline is the
   * line it wrote when it was logged; it has no recording a person can play here (a reference on the provider's side is never returned).
   */
  private async entryDetail(v: Viewer, uuid: string): Promise<CallLogDetail> {
    const r = await this.db.tx((tx) => this.repo.entryByUuid(tx, v, uuid));
    if (!r) throw notFound('CALL_NOT_FOUND', 'Call');
    const row = toLogRow(r);
    return {
      call: {
        ...row,
        answeredAt: null,
        endedAt: iso(r.ended_at),
        failureReason: null,
        conversationId: null,
        notes: (r.notes as string | null) ?? null,
        followUpTaskId: (r.task_uuid as string | null) ?? null,
      },
      timeline: [
        {
          type: 'logged',
          at: iso(r.started_at) ?? new Date().toISOString(),
          note: row.source ?? null,
        },
      ],
      recording: {
        available: false,
        mime: null,
        sizeBytes: null,
        lifecycle: {
          storedAt: null,
          expiresAt: null,
          legalHold: false,
          holdReason: null,
          deletedAt: null,
          deletedReason: null,
          consent: {
            status: null,
            method: null,
            at: null,
            noticeVersion: null,
            noticeSha256: null,
          },
        },
      },
    };
  }

  /**
   * A link to play one recording, good for a few minutes and for this person only (the same sealed media link the inbox uses for a
   * customer's file; the media route also needs their session). Every request is audited: who listened to which call.
   */
  async playback(uuid: string, scope: RecordScope): Promise<CallPlayback> {
    const v = this.viewer(scope);
    // A recording a person can play belongs to a WhatsApp call: playing one stays a WhatsApp calling feature.
    await this.plans.assertFeature(v.orgId, WHATSAPP_CALLING);
    if (RequestContextStore.require().grants?.get(PERM_RECORDINGS_PLAY)?.effect !== 'allow') {
      throw AppError.forbidden(PERM_RECORDINGS_PLAY);
    }
    const found = await this.db.tx(async (tx) => {
      const r = await this.repo.byUuid(tx, v, uuid);
      if (!r || typeof r.recording_path !== 'string' || !r.recording_path) return null;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: Number(r.id),
        action: 'read',
        delta: { recording: { old: null, new: 'played' } },
      });
      return { key: r.recording_path, uuid: String(r.uuid) };
    });
    if (!found || !v.userId || !this.media.ownsKey(v.orgId, found.key)) {
      throw notFound('CALL_NOT_FOUND', 'Recording');
    }
    const mime = recordingMime(found.key);
    const token = this.tokens.sign(
      {
        key: found.key,
        orgId: v.orgId,
        userId: v.userId,
        name: `call-${found.uuid}.${found.key.split('.').pop() ?? 'webm'}`,
        mime,
      },
      CALL_PLAYBACK_TTL_SECONDS,
    );
    return {
      url: `/v2/media/${token}`,
      expiresAt: new Date(Date.now() + CALL_PLAYBACK_TTL_SECONDS * 1000).toISOString(),
      mime,
    };
  }

  async analytics(
    q: CallAnalyticsQuery,
    scope: RecordScope,
    now = new Date(),
  ): Promise<CallAnalytics> {
    const v = this.viewer(scope);
    await this.assertWhatsappFilter(v, q.numberId);
    const w = dayWindow(q, now);
    const [totals, daily, byAgent, heat, bySource] = await this.db.tx(async (tx) =>
      Promise.all([
        this.repo.analyticsTotals(tx, v, w.start, w.end, q.numberId, q.source),
        this.repo.analyticsDaily(tx, v, w.start, w.end, w.tz, q.numberId, q.source),
        this.repo.analyticsByAgent(tx, v, w.start, w.end, q.numberId, q.source),
        this.repo.analyticsHeatmap(tx, v, w.start, w.end, w.tz, q.numberId, q.source),
        this.repo.analyticsBySource(tx, v, w.start, w.end, q.numberId, q.source),
      ]),
    );
    const byDay = new Map(daily.map((d) => [d.day, d]));
    return {
      from: w.fromDay,
      to: w.toDay,
      tz: w.tz,
      totals: {
        total: totals.total,
        answered: totals.answered,
        missed: totals.missed,
        // Over the calls that finished: one still ringing has not been answered or missed yet.
        answeredRate: totals.finished === 0 ? 0 : totals.answered / totals.finished,
        avgHandleSec: totals.avgHandleSec,
        totalMinutes: totals.totalMinutes,
      },
      series: eachDay(w.fromDay, w.toDay).map(
        (day) => byDay.get(day) ?? { day, total: 0, answered: 0, missed: 0 },
      ),
      byAgent,
      bySource,
      heatmap: heat.filter((h) => h.calls > 0),
    };
  }
}
