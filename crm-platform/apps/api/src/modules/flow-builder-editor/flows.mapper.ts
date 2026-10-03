import {
  flowState,
  flbGraphStats,
  flbPreviewLabel,
  type FlowDetail,
  type FlowFeatured,
  type FlowGraph,
  type FlowSummary,
  type FlowType,
} from '@crm/contracts';
import type { FlowRow } from './flows.repository';

/** The mapper is the only place an internal id becomes a uuid. */
export function toFlowSummary(row: FlowRow): FlowSummary {
  return {
    id: row.uuid,
    name: row.name,
    flowType: row.flowType as FlowType,
    category: row.category,
    state: flowState(row),
    isPublished: row.isPublished,
    isActive: row.isActive,
    triggerKind: row.triggerKind,
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    subscribers: row.subscribers,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

export const EMPTY_GRAPH: FlowGraph = { flowNodes: [], flowEdges: [], vars: [] };

export function toFlowDetail(row: FlowRow): FlowDetail {
  return { ...toFlowSummary(row), graph: row.graph ?? EMPTY_GRAPH };
}

export function toFeatured(row: FlowRow): FlowFeatured {
  const graph = row.graph ?? EMPTY_GRAPH;
  const stats = flbGraphStats(graph);
  return {
    ...toFlowSummary(row),
    steps: stats.nodes,
    messages: stats.messages,
    waitMinutes: stats.waitMinutes,
    // WaDesk previews the first four nodes that have a type, each with its own label.
    preview: graph.flowNodes
      .filter((n) => n.type)
      .slice(0, 4)
      .map((n) => ({ type: n.type, label: flbPreviewLabel(n) })),
  };
}

/** The few fields an outbox event carries: identifiers and what a consumer decides on, never the graph. */
export function flowEventPayload(row: FlowRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    name: row.name,
    flowType: row.flowType,
    state: flowState(row),
    isPublished: row.isPublished,
    isActive: row.isActive,
    triggerKind: row.triggerKind,
    triggerChannelId: row.triggerChannelId,
    provider: row.provider,
    nodeCount: row.nodeCount,
  };
}
