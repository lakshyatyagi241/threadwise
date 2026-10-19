import { ensurePlan, flowUuidOf, readyPlan } from '../automation/plan';
import { docKey } from '../flows/rules';
import type { Doc } from '../util';
import { c } from './common';
import { FLOW_CONSTANTS } from './flows';
import type { Ctx, FieldMap, HandlerSpec, Outcome } from './types';

/**
 * Advanced automations -> flows (step automation_flows) and the node rows of the runtime (step automation_nodes), driven by the plan of
 * pass 1 (automation/plan.ts). Imported automations are unpublished AND inactive, always; see the plan for the consumers checked.
 *
 *   automation_flows  automation_metadata  one document = one automation = one `flows` row (category "Waboo automation")
 *   automation_nodes  automation_journey   one row per node of the runtime copy: adopted into the flow, or excluded / quarantined
 */
const NOT_PRESENT = 'NOT PRESENT: no column in flows';
const LOST = `drop:${NOT_PRESENT}; counted in the flow's AUTOMATION_STATE soft issue`;

export const META_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  automationId:
    'id (registered in migration.id_map: the journey rows and references resolve to the flow)',
  name: 'flows.flow_name',
  description: 'flows.flow_data.waboo.description (credentials redacted)',
  nodes:
    'flows.flow_data: every node becomes a step (see the mapping table); unsupported ones become inert placeholders',
  triggerObjects: 'flows.flow_data: picks the trigger node (WaDesk has one per flow)',
  uiObject:
    'flows.flow_data: only the position of each node is read; the rest of the JointJS layout is dropped',
  createdOn: 'flows.created_at',
  updatedOn: 'flows.updated_at',
  createdBy: 'drop:Waboo users are not linked to flows',
  updatedBy: 'drop:Waboo users are not linked to flows',
  status: 'flows.flow_data.waboo.status (the flow itself is never published)',
  is_active: 'flows.flow_data.waboo.wasActive (the flow itself is never active)',
  publishedOn: 'drop:the flow is not published (published_at stays NULL)',
  version: 'flows.flow_data.waboo.version (latest version only)',
  versionedAt: 'drop:history is not kept (latest version only)',
  isLocked: 'drop:editing lock of the console',
  enteredCount: LOST,
  activeCount: LOST,
  finishedCount: LOST,
  failedCount: LOST,
  goalCount: LOST,
  is_deleted: 'drop:soft-delete flag; a deleted automation is excluded SOFT_DELETED',
  deleted_time: 'drop:soft-delete timestamp',
};
export const JOURNEY_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map; points at the flow of the automation)',
  id: 'id (registered in migration.id_map)',
  automationId: 'the automation (one flow)',
  nodeId: 'flows.flow_data: the node id (n_ + the first 12 characters)',
  type: 'record kind (trigger / action / condition)',
  class: 'flows.flow_data: with function, picks the WaDesk node',
  function: 'flows.flow_data: with class, picks the WaDesk node',
  shapeId: 'drop:id of a UI shape (the shapes catalogue is not migrated)',
  edges:
    'flows.flow_data: read from the definition (automation_metadata); this row is its runtime copy',
  nodeObjectData:
    'flows.flow_data: read from the definition (automation_metadata); this row is its runtime copy',
  parent_nodeId: 'cross-check only: marks the runtime event triggers (DERIVED_EVENT_NODE)',
  version:
    'drop:version stamp of the runtime copy (the flow keeps the latest version only: see flows.flow_data.waboo.version)',
  versionedAt: 'drop:history is not kept (latest version only)',
  child_node: 'drop:runtime bookkeeping of the expanded graph',
  pedges: 'drop:runtime bookkeeping of the expanded graph',
  events: 'drop:runtime bookkeeping of the expanded graph',
  is_deleted: 'drop:soft-delete flag',
  deleted_time: 'drop:soft-delete timestamp',
};

const NOT_PLANNED: Outcome = {
  kind: 'quarantine',
  code: 'NOT_PLANNED',
  reason: 'the automation plan has no verdict for this document',
};

/** the plan is built once per source index, by prepare (loader) or by the document stream (verifier) */
const reader = (collection: string): NonNullable<HandlerSpec['read']> =>
  async function* ({ idx, source, client, ctx }) {
    await ensurePlan(idx, {
      source,
      client,
      fallbackAt: ctx?.fallbackAt ?? '1970-01-01T00:00:00.000Z',
      ref: (col, key) => ctx?.ref(col, key),
    });
    if (source.collections(client).includes(collection)) yield* source.read(client, collection);
  };

export const automationFlows: HandlerSpec = {
  handler: 'automation_flows',
  collection: 'automation_metadata',
  mapCollection: 'automation_metadata',
  aliasKeys: ['automationId'],
  shaCollections: ['automation_journey', 'broadcast_templates'],
  read: reader('automation_metadata'),
  prepare: async (env) => {
    await ensurePlan(env.idx, {
      source: env.source,
      client: env.client,
      fallbackAt: env.fallbackAt,
      ref: (col, key) => env.idmap.get(col, key),
    });
  },
  fingerprint: (env) => readyPlan(env.idx)?.fingerprint ?? '',
  fields: META_FIELDS,
  tables: {
    flows: {
      columns: [
        c('flow_name', 'text'),
        c('flow_data', 'jsonb'),
        c('category', 'text'),
        c('trigger_kind', 'text'),
        c('trigger_value', 'bigint'),
        c('trigger_keywords', 'text'),
        c('trigger_config', 'jsonb'),
        c('provider', 'text'),
        c('flow_type', 'text'),
        c('is_published', 'boolean'),
        c('is_active', 'boolean'),
        c('published_at', 'timestamptz'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: FLOW_CONSTANTS,
      // what the live application changes once people work in the app (publish, edit, bind a channel)
      liveColumns: [
        'flow_name',
        'flow_data',
        'category',
        'trigger_kind',
        'trigger_value',
        'trigger_keywords',
        'trigger_config',
        'trigger_channel_id',
        'trigger_last_occurrence',
        'provider',
        'flow_type',
        'is_published',
        'is_active',
        'published_at',
        'updated_at',
        'row_version',
        'user_id',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const v = readyPlan(ctx.idx)?.meta.get(docKey('automation_metadata', doc));
    if (!v) return NOT_PLANNED;
    if (v.kind !== 'load') return { kind: v.kind, code: v.code, reason: v.reason };
    return { kind: 'rows', rows: [{ table: 'flows', sub: '', row: v.row }], soft: v.soft };
  },
};

export const automationNodes: HandlerSpec = {
  handler: 'automation_nodes',
  collection: 'automation_journey',
  mapCollection: 'automation_journey',
  shaCollections: ['automation_metadata'],
  read: reader('automation_journey'),
  prepare: automationFlows.prepare,
  fingerprint: automationFlows.fingerprint,
  fields: JOURNEY_FIELDS,
  tables: {},
  transform(doc: Doc, ctx: Ctx): Outcome {
    const v = readyPlan(ctx.idx)?.journey.get(docKey('automation_journey', doc));
    if (!v) return NOT_PLANNED;
    if (v.kind === 'adopt')
      return {
        kind: 'adopt',
        table: 'flows',
        column: 'uuid',
        value: flowUuidOf(ctx.client, v.metaKey),
      };
    return { kind: v.kind, code: v.code, reason: v.reason };
  },
};
