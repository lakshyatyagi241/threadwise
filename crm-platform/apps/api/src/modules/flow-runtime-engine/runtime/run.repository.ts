import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { FlowRunEndReason, FlowRunSource, FlowRunStatus } from '@crm/contracts';
import type { RuntimeGraph } from '../graph/runtime-graph';
import type { LastOut, MenuMemory, RunState, WaitSpec } from './types';
import type { VariableBag } from './variables';
import { hashGraph } from './step-log';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string);
const json = (v: unknown) => sql`${JSON.stringify(v ?? null)}::jsonb`;

/** The columns a run is read with, joined to the channel and contact the sender needs. */
const SELECT = sql`
  r.id, r.uuid, r.org_id, r.flow_id, r.subscriber_id, r.contact_id, r.channel_id, r.peer_key, r.conversation_id, r.source,
  r.trigger_text, r.status, COALESCE(r.graph, gv.graph) AS graph, r.graph_version_id, r.node_count, r.current_node_id, r.step_seq, r.vars, r.visits, r.wait, r.last_menu, r.last_out,
  r.timeout_seconds, r.cooldown_seconds, r.halt_reason, r.started_at, r.expires_at, r.max_expires_at, r.resume_at,
  ch.uuid AS channel_uuid, ch.kind AS channel_kind, ct.uuid AS contact_uuid
  FROM flow_runs r
  LEFT JOIN channels ch ON ch.org_id = r.org_id AND ch.id = r.channel_id
  LEFT JOIN contacts ct ON ct.org_id = r.org_id AND ct.id = r.contact_id
  LEFT JOIN flow_graph_versions gv ON gv.org_id = r.org_id AND gv.id = r.graph_version_id`;

function toState(r: Row): RunState {
  const menus = (r.last_menu ?? { latest: null, byNode: {} }) as MenuMemory;
  return {
    id: num(r.id),
    uuid: String(r.uuid),
    orgId: num(r.org_id),
    flowId: num(r.flow_id),
    subscriberId: numOrNull(r.subscriber_id),
    contactId: numOrNull(r.contact_id),
    channelId: numOrNull(r.channel_id),
    channelUuid: (r.channel_uuid as string | null) ?? null,
    channelKind: (r.channel_kind as string | null) ?? null,
    contactUuid: (r.contact_uuid as string | null) ?? null,
    peerKey: String(r.peer_key),
    conversationId: numOrNull(r.conversation_id),
    source: r.source as FlowRunSource,
    triggerText: (r.trigger_text as string | null) ?? null,
    status: r.status as FlowRunStatus,
    graph: r.graph as RuntimeGraph,
    graphVersionId: numOrNull(r.graph_version_id),
    nodeCount: num(r.node_count),
    currentNodeId: (r.current_node_id as string | null) ?? null,
    stepSeq: num(r.step_seq),
    vars: (r.vars ?? {}) as VariableBag,
    visits: (r.visits ?? {}) as Record<string, number>,
    wait: (r.wait as WaitSpec | null) ?? null,
    menus: { latest: menus.latest ?? null, byNode: menus.byNode ?? {} },
    lastOut: (r.last_out as LastOut | null) ?? null,
    timeoutSeconds: num(r.timeout_seconds),
    cooldownSeconds: num(r.cooldown_seconds),
    haltReason: (r.halt_reason as string | null) ?? null,
    startedAt: new Date(r.started_at as string),
    expiresAt: date(r.expires_at),
    maxExpiresAt: new Date(r.max_expires_at as string),
    resumeAt: date(r.resume_at),
  };
}

export interface NewRun {
  flowId: number;
  subscriberId: number | null;
  contactId: number | null;
  channelId: number | null;
  peerKey: string;
  conversationId: number | null;
  source: FlowRunSource;
  triggerRef: string | null;
  triggerText: string | null;
  graph: RuntimeGraph;
  currentNodeId: string | null;
  vars: VariableBag;
  timeoutSeconds: number;
  cooldownSeconds: number;
  variant: string | null;
  campaignId: number | null;
  maxExpiresAt: Date;
}

/** The mutable part of a run, written back after a step. */
export interface RunPatch {
  status: FlowRunStatus;
  currentNodeId: string | null;
  vars: VariableBag;
  visits: Record<string, number>;
  wait: WaitSpec | null;
  menus: MenuMemory;
  lastOut: LastOut | null;
  haltReason: string | null;
  expiresAt: Date | null;
  maxExpiresAt: Date;
  resumeAt: Date | null;
  endedAt: Date | null;
  endReason: FlowRunEndReason | null;
  failureCode: string | null;
  failureReason: string | null;
  /** Set only when a Sub-flow swapped the graph: the run points at the new flow's stored version. Left out, the graph is untouched. */
  graphVersionId?: number;
  /** What this step adds to the run's log totals. */
  log: { nodes: number; errors: number; ms: number };
}

