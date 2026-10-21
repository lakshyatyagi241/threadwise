import { flbDefaultNodeData } from '../../../packages/contracts/src/flow-builder-editor/node-catalogue';
import type { FlowEdge, FlowNode } from '../../../packages/contracts/src/flow-builder-editor/graph';
import { flbExtractTrigger } from '../../../packages/contracts/src/flow-builder-editor/trigger';
import { arr, obj, s } from '../flows/rules';
import type { Soft } from '../transform/types';
import { scrub, type Doc } from '../util';

/**
 * The converter of the ADVANCED automations: one Waboo automation (the node map of `automation_metadata` plus the positions of its
 * `uiObject`) -> the editor graph of a WaDesk flow (`flows.flow_data`). Pure: no database, no clock, no randomness.
 *
 * Rules (the table is MAPPING below and in the README, "Stage 2: advanced automations"):
 * - a Waboo node is mapped (same behaviour), approximated (WaDesk has the node, not every setting) or unsupported. An unsupported node
 *   becomes an INERT placeholder that keeps the original type / class / function and its scrubbed configuration in `data._waboo`:
 *   an action = an "Update contact field" with no field (the runtime skips it and goes on), a condition = a Condition with no rules
 *   (always the `no` branch), a trigger = a Trigger of kind `manual_enroll` (nobody is enrolled automatically). Nothing is dropped
 *   silently: every loss is a soft issue with a count.
 * - the runtime follows the FIRST edge of an output port only (`runtime-graph.ts`), so a port with several edges keeps all of them
 *   (the editor shows them) and the loss is counted (FAN_OUT_FIRST_ONLY).
 * - WaDesk has no "message delivered / failed" event: the successors of those two ports hang behind an inert node nobody reaches, so
 *   they never run (EVENT_BRANCH_DETACHED). `sent` follows the template step.
 */

export const AUTOMATION_CATEGORY = 'Waboo automation';
export const MAX_NODES = 500;
export const MAX_EDGES = 2000;
const CONFIG_CAP = 20_000;

export type MapStatus = 'mapped' | 'approximated' | 'unsupported';
export interface MappingRow {
  key: string;
  target: string;
  status: MapStatus;
  note: string;
}
/** key = type|class|function. Anything not listed is an inert placeholder (status unsupported). */
export const MAPPING: MappingRow[] = [
  {
    key: 'trigger|contact|field_match',
    target: 'trigger kind field_match',
    status: 'mapped',
    note: 'one rule with a supported operator; several rules / OR / NOT: a manual_enroll trigger + a Condition holding the whole query (approximated)',
  },
  {
    key: 'trigger|Datematch|date_match',
    target: 'trigger kind date_field_match',
    status: 'approximated',
    note: 'offset read as DAYS, cycle "once" as not yearly, time "11:00 AM" as 11:00',
  },
  {
    key: 'trigger|contact|added_to_list',
    target: 'trigger kind group_join',
    status: 'mapped',
    note: 'the list through id_map (marketing_list); unresolved: kept as soft LIST_UNRESOLVED',
  },
  {
    key: 'trigger|contact|added',
    target: 'trigger kind contact_created',
    status: 'mapped',
    note: 'Waboo "Contact Created - Any Contact Created": the same event in WaDesk (a new contact is added)',
  },
  {
    key: 'trigger|google|google_sheet_events',
    target: 'trigger kind manual_enroll (placeholder)',
    status: 'unsupported',
    note: 'no "sheet row added or updated" trigger in WaDesk',
  },
  {
    key: 'condition|contact|query',
    target: 'condition',
    status: 'mapped',
    note: 'filter_query -> rules; AND/OR; nested groups -> conditionGroup; NOT swaps yes/no; the Waboo "true" port is `yes`',
  },
  {
    key: 'condition|google|google_sheet_query',
    target: 'condition',
    status: 'approximated',
    note: 'read as a filter on contact fields (UNVERIFIED: could be sheet columns)',
  },
  {
    key: 'condition|list|query',
    target: 'in_list',
    status: 'mapped',
    note: 'the list through id_map',
  },
  {
    key: 'action|whatsapp|send',
    target: 'template',
    status: 'approximated',
    note: 'template NAME only; body variables, buttons, header are lost; sent -> next, delivered / failed detached',
  },
  {
    key: 'action|contact|update',
    target: 'update_contact (one per field)',
    status: 'mapped',
    note: 'value = the template text of the field',
  },
  {
    key: 'action|list|add',
    target: 'list_member (add)',
    status: 'mapped',
    note: 'the list through id_map',
  },
  {
    key: 'action|delay|add',
    target: 'delay',
    status: 'approximated',
    note: 'the number is read as SECONDS (86400 = 1 day), shown in the largest exact unit',
  },
  {
    key: 'action|google|save_contact_from_sheet',
    target: 'sheet_contact',
    status: 'approximated',
    note: 'sheet id, tab, column -> field map; Google account, action type, static values are lost',
  },
];
const MAP = new Map(MAPPING.map((m) => [m.key, m]));
/** Rows of automation_journey that are the runtime's own event triggers (children of a send / delay): the definition holds them as ports. */
export const EVENT_FUNCTIONS = new Set(['sent', 'delivered', 'failed', 'completed']);

