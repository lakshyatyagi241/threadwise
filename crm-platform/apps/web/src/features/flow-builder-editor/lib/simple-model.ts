import {
  flbCleanAskInputType,
  flbDefaultNodeData,
  flbNewNodeId,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowVar,
} from '@crm/contracts';
import { askInputLabelMsg, nodeLabelMsg } from './contract-text';
import { dedupeMsgs, msg, renderMsg, type Msg, type Translate } from './msg';

/**
 * The Simple flow builder's view of a flow. A flow is saved as the same graph the Advanced canvas edits; Simple only shows
 * it as steps one under another, grouped in "journeys" (a journey is a chain of steps). Nothing here is stored: `toSimple`
 * reads a graph, `toGraph` writes one back, and the two round-trip.
 *
 * A step continues into the next step of its journey (the `out` port). A buttons or list step is the end of its journey:
 * each button or row instead links to a step (of any journey) or ends the conversation (the `p<i>` ports). The first
 * journey is the one the trigger starts.
 */

export const SIMPLE_TYPES = [
  'message',
  'media',
  'buttons',
  'list',
  'ask',
  'ask_file',
  'ask_location',
  'delay',
  'location',
  'template',
  'cta',
  'assign',
] as const;
export type SimpleType = (typeof SIMPLE_TYPES)[number];

/** The steps that end their journey: what happens next depends on what the customer taps. */
export const BRANCHING: ReadonlySet<string> = new Set(['buttons', 'list']);

export const LIMITS = {
  buttons: 3,
  buttonLabel: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  listButton: 20,
  body: 1024,
} as const;

export interface SimpleStep {
  /** The graph node id, kept so a saved flow keeps its identity. */
  id: string;
  type: SimpleType;
  data: Record<string, unknown>;
  /** For buttons and list steps: the step each button / row leads to (a step id), `null` = the conversation ends there. */
  links: (string | null)[];
  /**
   * For the last step of a part that is not buttons or a list: the step it carries on with, anywhere in the flow (a "node to node"
   * connection of the console). `null` / missing: it just ends there.
   */
  goto?: string | null;
}

export interface SimpleJourney {
  name: string;
  steps: SimpleStep[];
}

export interface SimpleDoc {
  trigger: FlowNode;
  /** `journeys[0]` is the one the trigger starts (it may have no steps yet). */
  journeys: SimpleJourney[];
  vars: FlowVar[];
}

export type ToSimple = { ok: true; doc: SimpleDoc } | { ok: false; reasons: Msg[] };

const isSimpleType = (t: string): t is SimpleType =>
  (SIMPLE_TYPES as readonly string[]).includes(t);
const str = (v: unknown): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const optionCount = (s: Pick<SimpleStep, 'type' | 'data'>): number =>
  BRANCHING.has(s.type) ? arr(s.data.options).length : 0;

export const MAIN_NAME = 'Main flow';

/** Where a step sits in the stack, written like the console does: journey number, dot, step number (`2.3`). */
export const stageLabel = (journeyIndex: number, stepIndex: number): string =>
  `${journeyIndex + 1}.${stepIndex + 1}`;

/**
 * What the list of flows shows. A flow, as the console's bot builder lists it, can hold steps that no chain of `out` wires
 * connects (the steps after a buttons or list step are only reached through a button). Those are separate chains here, so the
 * chains that share one name are one entry in the list: `chains` are their journey indexes, the first being where the entry starts.
 */
export interface SimpleGroup {
  key: string;
  /** The flow's name; a flow with no name is "Flow 3" (what a copy of it is named after). */
  name: string;
  /** Set when `name` is only a stand-in ("Main flow", "Flow 3"): what the list shows instead of it, in the viewer's language. */
  placeholder: Msg | null;
  chains: number[];
  steps: number;
}

const groupCache = new WeakMap<SimpleDoc, SimpleGroup[]>();

