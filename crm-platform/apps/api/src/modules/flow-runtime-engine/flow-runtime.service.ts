import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  FLOW_ENROLL_MAX_CONTACTS,
  type EnrollContactsInput,
  type EnrollOneInput,
  type EnrollOneResult,
  type EnrollResult,
  type FlowAnalytics,
  type FlowAnalyticsQuery,
  type FlowRunDetail,
  type FlowRunList,
  type FlowSubscriberList,
  type ListFlowRunsQuery,
  type ListFlowSubscribersQuery,
  type RetryResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { FlowEngine } from './runtime/engine.service';
import { FlowRunPublisher } from './runtime/flow-run.publisher';
import { FlowLaunchService } from './runtime/launch.service';
import { RunRepository } from './runtime/run.repository';
import { SubscriberRepository } from './runtime/subscriber.repository';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const MODULE = 'flow_runtime';
const notFound = (code: keyof typeof ERROR_CODES, what: string) =>
  new AppError(ERROR_CODES[code], `${what} not found`, HttpStatus.NOT_FOUND);

/**
 * What an operator sees and does with runs and subscribers (WD-FLR-008, 009, 051 to 058): enrol contacts, list who is in a flow,
 * pause and resume, retry failures, read a run's log, cancel a run, the numbers. Every id on the wire is a uuid; every query names the
 * caller's workspace, with row-level security as the backstop, so another workspace's id is a 404.
 */