export interface ListRef {
  id: number;
  uuid: string;
}
export interface ConvertInput {
  nodes: Doc;
  triggerIds: string[];
  cells: Map<string, { x: number; y: number }>;
  templates: Map<string, string>;
  list(id: string): ListRef | undefined;
}
export type ConvertOutput =
  | { ok: false; code: string; reason: string }
  | {
      ok: true;
      graph: { flowNodes: FlowNode[]; flowEdges: FlowEdge[]; vars: [] };
      soft: Soft[];
      trigger: ReturnType<typeof flbExtractTrigger>;
      groupRef: ListRef | null;
      loss: Record<string, number>;
    };

interface WNode {
  id: string;
  type: string;
  cls: string;
  fn: string;
  edges: Array<{ to: string; port: string }>;
  data: Doc;
}

const TRIG_OPS: Record<string, string> = {
  '=': 'equals',
  '!=': 'not_equals',
  contains: 'contains',
  doesNotContain: 'not_contains',
  beginsWith: 'starts_with',
  endsWith: 'ends_with',
  '>': 'greater_than',
  '<': 'less_than',
  notNull: 'is_set',
  null: 'is_not_set',
};
const COND_OPS: Record<string, string> = {
  ...TRIG_OPS,
  '>': 'gt',
  '<': 'lt',
  notNull: 'exists',
  null: 'not_exists',
};

interface Rule {
  field: string;
  operator: string;
  value: string;
  valueSource: string;
}
interface Group {
  combinator: 'and' | 'or';
  not: boolean;
  items: Array<Rule | Group>;
}
const isGroup = (x: Rule | Group): x is Group => 'items' in x;

function parseFilter(fq: unknown): Group | null {
  const o = obj(fq);
  if (!Array.isArray(o.rules)) return null;
  const items = (o.rules as unknown[]).map((r): Rule | Group | null => {
    const x = obj(r);
    if (Array.isArray(x.rules)) return parseFilter(x);
    if (!s(x.field)) return null;
    return {
      field: s(x.field),
      operator: s(x.operator),
      value: s(x.value),
      valueSource: s(x.valueSource) || 'value',
    };
  });
  return {
    combinator: s(o.combinator).toLowerCase() === 'or' ? 'or' : 'and',
    not: o.not === true,
    items: items.filter((x): x is Rule | Group => x !== null),
  };
}

