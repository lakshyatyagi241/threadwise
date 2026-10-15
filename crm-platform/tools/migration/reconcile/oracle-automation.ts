import { isDeleted, primaryKey, toDate, uuidv5, type Doc } from '../util';

/**
 * INDEPENDENT oracle of the advanced automations (a second implementation of the rules in README "Stage 2: advanced automations").
 * It imports NOTHING from transform/, flows/ or automation/: it reads the two source collections itself and derives, per automation,
 * the verdict, the number of nodes and links the flow must have, the WaDesk type of every Waboo node, the trigger kind, the
 * placeholder count; and, per journey row, where it goes. The verifier (reconcile/automation.ts) compares the target with this.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
    ? (v as Rec)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export const MAX_NODES = 500;
export const MAX_EDGES = 2000;
export const CATEGORY = 'Waboo automation';

/** type|class|function -> the WaDesk node type (the trigger of a field match is decided separately) */
const NODE_TYPE: Record<string, string> = {
  'trigger|contact|field_match': 'trigger',
  'trigger|Datematch|date_match': 'trigger',
  'trigger|contact|added_to_list': 'trigger',
  'condition|contact|query': 'condition',
  'condition|google|google_sheet_query': 'condition',
  'condition|list|query': 'in_list',
  'action|whatsapp|send': 'template',
  'action|contact|update': 'update_contact',
  'action|list|add': 'list_member',
  'action|delay|add': 'delay',
  'action|google|save_contact_from_sheet': 'sheet_contact',
};
const TRIGGER_OPS = new Set([
  '=',
  '!=',
  'contains',
  'doesNotContain',
  'beginsWith',
  'endsWith',
  '>',
  '<',
  'notNull',
  'null',
]);
const EVENTS = new Set(['sent', 'delivered', 'failed', 'completed']);

export interface OAuto {
  docKey: string;
  metaKey: string;
  automationId: string;
  name: string;
  created: string;
  updated: string;
  nodeCount: number;
  edgeCount: number;
  triggerKind: string;
  /** the Waboo node id of the trigger the flow starts from (null: none, one was added) */
  primary: string | null;
  /** Waboo node id -> WaDesk type of the node that stands for it */
  typeOf: Map<string, string>;
  placeholders: number;
  detachedPorts: number;
  /** marketing_list key of a group_join trigger */
  listKey: string | null;
  /** date_field_match / field_match expectations */
  config: Rec | null;
  nodeIds: string[];
}
export type OVerdict =
  { kind: 'load'; auto: OAuto } | { kind: 'exclude' | 'quarantine'; code: string };
export type OJourney =
  { kind: 'adopt'; metaKey: string } | { kind: 'exclude' | 'quarantine'; code: string };

function single(fq: Rec): Rec | null {
  const items = list(fq.rules)
    .map(rec)
    .filter((r) => Array.isArray(r.rules) || txt(r.field) !== '');
  if (items.length !== 1 || fq.not === true) return null;
  const r = items[0]!;
  if (Array.isArray(r.rules)) return null;
  if (!TRIGGER_OPS.has(txt(r.operator))) return null;
  if ((txt(r.valueSource) || 'value') !== 'value') return null;
  return r;
}