export function groupsOf(doc: SimpleDoc): SimpleGroup[] {
  const hit = groupCache.get(doc);
  if (hit) return hit;
  const groups: SimpleGroup[] = [];
  const byKey = new Map<string, SimpleGroup>();
  doc.journeys.forEach((j, i) => {
    const name = i === 0 ? j.name.trim() || MAIN_NAME : j.name.trim();
    const key = name ? name.toLowerCase() : `#${i}`;
    let g = byKey.get(key);
    if (!g) {
      const placeholder =
        name === MAIN_NAME && i === 0
          ? msg('simpleModel.mainFlow')
          : name
            ? null
            : msg('simpleModel.flowN', { n: groups.length + 1 });
      g = {
        key,
        name: name || `Flow ${groups.length + 1}`,
        placeholder,
        chains: [],
        steps: 0,
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.chains.push(i);
    g.steps += j.steps.length;
  });
  groupCache.set(doc, groups);
  return groups;
}

/** The entry of the list a chain belongs to. */
/** What the list shows for an entry: its name, or the stand-in text of one that has none. */
export const groupText = (g: SimpleGroup, t: Translate): string =>
  g.placeholder ? renderMsg(t, g.placeholder) : g.name;

export const groupIndexOf = (doc: SimpleDoc, journeyIndex: number): number =>
  Math.max(
    0,
    groupsOf(doc).findIndex((g) => g.chains.includes(journeyIndex)),
  );

/** `2.3`: the flow's number in the list, a dot, and the step's place in that flow (all its chains, in order). */
export function stageIn(doc: SimpleDoc, journeyIndex: number, stepIndex: number): string {
  const groups = groupsOf(doc);
  const gi = groupIndexOf(doc, journeyIndex);
  let before = 0;
  for (const c of groups[gi]!.chains) {
    if (c === journeyIndex) break;
    before += doc.journeys[c]!.steps.length;
  }
  return `${gi + 1}.${before + stepIndex + 1}`;
}

// --- graph -> simple ------------------------------------------------------------------------------------------------------

export function toSimple(graph: Pick<FlowGraph, 'flowNodes' | 'flowEdges' | 'vars'>): ToSimple {
  const reasons: Msg[] = [];
  const nodes = new Map(graph.flowNodes.map((n) => [n.id, n]));
  const triggers = graph.flowNodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) reasons.push(msg('simpleModel.reasons.oneTrigger'));
  for (const n of graph.flowNodes) {
    if (n.type !== 'trigger' && !isSimpleType(n.type))
      reasons.push(msg('simpleModel.reasons.unsupportedStep', { node: nodeLabelMsg(n.type) }));
  }
  for (const n of graph.flowNodes) {
    if (n.type === 'ask' && (arr(n.data.options).length > 0 || n.data.acceptMedia === true))
      reasons.push(msg('simpleModel.reasons.askFixed'));
  }
  const trigger = triggers[0];
  if (!trigger || reasons.length) return { ok: false, reasons: dedupe(reasons) };

  // Edges, split into "continues to" (one per step) and "this button / row leads to".
  const next = new Map<string, string>();
  const option = new Map<string, string[]>();
  /** The steps (not the Trigger) whose `out` wire reaches each step. */
  const feeders = new Map<string, string[]>();
  for (const e of graph.flowEdges) {
    const src = nodes.get(e.source);
    const dst = nodes.get(e.target);
    if (!src || !dst) continue;
    if (dst.type === 'trigger') {
      reasons.push(msg('simpleModel.reasons.intoTrigger'));
      continue;
    }
    const branching = BRANCHING.has(src.type);
    const m = /^p(\d+)$/.exec(e.sourceHandle);
    if (branching && m) {
      const i = Number(m[1]);
      const list = option.get(src.id) ?? [];
      if (list[i] !== undefined) reasons.push(msg('simpleModel.reasons.multiLink'));
      list[i] = dst.id;
      option.set(src.id, list);
    } else if (!branching && e.sourceHandle === 'out') {
      if (next.has(src.id)) reasons.push(msg('simpleModel.reasons.multiNext'));
      next.set(src.id, dst.id);
      if (src.type !== 'trigger') feeders.set(dst.id, [...(feeders.get(dst.id) ?? []), src.id]);
    } else {
      reasons.push(msg('simpleModel.reasons.badPort', { node: nodeLabelMsg(src.type) }));
    }
  }
  if (reasons.length) return { ok: false, reasons: dedupe(reasons) };

  // Journeys: the trigger's chain first, then every other chain by where its first step sits on the canvas. A step continues its
  // chain only when it is reached by that one wire and does not start a named flow; any other `out` wire is a "carry on at" jump.
  const mainHead = next.get(trigger.id);
  const continues = (id: string): boolean =>
    id !== mainHead &&
    nodes.get(id)!.data.journeyName === undefined &&
    (feeders.get(id)?.length ?? 0) === 1;
  const others = graph.flowNodes
    .filter((n) => n.type !== 'trigger' && n.id !== mainHead && !continues(n.id))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const seen = new Set<string>();
  const chain = (headId: string): SimpleStep[] => {
    const steps: SimpleStep[] = [];
    let cur: string | undefined = headId;
    while (cur) {
      seen.add(cur);
      const n = nodes.get(cur)!;
      const links: (string | null)[] = [];
      if (BRANCHING.has(n.type)) {
        const wired = option.get(n.id) ?? [];
        for (let i = 0; i < optionCount({ type: n.type as SimpleType, data: n.data }); i++)
          links.push(wired[i] ?? null);
      }
      const step: SimpleStep = { id: n.id, type: n.type as SimpleType, data: { ...n.data }, links };
      steps.push(step);
      const nx = next.get(cur);
      if (!nx) break;
      if (continues(nx) && !seen.has(nx)) cur = nx;
      else {
        step.goto = nx;
        break;
      }
    }
    return steps;
  };

  const journeys: SimpleJourney[] = [];
  const main = mainHead ? chain(mainHead) : [];
  journeys.push({ name: str(trigger.data.journeyName).trim() || MAIN_NAME, steps: main });
  for (const h of others) {
    if (seen.has(h.id)) continue;
    journeys.push({ name: str(h.data.journeyName), steps: chain(h.id) });
  }
  // Steps that only wire into each other in a ring have no first step: the left-most of them starts one.
  for (;;) {
    const rest = graph.flowNodes
      .filter((n) => n.type !== 'trigger' && !seen.has(n.id))
      .sort((a, b) => a.x - b.x || a.y - b.y)[0];
    if (!rest) break;
    journeys.push({ name: str(rest.data.journeyName), steps: chain(rest.id) });
  }

  // A button that leads to a step has to lead to one that exists in a journey (it always does for a valid graph).
  const ids = new Set(journeys.flatMap((j) => j.steps.map((s) => s.id)));
  for (const j of journeys)
    for (const s of j.steps) {
      s.links = s.links.map((l) => (l && ids.has(l) ? l : null));
      if (s.goto && !ids.has(s.goto)) delete s.goto;
    }

  return {
    ok: true,
    doc: { trigger: { ...trigger, data: { ...trigger.data } }, journeys, vars: graph.vars },
  };
}

const dedupe = dedupeMsgs;

// --- simple -> graph ------------------------------------------------------------------------------------------------------

const COL = 340;
const ROW = 190;

export function toGraph(doc: SimpleDoc): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const edge = (source: string, sourceHandle: string, target: string) =>
    edges.push({ id: `e_${source}_${sourceHandle}`, source, sourceHandle, target });

  // The main flow's name rides on the trigger (the graph has no place for it); the default name is not stored.
  const trigger: FlowNode = { ...doc.trigger, data: { ...doc.trigger.data } };
  const mainName = doc.journeys[0]?.name.trim() ?? '';
  if (mainName && mainName !== MAIN_NAME) trigger.data.journeyName = mainName;
  else delete trigger.data.journeyName;
  nodes.push({ ...trigger, x: 80, y: 60, isStart: true });
  const known = new Set(doc.journeys.flatMap((j) => j.steps.map((s) => s.id)));

  doc.journeys.forEach((j, ji) => {
    j.steps.forEach((s, si) => {
      const data = { ...s.data };
      // The journey's name rides on its first step (the graph has no place for it); the main flow's is fixed.
      if (si === 0 && ji > 0) data.journeyName = j.name.trim();
      else delete data.journeyName;
      nodes.push({
        id: s.id,
        type: s.type,
        x: 80 + ji * COL,
        y: 60 + (ji === 0 ? si + 1 : si) * ROW,
        data,
      });
      if (si === 0 && ji === 0) edge(doc.trigger.id, 'out', s.id);
      const nextStep = j.steps[si + 1];
      if (!BRANCHING.has(s.type) && nextStep) edge(s.id, 'out', nextStep.id);
      else if (!BRANCHING.has(s.type) && s.goto && known.has(s.goto)) edge(s.id, 'out', s.goto);
      if (BRANCHING.has(s.type)) {
        s.links.forEach((target, i) => {
          if (target && known.has(target)) edge(s.id, `p${i}`, target);
        });
      }
    });
  });

  const names = new Set(doc.vars.map((v) => v.name));
  const vars = [...doc.vars];
  for (const j of doc.journeys)
    for (const s of j.steps) {
      const v = str(s.data.var);
      if (v && !names.has(v)) {
        names.add(v);
        vars.push({ name: v });
      }
    }
  return { flowNodes: nodes, flowEdges: edges, vars };
}