@Injectable()
export class FlowRuntimeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly subscribers: SubscriberRepository,
    private readonly launch: FlowLaunchService,
    private readonly engine: FlowEngine,
    private readonly publisher: FlowRunPublisher,
    private readonly audit: AuditService,
  ) {}

  private org(): number {
    return RequestContextStore.require().orgId;
  }

  // --- enrolment -------------------------------------------------------------------------------------------------------------

  /**
   * Manual enrolment (WD-FLR-008): chosen contacts win over a group; a contact from another workspace is ignored; the flow must be
   * active but need not be published. A contact already in the flow is counted, not launched again. Capped per request.
   */
  async enroll(flowUuid: string, input: EnrollContactsInput): Promise<EnrollResult> {
    const orgId = this.org();
    const { flowId, contactIds } = await this.db.tx(async (tx) => {
      const flowId = await this.flowId(tx, orgId, flowUuid);
      let ids: Array<{ id: number; uuid: string }>;
      if (input.contactIds && input.contactIds.length > 0) {
        const res = await tx.execute(sql`
          SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND uuid IN (${sql.join(
            input.contactIds.map((u) => sql`${u}::uuid`),
            sql`, `,
          )})
          ORDER BY id LIMIT ${FLOW_ENROLL_MAX_CONTACTS}`);
        ids = rowsOf(res).map((r) => ({ id: Number(r.id), uuid: String(r.uuid) }));
      } else {
        const res = await tx.execute(sql`
          SELECT c.id, c.uuid FROM contact_group_members m
          JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id AND g.uuid = ${input.groupId!}::uuid
          JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id
          WHERE m.org_id = ${orgId} ORDER BY c.id LIMIT ${FLOW_ENROLL_MAX_CONTACTS}`);
        ids = rowsOf(res).map((r) => ({ id: Number(r.id), uuid: String(r.uuid) }));
      }
      return { flowId, contactIds: ids };
    });

    const results: EnrollResult['results'] = [];
    for (const c of contactIds) {
      try {
        const out = await this.launch.start(orgId, {
          flowId,
          contactId: c.id,
          source: 'manual',
          requirePublished: false,
          withSubscriber: true,
        });
        results.push({
          contactId: c.uuid,
          outcome:
            out.outcome === 'started'
              ? 'started'
              : out.outcome === 'already_enrolled'
                ? 'already_enrolled'
                : 'failed',
          reason: out.outcome === 'failed' ? out.reason : null,
        });
      } catch (err) {
        if (err instanceof AppError && err.code === ERROR_CODES.FLR_FLOW_INACTIVE) throw err;
        results.push({ contactId: c.uuid, outcome: 'failed', reason: (err as Error).message });
      }
    }
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: MODULE,
        recordId: flowId,
        action: 'update',
        delta: { enrolled: { old: 0, new: results.length } },
      }),
    );
    return {
      enrolled: results.filter((r) => r.outcome === 'started').length,
      alreadyEnrolled: results.filter((r) => r.outcome === 'already_enrolled').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    };
  }

  /** One contact by id or phone (the REST API's enrol, WD-FLR-009). Answers with the subscriber as it is, launched or not. */
  async enrollOne(flowUuid: string, input: EnrollOneInput): Promise<EnrollOneResult> {
    const orgId = this.org();
    const { flowId, contact } = await this.db.tx(async (tx) => {
      const flowId = await this.flowId(tx, orgId, flowUuid);
      let res;
      if (input.contactId) {
        res = await tx.execute(
          sql`SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND uuid = ${input.contactId}::uuid`,
        );
      } else {
        const digits = (input.phone ?? '').replace(/\D/g, '');
        res = await tx.execute(sql`
          SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND normalized_phone = ${'+' + digits} ORDER BY id LIMIT 1`);
      }
      const c = rowsOf(res)[0];
      if (!c) throw notFound('FLR_CONTACT_NOT_FOUND', 'Contact');
      return { flowId, contact: { id: Number(c.id), uuid: String(c.uuid) } };
    });
    const out = await this.launch.start(orgId, {
      flowId,
      contactId: contact.id,
      source: 'api',
      requirePublished: false,
      withSubscriber: true,
    });
    return this.db.tx(async (tx) => {
      const sub = await this.subscribers.find(tx, orgId, flowId, contact.id);
      const res = await tx.execute(sql`
        SELECT s.uuid, s.status, s.enrolled_at, r.uuid AS run_uuid FROM flow_subscribers s
        LEFT JOIN flow_runs r ON r.org_id = s.org_id AND r.id = s.last_run_id
        WHERE s.org_id = ${orgId} AND s.id = ${sub!.id}`);
      const r = rowsOf(res)[0]!;
      return {
        flowId: flowUuid,
        contactId: contact.uuid,
        subscriberId: String(r.uuid),
        status: r.status as EnrollOneResult['status'],
        enrolledAt: iso(r.enrolled_at),
        runId: out.outcome === 'started' ? String(r.run_uuid) : null,
      };
    });
  }

  // --- subscribers -----------------------------------------------------------------------------------------------------------

  async subscribersOf(flowUuid: string, q: ListFlowSubscribersQuery): Promise<FlowSubscriberList> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const flowId = await this.flowId(tx, orgId, flowUuid, false);
      const cursor = q.cursor ? Number(q.cursor) : null;
      const res = await tx.execute(sql`
        SELECT s.uuid, s.status, s.source, s.enrolled_at, s.completed_at, s.failed_at, s.failure_reason, s.retry_count,
               s.last_retried_at, s.id, c.uuid AS contact_uuid, c.name AS contact_name, c.phone AS contact_phone, r.uuid AS run_uuid
        FROM flow_subscribers s
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
        LEFT JOIN flow_runs r ON r.org_id = s.org_id AND r.id = s.last_run_id
        WHERE s.org_id = ${orgId} AND s.flow_id = ${flowId}
          ${q.status ? sql`AND s.status = ${q.status}` : sql``}
          ${cursor ? sql`AND s.id < ${cursor}` : sql``}
        ORDER BY s.id DESC LIMIT ${q.limit + 1}`);
      const rows = rowsOf(res);
      const page = rows.slice(0, q.limit);
      const counts = rowsOf(
        await tx.execute(
          sql`SELECT status, count(*)::int AS n FROM flow_subscribers WHERE org_id = ${orgId} AND flow_id = ${flowId} GROUP BY status`,
        ),
      );
      const n = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
      return {
        items: page.map((r) => ({
          id: String(r.uuid),
          flowId: flowUuid,
          contact: {
            id: String(r.contact_uuid),
            name: (r.contact_name as string | null) ?? null,
            phone: (r.contact_phone as string | null) ?? null,
          },
          status: r.status as 'active' | 'paused' | 'completed' | 'failed',
          source: String(r.source),
          enrolledAt: iso(r.enrolled_at),
          completedAt: iso(r.completed_at),
          failedAt: iso(r.failed_at),
          failureReason: (r.failure_reason as string | null) ?? null,
          retryCount: Number(r.retry_count),
          lastRetriedAt: iso(r.last_retried_at),
          lastRunId: (r.run_uuid as string | null) ?? null,
        })),
        counts: {
          active: n('active'),
          paused: n('paused'),
          completed: n('completed'),
          failed: n('failed'),
        },
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
      };
    });
  }

  /** Pauses a subscriber: its live run keeps its place and does nothing until resumed (WD-FLR-052). */
  async pause(subscriberUuid: string): Promise<void> {
    const orgId = this.org();
    await this.db.tx(async (tx) => {
      const sub = await this.subscriberOf(tx, orgId, subscriberUuid);
      if (sub.status !== 'active') {
        throw new AppError(
          ERROR_CODES.FLR_RUN_STATE_CONFLICT,
          `A ${sub.status} subscriber cannot be paused`,
          HttpStatus.CONFLICT,
        );
      }
      await this.subscribers.setStatus(tx, orgId, sub.id, 'paused');
      if (sub.lastRunId !== null) await this.runs.pause(tx, orgId, sub.lastRunId);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: sub.id,
        action: 'update',
        delta: { status: { old: 'active', new: 'paused' } },
      });
    });
  }

  async resume(subscriberUuid: string): Promise<void> {
    const orgId = this.org();
    const next = await this.db.tx(async (tx) => {
      const sub = await this.subscriberOf(tx, orgId, subscriberUuid);
      if (sub.status !== 'paused') {
        throw new AppError(
          ERROR_CODES.FLR_RUN_STATE_CONFLICT,
          `A ${sub.status} subscriber cannot be resumed`,
          HttpStatus.CONFLICT,
        );
      }
      await this.subscribers.setStatus(tx, orgId, sub.id, 'active');
      await this.audit.record(tx, {
        module: MODULE,
        recordId: sub.id,
        action: 'update',
        delta: { status: { old: 'paused', new: 'active' } },
      });
      if (sub.lastRunId === null) return null;
      const r = await this.runs.resume(tx, orgId, sub.lastRunId);
      return r ? { runId: sub.lastRunId, ...r } : null;
    });
    if (next) await this.publisher.schedule(orgId, next.runId, next.seq, next.delayMs ?? 0);
  }

  // --- retry -----------------------------------------------------------------------------------------------------------------

  /** Retries one failed subscriber (WD-FLR-057): the same row, a new run; every attempt is logged with what happened. */
  async retry(subscriberUuid: string): Promise<RetryResult> {
    const orgId = this.org();
    const sub = await this.db.tx((tx) => this.subscriberOf(tx, orgId, subscriberUuid));
    if (sub.status !== 'failed') {
      throw new AppError(
        ERROR_CODES.FLR_NOT_RETRYABLE,
        'Only a failed run can be retried',
        HttpStatus.CONFLICT,
      );
    }
    return await this.retryRows(orgId, [sub]);
  }

  /** Retries every failed subscriber of a flow, up to the request cap (WD-FLR-058). */
  async retryFailed(flowUuid: string): Promise<RetryResult> {
    const orgId = this.org();
    const subs = await this.db.tx(async (tx) => {
      const flowId = await this.flowId(tx, orgId, flowUuid, false);
      const res = await tx.execute(sql`
        SELECT id FROM flow_subscribers WHERE org_id = ${orgId} AND flow_id = ${flowId} AND status = 'failed' ORDER BY id LIMIT ${FLOW_ENROLL_MAX_CONTACTS}`);
      const out = [];
      for (const r of rowsOf(res)) {
        const s = await this.subscribers.findById(tx, orgId, Number(r.id));
        if (s) out.push(s);
      }
      return out;
    });
    return this.retryRows(orgId, subs);
  }

  private async retryRows(
    orgId: number,
    subs: Array<{ id: number; flowId: number; contactId: number; status: string }>,
  ): Promise<RetryResult> {
    const userId = RequestContextStore.require().userId ?? null;
    let retried = 0;
    let skipped = 0;
    for (const s of subs) {
      const prior = await this.db.tx(async (tx) => {
        const res = await tx.execute(
          sql`SELECT status, failure_reason FROM flow_subscribers WHERE org_id = ${orgId} AND id = ${s.id}`,
        );
        return rowsOf(res)[0]!;
      });
      let outcome: 'started' | 'failed' | 'skipped' = 'skipped';
      let reason: string | null = null;
      try {
        const out = await this.launch.start(orgId, {
          flowId: s.flowId,
          contactId: s.contactId,
          source: 'retry',
          requirePublished: false,
          withSubscriber: true,
          retry: true,
        });
        outcome =
          out.outcome === 'started' ? 'started' : out.outcome === 'failed' ? 'failed' : 'skipped';
        reason = out.outcome === 'failed' ? out.reason : null;
      } catch (err) {
        outcome = 'failed';
        reason = (err as Error).message;
      }
      await this.db.tx((tx) =>
        tx.execute(sql`
          INSERT INTO flow_retry_logs (org_id, flow_id, flow_subscriber_id, contact_id, retried_by_user_id, previous_status,
                                       previous_failure_reason, outcome, outcome_reason)
          VALUES (${orgId}, ${s.flowId}, ${s.id}, ${s.contactId}, ${userId}, ${String(prior.status)},
                  ${(prior.failure_reason as string | null) ?? null}, ${outcome}, ${reason})`),
      );
      if (outcome === 'started') retried++;
      else skipped++;
    }
    return { retried, skipped };
  }

  // --- runs ------------------------------------------------------------------------------------------------------------------

  async listRuns(q: ListFlowRunsQuery): Promise<FlowRunList> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const cursor = q.cursor ? Number(q.cursor) : null;
      const res = await tx.execute(sql`
        SELECT r.id, r.uuid, r.peer_key, r.source, r.status, r.end_reason, r.failure_reason, r.halt_reason, r.current_node_id,
               r.started_at, r.last_activity_at, r.ended_at, r.resume_at,
               f.uuid AS flow_uuid, f.flow_name, c.uuid AS contact_uuid, c.name AS contact_name,
               ch.uuid AS channel_uuid, ch.name AS channel_name, ch.kind AS channel_kind,
               (SELECT count(*)::int FROM flow_run_steps s WHERE s.org_id = r.org_id AND s.run_id = r.id) AS steps
        FROM flow_runs r
        JOIN flows f ON f.org_id = r.org_id AND f.id = r.flow_id
        LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
        LEFT JOIN channels ch ON ch.org_id = r.org_id AND ch.id = r.channel_id
        WHERE r.org_id = ${orgId}
          ${q.flowId ? sql`AND f.uuid = ${q.flowId}::uuid` : sql``}
          ${q.contactId ? sql`AND c.uuid = ${q.contactId}::uuid` : sql``}
          ${q.status ? sql`AND r.status = ${q.status}` : sql``}
          ${q.source ? sql`AND r.source = ${q.source}` : sql``}
          ${cursor ? sql`AND r.id < ${cursor}` : sql``}
        ORDER BY r.id DESC LIMIT ${q.limit + 1}`);
      const rows = rowsOf(res);
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => this.summaryOf(r)),
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
      };
    });
  }

  async runDetail(runUuid: string): Promise<FlowRunDetail> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.id, r.uuid, r.peer_key, r.source, r.status, r.end_reason, r.failure_reason, r.halt_reason, r.current_node_id,
               r.started_at, r.last_activity_at, r.ended_at, r.resume_at, r.trigger_text, r.vars, r.wait, r.expires_at,
               f.uuid AS flow_uuid, f.flow_name, c.uuid AS contact_uuid, c.name AS contact_name,
               ch.uuid AS channel_uuid, ch.name AS channel_name, ch.kind AS channel_kind,
               (SELECT count(*)::int FROM flow_run_steps s WHERE s.org_id = r.org_id AND s.run_id = r.id) AS steps
        FROM flow_runs r
        JOIN flows f ON f.org_id = r.org_id AND f.id = r.flow_id
        LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
        LEFT JOIN channels ch ON ch.org_id = r.org_id AND ch.id = r.channel_id
        WHERE r.org_id = ${orgId} AND r.uuid = ${runUuid}::uuid`);
      const r = rowsOf(res)[0];
      if (!r) throw notFound('FLR_RUN_NOT_FOUND', 'Run');
      const steps = rowsOf(
        await tx.execute(sql`
          SELECT seq, node_id, node_type, event, detail, error, created_at FROM flow_run_steps
          WHERE org_id = ${orgId} AND run_id = ${Number(r.id)} ORDER BY seq, id`),
      );
      const wait = r.wait as { nodeId: string; kind: string } | null;
      return {
        ...this.summaryOf(r),
        triggerText: (r.trigger_text as string | null) ?? null,
        variables: (r.vars ?? {}) as Record<string, unknown>,
        waiting: wait
          ? { nodeId: wait.nodeId, kind: wait.kind, expiresAt: iso(r.expires_at) }
          : null,
        log: steps.map((s) => ({
          seq: Number(s.seq),
          nodeId: (s.node_id as string | null) ?? null,
          nodeType: (s.node_type as string | null) ?? null,
          event: String(s.event),
          detail: (s.detail ?? {}) as Record<string, unknown>,
          error: (s.error as string | null) ?? null,
          at: iso(s.created_at)!,
        })),
      };
    });
  }

  /** Ends a live run by hand (WD-FLR-050). The customer is not told anything. */
  async cancelRun(runUuid: string): Promise<void> {
    const orgId = this.org();
    await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id FROM flow_runs WHERE org_id = ${orgId} AND uuid = ${runUuid}::uuid`,
      );
      const id = rowsOf(res)[0]?.id;
      if (id === undefined) throw notFound('FLR_RUN_NOT_FOUND', 'Run');
      const state = await this.runs.byId(tx, orgId, Number(id), true);
      if (!state || !(await this.engine.cancel(tx, orgId, state, 'cancelled'))) {
        throw new AppError(
          ERROR_CODES.FLR_RUN_STATE_CONFLICT,
          'This run is already over',
          HttpStatus.CONFLICT,
        );
      }
      await this.audit.record(tx, {
        module: MODULE,
        recordId: state.id,
        action: 'update',
        delta: { status: { old: state.status, new: 'cancelled' } },
      });
    });
  }

  /** Starts a flow on an open conversation (the inbox and the mobile app's "start flow", WD-FLR-010 rule 3). */
  async startOnConversation(
    conversationUuid: string,
    flowUuid: string,
  ): Promise<{ runId: string }> {
    const orgId = this.org();
    const conv = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, channel_id, peer_key, contact_id, peer_name FROM conversations WHERE org_id = ${orgId} AND uuid = ${conversationUuid}::uuid`);
      const r = rowsOf(res)[0];
      if (!r) throw notFound('FLR_CONVERSATION_NOT_FOUND', 'Conversation');
      return {
        id: Number(r.id),
        channelId: Number(r.channel_id),
        peerKey: String(r.peer_key),
        contactId: r.contact_id === null ? null : Number(r.contact_id),
        peerName: (r.peer_name as string | null) ?? null,
        flowId: await this.flowId(tx, orgId, flowUuid),
      };
    });
    const out = await this.launch.start(orgId, {
      flowId: conv.flowId,
      contactId: conv.contactId,
      channelId: conv.channelId,
      peerKey: conv.peerKey,
      pushName: conv.peerName,
      conversationId: conv.id,
      source: 'inbox',
      requirePublished: false,
      withSubscriber: false,
    });
    if (out.outcome !== 'started') {
      throw new AppError(
        ERROR_CODES.FLR_ENROLL_FAILED,
        out.outcome === 'failed' ? out.reason : 'The flow did not start',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { runId: out.runUuid };
  }

  // --- analytics -------------------------------------------------------------------------------------------------------------

  /**
   * The numbers (WD-FLR-053 to 055). WaDesk's "completed" never moved because nothing set it; here the runtime marks a run completed
   * when it ends normally, and every launch path writes a run, so keyword and campaign runs count too.
   */
  async analytics(q: FlowAnalyticsQuery): Promise<FlowAnalytics> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const flowFilter = q.flowId
        ? sql`AND r.flow_id = (SELECT id FROM flows WHERE org_id = ${orgId} AND uuid = ${q.flowId}::uuid)`
        : sql``;
      const since = sql`r.started_at >= now() - make_interval(days => ${q.days})`;
      const totals = rowsOf(
        await tx.execute(sql`
          SELECT count(*)::int AS enrolled,
                 count(*) FILTER (WHERE r.status IN ('running','waiting','sleeping','halted'))::int AS running,
                 count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
                 count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
                 count(*) FILTER (WHERE r.status = 'expired')::int AS expired,
                 avg(extract(epoch FROM (r.ended_at - r.started_at))) FILTER (WHERE r.status = 'completed') AS avg_secs
          FROM flow_runs r WHERE r.org_id = ${orgId} AND ${since} ${flowFilter}`),
      )[0]!;
      const completed = Number(totals.completed);
      const failed = Number(totals.failed);
      const trend = rowsOf(
        await tx.execute(sql`
          SELECT to_char(date_trunc('day', r.started_at), 'YYYY-MM-DD') AS day, count(*)::int AS started,
                 count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed
          FROM flow_runs r WHERE r.org_id = ${orgId} AND ${since} ${flowFilter} GROUP BY 1 ORDER BY 1`),
      );
      const reasons = rowsOf(
        await tx.execute(sql`
          SELECT coalesce(r.failure_reason, 'Unknown') AS reason, count(*)::int AS n
          FROM flow_runs r WHERE r.org_id = ${orgId} AND r.status = 'failed' AND ${since} ${flowFilter}
          GROUP BY 1 ORDER BY n DESC LIMIT 20`),
      );
      const bySource = rowsOf(
        await tx.execute(sql`
          SELECT r.source, count(*)::int AS n FROM flow_runs r WHERE r.org_id = ${orgId} AND ${since} ${flowFilter}
          GROUP BY 1 ORDER BY n DESC`),
      );
      const board = rowsOf(
        await tx.execute(sql`
          SELECT f.uuid, f.flow_name, count(*)::int AS runs, count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed
          FROM flow_runs r JOIN flows f ON f.org_id = r.org_id AND f.id = r.flow_id
          WHERE r.org_id = ${orgId} AND ${since} ${flowFilter} GROUP BY f.uuid, f.flow_name ORDER BY runs DESC LIMIT 10`),
      );
      return {
        totals: {
          enrolled: Number(totals.enrolled),
          running: Number(totals.running),
          completed,
          failed,
          cancelled: Number(totals.cancelled),
          expired: Number(totals.expired),
        },
        completionRate: completed + failed > 0 ? completed / (completed + failed) : null,
        avgSecondsToComplete: totals.avg_secs === null ? null : Number(totals.avg_secs),
        trend: trend.map((t) => ({
          day: String(t.day),
          started: Number(t.started),
          completed: Number(t.completed),
          failed: Number(t.failed),
        })),
        failureReasons: reasons.map((r) => ({ reason: String(r.reason), count: Number(r.n) })),
        bySource: bySource.map((r) => ({ source: String(r.source), count: Number(r.n) })),
        leaderboard: board.map((b) => ({
          flowId: String(b.uuid),
          flowName: String(b.flow_name),
          runs: Number(b.runs),
          completed: Number(b.completed),
          failed: Number(b.failed),
        })),
      };
    });
  }

  // --- the flows as the REST API shows them (WD-FLR-009) ---------------------------------------------------------------------

  async listFlows(): Promise<{ data: Array<Record<string, unknown>>; meta: { count: number } }> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT f.uuid, f.flow_name, f.flow_type, f.trigger_kind, f.is_published, f.is_active, f.provider, f.updated_at,
               (SELECT count(*)::int FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id) AS subscribers_count
        FROM flows f WHERE f.org_id = ${orgId} ORDER BY f.updated_at DESC LIMIT 500`);
      const data = rowsOf(res).map((r) => this.publicFlowOf(r));
      return { data, meta: { count: data.length } };
    });
  }

  async getFlow(flowUuid: string): Promise<Record<string, unknown>> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT f.uuid, f.flow_name, f.flow_type, f.trigger_kind, f.is_published, f.is_active, f.provider, f.updated_at,
               (SELECT count(*)::int FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id) AS subscribers_count
        FROM flows f WHERE f.org_id = ${orgId} AND f.uuid = ${flowUuid}::uuid`);
      const r = rowsOf(res)[0];
      if (!r) throw notFound('FLR_FLOW_NOT_FOUND', 'Flow');
      return this.publicFlowOf(r);
    });
  }

  private publicFlowOf(r: Row): Record<string, unknown> {
    return {
      id: String(r.uuid),
      name: String(r.flow_name),
      type: String(r.flow_type),
      trigger: String(r.trigger_kind),
      provider: String(r.provider),
      published: r.is_published === true,
      active: r.is_active === true,
      subscribers: Number(r.subscribers_count),
      updatedAt: iso(r.updated_at),
    };
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------------

  private async flowId(
    tx: Parameters<Parameters<DatabaseService['tx']>[0]>[0],
    orgId: number,
    uuid: string,
    mustBeActive = true,
  ): Promise<number> {
    const res = await tx.execute(
      sql`SELECT id, is_active FROM flows WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const f = rowsOf(res)[0];
    if (!f) throw notFound('FLR_FLOW_NOT_FOUND', 'Flow');
    if (mustBeActive && f.is_active !== true) {
      throw new AppError(
        ERROR_CODES.FLR_FLOW_INACTIVE,
        'This flow is switched off',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return Number(f.id);
  }

  private async subscriberOf(
    tx: Parameters<Parameters<DatabaseService['tx']>[0]>[0],
    orgId: number,
    uuid: string,
  ) {
    const res = await tx.execute(
      sql`SELECT id FROM flow_subscribers WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const id = rowsOf(res)[0]?.id;
    const sub =
      id === undefined ? null : await this.subscribers.findById(tx, orgId, Number(id), true);
    if (!sub) throw notFound('FLR_SUBSCRIBER_NOT_FOUND', 'Subscriber');
    return sub;
  }

  private summaryOf(r: Row) {
    return {
      id: String(r.uuid),
      flowId: String(r.flow_uuid),
      flowName: String(r.flow_name),
      contact: r.contact_uuid
        ? { id: String(r.contact_uuid), name: (r.contact_name as string | null) ?? null }
        : null,
      channel: r.channel_uuid
        ? { id: String(r.channel_uuid), name: String(r.channel_name), kind: String(r.channel_kind) }
        : null,
      peerKey: String(r.peer_key),
      source: r.source as FlowRunDetail['source'],
      status: r.status as FlowRunDetail['status'],
      endReason: (r.end_reason as FlowRunDetail['endReason']) ?? null,
      failureReason: (r.failure_reason as string | null) ?? null,
      haltReason: (r.halt_reason as string | null) ?? null,
      currentNodeId: (r.current_node_id as string | null) ?? null,
      startedAt: iso(r.started_at)!,
      lastActivityAt: iso(r.last_activity_at)!,
      endedAt: iso(r.ended_at),
      resumeAt: iso(r.resume_at),
      steps: Number(r.steps),
    };
  }
}
