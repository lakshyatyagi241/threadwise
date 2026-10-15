import type { Source } from '../extract/source';
import { arr, clipChars, docKey, obj, s, wabooDate } from '../flows/rules';
import type { Row, Soft, TargetRef } from '../transform/types';
import { isDeleted, primaryKey, redactText, sha256, str, uuidv5, type Doc } from '../util';
import { AUTOMATION_CATEGORY, convertAutomation, EVENT_FUNCTIONS } from './convert';

/**
 * Pass 1 of the advanced automations: every document of `automation_metadata` and `automation_journey` gets its verdict BEFORE the
 * first row is written; the steps only look the verdict up. One metadata document = one automation = one flow. The journey rows are
 * the runtime's expanded copy of the same graph (one row per node, plus the event triggers the runtime adds under a send / a delay):
 * they are adopted into the flow (id_map points at it) or excluded / quarantined with a counted reason.
 *
 * SAFETY: an imported automation is unpublished AND inactive, always. Every consumer selects on `is_published AND is_active`:
 * trigger.service (keywordFlow, liveConfigured, enrolLive), schedule.sweeper (schedule, date_field_match), launch.service / engine.service
 * (refuse an inactive flow), flow-reader, the admin counters and the partial index idx_flows_live_trigger. No trigger is armed
 * (trigger_channel_id / trigger_device_id NULL), and no run, subscriber, outbox or log row is written.
 */

export const AUTOMATION_COLLECTIONS = ['automation_metadata', 'automation_journey'] as const;

export type MetaVerdict =
  | {
      kind: 'load';
      automationId: string;
      metaKey: string;
      row: Row;
      soft: Soft[];
      nodeIds: string[];
      loss: Record<string, number>;
    }
  | { kind: 'exclude' | 'quarantine'; code: string; reason: string };
export type JourneyVerdict =
  | { kind: 'adopt'; metaKey: string }
  | { kind: 'exclude' | 'quarantine'; code: string; reason: string };

export interface AutomationPlan {
  meta: Map<string, MetaVerdict>;
  journey: Map<string, JourneyVerdict>;
  fingerprint: string;
  tally: Record<string, number>;
}

export const flowUuidOf = (client: string, metaKey: string): string =>
  uuidv5(`${client}|automation_metadata|${metaKey}`);

export interface PlanInput {
  source: Source;
  client: string;
  fallbackAt: string;
  /** id_map lookup (marketing_list -> contact group): the lists a step points at */
  ref(collection: string, key: unknown): TargetRef | undefined;
}

async function readAll(source: Source, client: string, collection: string): Promise<Doc[]> {
  const out: Doc[] = [];
  if (source.collections(client).includes(collection))
    for await (const d of source.read(client, collection)) out.push(d);
  return out;
}