// --- a new, empty flow ----------------------------------------------------------------------------------------------------

export function emptyDoc(): SimpleDoc {
  const trigger: FlowNode = {
    id: flbNewNodeId(),
    type: 'trigger',
    x: 80,
    y: 60,
    isStart: true,
    data: { ...flbDefaultNodeData('trigger'), keywords: '' },
  };
  return { trigger, journeys: [{ name: MAIN_NAME, steps: [] }], vars: [] };
}

// --- editing --------------------------------------------------------------------------------------------------------------

/** The entries of the "+" menu. Questions are separate entries, as the console lists its input nodes. */
export interface StepKind {
  key: string;
  type: SimpleType;
  /** For a question: what it validates the answer as. */
  preset?: string;
  label: Msg;
  help: Msg;
  group: 'send' | 'ask' | 'handoff';
}

const kind = (
  key: string,
  type: SimpleType,
  group: StepKind['group'],
  preset?: string,
): StepKind => {
  const id = key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return {
    key,
    type,
    ...(preset ? { preset } : {}),
    label: msg(`simpleModel.kinds.${id}.label`),
    help: msg(`simpleModel.kinds.${id}.help`),
    group,
  };
};

export const STEP_KINDS: readonly StepKind[] = [
  kind('assign', 'assign', 'handoff'),
  kind('message', 'message', 'send'),
  kind('media', 'media', 'send'),
  kind('buttons', 'buttons', 'send'),
  kind('list', 'list', 'send'),
  kind('cta', 'cta', 'send'),
  kind('template', 'template', 'send'),
  kind('location', 'location', 'send'),
  kind('delay', 'delay', 'send'),
  kind('ask', 'ask', 'ask', 'text'),
  kind('ask-name', 'ask', 'ask', 'name'),
  kind('ask-email', 'ask', 'ask', 'email'),
  kind('ask-phone', 'ask', 'ask', 'phone'),
  kind('ask-number', 'ask', 'ask', 'number'),
  kind('ask-alphanumeric', 'ask', 'ask', 'alphanumeric'),
  kind('ask-date', 'ask', 'ask', 'date'),
  kind('ask-file', 'ask_file', 'ask'),
  kind('ask-location', 'ask_location', 'ask'),
];