const clock = (v: string): string | null => {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  if (Number(m[2]) > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

export function oracleAutomations(
  metaDocs: Doc[],
  journeyDocs: Doc[],
  fallbackAt: string,
): { meta: Map<string, OVerdict>; journey: Map<string, OJourney> } {
  const meta = new Map<string, OVerdict>();
  const journey = new Map<string, OJourney>();
  const stamp = (d: Doc): number => (toDate(d.updatedOn) ?? toDate(d.createdOn))?.getTime() ?? 0;
  const winner = new Map<string, Doc>();
  for (const d of metaDocs) {
    const id = txt(d.automationId);
    if (!id || isDeleted(d)) continue;
    const w = winner.get(id);
    if (!w || stamp(d) > stamp(w) || (stamp(d) === stamp(w) && primaryKey(d) > primaryKey(w)))
      winner.set(id, d);
  }
  const loadedNodes = new Map<string, { metaKey: string; nodes: Rec }>();
  const verdictOfId = new Map<string, OVerdict>();

  for (const d of metaDocs) {
    const key = primaryKey(d);
    const id = txt(d.automationId);
    const out = (v: OVerdict): void => {
      meta.set(key, v);
      if (id && winner.get(id) === d) verdictOfId.set(id, v);
    };
    if (isDeleted(d)) {
      out({ kind: 'exclude', code: 'SOFT_DELETED' });
      continue;
    }
    if (!id) {
      out({ kind: 'quarantine', code: 'NO_AUTOMATION_ID' });
      continue;
    }
    if (winner.get(id) !== d) {
      out({ kind: 'exclude', code: 'OLDER_DUPLICATE' });
      continue;
    }
    const nodes = rec(d.nodes);
    const ids = Object.keys(nodes);
    if (ids.length === 0) {
      out({ kind: 'exclude', code: 'NO_NODES' });
      continue;
    }
    if (ids.length > MAX_NODES) {
      out({ kind: 'quarantine', code: 'GRAPH_TOO_LARGE' });
      continue;
    }

    const wn = ids.map((nid) => {
      const n = rec(nodes[nid]);
      return {
        id: nid,
        type: txt(n.type),
        cls: txt(n.class),
        fn: txt(n.function),
        data: rec(n.nodeObjectData),
        edges: list(n.edges)
          .map(rec)
          .filter((e) => txt(e.to) !== '')
          .map((e) => ({ to: txt(e.to), port: txt(e.port) })),
      };
    });
    const exists = new Set(ids);
    const triggers = wn.filter((n) => n.type === 'trigger');
    const order = [
      ...list(d.triggerObjects)
        .map((t) => triggers.find((n) => n.id === txt(t)))
        .filter((n) => n !== undefined),
      ...triggers,
    ];
    const primary = order[0] ?? null;
    const typeOf = new Map<string, string>();
    let nodeCount = 0;
    let edgeCount = 0;
    let placeholders = 0;
    let detachedPorts = 0;
    let triggerKind = 'manual_enroll';
    let listKey: string | null = null;
    let config: Rec | null = null;
    for (const n of wn) {
      const key3 = `${n.type}|${n.cls}|${n.fn}`;
      const supported = key3 in NODE_TYPE;
      const dangling = n.edges.filter((e) => !exists.has(e.to));
      edgeCount += n.edges.length - dangling.length;
      if (n.type === 'trigger' && n !== primary) {
        nodeCount += 1;
        placeholders += 1;
        typeOf.set(n.id, 'update_contact');
        continue;
      }
      if (!supported) {
        nodeCount += 1;
        placeholders += 1;
        typeOf.set(
          n.id,
          n.type === 'trigger'
            ? 'trigger'
            : n.type === 'condition'
              ? 'condition'
              : 'update_contact',
        );
        continue;
      }
      typeOf.set(n.id, NODE_TYPE[key3]!);
      nodeCount += 1;
      if (key3 === 'trigger|contact|field_match') {
        const one = single(rec(n.data.filter_query));
        if (one) {
          triggerKind = 'field_match';
          config = { field: txt(one.field), value: txt(one.value) };
        } else {
          nodeCount += 1;
          edgeCount += 1;
        }
      }
      if (key3 === 'trigger|Datematch|date_match') {
        triggerKind = 'date_field_match';
        const dir = txt(n.data.date_of_execution).toLowerCase();
        const off = Math.trunc(Number(n.data.execution_offset));
        config = {
          field: txt(n.data.field_name),
          direction: dir === 'before' || dir === 'after' ? dir : 'on',
          days: Number.isFinite(off) && off >= 0 ? off : 0,
          time: clock(txt(n.data.execution_time)) ?? '09:00',
        };
      }
      if (key3 === 'trigger|contact|added_to_list') {
        triggerKind = 'group_join';
        listKey = txt(n.data.marketing_list_id) || null;
      }
      if (key3 === 'action|contact|update') {
        const k = list(n.data.fields).reduce<number>((a, f) => a + Object.keys(rec(f)).length, 0);
        nodeCount += Math.max(1, k) - 1;
        edgeCount += Math.max(1, k) - 1;
      }
      if (key3 === 'action|whatsapp|send') {
        const ports = new Set(
          n.edges
            .filter((e) => exists.has(e.to) && (e.port === 'delivered' || e.port === 'failed'))
            .map((e) => e.port),
        );
        nodeCount += ports.size;
        detachedPorts += n.edges.filter(
          (e) => exists.has(e.to) && (e.port === 'delivered' || e.port === 'failed'),
        ).length;
      }
    }
    if (!primary) {
      nodeCount += 1;
      const into = new Set(wn.flatMap((n) => n.edges.map((e) => e.to)));
      if (wn.some((n) => !into.has(n.id))) edgeCount += 1;
    }
    if (edgeCount > MAX_EDGES) {
      out({ kind: 'quarantine', code: 'GRAPH_TOO_LARGE' });
      continue;
    }
    const created = toDate(d.createdOn) ?? new Date(fallbackAt);
    let updated = toDate(d.updatedOn) ?? created;
    if (updated < created) updated = created;
    const nm = txt(d.name).trim();
    const name = Array.from(nm || `Waboo automation ${id.slice(-6)}`)
      .slice(0, 255)
      .join('');
    const auto: OAuto = {
      docKey: key,
      metaKey: key,
      automationId: id,
      name,
      created: created.toISOString(),
      updated: updated.toISOString(),
      nodeCount,
      edgeCount,
      triggerKind,
      primary: primary ? primary.id : null,
      typeOf,
      placeholders,
      detachedPorts,
      listKey,
      config,
      nodeIds: ids,
    };
    out({ kind: 'load', auto });
    loadedNodes.set(id, { metaKey: key, nodes });
  }

  const seen = new Set<string>();
  for (const d of journeyDocs) {
    const key = primaryKey(d);
    const id = txt(d.automationId);
    const nid = txt(d.nodeId);
    const set = (v: OJourney): void => void journey.set(key, v);
    if (isDeleted(d)) {
      set({ kind: 'exclude', code: 'SOFT_DELETED' });
      continue;
    }
    if (!id || !nid) {
      set({ kind: 'quarantine', code: !id ? 'NO_AUTOMATION_ID' : 'NO_NODE_ID' });
      continue;
    }
    const l = loadedNodes.get(id);
    if (!l) {
      set(
        verdictOfId.has(id)
          ? { kind: 'exclude', code: 'AUTOMATION_NOT_IMPORTED' }
          : { kind: 'quarantine', code: 'NO_DEFINITION' },
      );
      continue;
    }
    const dup = `${id}\u0000${nid}`;
    if (seen.has(dup)) {
      set({ kind: 'exclude', code: 'DUPLICATE_NODE' });
      continue;
    }
    const node = rec(l.nodes[nid]);
    if (Object.keys(node).length > 0) {
      if (txt(node.class) === txt(d.class) && txt(node.function) === txt(d.function)) {
        seen.add(dup);
        set({ kind: 'adopt', metaKey: l.metaKey });
      } else set({ kind: 'quarantine', code: 'JOURNEY_DIVERGES' });
      continue;
    }
    const parent = txt(d.parent_nodeId);
    if (
      d.type === 'trigger' &&
      EVENTS.has(txt(d.function)) &&
      parent !== '' &&
      Object.keys(rec(l.nodes[parent])).length > 0
    ) {
      seen.add(dup);
      set({ kind: 'exclude', code: 'DERIVED_EVENT_NODE' });
      continue;
    }
    set({ kind: 'quarantine', code: 'NOT_IN_DEFINITION' });
  }
  return { meta, journey };
}

/** the uuid of the flow of a metadata document (same scheme as the engine's row uuid) */
export const flowUuid = (client: string, metaKey: string): string =>
  uuidv5(`${client}|automation_metadata|${metaKey}`);