const cache = new WeakMap<object, Promise<AutomationPlan>>();
const ready = new WeakMap<object, AutomationPlan>();
/** One plan per source index (so the loader's steps and the verifier each build it once from the dump). */
export function ensurePlan(key: object, input: PlanInput): Promise<AutomationPlan> {
  let p = cache.get(key);
  if (!p) {
    p = buildAutomationPlan(input).then((pl) => {
      ready.set(key, pl);
      return pl;
    });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
/** The plan once ensurePlan has finished (the transforms are synchronous and run after it). */
export const readyPlan = (key: object): AutomationPlan | undefined => ready.get(key);

export async function buildAutomationPlan(a: PlanInput): Promise<AutomationPlan> {
  const [metaDocs, journeyDocs, templates] = await Promise.all([
    readAll(a.source, a.client, 'automation_metadata'),
    readAll(a.source, a.client, 'automation_journey'),
    readAll(a.source, a.client, 'broadcast_templates'),
  ]);
  const tpl = new Map<string, string>();
  for (const t of templates) {
    const name = str(t.name) ?? str(t.template_name);
    if (!name) continue;
    for (const k of [t.id, t._id, t.template_id, t.meta_template_id]) {
      const key = str(k);
      if (key && !tpl.has(key)) tpl.set(key, name);
    }
  }
  const meta = new Map<string, MetaVerdict>();
  const journey = new Map<string, JourneyVerdict>();
  const tally: Record<string, number> = {};
  const count = (k: string): void => void (tally[k] = (tally[k] ?? 0) + 1);

  // the winner per automationId: the newest updatedOn, a tie to the larger key
  const stamp = (d: Doc): number =>
    (wabooDate(d.updatedOn) ?? wabooDate(d.createdOn))?.getTime() ?? 0;
  const winner = new Map<string, Doc>();
  for (const d of metaDocs) {
    const id = s(d.automationId);
    if (!id || isDeleted(d)) continue;
    const w = winner.get(id);
    if (!w || stamp(d) > stamp(w) || (stamp(d) === stamp(w) && primaryKey(d) > primaryKey(w)))
      winner.set(id, d);
  }

  for (const d of metaDocs) {
    const k = docKey('automation_metadata', d);
    const id = s(d.automationId);
    const stop = (kind: 'exclude' | 'quarantine', code: string, reason: string): void => {
      meta.set(k, { kind, code, reason });
      count(`meta:${kind}:${code}`);
    };
    if (isDeleted(d)) {
      stop('exclude', 'SOFT_DELETED', 'the automation is deleted at the source');
      continue;
    }
    if (!id) {
      stop('quarantine', 'NO_AUTOMATION_ID', 'the document has no automationId');
      continue;
    }
    if (winner.get(id) !== d) {
      stop(
        'exclude',
        'OLDER_DUPLICATE',
        'another document with the same automationId is newer (latest only)',
      );
      continue;
    }
    const nodes = obj(d.nodes);
    if (Object.keys(nodes).length === 0) {
      stop(
        'exclude',
        'NO_NODES',
        'the automation has no nodes (an empty draft): nothing to convert',
      );
      continue;
    }
    const cells = new Map<string, { x: number; y: number }>();
    for (const c of arr(obj(d.uiObject).cells)) {
      const o = obj(c);
      const p = obj(o.position);
      if (s(o.id) && typeof p.x === 'number' && typeof p.y === 'number')
        cells.set(s(o.id), { x: p.x, y: p.y });
    }
    const out = convertAutomation({
      nodes,
      triggerIds: arr(d.triggerObjects).map(s).filter(Boolean),
      cells,
      templates: tpl,
      list: (lid) => {
        const r = lid ? a.ref('marketing_list', lid) : undefined;
        return r ? { id: r.id, uuid: r.uuid } : undefined;
      },
    });
    if (!out.ok) {
      stop('quarantine', out.code, out.reason);
      continue;
    }
    const soft = [...out.soft];
    const created = wabooDate(d.createdOn);
    let c0 = created;
    if (!c0) {
      c0 = new Date(a.fallbackAt);
      soft.push({
        code: 'NO_DATE',
        reason: 'no usable createdOn: stamped with the dump manifest time',
        detail: a.fallbackAt,
      });
    }
    let u0 = wabooDate(d.updatedOn) ?? c0;
    if (u0 < c0) u0 = c0;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    soft.push({
      code: 'AUTOMATION_STATE',
      reason:
        'the state of the automation at the source (an imported automation is never live) and the run counters, which are not kept',
      detail: {
        status: s(d.status),
        is_active: d.is_active === true,
        version: num(d.version),
        entered: num(d.enteredCount),
        active: num(d.activeCount),
        finished: num(d.finishedCount),
        failed: num(d.failedCount),
        goal: num(d.goalCount),
      },
    });
    const g = out.graph;
    const name = clipChars(str(d.name) ?? `Waboo automation ${id.slice(-6)}`, 255);
    const desc = redactText(s(d.description)).text;
    const trig = out.trigger;
    const flowData = JSON.parse(
      JSON.stringify({
        flowNodes: g.flowNodes,
        flowEdges: g.flowEdges,
        vars: g.vars,
        waboo: {
          source: 'automation_metadata',
          status: s(d.status),
          wasActive: d.is_active === true,
          version: num(d.version),
          ...(desc ? { description: clipChars(desc, 1000) } : {}),
        },
      }),
    ) as Row;
    const row: Row = {
      flow_name: name,
      flow_data: flowData,
      category: AUTOMATION_CATEGORY,
      trigger_kind: trig.kind,
      trigger_value: trig.valueKind === 'zero' ? 0 : out.groupRef ? out.groupRef.id : null,
      trigger_keywords: null,
      trigger_config: trig.config ?? null,
      provider: 'waba',
      flow_type: 'chat',
      // SAFETY: never live. The API default for is_active is TRUE: overridden here, checked by reconcile.
      is_published: false,
      is_active: false,
      published_at: null,
      created_at: c0.toISOString(),
      updated_at: u0.toISOString(),
    };
    meta.set(k, {
      kind: 'load',
      automationId: id,
      metaKey: primaryKey(d),
      row,
      soft,
      nodeIds: Object.keys(nodes),
      loss: out.loss,
    });
    count('meta:load');
  }

  // --- the journey rows -----------------------------------------------------------------------------------------------------------
  const loaded = new Map<string, { verdict: Extract<MetaVerdict, { kind: 'load' }>; nodes: Doc }>();
  const verdictById = new Map<string, MetaVerdict>();
  for (const d of metaDocs) {
    const id = s(d.automationId);
    const v = meta.get(docKey('automation_metadata', d))!;
    if (id && winner.get(id) === d) verdictById.set(id, v);
    if (v.kind === 'load') loaded.set(id, { verdict: v, nodes: obj(d.nodes) });
  }
  const seenNode = new Set<string>();
  for (const d of journeyDocs) {
    const k = docKey('automation_journey', d);
    const id = s(d.automationId);
    const nid = s(d.nodeId);
    const stop = (kind: 'exclude' | 'quarantine', code: string, reason: string): void => {
      journey.set(k, { kind, code, reason });
      count(`journey:${kind}:${code}`);
    };
    if (isDeleted(d)) {
      stop('exclude', 'SOFT_DELETED', 'the node row is deleted at the source');
      continue;
    }
    if (!id || !nid) {
      stop(
        'quarantine',
        !id ? 'NO_AUTOMATION_ID' : 'NO_NODE_ID',
        'the row has no automationId / nodeId',
      );
      continue;
    }
    const l = loaded.get(id);
    if (!l) {
      const mv = verdictById.get(id);
      if (!mv)
        stop(
          'quarantine',
          'NO_DEFINITION',
          'no automation_metadata document defines this automation, so its graph cannot be rebuilt (the raw dump is the archive)',
        );
      else
        stop(
          'exclude',
          'AUTOMATION_NOT_IMPORTED',
          `its automation is not imported (${mv.kind === 'load' ? 'load' : mv.code})`,
        );
      continue;
    }
    const dup = `${id}\u0000${nid}`;
    if (seenNode.has(dup)) {
      stop('exclude', 'DUPLICATE_NODE', 'a row for this node was already seen');
      continue;
    }
    const node = obj(l.nodes[nid]);
    if (Object.keys(node).length > 0) {
      if (s(node.class) === s(d.class) && s(node.function) === s(d.function)) {
        seenNode.add(dup);
        journey.set(k, { kind: 'adopt', metaKey: l.verdict.metaKey });
        count('journey:adopt');
      } else {
        stop(
          'quarantine',
          'JOURNEY_DIVERGES',
          'the row names a different class / function than the definition of the same node',
        );
      }
      continue;
    }
    const parent = s(d.parent_nodeId);
    if (
      d.type === 'trigger' &&
      EVENT_FUNCTIONS.has(s(d.function)) &&
      parent !== '' &&
      Object.keys(obj(l.nodes[parent])).length > 0
    ) {
      seenNode.add(dup);
      stop(
        'exclude',
        'DERIVED_EVENT_NODE',
        "the runtime's own event trigger under a send / delay node: the definition holds it as an output port",
      );
      continue;
    }
    stop('quarantine', 'NOT_IN_DEFINITION', 'the row is not a node of the automation definition');
  }
  const fingerprint = sha256(
    JSON.stringify([
      [...meta].map(([k, v]) => [k, v.kind, 'code' in v ? v.code : sha256(JSON.stringify(v.row))]),
      [...journey].map(([k, v]) => [k, v.kind, 'code' in v ? v.code : v.metaKey]),
    ]),
  ).slice(0, 16);
  return { meta, journey, fingerprint, tally };
}