const PRESET_VAR: Record<string, string> = {
  text: 'answer',
  name: 'name',
  email: 'email',
  phone: 'phone',
  number: 'number',
  alphanumeric: 'code',
  date: 'date',
};

/** A step's name on its card: a question shows what it checks (`Email`), the others their type. */
export function stepLabel(s: Pick<SimpleStep, 'type' | 'data'>): Msg {
  if (s.type === 'ask') {
    const v = flbCleanAskInputType(s.data.validate);
    return v === 'text'
      ? TYPE_LABEL.ask
      : msg('simpleModel.stepLabel.questionOf', { kind: askInputLabelMsg(v) });
  }
  return TYPE_LABEL[s.type];
}

export function newStep(
  type: SimpleType,
  existing: readonly SimpleStep[],
  preset?: string,
): SimpleStep {
  const data: Record<string, unknown> = { ...flbDefaultNodeData(type) };
  const taken = new Set(existing.map((s) => str(s.data.var)).filter(Boolean));
  const fresh = (base: string) => {
    let n = 1;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  };
  if (type === 'ask') {
    const v = flbCleanAskInputType(preset);
    data.validate = v;
    data.var = fresh(PRESET_VAR[v] ?? 'answer');
    data.prompt = '';
  }
  if (type === 'ask_file' || type === 'ask_location')
    data.var = fresh(type === 'ask_file' ? 'file' : 'location');
  if (type === 'buttons') {
    data.var = fresh('choice');
    data.prompt = '';
    data.options = ['Option 1'];
  }
  if (type === 'list') {
    data.var = fresh('choice');
    data.prompt = '';
    data.button = 'View options';
    data.options = [{ title: 'Item 1', description: '', section: '' }];
  }
  if (type === 'message') data.text = '';
  if (type === 'location') Object.assign(data, { lat: '', lng: '', title: '', address: '' });
  if (type === 'cta') data.actions = [{ type: 'url', label: 'Visit website', value: '' }];
  const links = BRANCHING.has(type) ? [null] : [];
  return { id: flbNewNodeId(), type, data, links };
}

