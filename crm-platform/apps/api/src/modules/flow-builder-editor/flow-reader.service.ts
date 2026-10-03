import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  flbHandleToPort,
  flbPortsFor,
  flbRuntimeNodeData,
  type FlowGraph,
  type FlowType,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { FlowsRepository } from './flows.repository';

/**
 * A flow as the runtime executes it: the graph plus the 1-based port number of every edge (`<nodeId>_<port>`). `graph` is the saved
 * graph with each node's `data` shaped by `flbRuntimeNodeData` (Reference's FlowNormalizer field mapping: `save` also as `variable`, `lat` /
 * `lng` as `latitude` / `longitude`, ...); every saved field is still there, the runtime-named ones are added.
 */
export interface RunnableFlow {
  id: string;
  name: string;
  flowType: FlowType;
  isPublished: boolean;
  isActive: boolean;
  /** The trigger columns the save denormalised (what the runtime's keyword matcher and enrolment read). */
  triggerKind: string;
  triggerKeywords: string | null;
  /** The engine stamp (`baileys`, `waba`, `telegram`...), with the channel it is pinned to, when it is pinned. */
  provider: string;
  triggerChannelId: number | null;
  graph: FlowGraph;
  /** `<sourceNodeId>_<port>` -> target node id: the lookup table Reference's FlowNormalizer built for the Node runtime. */
  routes: Record<string, string>;
  startNodeId: string | null;
}

export interface EnrollableFlow {
  id: string;
  internalId: number;
  flowType: string;
  triggerKind: string;
  triggerValue: number | null;
  triggerKeywords: string | null;
  provider: string;
  triggerDeviceId: number | null;
  /** `channels.id` the flow listens on; null = every channel of its `provider` (the runtime's own rule). */
  triggerChannelId: number | null;
}

/**
 * The seam the flow runtime (FLR) reads through. Nothing in the editor executes a flow; this is the narrow, read-only way
 * the engine asks "what graph do I run" (TW-FLB-070) and "which flows enrol on this event" (TW-FLB-071), over the columns
 * the save path denormalised. Called from jobs and consumers that carry the organization id, so every read is scoped by it.
 */
@Injectable()
export class FlowReaderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FlowsRepository,
  ) {}

  async getRunnableFlow(orgId: number, flowUuid: string): Promise<RunnableFlow | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, flowUuid);
      if (!row?.graph) return null;
      const byId = new Map(row.graph.flowNodes.map((n) => [n.id, n]));
      const routes: Record<string, string> = {};
      for (const e of row.graph.flowEdges) {
        const src = byId.get(e.source);
        if (!src) continue;
        // A port that is not declared on the node still routes by its handle (imported graphs); first edge wins per port.
        const declared = flbPortsFor(src).some((p) => p.id === e.sourceHandle);
        const port = declared || e.sourceHandle ? flbHandleToPort(src.type, e.sourceHandle) : 1;
        const key = `${e.source}_${port}`;
        if (!(key in routes)) routes[key] = e.target;
      }
      const start =
        row.graph.flowNodes.find((n) => n.isStart) ??
        row.graph.flowNodes.find((n) => n.type === 'trigger');
      return {
        id: row.uuid,
        name: row.name,
        flowType: row.flowType as FlowType,
        isPublished: row.isPublished,
        isActive: row.isActive,
        triggerKind: row.triggerKind,
        triggerKeywords: row.triggerKeywords,
        provider: row.provider,
        triggerChannelId: row.triggerChannelId,
        graph: flbRuntimeNodeData(row.graph),
        routes,
        startNodeId: start?.id ?? null,
      };
    });
  }

  /**
   * Published AND active flows with this trigger kind (and value), the set tag / group / event enrolment fans out to. A value-less
   * trigger stores 0, and a flow whose value is null counts as 0, exactly as the runtime's own enrolment query reads it
   * (`coalesce(trigger_value, 0)`).
   */
  async listEnrollable(
    orgId: number,
    kind: string,
    value?: number | null,
  ): Promise<EnrollableFlow[]> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, flow_type, trigger_kind, trigger_value, trigger_keywords, provider, trigger_device_id, trigger_channel_id
        FROM flows
        WHERE org_id = ${orgId} AND is_published AND is_active AND trigger_kind = ${kind}
          ${value === undefined || value === null ? sql`` : sql`AND coalesce(trigger_value, 0) = ${value}`}
        ORDER BY id
      `);
      return (res.rows as Array<Record<string, unknown>>).map((r) => ({
        id: r.uuid as string,
        internalId: Number(r.id),
        flowType: r.flow_type as string,
        triggerKind: r.trigger_kind as string,
        triggerValue: r.trigger_value === null ? null : Number(r.trigger_value),
        triggerKeywords: (r.trigger_keywords as string | null) ?? null,
        provider: r.provider as string,
        triggerDeviceId: r.trigger_device_id === null ? null : Number(r.trigger_device_id),
        triggerChannelId: r.trigger_channel_id === null ? null : Number(r.trigger_channel_id),
      }));
    });
  }
}
