import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  FLOW_ENROLL_MAX_CONTACTS,
  FLOW_RETRY_COOLDOWN_SECONDS,
  FLOW_RETRY_MAX_BATCH,
  type EnrollContactsInput,
  type EnrollOneInput,
  type EnrollOneResult,
  type EnrollResult,
  type FlowAnalytics,
  type FlowAnalyticsQuery,
  type FlowErrorGroups,
  type FlowErrorGroupsQuery,
  type FlowHistoryList,
  type FlowHistoryRow,
  type FlowRetryList,
  type FlowRetryOutcome,
  type FlowRunDetail,
  type FlowRunList,
  type FlowRunStep,
  type FlowSubscriberList,
  type ListFlowHistoryQuery,
  type ListFlowRetriesQuery,
  type ListFlowRunsQuery,
  type ListFlowSubscribersQuery,
  type RetryManyInput,
  type RetryManyResult,
  type RetryOneResult,
  type RetryResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { compileGraph } from './graph/compile-graph';
import type { RuntimeGraph } from './graph/runtime-graph';
import { FlowEngine } from './runtime/engine.service';
import { FlowRunPublisher } from './runtime/flow-run.publisher';
import { FlowLaunchService } from './runtime/launch.service';
import { RunRepository } from './runtime/run.repository';
import { compactGraph, hashGraph, splitIo } from './runtime/step-log';
import { SubscriberRepository } from './runtime/subscriber.repository';
import { likePattern, windowOf } from './flow-runtime.window';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const MODULE = 'flow_runtime';
const notFound = (code: keyof typeof ERROR_CODES, what: string) =>
  new AppError(ERROR_CODES[code], `${what} not found`, HttpStatus.NOT_FOUND);

/** Reference's three flow states: live (published and on), paused (published, switched off), draft (not published). */
const flowState = (r: Row): 'live' | 'paused' | 'draft' =>
  r.is_published !== true ? 'draft' : r.is_active === true ? 'live' : 'paused';