export const allSteps = (doc: SimpleDoc): SimpleStep[] => doc.journeys.flatMap((j) => j.steps);

const mapJourney = (
  doc: SimpleDoc,
  ji: number,
  f: (j: SimpleJourney) => SimpleJourney,
): SimpleDoc => ({
  ...doc,
  journeys: doc.journeys.map((j, i) => (i === ji ? f(j) : j)),
});

/** Insert a step into a journey at `at` (a step may not follow a buttons or list step: they end the journey). */
export function insertStep(doc: SimpleDoc, ji: number, at: number, step: SimpleStep): SimpleDoc {
  const j = doc.journeys[ji];
  if (!j) return doc;
  const prev = j.steps[at - 1];
  if (prev && BRANCHING.has(prev.type)) return doc;
  // A branching step inserted before others would cut them off from the journey: it has to be the last one.
  if (BRANCHING.has(step.type) && at < j.steps.length) return doc;
  return mapJourney(doc, ji, (jj) => {
    const steps = [...jj.steps.slice(0, at), step, ...jj.steps.slice(at)];
    // The jump ("carry on at") belongs to the last step: a step added at the end takes it over.
    if (at === jj.steps.length && prev?.goto && !BRANCHING.has(step.type)) {
      return {
        ...jj,
        steps: steps.map((x) =>
          x.id === prev.id
            ? { ...x, goto: null }
            : x.id === step.id
              ? { ...x, goto: prev.goto }
              : x,
        ),
      };
    }
    return { ...jj, steps };
  });
}

export function updateStep(
  doc: SimpleDoc,
  id: string,
  patch: Partial<Pick<SimpleStep, 'data' | 'links' | 'goto'>>,
): SimpleDoc {
  return {
    ...doc,
    journeys: doc.journeys.map((j) => ({
      ...j,
      steps: j.steps.map((s) => {
        if (s.id !== id) return s;
        const data = patch.data ? { ...s.data, ...patch.data } : s.data;
        let links = patch.links ?? s.links;
        // The links always have one entry per button / row.
        const n = optionCount({ type: s.type, data });
        if (BRANCHING.has(s.type) && links.length !== n)
          links = Array.from({ length: n }, (_, i) => links[i] ?? null);
        return { ...s, data, links, ...(patch.goto !== undefined ? { goto: patch.goto } : {}) };
      }),
    })),
  };
}

/** Remove a step; buttons that led to it now end the conversation. Removing the last step of a side journey removes the journey. */
export function removeStep(doc: SimpleDoc, id: string): SimpleDoc {
  const journeys = doc.journeys
    .map((j) => {
      const steps = j.steps.filter((s) => s.id !== id);
      // The jump of a removed last step passes to the step before it.
      const removedLast = j.steps[j.steps.length - 1];
      if (removedLast?.id === id && removedLast.goto && steps.length) {
        const prev = steps[steps.length - 1]!;
        if (!BRANCHING.has(prev.type))
          steps[steps.length - 1] = { ...prev, goto: removedLast.goto };
      }
      return {
        ...j,
        steps: steps.map((s) => {
          const t = s.links.includes(id)
            ? { ...s, links: s.links.map((l) => (l === id ? null : l)) }
            : s;
          return t.goto === id ? { ...t, goto: null } : t;
        }),
      };
    })
    .filter((j, i) => i === 0 || j.steps.length > 0);
  return { ...doc, journeys };
}