/** 11:00 AM / 09:30 PM / 17:30 -> HH:MM, else null */
export function clockOf(v: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** seconds -> the largest unit that is exact */
export function delayOf(seconds: number): { amount: number; unit: 'sec' | 'min' | 'hour' | 'day' } {
  if (seconds > 0 && seconds % 86400 === 0) return { amount: seconds / 86400, unit: 'day' };
  if (seconds > 0 && seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'hour' };
  if (seconds > 0 && seconds % 60 === 0) return { amount: seconds / 60, unit: 'min' };
  return { amount: seconds, unit: 'sec' };
}

const flat = (id: string): string => id.replace(/[^A-Za-z0-9]/g, '');

export function convertAutomation(inp: ConvertInput): ConvertOutput {
  const loss: Record<string, number> = {};
  const bump = (k: string, n = 1): void => void (loss[k] = (loss[k] ?? 0) + n);

  // --- read the node map -------------------------------------------------------------------------------------------------------
  const nodes: WNode[] = [];
  for (const [id, raw] of Object.entries(inp.nodes)) {
    const n = obj(raw);
    nodes.push({
      id,
      type: s(n.type),
      cls: s(n.class),
      fn: s(n.function),
      edges: arr(n.edges)
        .map((e) => obj(e))
        .filter((e) => s(e.to) !== '')
        .map((e) => ({ to: s(e.to), port: s(e.port) })),
      data: obj(n.nodeObjectData),
    });
  }
  // an empty draft (no nodes) is converted too: it becomes a flow with the manual_enroll trigger (NO_TRIGGER), so every automation of the old workspace exists
  if (nodes.length > MAX_NODES)
    return {
      ok: false,
      code: 'GRAPH_TOO_LARGE',
      reason: `${nodes.length} nodes; the editor holds at most ${MAX_NODES}`,
    };

  // --- ids and positions -------------------------------------------------------------------------------------------------------
  const used = new Set<string>();
  const fid = new Map<string, string>();
  for (const n of nodes) {
    let id = `n_${flat(n.id).slice(0, 12)}`;
    if (id === 'n_' || used.has(id)) id = `n_${flat(n.id)}`;
    for (let i = 2; used.has(id) || id === 'n_'; i++) id = `n_${flat(n.id) || 'x'}_${i}`;
    used.add(id);
    fid.set(n.id, id);
  }
  let layoutMissing = 0;
  const pos = (n: WNode, i: number): { x: number; y: number } => {
    const c = inp.cells.get(n.id);
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
    layoutMissing++;
    return { x: 120 + (i % 3) * 260, y: 120 + Math.floor(i / 3) * 180 };
  };

  // --- the primary trigger ------------------------------------------------------------------------------------------------------
  const triggers = nodes.filter((n) => n.type === 'trigger');
  const order = [
    ...inp.triggerIds.map((t) => triggers.find((n) => n.id === t)).filter((n): n is WNode => !!n),
    ...triggers,
  ];
  const primary = order[0] ?? null;

  const flowNodes: FlowNode[] = [];
  const flowEdges: FlowEdge[] = [];
  const addNode = (
    id: string,
    type: string,
    x: number,
    y: number,
    over: Doc,
    waboo: Doc,
  ): FlowNode => {
    const node: FlowNode = {
      id,
      type,
      x,
      y,
      data: { ...flbDefaultNodeData(type), ...over, _waboo: waboo },
    };
    flowNodes.push(node);
    return node;
  };
  const link = (source: string, handle: string, target: string): void =>
    void flowEdges.push({ id: '', source, sourceHandle: handle, target });

  interface Built {
    entry: string;
    /** where an edge leaving the Waboo node on `port` starts */
    from(port: string): { source: string; handle: string };
  }
  const built = new Map<string, Built>();
  const outOf = (id: string) => (): { source: string; handle: string } => ({
    source: id,
    handle: 'out',
  });

  const placeholder = (
    n: WNode,
    i: number,
    as: 'trigger' | 'action' | 'condition' | 'extra_trigger',
  ): Built => {
    const id = fid.get(n.id)!;
    const p = pos(n, i);
    const cfg = scrub(n.data);
    let config: unknown = cfg.value;
    if (cfg.redacted.length) bump('secretsScrubbed', cfg.redacted.length);
    if (JSON.stringify(config).length > CONFIG_CAP) {
      config = { truncated: true, keys: Object.keys(n.data).slice(0, 50) };
      bump('configTruncated');
    }
    const waboo = {
      id: n.id,
      type: n.type,
      class: n.cls,
      function: n.fn,
      placeholder: true,
      role: as,
      config,
    };
    bump('placeholderNodes');
    if (as === 'trigger') {
      addNode(id, 'trigger', p.x, p.y, { kind: 'manual_enroll' }, waboo);
      return { entry: id, from: outOf(id) };
    }
    if (as === 'condition') {
      addNode(id, 'condition', p.x, p.y, { conditions: [], operators: [] }, waboo);
      return { entry: id, from: () => ({ source: id, handle: 'no' }) };
    }
    addNode(id, 'update_contact', p.x, p.y, { field: '', value: '' }, waboo);
    return { entry: id, from: outOf(id) };
  };

  const condData = (g: Group): { data: Doc; swap: boolean } => {
    const nested = g.items.some(isGroup);
    const rule = (r: Rule): Doc => {
      const op = COND_OPS[r.operator];
      if (!op) bump('operatorsUnsupported');
      if (r.valueSource !== 'value') bump('operatorsUnsupported');
      return { variable: r.field, operator: op ?? r.operator, value: r.value };
    };
    if (g.items.some((x) => isGroup(x) && x.not)) bump('nestedNotDropped');
    if (!nested) {
      return {
        data: {
          conditions: g.items.map((x) => rule(x as Rule)),
          operators: g.items.slice(1).map(() => (g.combinator === 'or' ? 'OR' : 'AND')),
        },
        swap: g.not,
      };
    }
    const tree = (x: Group): Doc => ({
      op: x.combinator,
      items: x.items.map((i) => (isGroup(i) ? tree(i) : rule(i))),
    });
    return { data: { conditions: [], operators: [], conditionGroup: tree(g) }, swap: g.not };
  };

  nodes.forEach((n, i) => {
    const id = fid.get(n.id)!;
    const p = pos(n, i);
    const row = MAP.get(`${n.type}|${n.cls}|${n.fn}`);
    const waboo = { id: n.id, class: n.cls, function: n.fn };
    const key = `${n.type}|${n.cls}|${n.fn}`;
    if (n.type === 'trigger' && n !== primary) {
      bump('extraTriggers');
      built.set(n.id, placeholder(n, i, 'extra_trigger'));
      return;
    }
    if (!row || row.status === 'unsupported') {
      built.set(
        n.id,
        placeholder(
          n,
          i,
          n.type === 'trigger' ? 'trigger' : n.type === 'condition' ? 'condition' : 'action',
        ),
      );
      return;
    }
    if (row.status === 'approximated') bump('approximatedNodes');
    const fq = parseFilter(n.data.filter_query);
    if (fq && s(n.data.mongodb_query)) bump('mongoQueryDropped');
    switch (key) {
      case 'trigger|contact|field_match': {
        const one =
          fq && fq.items.length === 1 && !fq.not && !isGroup(fq.items[0]!)
            ? (fq.items[0] as Rule)
            : null;
        if (one && TRIG_OPS[one.operator] && one.valueSource === 'value') {
          addNode(
            id,
            'trigger',
            p.x,
            p.y,
            {
              kind: 'field_match',
              field: one.field,
              operator: TRIG_OPS[one.operator],
              value: one.value,
            },
            waboo,
          );
          built.set(n.id, { entry: id, from: outOf(id) });
        } else {
          // the whole query lives in a Condition behind a trigger nobody can fire by itself
          bump('triggerNotArmable');
          bump('approximatedNodes');
          const cid = `${id}_c`;
          addNode(
            id,
            'trigger',
            p.x,
            p.y,
            { kind: 'manual_enroll' },
            { ...waboo, role: 'split_trigger' },
          );
          const cd = fq ? condData(fq) : { data: { conditions: [], operators: [] }, swap: false };
          if (!fq) bump('filterMissing');
          addNode(cid, 'condition', p.x + 300, p.y, cd.data, { ...waboo, role: 'split_condition' });
          link(id, 'out', cid);
          built.set(n.id, {
            entry: id,
            from: () => ({ source: cid, handle: cd.swap ? 'no' : 'yes' }),
          });
        }
        return;
      }
      case 'trigger|Datematch|date_match': {
        const dir = s(n.data.date_of_execution).toLowerCase();
        const direction = dir === 'before' || dir === 'after' ? dir : 'on';
        const off = Math.trunc(Number(n.data.execution_offset));
        const time = clockOf(s(n.data.execution_time));
        bump('dateAssumed');
        if (!time) bump('dateTimeUnreadable');
        addNode(
          id,
          'trigger',
          p.x,
          p.y,
          {
            kind: 'date_field_match',
            field: s(n.data.field_name),
            direction,
            days: Number.isFinite(off) && off >= 0 ? off : 0,
            time: time ?? '09:00',
            yearly: s(n.data.execution_cycle).toLowerCase() === 'yearly',
          },
          waboo,
        );
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      case 'trigger|contact|added': {
        addNode(id, 'trigger', p.x, p.y, { kind: 'contact_created' }, waboo);
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      case 'trigger|contact|added_to_list': {
        const ref = inp.list(s(n.data.marketing_list_id));
        if (!ref) bump('listUnresolved');
        addNode(id, 'trigger', p.x, p.y, { kind: 'group_join', groupId: ref?.uuid ?? '' }, waboo);
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      case 'condition|contact|query':
      case 'condition|google|google_sheet_query': {
        if (!fq) bump('filterMissing');
        const cd = fq ? condData(fq) : { data: { conditions: [], operators: [] }, swap: false };
        addNode(id, 'condition', p.x, p.y, cd.data, waboo);
        built.set(n.id, {
          entry: id,
          from: (port) => {
            if (port !== 'true') bump('unknownPorts');
            return { source: id, handle: cd.swap ? 'no' : 'yes' };
          },
        });
        return;
      }
      case 'condition|list|query': {
        const ref = inp.list(s(n.data.marketingListId));
        if (!ref) bump('listUnresolved');
        addNode(id, 'in_list', p.x, p.y, { list: '', listId: ref?.uuid ?? '' }, waboo);
        built.set(n.id, {
          entry: id,
          from: (port) => {
            if (port !== 'true') bump('unknownPorts');
            return { source: id, handle: 'yes' };
          },
        });
        return;
      }
      case 'action|whatsapp|send': {
        const tid = s(n.data.whatsappTemplateId) || s(n.data.broadcast_template_id);
        const name =
          inp.templates.get(tid) ?? inp.templates.get(s(n.data.broadcast_template_id)) ?? '';
        if (!name) bump('templatesUnnamed');
        const comp = obj(n.data.components);
        bump('templateVariables', arr(obj(comp.body).value).length + (comp.header ? 1 : 0));
        bump('templateButtons', arr(obj(comp.button).value).length);
        addNode(id, 'template', p.x, p.y, { tpl: name }, waboo);
        const dead = new Map<string, string>();
        built.set(n.id, {
          entry: id,
          from: (port) => {
            if (port === 'delivered' || port === 'failed') {
              let d = dead.get(port);
              if (!d) {
                d = `${id}_x${port === 'failed' ? 'f' : 'd'}`;
                dead.set(port, d);
                bump('placeholderNodes', 0);
                addNode(
                  d,
                  'update_contact',
                  p.x + 300,
                  p.y + (port === 'failed' ? 120 : 60),
                  { field: '', value: '' },
                  { ...waboo, placeholder: true, role: `detached_${port}` },
                );
                bump('detachedNodes');
              }
              bump('detachedEvents');
              return { source: d, handle: 'out' };
            }
            if (port !== 'sent') bump('unknownPorts');
            return { source: id, handle: 'out' };
          },
        });
        return;
      }
      case 'action|contact|update': {
        const entries = arr(n.data.fields).flatMap((f) =>
          Object.entries(obj(f)).map(([field, v]) => ({ field, value: s(obj(v).template) })),
        );
        const list = entries.length ? entries : [{ field: '', value: '' }];
        if (!entries.length) bump('filterMissing');
        let prev = '';
        list.forEach((e, k) => {
          const nid = k === 0 ? id : `${id}_${k}`;
          addNode(
            nid,
            'update_contact',
            p.x + 300 * k,
            p.y,
            e,
            k === 0 ? waboo : { ...waboo, role: 'chain' },
          );
          if (prev) link(prev, 'out', nid);
          prev = nid;
        });
        built.set(n.id, { entry: id, from: outOf(prev) });
        return;
      }
      case 'action|list|add': {
        const ref = inp.list(s(n.data.marketing_list_id));
        if (!ref) bump('listUnresolved');
        addNode(
          id,
          'list_member',
          p.x,
          p.y,
          { action: 'add', list: '', listId: ref?.uuid ?? '' },
          waboo,
        );
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      case 'action|delay|add': {
        const secs = Math.trunc(Number(n.data.delay));
        bump('delayAssumed');
        if (!Number.isFinite(secs) || secs < 0) bump('delayUnreadable');
        addNode(
          id,
          'delay',
          p.x,
          p.y,
          delayOf(Number.isFinite(secs) && secs >= 0 ? secs : 60),
          waboo,
        );
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      case 'action|google|save_contact_from_sheet': {
        const lv = obj(n.data.localValues);
        const sheet = obj(n.data.googleSheet);
        const pc = obj(obj(lv.primaryContact).column);
        const map = arr(n.data.mappings)
          .map((m) => obj(m))
          .map((m) => ({ column: s(m.columnLabel) || s(m.column), field: s(m.contactField) }))
          .filter((m) => m.column && m.field);
        bump('sheetDetailsLost');
        addNode(
          id,
          'sheet_contact',
          p.x,
          p.y,
          {
            sheetId: s(sheet.id),
            tabName: s(n.data.googleSheetName) || s(lv.googleSheetName),
            matchColumn: s(pc.label) || s(pc.id),
            matchValue: '{{phone}}',
            map: map.length ? map : [{ column: '', field: 'name' }],
          },
          waboo,
        );
        built.set(n.id, { entry: id, from: outOf(id) });
        return;
      }
      default:
        built.set(n.id, placeholder(n, i, 'action'));
    }
  });

  // --- a trigger there must be ---------------------------------------------------------------------------------------------------
  let rootless = 0;
  if (!primary) {
    bump('noTrigger');
    const tid = 'n_trigger0000';
    const into = new Set(nodes.flatMap((n) => n.edges.map((e) => e.to)));
    const root = nodes.find((n) => !into.has(n.id));
    flowNodes.unshift({
      id: tid,
      type: 'trigger',
      x: 20,
      y: 20,
      data: {
        ...flbDefaultNodeData('trigger'),
        kind: 'manual_enroll',
        _waboo: { synthetic: true, role: 'no_trigger' },
      },
    });
    if (root) link(tid, 'out', built.get(root.id)!.entry);
    else rootless = 1;
  }

  // --- the edges -----------------------------------------------------------------------------------------------------------------
  for (const n of nodes) {
    const b = built.get(n.id)!;
    const seen = new Map<string, number>();
    const linked = new Set<string>();
    for (const e of n.edges) {
      const target = built.get(e.to);
      if (!target) {
        bump('danglingEdges');
        continue;
      }
      const f = b.from(e.port);
      // Several Waboo ports can leave by the same graph port (a trigger has one `out`): a link to the same step twice is one link.
      const same = `${f.source}\u0000${f.handle}\u0000${target.entry}`;
      if (linked.has(same)) continue; // the same link again: nothing is lost by keeping one
      linked.add(same);
      const k = `${f.source}\u0000${f.handle}`;
      const c = (seen.get(k) ?? 0) + 1;
      seen.set(k, c);
      if (c > 1) bump('fanOutExtra');
      link(f.source, f.handle, target.entry);
    }
  }
  if (flowEdges.length > MAX_EDGES)
    return {
      ok: false,
      code: 'GRAPH_TOO_LARGE',
      reason: `${flowEdges.length} links; the editor holds at most ${MAX_EDGES}`,
    };
  flowEdges.forEach((e, i) => (e.id = `e_${i + 1}`));

  // the start anchor
  const start = flowNodes.find((n) => n.type === 'trigger')!;
  for (const n of flowNodes) n.isStart = n === start;
  if (layoutMissing) bump('layoutMissing', layoutMissing);

  // a cycle (the runtime has no loop guard here: reported)
  {
    const out = new Map<string, string[]>();
    for (const e of flowEdges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    const state = new Map<string, number>();
    let back = 0;
    for (const root of flowNodes.map((x) => x.id)) {
      if (state.has(root)) continue;
      const stack: Array<[string, number]> = [[root, 0]];
      state.set(root, 1);
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        const next = (out.get(top[0]) ?? [])[top[1]++];
        if (next === undefined) {
          state.set(top[0], 2);
          stack.pop();
        } else if (state.get(next) === 1) back++;
        else if (!state.has(next)) {
          state.set(next, 1);
          stack.push([next, 0]);
        }
      }
    }
    if (back) bump('cycles', back);
  }

  // --- secrets never reach the target ---------------------------------------------------------------------------------------------
  let graph = { flowNodes, flowEdges, vars: [] as [] };
  const sc = scrub(graph);
  if (sc.redacted.length > 0) {
    graph = sc.value as typeof graph;
    bump('secretsScrubbed', sc.redacted.length);
  }
  void rootless;

  const trigger = flbExtractTrigger(graph);
  const groupId = trigger.valueKind === 'group' ? trigger.valueRef : null;
  let groupRef: ListRef | null = null;
  if (groupId) {
    for (const n of nodes) {
      const r =
        n.cls === 'contact' && n.fn === 'added_to_list'
          ? inp.list(s(n.data.marketing_list_id))
          : undefined;
      if (r && r.uuid === groupId) groupRef = r;
    }
  }

  // --- the soft issues (one per code, with the count) ------------------------------------------------------------------------------
  const L = (k: string): number => loss[k] ?? 0;
  const soft: Soft[] = [];
  const add = (code: string, reason: string, n: number): void => {
    if (n > 0) soft.push({ code, reason, detail: n });
  };
  add(
    'PLACEHOLDER_NODES',
    'a node type WaDesk has no equivalent for became an inert placeholder that keeps its type and scrubbed configuration in data._waboo; it does nothing',
    L('placeholderNodes'),
  );
  add(
    'APPROXIMATED_NODES',
    'the node exists in WaDesk but not every setting (see the mapping table); check it before publishing',
    L('approximatedNodes'),
  );
  add(
    'EVENT_BRANCH_DETACHED',
    'WaDesk has no "message delivered / failed" event: the nodes after those ports hang behind an inert node and never run',
    L('detachedEvents'),
  );
  add(
    'FAN_OUT_FIRST_ONLY',
    'the runtime follows only the first link of an output port; the other links are kept but never followed',
    L('fanOutExtra'),
  );
  add(
    'DANGLING_EDGES_DROPPED',
    'a link to a node that is not in the automation was dropped',
    L('danglingEdges'),
  );
  add(
    'UNKNOWN_PORT',
    'an output port the converter does not know was mapped to the default output',
    L('unknownPorts'),
  );
  add(
    'TEMPLATE_VARIABLES_LOST',
    'template body / header variables are lost (WaDesk fills them from the template variable map)',
    L('templateVariables'),
  );
  add('TEMPLATE_BUTTONS_LOST', 'template button parameters are lost', L('templateButtons'));
  add(
    'TEMPLATE_UNRESOLVED',
    'templates are not migrated: a step carries the template NAME where the dump gives one, empty otherwise',
    L('templatesUnnamed'),
  );
  add(
    'LIST_UNRESOLVED',
    'the list is not in id_map (load the groups step first): the step has no list',
    L('listUnresolved'),
  );
  add(
    'OPERATOR_UNSUPPORTED',
    'a rule uses an operator or a value source the Condition node has no name for; it never matches',
    L('operatorsUnsupported'),
  );
  add(
    'NESTED_NOT_DROPPED',
    'a NOT on a nested rule group is not supported and was dropped',
    L('nestedNotDropped'),
  );
  add(
    'FILTER_MISSING',
    'the node has no readable filter / field list; it is empty and does nothing',
    L('filterMissing'),
  );
  add(
    'MONGO_QUERY_DROPPED',
    'mongodb_query is the machine copy of filter_query and was not kept',
    L('mongoQueryDropped'),
  );
  add(
    'TRIGGER_NOT_ARMABLE',
    'the trigger query cannot be a field-match trigger: a manual_enroll trigger plus a Condition holds it',
    L('triggerNotArmable'),
  );
  add(
    'EXTRA_TRIGGER',
    'WaDesk has one trigger per flow: the other triggers became inert placeholders no run can reach',
    L('extraTriggers'),
  );
  add(
    'NO_TRIGGER',
    'the automation has no trigger node: a manual_enroll trigger was added',
    L('noTrigger'),
  );
  add(
    'DATE_SEMANTICS_ASSUMED',
    'offset = days, cycle once = not yearly, time as written (UNVERIFIED)',
    L('dateAssumed'),
  );
  add('DELAY_UNIT_ASSUMED', 'the delay number is read as seconds (UNVERIFIED)', L('delayAssumed'));
  add(
    'SHEET_DETAILS_LOST',
    'Google account, action type and static values of the sheet step are lost',
    L('sheetDetailsLost'),
  );
  add(
    'LAYOUT_MISSING',
    'no position in the UI layout for some nodes: placed on a grid',
    L('layoutMissing'),
  );
  add(
    'CONFIG_TRUNCATED',
    'a placeholder configuration was too large and only its key names were kept',
    L('configTruncated'),
  );
  add(
    'SECRET_SCRUBBED',
    'credential-looking entries were removed from the graph (key paths only are logged by the shared scrub)',
    L('secretsScrubbed'),
  );
  add('CYCLE_PRESENT', 'the graph has a cycle (back links counted)', L('cycles'));
  const lossy = Object.entries(loss).filter(([, v]) => v > 0);
  if (lossy.length > 0)
    soft.push({
      code: 'CONVERSION_LOSS',
      reason:
        'what the conversion lost or approximated, per kind (counts); the raw dump is the archive',
      detail: Object.fromEntries(lossy.sort(([a], [b]) => (a < b ? -1 : 1))),
    });
  return { ok: true, graph, soft, trigger, groupRef, loss };
}