/** SQL for runs and their log. Every method runs in the caller's transaction, under the tenant's row-level security. */
@Injectable()
export class RunRepository {
  /**
   * Stores a graph once per flow and content: a thousand runs of the same version share one row. Returns its id.
   * The no-op update makes the insert return the existing row's id on a repeat.
   */
  async upsertGraphVersion(
    tx: Tx,
    orgId: number,
    flowId: number,
    graph: RuntimeGraph,
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO flow_graph_versions (org_id, flow_id, hash, graph)
      VALUES (${orgId}, ${flowId}, ${hashGraph(graph)}, ${json(graph)})
      ON CONFLICT (org_id, flow_id, hash) DO UPDATE SET hash = EXCLUDED.hash
      RETURNING id`);
    return num(rowsOf(res)[0]!.id);
  }

  async insert(tx: Tx, orgId: number, r: NewRun): Promise<{ id: number; uuid: string }> {
    const versionId = await this.upsertGraphVersion(tx, orgId, r.flowId, r.graph);
    const res = await tx.execute(sql`
      INSERT INTO flow_runs (org_id, flow_id, subscriber_id, contact_id, channel_id, peer_key, conversation_id, source, trigger_ref,
                             trigger_text, graph_version_id, current_node_id, vars, timeout_seconds, cooldown_seconds, variant, campaign_id,
                             max_expires_at)
      VALUES (${orgId}, ${r.flowId}, ${r.subscriberId}, ${r.contactId}, ${r.channelId}, ${r.peerKey}, ${r.conversationId},
              ${r.source}, ${r.triggerRef}, ${r.triggerText}, ${versionId}, ${r.currentNodeId}, ${json(r.vars)},
              ${r.timeoutSeconds}, ${r.cooldownSeconds}, ${r.variant}, ${r.campaignId}, ${r.maxExpiresAt.toISOString()}::timestamptz)
      RETURNING id, uuid`);
    const row = rowsOf(res)[0]!;
    return { id: num(row.id), uuid: String(row.uuid) };
  }

  async byId(tx: Tx, orgId: number, id: number, forUpdate = false): Promise<RunState | null> {
    const res = await tx.execute(
      forUpdate
        ? sql`SELECT ${SELECT} WHERE r.org_id = ${orgId} AND r.id = ${id} FOR UPDATE OF r`
        : sql`SELECT ${SELECT} WHERE r.org_id = ${orgId} AND r.id = ${id}`,
    );
    const r = rowsOf(res)[0];
    return r ? toState(r) : null;
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<RunState | null> {
    const res = await tx.execute(
      sql`SELECT ${SELECT} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}`,
    );
    const r = rowsOf(res)[0];
    return r ? toState(r) : null;
  }

  /** The one live run of a customer on a channel (the partial unique index guarantees there is at most one). */
  async liveByPeer(
    tx: Tx,
    orgId: number,
    channelId: number,
    peerKey: string,
    forUpdate = false,
  ): Promise<RunState | null> {
    const base = sql`SELECT ${SELECT} WHERE r.org_id = ${orgId} AND r.channel_id = ${channelId} AND r.peer_key = ${peerKey}
      AND r.status IN ('running', 'waiting', 'sleeping', 'halted')`;
    const res = await tx.execute(forUpdate ? sql`${base} FOR UPDATE OF r` : base);
    const r = rowsOf(res)[0];
    return r ? toState(r) : null;
  }

  /** Live runs of a contact, across channels (an operator took over, a contact was deleted). */
  async liveByContact(tx: Tx, orgId: number, contactId: number): Promise<RunState[]> {
    const res =
      await tx.execute(sql`SELECT ${SELECT} WHERE r.org_id = ${orgId} AND r.contact_id = ${contactId}
      AND r.status IN ('running', 'waiting', 'sleeping', 'halted') FOR UPDATE OF r`);
    return rowsOf(res).map(toState);
  }

  /**
   * Writes a step back only if the run is still at the step the writer read (`expectedSeq`); a reply, a cancel or a duplicate job
   * that got there first wins and this returns false. `step_seq` always moves forward by one.
   */
  async save(
    tx: Tx,
    orgId: number,
    id: number,
    expectedSeq: number,
    p: RunPatch,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE flow_runs SET
        status = ${p.status}, current_node_id = ${p.currentNodeId}, step_seq = step_seq + 1,
        vars = ${json(p.vars)}, visits = ${json(p.visits)}, wait = ${json(p.wait)}, last_menu = ${json(p.menus)},
        last_out = ${json(p.lastOut)}, halt_reason = ${p.haltReason}, last_activity_at = now(),
        expires_at = ${p.expiresAt?.toISOString() ?? null}::timestamptz,
        max_expires_at = ${p.maxExpiresAt.toISOString()}::timestamptz,
        resume_at = ${p.resumeAt?.toISOString() ?? null}::timestamptz,
        ended_at = ${p.endedAt?.toISOString() ?? null}::timestamptz,
        end_reason = ${p.endReason}, failure_code = ${p.failureCode}, failure_reason = ${p.failureReason},
        node_count = node_count + ${p.log.nodes}, error_count = error_count + ${p.log.errors},
        duration_ms = duration_ms + ${p.log.ms},
        graph = ${p.graphVersionId !== undefined ? sql`NULL` : sql`graph`},
        graph_version_id = ${p.graphVersionId !== undefined ? p.graphVersionId : sql`graph_version_id`}
      WHERE org_id = ${orgId} AND id = ${id} AND step_seq = ${expectedSeq}
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** A flow a Sub-flow node may run: of this workspace, whatever its state (the caller decides what is live enough). */
  async flowForSubflow(
    tx: Tx,
    orgId: number,
    ref: number | string,
  ): Promise<{ id: number; data: unknown; isPublished: boolean; isActive: boolean } | null> {
    // The editor may store the flow's number (Reference) or its public uuid.
    const by = typeof ref === 'number' ? sql`id = ${ref}` : sql`uuid = ${ref}::uuid`;
    const res = await tx.execute(
      sql`SELECT id, flow_data, is_published, is_active FROM flows WHERE org_id = ${orgId} AND ${by}`,
    );
    const r = rowsOf(res)[0];
    return r
      ? {
          id: num(r.id),
          data: r.flow_data,
          isPublished: Boolean(r.is_published),
          isActive: Boolean(r.is_active),
        }
      : null;
  }

  async appendStep(
    tx: Tx,
    orgId: number,
    runId: number,
    s: {
      seq: number;
      nodeId: string | null;
      nodeType: string | null;
      event: string;
      detail?: Record<string, unknown>;
      error?: string | null;
      nodeLabel?: string | null;
      outcome?: string | null;
      port?: number | null;
      durationMs?: number | null;
      attempt?: number | null;
      summary?: string | null;
      errorCode?: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO flow_run_steps (org_id, run_id, seq, node_id, node_type, event, detail, error, node_label, outcome, port,
                                  duration_ms, attempt, summary, error_code)
      VALUES (${orgId}, ${runId}, ${s.seq}, ${s.nodeId}, ${s.nodeType}, ${s.event}, ${json(s.detail ?? {})}, ${s.error ?? null},
              ${s.nodeLabel ?? null}, ${s.outcome ?? null}, ${s.port ?? null}, ${s.durationMs ?? null}, ${s.attempt ?? null},
              ${s.summary ?? null}, ${s.errorCode ?? null})`);
  }

  /**
   * The retention sweep (cross-tenant: run as privileged): deletes runs that ended before `cutoff`, a batch at a time. Their steps
   * go with them (cascade). A live run has no ended_at, so it is never touched.
   */
  async purgeEndedBefore(tx: Tx, cutoff: Date, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM flow_runs WHERE (org_id, id) IN (
        SELECT org_id, id FROM flow_runs WHERE ended_at IS NOT NULL AND ended_at < ${cutoff.toISOString()}::timestamptz
        ORDER BY ended_at LIMIT ${limit})
      RETURNING id`);
    return rowsOf(res).length;
  }

  /** Graph versions no run points at any more and older than `cutoff`: nothing can show them, so they go. */
  async purgeUnusedGraphVersions(tx: Tx, cutoff: Date, limit: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM flow_graph_versions WHERE (org_id, id) IN (
        SELECT v.org_id, v.id FROM flow_graph_versions v
        WHERE v.created_at < ${cutoff.toISOString()}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM flow_runs r WHERE r.org_id = v.org_id AND r.graph_version_id = v.id)
        LIMIT ${limit})
      RETURNING id`);
    return rowsOf(res).length;
  }

  /** Ends a live run from outside (replaced by a new start, an operator took over, cancelled). */
  async endLive(
    tx: Tx,
    orgId: number,
    id: number,
    status: Extract<FlowRunStatus, 'cancelled' | 'expired' | 'failed' | 'completed'>,
    reason: FlowRunEndReason,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE flow_runs SET status = ${status}, end_reason = ${reason}, ended_at = now(), wait = NULL, expires_at = NULL,
                           resume_at = NULL, step_seq = step_seq + 1, last_activity_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('running', 'waiting', 'sleeping', 'halted') RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The latest finished run of a customer on a channel whose cooldown has not run out: the Auto reply domain asks it. */
  async cooldownUntil(
    tx: Tx,
    orgId: number,
    channelId: number,
    peerKey: string,
  ): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT max(ended_at + make_interval(secs => cooldown_seconds)) AS until
      FROM flow_runs
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND peer_key = ${peerKey}
        AND cooldown_seconds > 0 AND ended_at IS NOT NULL`);
    const until = date(rowsOf(res)[0]?.until);
    return until && until.getTime() > Date.now() ? until : null;
  }

  /**
   * An operator pauses a live run: it keeps its place, its variables and its wait (and a Delay keeps its wake-up time), and does
   * nothing until it is resumed. Stored as `halted` with the reason `paused`, so the engine and the sweeper both leave it alone.
   */
  async pause(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE flow_runs SET status = 'halted', halt_reason = 'paused', step_seq = step_seq + 1, last_activity_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('running', 'waiting', 'sleeping') RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** Puts a paused run back where it was. Returns what to queue, or null when nothing needs a job (it waits for a reply again). */
  async resume(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ seq: number; delayMs: number | null } | null | false> {
    const cur = await this.byId(tx, orgId, id, true);
    if (!cur || cur.status !== 'halted' || cur.haltReason !== 'paused') return false;
    const seq = cur.stepSeq + 1;
    const isDelay = cur.currentNodeId
      ? cur.graph.nodes.find((n) => n.id === cur.currentNodeId)?.type === 'TimeDelay'
      : false;
    let status: FlowRunStatus = 'running';
    let delayMs: number | null = 0;
    if (cur.wait) {
      status = 'waiting';
      delayMs = null;
    } else if (isDelay && cur.resumeAt) {
      status = 'sleeping';
      delayMs = Math.max(0, cur.resumeAt.getTime() - Date.now());
    }
    await tx.execute(sql`
      UPDATE flow_runs SET status = ${status}, halt_reason = NULL, step_seq = step_seq + 1, last_activity_at = now(),
        expires_at = CASE WHEN ${status} = 'waiting' THEN now() + make_interval(secs => timeout_seconds) ELSE NULL END,
        resume_at = CASE WHEN ${status} = 'sleeping' THEN resume_at ELSE NULL END
      WHERE org_id = ${orgId} AND id = ${id}`);
    return delayMs === null ? null : { seq, delayMs };
  }

  // --- the sweeper (cross-tenant: run as privileged) ------------------------------------------------------------------------

  /** Runs that need a push: an idle wait that gave up, a Delay or a halt that is due, a run whose first job never got queued. */
  async due(
    tx: Tx,
    now: Date,
    limit: number,
  ): Promise<
    Array<{
      orgId: number;
      id: number;
      status: FlowRunStatus;
      stepSeq: number;
      reason: 'idle' | 'lifetime' | 'wake' | 'stuck';
    }>
  > {
    const iso = now.toISOString();
    const res = await tx.execute(sql`
      SELECT org_id, id, status, step_seq,
             CASE WHEN max_expires_at <= ${iso}::timestamptz THEN 'lifetime'
                  WHEN status = 'waiting' THEN 'idle'
                  WHEN status IN ('sleeping', 'halted') THEN 'wake'
                  ELSE 'stuck' END AS reason
      FROM flow_runs
      WHERE status IN ('running', 'waiting', 'sleeping', 'halted')
        AND (max_expires_at <= ${iso}::timestamptz
             OR (status = 'waiting' AND expires_at IS NOT NULL AND expires_at <= ${iso}::timestamptz)
             OR (status IN ('sleeping', 'halted') AND resume_at IS NOT NULL AND resume_at <= ${iso}::timestamptz
                 AND coalesce(halt_reason, '') <> 'paused')
             OR (status = 'running' AND last_activity_at <= ${new Date(now.getTime() - 120_000).toISOString()}::timestamptz))
      ORDER BY id LIMIT ${limit}`);
    return rowsOf(res).map((r) => ({
      orgId: num(r.org_id),
      id: num(r.id),
      status: r.status as FlowRunStatus,
      stepSeq: num(r.step_seq),
      reason: r.reason as 'idle' | 'lifetime' | 'wake' | 'stuck',
    }));
  }
}