export function duplicateStep(doc: SimpleDoc, id: string): SimpleDoc {
  for (let ji = 0; ji < doc.journeys.length; ji++) {
    const si = doc.journeys[ji]!.steps.findIndex((s) => s.id === id);
    if (si < 0) continue;
    const src = doc.journeys[ji]!.steps[si]!;
    // A copy of a buttons / list step is only allowed at the end, which is where the original is.
    if (BRANCHING.has(src.type)) return doc;
    const copy: SimpleStep = {
      ...src,
      id: flbNewNodeId(),
      data: structuredClone(src.data),
      links: [],
      goto: null,
    };
    return insertStep(doc, ji, si + 1, copy);
  }
  return doc;
}

export function moveStep(doc: SimpleDoc, id: string, dir: -1 | 1): SimpleDoc {
  for (let ji = 0; ji < doc.journeys.length; ji++) {
    const steps = doc.journeys[ji]!.steps;
    const si = steps.findIndex((s) => s.id === id);
    if (si < 0) continue;
    const to = si + dir;
    if (to < 0 || to >= steps.length) return doc;
    const next = steps.slice();
    [next[si], next[to]] = [next[to]!, next[si]!];
    // A branching step has to stay last.
    if (next.some((s, i) => BRANCHING.has(s.type) && i < next.length - 1)) return doc;
    // The jump belongs to whichever step is now last.
    const oldLast = steps[steps.length - 1]!;
    const newLast = next[next.length - 1]!;
    if (oldLast.goto && oldLast.id !== newLast.id) {
      if (BRANCHING.has(newLast.type)) return doc;
      return mapJourney(doc, ji, (j) => ({
        ...j,
        steps: next.map((x) =>
          x.id === oldLast.id
            ? { ...x, goto: null }
            : x.id === newLast.id
              ? { ...x, goto: oldLast.goto }
              : x,
        ),
      }));
    }
    return mapJourney(doc, ji, (j) => ({ ...j, steps: next }));
  }
  return doc;
}

export function addJourney(doc: SimpleDoc, firstStep: SimpleStep): SimpleDoc {
  return { ...doc, journeys: [...doc.journeys, { name: '', steps: [firstStep] }] };
}

export function renameJourney(doc: SimpleDoc, ji: number, name: string): SimpleDoc {
  return mapJourney(doc, ji, (j) => ({ ...j, name }));
}

/** Rename an entry of the list: every chain of it carries the new name. */
export function renameGroup(doc: SimpleDoc, gi: number, name: string): SimpleDoc {
  const g = groupsOf(doc)[gi];
  if (!g) return doc;
  const chains = new Set(g.chains);
  return { ...doc, journeys: doc.journeys.map((j, i) => (chains.has(i) ? { ...j, name } : j)) };
}

/** Delete an entry of the list (never the first, which the trigger starts); buttons that led into it end instead. */
export function removeGroup(doc: SimpleDoc, gi: number): SimpleDoc {
  const g = groupsOf(doc)[gi];
  if (!g || g.chains.includes(0)) return doc;
  let next = doc;
  for (const c of [...g.chains].sort((a, b) => b - a)) next = removeJourney(next, c);
  return next;
}

/**
 * Copy an entry of the list ("Hello" -> "Hello copy"): every step gets a new id, and a button that led to a step of the entry
 * leads to its copy. Nothing leads into the copy yet.
 */