/**
 * What an operator sees and does with runs and subscribers (TW-FLR-008, 009, 051 to 058): enrol contacts, list who is in a flow,
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
   * Manual enrolment (TW-FLR-008): chosen contacts win over a group; a contact from another workspace is ignored; the flow must be
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

  /** One contact by id or phone (the REST API's enrol, TW-FLR-009). Answers with the subscriber as it is, launched or not. */
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

  /** Pauses a subscriber: its live run keeps its place and does nothing until resumed (TW-FLR-052). */
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

  /**
   * Retries one failed run (TW-FLR-057): the same subscriber row, a new run; every attempt is logged with what happened. The order
   * of the checks is Reference's: a switched-off flow, then the cooldown (so a double click reads "just retried" and not "still in
   * progress"), then the state. A retry that fails again answers 200 with `outcome: 'failed'` and the engine's reason.
   */
  async retry(subscriberUuid: string): Promise<RetryOneResult> {
    const orgId = this.org();
    const sub = await this.db.tx((tx) => this.subscriberOf(tx, orgId, subscriberUuid));
    const a = await this.attempt(orgId, sub.id);
    if (a.outcome === null) {
      switch (a.reason) {
        case 'flow_inactive':
          throw new AppError(
            ERROR_CODES.FLR_FLOW_INACTIVE,
            'This flow is switched off',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        case 'too_soon':
          throw new AppError(
            ERROR_CODES.FLR_RETRY_TOO_SOON,
            'This run was just retried',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        case 'not_found':
          throw notFound('FLR_SUBSCRIBER_NOT_FOUND', 'Subscriber');
        default:
          throw new AppError(
            ERROR_CODES.FLR_NOT_RETRYABLE,
            'Only a failed run can be retried',
            HttpStatus.CONFLICT,
          );
      }
    }
    const started = a.outcome === 'queued' || a.outcome === 'succeeded';
    return {
      retried: started ? 1 : 0,
      skipped: started ? 0 : 1,
      outcome: a.outcome,
      reason: a.reason,
    };
  }

  /** Retries every failed subscriber of a flow, up to the request cap (TW-FLR-058, the per-flow button of the subscribers page). */
  async retryFailed(flowUuid: string): Promise<RetryResult> {
    const orgId = this.org();
    const ids = await this.db.tx(async (tx) => {
      const flowId = await this.flowId(tx, orgId, flowUuid, false);
      const res = await tx.execute(sql`
        SELECT id FROM flow_subscribers WHERE org_id = ${orgId} AND flow_id = ${flowId} AND status = 'failed' ORDER BY id LIMIT ${FLOW_ENROLL_MAX_CONTACTS}`);
      return rowsOf(res).map((r) => Number(r.id));
    });
    let retried = 0;
    let skipped = 0;
    for (const id of ids) {
      const a = await this.attempt(orgId, id);
      if (a.outcome === 'queued' || a.outcome === 'succeeded') retried++;
      else skipped++;
    }
    return { retried, skipped };
  }

  /**
   * Retries the named failed runs (TW-FLR-058): never "everything", at most one batch. A name that is not in this workspace is
   * reported as not found, the same as one that never existed.
   */
  async retryMany(input: RetryManyInput): Promise<RetryManyResult> {
    const orgId = this.org();
    const uuids = [...new Set(input.subscriberIds)];
    const found = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid FROM flow_subscribers WHERE org_id = ${orgId} AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
      return new Map(rowsOf(res).map((r) => [String(r.uuid), Number(r.id)]));
    });
    const out: RetryManyResult = {
      requested: uuids.length,
      attempted: 0,
      queued: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
    for (const subscriberId of uuids) {
      const id = found.get(subscriberId);
      const a =
        id === undefined ? { outcome: null, reason: 'not_found' } : await this.attempt(orgId, id);
      out.results.push({ subscriberId, outcome: a.outcome, reason: a.reason });
      if (id !== undefined) out.attempted++;
      if (a.outcome === 'queued') out.queued++;
      else if (a.outcome === 'succeeded') out.succeeded++;
      else if (a.outcome === 'failed') out.failed++;
      else out.skipped++;
    }
    return out;
  }

  /**
   * One retry: the checks, the launch, the log row. `outcome` is null when nothing was tried (then `reason` is `not_found`,
   * `flow_inactive`, `too_soon` or `not_failed`, and no log row is written, as in Reference).
   */
  private async attempt(
    orgId: number,
    subId: number,
  ): Promise<{ outcome: FlowRetryOutcome | null; reason: string | null }> {
    const userId = RequestContextStore.require().userId ?? null;
    const s = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.flow_id, s.contact_id, s.status, s.failure_reason, f.is_active,
               (s.last_retried_at IS NOT NULL
                AND s.last_retried_at > now() - make_interval(secs => ${FLOW_RETRY_COOLDOWN_SECONDS})) AS cooling
        FROM flow_subscribers s JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id
        WHERE s.org_id = ${orgId} AND s.id = ${subId}`);
      return rowsOf(res)[0];
    });
    if (!s) return { outcome: null, reason: 'not_found' };
    if (s.is_active !== true) return { outcome: null, reason: 'flow_inactive' };
    if (s.cooling === true) return { outcome: null, reason: 'too_soon' };
    if (s.status !== 'failed') return { outcome: null, reason: 'not_failed' };

    let outcome: FlowRetryOutcome = 'skipped';
    let reason: string | null = null;
    try {
      const out = await this.launch.start(orgId, {
        flowId: Number(s.flow_id),
        contactId: Number(s.contact_id),
        source: 'retry',
        requirePublished: false,
        withSubscriber: true,
        retry: true,
      });
      if (out.outcome === 'failed') {
        outcome = 'failed';
        reason = out.reason;
      } else if (out.outcome === 'started') {
        // The launch may have ended the run at once; say what the subscriber is now, as Reference does.
        const after = await this.db.tx(
          async (tx) =>
            rowsOf(
              await tx.execute(
                sql`SELECT status, failure_reason FROM flow_subscribers WHERE org_id = ${orgId} AND id = ${subId}`,
              ),
            )[0],
        );
        outcome =
          after?.status === 'failed'
            ? 'failed'
            : after?.status === 'completed'
              ? 'succeeded'
              : 'queued';
        reason = outcome === 'failed' ? ((after?.failure_reason as string | null) ?? null) : null;
      }
    } catch (err) {
      outcome = 'failed';
      reason = (err as Error).message.slice(0, 190);
    }
    await this.db.tx((tx) =>
      tx.execute(sql`
        INSERT INTO flow_retry_logs (org_id, flow_id, flow_subscriber_id, contact_id, retried_by_user_id, previous_status,
                                     previous_failure_reason, outcome, outcome_reason)
        VALUES (${orgId}, ${Number(s.flow_id)}, ${subId}, ${Number(s.contact_id)}, ${userId}, ${String(s.status)},
                ${(s.failure_reason as string | null) ?? null}, ${outcome}, ${reason})`),
    );
    return { outcome, reason };
  }

  /** The retry records (TW-FLR-056): every attempt, newest first, with the outcome chips' totals. */
  async listRetries(q: ListFlowRetriesQuery): Promise<FlowRetryList> {
    const orgId = this.org();
    const { from, to } = windowOf(q);
    return this.db.tx(async (tx) => {
      const where = sql`l.org_id = ${orgId}
        ${q.flowId ? sql`AND f.uuid = ${q.flowId}::uuid` : sql``}
        ${from ? sql`AND l.created_at >= ${from}::timestamptz` : sql``}
        ${to ? sql`AND l.created_at <= ${to}::timestamptz` : sql``}`;
      const from_ = sql`FROM flow_retry_logs l JOIN flows f ON f.org_id = l.org_id AND f.id = l.flow_id`;
      const cursor = q.cursor ? Number(q.cursor) : null;
      const totalsRows = rowsOf(
        await tx.execute(
          sql`SELECT l.outcome, count(*)::int AS n ${from_} WHERE ${where} GROUP BY l.outcome`,
        ),
      );
      const n = (o: string) => Number(totalsRows.find((r) => r.outcome === o)?.n ?? 0);
      const res = await tx.execute(sql`
        SELECT l.id, l.uuid, l.previous_status, l.previous_failure_reason, l.outcome, l.outcome_reason, l.created_at,
               l.retried_by_user_id, f.uuid AS flow_uuid, f.flow_name, s.uuid AS sub_uuid,
               c.uuid AS contact_uuid, c.name AS contact_name, c.phone AS contact_phone, u.full_name AS user_name
        ${from_}
        JOIN flow_subscribers s ON s.org_id = l.org_id AND s.id = l.flow_subscriber_id
        LEFT JOIN contacts c ON c.org_id = l.org_id AND c.id = l.contact_id
        LEFT JOIN users u ON u.org_id = l.org_id AND u.id = l.retried_by_user_id
        WHERE ${where}
          ${q.outcome ? sql`AND l.outcome = ${q.outcome}` : sql``}
          ${cursor ? sql`AND l.id < ${cursor}` : sql``}
        ORDER BY l.id DESC LIMIT ${q.limit + 1}`);
      const rows = rowsOf(res);
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({
          id: String(r.uuid),
          flowId: String(r.flow_uuid),
          flowName: String(r.flow_name),
          subscriberId: String(r.sub_uuid),
          contact: r.contact_uuid
            ? {
                id: String(r.contact_uuid),
                name: (r.contact_name as string | null) ?? null,
                phone: (r.contact_phone as string | null) ?? null,
              }
            : null,
          retriedBy: (r.user_name as string | null) ?? null,
          source: r.retried_by_user_id === null ? ('system' as const) : ('manual' as const),
          previousStatus: (r.previous_status as string | null) ?? null,
          previousFailureReason: (r.previous_failure_reason as string | null) ?? null,
          outcome: r.outcome as FlowRetryOutcome,
          outcomeReason: (r.outcome_reason as string | null) ?? null,
          createdAt: iso(r.created_at)!,
        })),
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
        totals: {
          all: totalsRows.reduce((sum, r) => sum + Number(r.n), 0),
          queued: n('queued'),
          succeeded: n('succeeded'),
          failed: n('failed'),
          skipped: n('skipped'),
        },
      };
    });
  }

  // --- runs ------------------------------------------------------------------------------------------------------------------

  /**
   * The filters of the execution history and the error logs (TW-FLR-054, 055), on `flow_subscribers s` joined to its flow `f` and
   * contact `c`: flow, window on the enrolment time, and a search over the failure reason, the contact's name or phone and the
   * flow's name. `status` is applied only when asked, so the tab counts can leave it out.
   */
  private historyFilter(
    orgId: number,
    q: {
      flowId?: string | undefined;
      status?: string | undefined;
      q?: string | undefined;
    } & Parameters<typeof windowOf>[0],
    withStatus: boolean,
  ): ReturnType<typeof sql> {
    const { from, to } = windowOf(q);
    const like = q.q ? likePattern(q.q) : null;
    return sql`s.org_id = ${orgId}
      ${q.flowId ? sql`AND f.uuid = ${q.flowId}::uuid` : sql``}
      ${withStatus && q.status ? sql`AND s.status = ${q.status}` : sql``}
      ${from ? sql`AND s.enrolled_at >= ${from}::timestamptz` : sql``}
      ${to ? sql`AND s.enrolled_at <= ${to}::timestamptz` : sql``}
      ${
        like
          ? sql`AND (s.failure_reason ILIKE ${like} OR f.flow_name ILIKE ${like} OR c.name ILIKE ${like} OR c.phone ILIKE ${like})`
          : sql``
      }`;
  }

  /**
   * The execution history (TW-FLR-054): every contact's pass through a flow, newest first, with status counts over the same filters.
   * Reference's "run" is the subscriber row, so a launch that failed before any run existed (no connected sender) is listed too.
   */
  async history(q: ListFlowHistoryQuery): Promise<FlowHistoryList> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const cursor = q.cursor ? Number(q.cursor) : null;
      const from = sql`FROM flow_subscribers s
        JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id`;
      const countRows = rowsOf(
        await tx.execute(sql`
          SELECT s.status, count(*)::int AS n ${from} WHERE ${this.historyFilter(orgId, q, false)} GROUP BY s.status`),
      );
      const n = (st: string) => Number(countRows.find((r) => r.status === st)?.n ?? 0);
      const res = await tx.execute(sql`
        SELECT s.id, s.uuid, s.status, s.source, s.enrolled_at, s.completed_at, s.failed_at, s.failure_reason, s.retry_count,
               s.last_retried_at, f.uuid AS flow_uuid, f.flow_name, f.is_active, f.is_published,
               c.uuid AS contact_uuid, c.name AS contact_name, c.phone AS contact_phone,
               (SELECT r.uuid FROM flow_runs r WHERE r.org_id = s.org_id AND r.id = s.last_run_id) AS run_uuid
        ${from}
        WHERE ${this.historyFilter(orgId, q, true)} ${cursor ? sql`AND s.id < ${cursor}` : sql``}
        ORDER BY s.id DESC LIMIT ${q.limit + 1}`);
      const rows = rowsOf(res);
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({
          id: String(r.uuid),
          flowId: String(r.flow_uuid),
          flowName: String(r.flow_name),
          flowState: flowState(r),
          contact: {
            id: String(r.contact_uuid),
            name: (r.contact_name as string | null) ?? null,
            phone: (r.contact_phone as string | null) ?? null,
          },
          status: r.status as FlowHistoryRow['status'],
          source: String(r.source),
          enrolledAt: iso(r.enrolled_at),
          completedAt: iso(r.completed_at),
          failedAt: iso(r.failed_at),
          failureReason: (r.failure_reason as string | null) ?? null,
          retryCount: Number(r.retry_count),
          lastRetriedAt: iso(r.last_retried_at),
          lastRunId: (r.run_uuid as string | null) ?? null,
          durationSeconds:
            r.enrolled_at && r.completed_at
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(r.completed_at as string).getTime() -
                      new Date(r.enrolled_at as string).getTime()) /
                      1000,
                  ),
                )
              : null,
          canRetry: r.status === 'failed' && r.is_active === true,
        })),
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
        counts: {
          all: countRows.reduce((sum, r) => sum + Number(r.n), 0),
          active: n('active'),
          paused: n('paused'),
          completed: n('completed'),
          failed: n('failed'),
        },
      };
    });
  }

  /**
   * The error logs (TW-FLR-055): failed runs rolled up by reason, with the flows each reason hit, when it was first and last seen,
   * and the subscribers behind it so the screen can offer "retry these" without a second trip (at most one batch per reason).
   */
  async errorGroups(q: FlowErrorGroupsQuery): Promise<FlowErrorGroups> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const where = sql`${this.historyFilter(orgId, q, false)} AND s.status = 'failed'`;
      const from = sql`FROM flow_subscribers s
        JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id`;
      const rows = rowsOf(
        await tx.execute(sql`
          SELECT nullif(trim(s.failure_reason), '') AS reason, f.uuid AS flow_uuid, f.flow_name, count(*)::int AS n,
                 min(s.failed_at) AS first_seen, max(s.failed_at) AS last_seen
          ${from} WHERE ${where} GROUP BY 1, 2, 3`),
      );
      type Group = FlowErrorGroups['groups'][number] & { first: number; last: number };
      const byReason = new Map<string, Group>();
      for (const r of rows) {
        const reason = (r.reason as string | null) ?? null;
        const g = byReason.get(reason ?? '') ?? {
          reason,
          count: 0,
          firstSeen: null,
          lastSeen: null,
          flows: [],
          subscriberIds: [],
          first: Infinity,
          last: -Infinity,
        };
        g.count += Number(r.n);
        if (r.first_seen) g.first = Math.min(g.first, new Date(r.first_seen as string).getTime());
        if (r.last_seen) g.last = Math.max(g.last, new Date(r.last_seen as string).getTime());
        g.flows.push({
          flowId: String(r.flow_uuid),
          flowName: String(r.flow_name),
          count: Number(r.n),
        });
        byReason.set(reason ?? '', g);
      }
      if (byReason.size > 0) {
        const newest = rowsOf(
          await tx.execute(sql`
            SELECT s.uuid, nullif(trim(s.failure_reason), '') AS reason ${from}
            WHERE ${where} ORDER BY s.id DESC LIMIT 2000`),
        );
        for (const r of newest) {
          const g = byReason.get((r.reason as string | null) ?? '');
          if (g && g.subscriberIds.length < FLOW_RETRY_MAX_BATCH)
            g.subscriberIds.push(String(r.uuid));
        }
      }
      const groups = [...byReason.values()]
        .map(({ first, last, ...g }) => ({
          ...g,
          flows: g.flows.sort((a, b) => b.count - a.count),
          firstSeen: Number.isFinite(first) ? new Date(first).toISOString() : null,
          lastSeen: Number.isFinite(last) ? new Date(last).toISOString() : null,
        }))
        .sort((a, b) => b.count - a.count);
      const t = rowsOf(
        await tx.execute(sql`
          SELECT count(*)::int AS failed, count(DISTINCT s.flow_id)::int AS flows, count(DISTINCT s.contact_id)::int AS contacts,
                 count(*) FILTER (WHERE s.retry_count > 0)::int AS retried
          ${from} WHERE ${where}`),
      )[0]!;
      return {
        groups,
        totals: {
          failed: Number(t.failed),
          distinctReasons: groups.length,
          affectedFlows: Number(t.flows),
          affectedContacts: Number(t.contacts),
          retried: Number(t.retried),
        },
      };
    });
  }

  async listRuns(q: ListFlowRunsQuery): Promise<FlowRunList> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const cursor = q.cursor ? Number(q.cursor) : null;
      const res = await tx.execute(sql`
        SELECT r.id, r.uuid, r.peer_key, r.source, r.status, r.end_reason, r.failure_reason, r.halt_reason, r.current_node_id,
               r.started_at, r.last_activity_at, r.ended_at, r.resume_at,
               f.uuid AS flow_uuid, f.flow_name, c.uuid AS contact_uuid, c.name AS contact_name,
               ch.uuid AS channel_uuid, ch.name AS channel_name, ch.kind AS channel_kind,
               CASE WHEN r.node_count > 0 THEN r.node_count
                    ELSE (SELECT count(*)::int FROM flow_run_steps s WHERE s.org_id = r.org_id AND s.run_id = r.id) END AS steps,
               (SELECT count(*)::int FROM flow_run_steps rs WHERE rs.org_id = r.org_id AND rs.run_id = r.id AND rs.event = 'reply') AS replies,
               r.node_count, r.error_count, r.duration_ms
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
               COALESCE(r.graph, gv.graph) AS run_graph, f.flow_data AS current_flow_data,
               f.uuid AS flow_uuid, f.flow_name, c.uuid AS contact_uuid, c.name AS contact_name,
               ch.uuid AS channel_uuid, ch.name AS channel_name, ch.kind AS channel_kind,
               CASE WHEN r.node_count > 0 THEN r.node_count
                    ELSE (SELECT count(*)::int FROM flow_run_steps s WHERE s.org_id = r.org_id AND s.run_id = r.id) END AS steps,
               r.node_count, r.error_count, r.duration_ms
        FROM flow_runs r
        JOIN flows f ON f.org_id = r.org_id AND f.id = r.flow_id
        LEFT JOIN flow_graph_versions gv ON gv.org_id = r.org_id AND gv.id = r.graph_version_id
        LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
        LEFT JOIN channels ch ON ch.org_id = r.org_id AND ch.id = r.channel_id
        WHERE r.org_id = ${orgId} AND r.uuid = ${runUuid}::uuid`);
      const r = rowsOf(res)[0];
      if (!r) throw notFound('FLR_RUN_NOT_FOUND', 'Run');
      const steps = rowsOf(
        await tx.execute(sql`
          SELECT seq, node_id, node_type, event, detail, error, created_at, node_label, outcome, port, duration_ms, attempt, summary,
                 error_code FROM flow_run_steps
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
          ...splitIo((s.detail ?? {}) as Record<string, unknown>),
          error: (s.error as string | null) ?? null,
          at: iso(s.created_at)!,
          nodeLabel: (s.node_label as string | null) ?? null,
          outcome: (s.outcome as FlowRunStep['outcome']) ?? null,
          port: s.port === null ? null : Number(s.port),
          durationMs: s.duration_ms === null ? null : Number(s.duration_ms),
          attempt: s.attempt === null ? null : Number(s.attempt),
          summary: (s.summary as string | null) ?? null,
          errorCode: (s.error_code as string | null) ?? null,
        })),
        ...this.pathOf(r, steps),
      };
    });
  }

  /** Ends a live run by hand (TW-FLR-050). The customer is not told anything. */
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

  /** Starts a flow on an open conversation (the inbox and the mobile app's "start flow", TW-FLR-010 rule 3). */
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
   * The numbers (TW-FLR-053 to 055). Reference's "completed" never moved because nothing set it; here the runtime marks a run completed
   * when it ends normally, and every launch path writes a run, so keyword and campaign runs count too. The window is the last `days`
   * UTC days (today counts), or all time for 0.
   */
  async analytics(q: FlowAnalyticsQuery): Promise<FlowAnalytics> {
    const orgId = this.org();
    return this.db.tx(async (tx) => {
      const { from, to } = windowOf(q);
      const flowIdSql = q.flowId
        ? sql`(SELECT id FROM flows WHERE org_id = ${orgId} AND uuid = ${q.flowId}::uuid)`
        : null;
      const flowFilter = flowIdSql ? sql`AND r.flow_id = ${flowIdSql}` : sql``;
      // Every run, plus the launches that failed before a run existed (no connected sender): Reference counted those as runs.
      const ev = sql`WITH ev AS (
        SELECT r.flow_id, r.contact_id, r.status, r.source, r.started_at, r.ended_at, r.failure_reason, r.last_activity_at
        FROM flow_runs r WHERE r.org_id = ${orgId}
        UNION ALL
        SELECT s.flow_id, s.contact_id, 'failed', s.source, coalesce(s.enrolled_at, s.created_at), s.failed_at,
               s.failure_reason, s.failed_at
        FROM flow_subscribers s WHERE s.org_id = ${orgId} AND s.status = 'failed' AND s.last_run_id IS NULL)`;
      const since = sql`${from ? sql`r.started_at >= ${from}::timestamptz` : sql`true`} AND ${
        to ? sql`r.started_at <= ${to}::timestamptz` : sql`true`
      }`;
      const totals = rowsOf(
        await tx.execute(sql`
          ${ev}
          SELECT count(*)::int AS enrolled,
                 count(*) FILTER (WHERE r.status IN ('running','waiting','sleeping','halted'))::int AS running,
                 count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
                 count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
                 count(*) FILTER (WHERE r.status = 'expired')::int AS expired,
                 count(DISTINCT r.contact_id)::int AS contacts,
                 avg(extract(epoch FROM (r.ended_at - r.started_at))) FILTER (WHERE r.status = 'completed') AS avg_secs
          FROM ev r WHERE ${since} ${flowFilter}`),
      )[0]!;
      const completed = Number(totals.completed);
      const failed = Number(totals.failed);
      const enrolled = Number(totals.enrolled);
      const trend = rowsOf(
        await tx.execute(sql`
          ${ev}
          SELECT to_char(date_trunc('day', r.started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS started,
                 count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed
          FROM ev r WHERE ${since} ${flowFilter} GROUP BY 1 ORDER BY 1`),
      );
      const reasons = rowsOf(
        await tx.execute(sql`
          ${ev}
          SELECT coalesce(nullif(trim(r.failure_reason), ''), 'Unknown') AS reason, count(*)::int AS n,
                 min(coalesce(r.ended_at, r.last_activity_at)) AS first_seen, max(coalesce(r.ended_at, r.last_activity_at)) AS last_seen
          FROM ev r WHERE r.status = 'failed' AND ${since} ${flowFilter}
          GROUP BY 1 ORDER BY n DESC LIMIT 20`),
      );
      const bySource = rowsOf(
        await tx.execute(sql`
          ${ev}
          SELECT r.source, count(*)::int AS n FROM ev r WHERE ${since} ${flowFilter}
          GROUP BY 1 ORDER BY n DESC`),
      );
      const board = rowsOf(
        await tx.execute(sql`
          ${ev}
          SELECT f.uuid, f.flow_name, f.is_active, f.is_published, count(*)::int AS runs,
                 count(*) FILTER (WHERE r.status IN ('running','waiting','sleeping','halted'))::int AS running,
                 count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
                 avg(extract(epoch FROM (r.ended_at - r.started_at))) FILTER (WHERE r.status = 'completed') AS avg_secs
          FROM ev r JOIN flows f ON f.org_id = ${orgId} AND f.id = r.flow_id
          WHERE ${since} ${flowFilter}
          GROUP BY f.uuid, f.flow_name, f.is_active, f.is_published ORDER BY runs DESC LIMIT 50`),
      );
      const sinceSub = sql`${from ? sql`s.enrolled_at >= ${from}::timestamptz` : sql`true`} AND ${
        to ? sql`s.enrolled_at <= ${to}::timestamptz` : sql`true`
      }`;
      const subFlow = flowIdSql ? sql`AND s.flow_id = ${flowIdSql}` : sql``;
      const subs = rowsOf(
        await tx.execute(sql`
          SELECT count(*) FILTER (WHERE s.status = 'paused')::int AS paused,
                 count(*) FILTER (WHERE s.retry_count > 0)::int AS retried
          FROM flow_subscribers s WHERE s.org_id = ${orgId} AND ${sinceSub} ${subFlow}`),
      )[0]!;
      const attempts = rowsOf(
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM flow_retry_logs l
          WHERE l.org_id = ${orgId} ${from ? sql`AND l.created_at >= ${from}::timestamptz` : sql``}
            ${to ? sql`AND l.created_at <= ${to}::timestamptz` : sql``}
            ${flowIdSql ? sql`AND l.flow_id = ${flowIdSql}` : sql``}`),
      )[0]!;
      const flows = rowsOf(
        await tx.execute(sql`
          SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active AND is_published)::int AS live
          FROM flows WHERE org_id = ${orgId}`),
      )[0]!;
      const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 1000) / d) / 10 : null);
      return {
        totals: {
          enrolled,
          running: Number(totals.running),
          completed,
          failed,
          cancelled: Number(totals.cancelled),
          expired: Number(totals.expired),
        },
        completionRate: completed + failed > 0 ? completed / (completed + failed) : null,
        avgSecondsToComplete: totals.avg_secs === null ? null : Math.round(Number(totals.avg_secs)),
        trend: trend.map((t) => ({
          day: String(t.day),
          started: Number(t.started),
          completed: Number(t.completed),
          failed: Number(t.failed),
        })),
        failureReasons: reasons.map((r) => ({
          reason: String(r.reason),
          count: Number(r.n),
          firstSeen: iso(r.first_seen),
          lastSeen: iso(r.last_seen),
        })),
        bySource: bySource.map((r) => ({ source: String(r.source), count: Number(r.n) })),
        leaderboard: board.map((b) => {
          const runs = Number(b.runs);
          return {
            flowId: String(b.uuid),
            flowName: String(b.flow_name),
            state:
              b.is_published !== true
                ? ('draft' as const)
                : b.is_active
                  ? ('live' as const)
                  : ('paused' as const),
            runs,
            running: Number(b.running),
            completed: Number(b.completed),
            failed: Number(b.failed),
            completionRate: pct(Number(b.completed), runs),
            failureRate: pct(Number(b.failed), runs),
            avgSecondsToComplete: b.avg_secs === null ? null : Math.round(Number(b.avg_secs)),
          };
        }),
        extras: {
          contactsReached: Number(totals.contacts),
          pausedSubscribers: Number(subs.paused),
          retriedRuns: Number(subs.retried),
          retryAttempts: Number(attempts.n),
          flowsTotal: Number(flows.total),
          flowsLive: Number(flows.live),
          flowsWithRuns: board.length,
          failureRate: enrolled > 0 ? failed / enrolled : null,
        },
      };
    });
  }

  // --- the flows as the REST API shows them (TW-FLR-009) ---------------------------------------------------------------------

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

  /**
   * The flow as the run walked it, and how it differs from the flow now. The run's own graph is the truth for the path; the current
   * flow only tells which logged nodes have since been removed, so an edit never rewrites what happened.
   */
  private pathOf(
    r: Row,
    steps: Row[],
  ): Pick<FlowRunDetail, 'graph' | 'flowChanged' | 'removedNodeIds' | 'logTruncated'> {
    const runGraph = (r.run_graph as RuntimeGraph | null) ?? null;
    let current: RuntimeGraph | null = null;
    try {
      current = compileGraph(r.current_flow_data);
    } catch {
      current = null;
    }
    const nowIds = new Set(current?.nodes.map((n) => n.id) ?? []);
    const logged = new Set(
      steps.map((s) => s.node_id as string | null).filter((id): id is string => !!id),
    );
    return {
      graph: runGraph ? compactGraph(runGraph) : null,
      flowChanged: !!runGraph && !!current && hashGraph(runGraph) !== hashGraph(current),
      removedNodeIds: current ? [...logged].filter((id) => !nowIds.has(id)) : [],
      logTruncated: steps.some((s) => s.event === 'truncated'),
    };
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
      replies: Number(r.replies ?? 0),
      nodeCount: Number(r.node_count),
      errorCount: Number(r.error_count),
      durationMs: Number(r.duration_ms),
    };
  }
}
