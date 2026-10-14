import { Injectable } from '@nestjs/common';
import {
  CALL_PLAYBACK_TTL_SECONDS,
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

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** The key that lets a person play recordings (`call.logs.read` only lets them read the log). */
export const PERM_RECORDINGS_PLAY = 'call.recordings.play';
const MODULE = 'wa_calls';

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
  };
}

/**
 * The call log and the call analytics (TW-CALL-022 onward). Reference mirrored every call into `ai_call_logs` and read that; here the
 * log reads `wa_calls` (the source of truth) and its ledger `wa_call_events` directly, so there is no mirror to fall behind. Same
 * plan gate as the dial routes (`waba_calling`); the record scope of `call.logs.read` decides whose calls a person sees; playing a
 * recording needs `call.recordings.play` and is written to the audit trail each time.
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

  private async viewer(scope: RecordScope): Promise<Viewer> {
    const { orgId, userId } = caller();
    await this.plans.assertFeature(orgId, 'waba_calling');
    return { orgId, userId, scope };
  }

  async list(q: CallLogListQuery, scope: RecordScope, now = new Date()): Promise<CallLogList> {
    const v = await this.viewer(scope);
    const w = logWindow(q, now);
    const filters = {
      start: w.start,
      end: w.end,
      status: q.status,
      direction: q.direction,
      numberUuid: q.numberId,
      agentUuid: q.agentId,
      q: q.q || undefined,
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
    const v = await this.viewer(scope);
    return this.db.tx(async (tx) => ({
      numbers: await this.repo.numbers(tx, v.orgId),
      agents: await this.repo.agents(tx, v),
    }));
  }

  async detail(uuid: string, scope: RecordScope): Promise<CallLogDetail> {
    const v = await this.viewer(scope);
    const found = await this.db.tx(async (tx) => {
      const r = await this.repo.byUuid(tx, v, uuid);
      if (!r) return null;
      return { r, events: await this.repo.timeline(tx, v.orgId, Number(r.id)) };
    });
    if (!found) throw notFound('CALL_NOT_FOUND', 'Call');
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
   * A link to play one recording, good for a few minutes and for this person only (the same sealed media link the inbox uses for a
   * customer's file; the media route also needs their session). Every request is audited: who listened to which call.
   */
  async playback(uuid: string, scope: RecordScope): Promise<CallPlayback> {
    const v = await this.viewer(scope);
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
    const v = await this.viewer(scope);
    const w = dayWindow(q, now);
    const [totals, daily, byAgent, heat] = await this.db.tx(async (tx) =>
      Promise.all([
        this.repo.analyticsTotals(tx, v, w.start, w.end, q.numberId),
        this.repo.analyticsDaily(tx, v, w.start, w.end, w.tz, q.numberId),
        this.repo.analyticsByAgent(tx, v, w.start, w.end, q.numberId),
        this.repo.analyticsHeatmap(tx, v, w.start, w.end, w.tz, q.numberId),
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
      heatmap: heat.filter((h) => h.calls > 0),
    };
  }
}