export function duplicateGroup(doc: SimpleDoc, gi: number): { doc: SimpleDoc; group: number } {
  const g = groupsOf(doc)[gi];
  if (!g) return { doc, group: gi };
  const idMap = new Map<string, string>();
  for (const c of g.chains) for (const s of doc.journeys[c]!.steps) idMap.set(s.id, flbNewNodeId());
  const taken = new Set(groupsOf(doc).map((x) => x.name.toLowerCase()));
  let name = `${g.name} copy`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${g.name} copy ${n}`;
  const copies: SimpleJourney[] = g.chains.map((c) => ({
    name,
    steps: doc.journeys[c]!.steps.map((s) => ({
      ...s,
      id: idMap.get(s.id)!,
      data: structuredClone(s.data),
      links: s.links.map((l) => (l ? (idMap.get(l) ?? l) : null)),
      goto: s.goto ? (idMap.get(s.goto) ?? s.goto) : null,
    })),
  }));
  const next = { ...doc, journeys: [...doc.journeys, ...copies] };
  return { doc: next, group: groupsOf(next).length - 1 };
}

export function removeJourney(doc: SimpleDoc, ji: number): SimpleDoc {
  if (ji === 0) return doc;
  const gone = new Set(doc.journeys[ji]?.steps.map((s) => s.id));
  const journeys = doc.journeys
    .filter((_, i) => i !== ji)
    .map((j) => ({
      ...j,
      steps: j.steps.map((s) => {
        const t = s.links.some((l) => l && gone.has(l))
          ? { ...s, links: s.links.map((l) => (l && gone.has(l) ? null : l)) }
          : s;
        return t.goto && gone.has(t.goto) ? { ...t, goto: null } : t;
      }),
    }));
  return { ...doc, journeys };
}

// --- checks ---------------------------------------------------------------------------------------------------------------

export interface SimpleProblem {
  /** The step to scroll to; `null` for the trigger. */
  stepId: string | null;
  message: Msg;
}

const cut = (s: string, n: number) => s.length > n;

export function problems(doc: SimpleDoc, opts: { senderRequired: boolean }): SimpleProblem[] {
  const out: SimpleProblem[] = [];
  const t = doc.trigger.data;
  if (str(t.kind) === 'keyword' && str(t.keywordMode) !== 'any' && !str(t.keywords).trim())
    out.push({ stepId: null, message: msg('simpleModel.problems.triggerKeyword') });
  if (opts.senderRequired && !str(t.deviceId).trim())
    out.push({ stepId: null, message: msg('simpleModel.problems.triggerSender') });
  if (doc.journeys[0]!.steps.length === 0)
    out.push({ stepId: null, message: msg('simpleModel.problems.firstStep') });

  const varsSeen = new Map<string, string>();
  doc.journeys.forEach((j, ji) =>
    j.steps.forEach((s, si) => {
      const stage = stageIn(doc, ji, si);
      const bad = (name: string, values: Record<string, string | number> = {}) =>
        out.push({
          stepId: s.id,
          message: msg(`simpleModel.problems.${name}`, { stage, ...values }),
        });
      const d = s.data;
      if (s.type === 'message' && !str(d.text).trim()) bad('writeMessage');
      if (s.type === 'media' && !str(d.url).trim()) bad('addFileLink');
      if (s.type === 'ask' || s.type === 'ask_file' || s.type === 'ask_location') {
        if (!str(d.prompt).trim()) bad('writeQuestion');
        if (!str(d.var).trim()) bad('nameVariable');
        if (d.saveProperty === true && !str(d.propertyKey).trim()) bad('chooseAnswerProperty');
      }
      if (
        s.type === 'location' &&
        (Number.isNaN(Number(d.lat)) ||
          str(d.lat).trim() === '' ||
          Number.isNaN(Number(d.lng)) ||
          str(d.lng).trim() === '')
      )
        bad('setCoordinates');
      if (s.type === 'template' && !str(d.tpl).trim()) bad('chooseTemplate');
      if (s.type === 'assign' && !str(d.team).trim()) bad('chooseTeam');
      if (s.type === 'cta') {
        const a = arr(d.actions)[0] as Record<string, unknown> | undefined;
        if (!a || !str(a.label).trim() || !str(a.value).trim()) bad('ctaLabelLink');
      }
      if (
        (s.type === 'buttons' || s.type === 'list') &&
        d.saveProperty === true &&
        !str(d.propertyKey).trim()
      )
        bad('choosePickedProperty');
      if (s.type === 'buttons') {
        if (!str(d.prompt).trim()) bad('buttonsPrompt');
        const o = arr(d.options).map(str);
        if (o.length === 0) bad('addButton');
        if (o.some((x) => !x.trim())) bad('buttonNeedsLabel');
        if (o.some((x) => cut(x, LIMITS.buttonLabel)))
          bad('buttonTooLong', { max: LIMITS.buttonLabel });
      }
      if (s.type === 'list') {
        if (!str(d.prompt).trim()) bad('listPrompt');
        if (!str(d.button).trim() || cut(str(d.button), LIMITS.listButton))
          bad('listButtonLabel', { max: LIMITS.listButton });
        const rows = arr(d.options) as Record<string, unknown>[];
        if (rows.length === 0) bad('addRow');
        if (rows.some((r) => !str(r.title).trim() || cut(str(r.title), LIMITS.rowTitle)))
          bad('rowTitle', { max: LIMITS.rowTitle });
        if (rows.some((r) => cut(str(r.description), LIMITS.rowDescription)))
          bad('rowDescriptionTooLong', { max: LIMITS.rowDescription });
      }
      const v = str(d.var).trim();
      if (
        v &&
        (s.type === 'ask' ||
          s.type === 'ask_file' ||
          s.type === 'ask_location' ||
          BRANCHING.has(s.type))
      ) {
        if (varsSeen.has(v)) bad('variableUsed', { name: v, other: varsSeen.get(v) ?? '' });
        else varsSeen.set(v, stageIn(doc, ji, si));
      }
    }),
  );
  return out;
}

/** Steps nothing leads to (not the first of the main flow, not a button / row target): they would never run. */
export function unreachable(doc: SimpleDoc): SimpleStep[] {
  const targets = new Set(
    allSteps(doc)
      .flatMap((s) => [...s.links, s.goto ?? null])
      .filter((l): l is string => !!l),
  );
  const out: SimpleStep[] = [];
  doc.journeys.forEach((j, ji) => {
    if (ji === 0) return;
    const head = j.steps[0];
    if (head && !targets.has(head.id)) out.push(head);
  });
  return out;
}

const DELAY_UNITS = ['sec', 'min', 'hour', 'day'];
const delaySummary = (t: Translate, d: Record<string, unknown>): string =>
  t('simpleModel.delaySummary', {
    amount: str(d.amount),
    unit: DELAY_UNITS.includes(str(d.unit))
      ? t(`builder.simple.editors.delay.${str(d.unit)}`)
      : str(d.unit),
  });

/** A step label for pickers: `2.3 · Message · "Hello there…"`. */
export function stepSummary(s: SimpleStep, t: Translate): string {
  const d = s.data;
  const raw =
    s.type === 'message'
      ? str(d.text)
      : s.type === 'ask'
        ? str(d.prompt)
        : s.type === 'buttons' || s.type === 'list'
          ? str(d.prompt)
          : s.type === 'media'
            ? str(d.caption) || str(d.url)
            : s.type === 'location'
              ? str(d.title) || str(d.address)
              : s.type === 'template'
                ? str(d.tpl)
                : s.type === 'cta'
                  ? str((arr(d.actions)[0] as Record<string, unknown> | undefined)?.label)
                  : s.type === 'delay'
                    ? delaySummary(t, d)
                    : s.type === 'assign'
                      ? str(d.message)
                      : '';
  const one = raw.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? `${one.slice(0, 40)}…` : one;
}

export const TYPE_LABEL: Record<SimpleType, Msg> = {
  message: msg('simpleModel.typeLabel.message'),
  media: msg('simpleModel.typeLabel.media'),
  buttons: msg('simpleModel.typeLabel.buttons'),
  list: msg('simpleModel.typeLabel.list'),
  ask: msg('simpleModel.typeLabel.ask'),
  ask_file: msg('simpleModel.typeLabel.ask_file'),
  ask_location: msg('simpleModel.typeLabel.ask_location'),
  delay: msg('simpleModel.typeLabel.delay'),
  location: msg('simpleModel.typeLabel.location'),
  template: msg('simpleModel.typeLabel.template'),
  cta: msg('simpleModel.typeLabel.cta'),
  assign: msg('simpleModel.typeLabel.assign'),
};
