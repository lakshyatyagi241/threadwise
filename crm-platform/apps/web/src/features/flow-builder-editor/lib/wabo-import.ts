import {
  flbCleanAskFileExtensions,
  flbDefaultNodeData,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
} from '@crm/contracts';
import { LIMITS, MAIN_NAME } from './simple-model';

/**
 * Reads a flow exported from the wabo console (the bot builder's records: one object per node, grouped by `qid`, ordered by
 * `displayOrder`, linked by the `nodeId` each button or list row points to) and writes the editor's graph, shaped so the Simple
 * builder shows it as flows ("journeys") of steps. Nothing is stored here; `toSimple` reads the result.
 *
 * Rules (the same ones the hand-made import files follow):
 * - A step continues into the next step of its `qid` by `displayOrder`; a buttons or list step ends its chain, and each button
 *   or row leads to the node its `value.nodeId` names (when that node is in the file).
 * - A button of any other kind (live agent, link) stays a button with no target; it is counted in `notes`.
 * - Intent / FAQ records that carry a `journey` give the flows their names and the trigger its words.
 * - What the editor has no place for (header images and texts, quick actions, API actions, template variables) is dropped.
 */

export interface WaboImport {
  graph: FlowGraph;
  /** What did not come across, in words for the person importing. */
  notes: string[];
  /** Words that start the flow, from the file's Intent / FAQ records. */
  keywords: string;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The records of a wabo export, whichever way it was copied (`{data:[…]}`, a bare list, or one object). */
export function waboRecords(raw: unknown): Rec[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(rec(raw).data)
      ? (rec(raw).data as unknown[])
      : [];
  return list.map(rec);
}

const isFlowNode = (r: Rec): boolean =>
  typeof r.nodeId === 'string' && typeof r.qid === 'string' && typeof r.subType === 'string';

/** True when the file looks like a wabo export (so the importer knows which reader to use). */
export function isWaboExport(raw: unknown): boolean {
  return waboRecords(raw).some(isFlowNode);
}

/** wabo writes text as light HTML (`<p>`, `<br>`); WhatsApp wants plain lines. */
function plain(v: unknown): string {
  return str(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const body = (b: unknown, footer: unknown): string => {
  const f = plain(footer);
  return clip([plain(b), f].filter(Boolean).join('\n\n'), LIMITS.body);
};

const ASK_TYPES: Record<string, string> = {
  name: 'name',
  email: 'email',
  number: 'number',
  alphanumeric: 'alphanumeric',
  textfield: 'text',
};

const VIDEO_PAGE = /(youtube\.com|youtu\.be|vimeo\.com)/i;

export interface WaboOptions {
  /**
   * Write the file's own connections and buttons as they are, for the canvas: a live-agent button leads to an Assign step, and a
   * "node to node" action of a step becomes its `out` wire. Simple cannot show either, so its import leaves them out and says so.
   */
  exact?: boolean;
}

export function waboToGraph(raw: unknown, opts: WaboOptions = {}): WaboImport {
  const notes: string[] = [];
  const records = waboRecords(raw);
  const seen = new Set<string>();
  const all = records.filter((r) => {
    if (!isFlowNode(r) || seen.has(str(r.nodeId))) return false;
    // The console's built-in opt-in / opt-out messages are not in its list of flows (they belong to subscription settings).
    if (/^OPT-(IN|OUT)\b/i.test(str(r.qid))) {
      notes.push(
        'Left out the opt-in / opt-out messages: the console keeps them outside its list of flows.',
      );
      return false;
    }
    seen.add(str(r.nodeId));
    return true;
  });

  // Names and trigger words from the Intent / FAQ records that point at a flow.
  const qidName = new Map<string, string>();
  /** The words each flow's Intent / FAQ records answer to: the trigger takes those of the flow it starts. */
  const wordsByQid = new Map<string, string[]>();
  const qidRefs = new Map<string, number>();
  for (const r of records) {
    const j = rec(r.journey);
    const q = str(j.qid);
    if (!q) continue;
    const n = str(j.name).trim();
    if (n && n.toLowerCase() !== 'untitled' && !qidName.has(q)) qidName.set(q, n);
    qidRefs.set(q, (qidRefs.get(q) ?? 0) + 1);
    const w = str(r.question || r.query)
      .trim()
      .toLowerCase();
    const list = wordsByQid.get(q) ?? [];
    if (w && w.length <= 40 && !list.includes(w)) list.push(w);
    wordsByQid.set(q, list);
  }

  // Group by flow (`qid`), in the order each first appears, each ordered by `displayOrder`.
  const groups = new Map<string, Rec[]>();
  for (const r of all) {
    const q = str(r.qid);
    groups.set(q, [...(groups.get(q) ?? []), r]);
  }
  for (const [q, g] of groups)
    groups.set(
      q,
      g
        .map((r, i) => ({ r, i }))
        .sort((a, b) => Number(a.r.displayOrder ?? 0) - Number(b.r.displayOrder ?? 0) || a.i - b.i)
        .map((x) => x.r),
    );
  // The console numbers its flows in the `stage` of their nodes ("2.1" is the first node of flow 2). The flow the trigger starts
  // (the one the Intent / FAQ records refer to most) comes first, the others follow in the console's own order.
  const stageNo = new Map<string, number>();
  for (const [q, g] of groups) {
    const nums = g
      .map((r) => parseInt(str(r.stage), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) stageNo.set(q, Math.min(...nums));
  }
  const order = [...groups.keys()].sort(
    (a, b) =>
      (qidRefs.get(b) ?? 0) - (qidRefs.get(a) ?? 0) ||
      (stageNo.get(a) ?? 1e9) - (stageNo.get(b) ?? 1e9) ||
      groups.get(b)!.length - groups.get(a)!.length,
  );

  // `n_` and the first 8 characters of the nodeId, so a step can be traced back; longer when two nodeIds start alike.
  const ids = new Map<string, string>();
  const taken = new Set<string>(['n_start000']);
  for (const r of all) {
    const flat = str(r.nodeId).replace(/-/g, '');
    let len = 8;
    while (len < flat.length && taken.has(`n_${flat.slice(0, len)}`)) len += 4;
    const id = taken.has(`n_${flat.slice(0, len)}`)
      ? `n_${flat}_${taken.size}`
      : `n_${flat.slice(0, len)}`;
    taken.add(id);
    ids.set(str(r.nodeId), id);
  }
  const idOf = (r: Rec): string => ids.get(str(r.nodeId))!;
  const idByNode = new Map<string, string>();
  const usedVars = new Set<string>();
  const vars: FlowGraph['vars'] = [];
  const claimVar = (r: Rec, fallback: string): string => {
    let v = str(r.variable)
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '_');
    if (!v) v = fallback;
    if (usedVars.has(v)) v = `${v}_${str(r.nodeId).slice(0, 4)}`;
    usedVars.add(v);
    const label = str(rec(rec(r.property).property).label);
    vars.push(label ? { name: v, desc: label } : { name: v });
    return v;
  };

  /** One wabo node as an editor node, or null with a note when the editor has no such step. */
  const convert = (r: Rec): { type: string; data: Record<string, unknown> } | null => {
    const first = rec(arr(r.response)[0]);
    const sub = str(r.subType);
    const id8 = str(r.nodeId).slice(0, 8);
    const inter = rec(first.interactive);
    const action = rec(inter.action);
    switch (sub) {
      case 'text': {
        // A text step normally holds a string; one that holds a video or image holds `{ text, url }`.
        const v = rec(first.value);
        const heldKind = str(first.type);
        if (
          typeof first.value !== 'string' &&
          str(v.url) &&
          !VIDEO_PAGE.test(str(v.url)) &&
          ['image', 'video', 'audio', 'document'].includes(heldKind)
        )
          return {
            type: 'media',
            data: {
              kind: heldKind,
              url: str(v.url),
              filename: '',
              caption: clip(plain(v.text), 1024),
            },
          };
        const text =
          typeof first.value === 'string'
            ? plain(first.value)
            : [plain(v.text), str(v.url)].filter(Boolean).join('\n');
        return { type: 'message', data: { text: clip(text, 4096) || '…' } };
      }
      case 'delay':
        return {
          type: 'delay',
          data: { amount: Math.max(1, Math.round(Number(r.delay) || 1)), unit: 'min' },
        };
      case 'media': {
        const v = rec(first.value);
        const url = str(v.url);
        const caption = plain(v.text);
        if (VIDEO_PAGE.test(url) || !url)
          return {
            type: 'message',
            data: { text: clip([caption, url].filter(Boolean).join('\n'), 4096) || '…' },
          };
        const kind = ['image', 'video', 'audio', 'document'].includes(str(first.type))
          ? str(first.type)
          : 'image';
        return { type: 'media', data: { kind, url, filename: '', caption: clip(caption, 1024) } };
      }
      case 'whatsapp-template':
        return { type: 'template', data: { tpl: str(first.template_id) } };
      case 'share-location': {
        const v = rec(first.value);
        return {
          type: 'location',
          data: {
            lat: str(v.latitude),
            lng: str(v.longitude),
            address: str(v.address),
            title: str(v.name),
          },
        };
      }
      case 'interactive-button-url': {
        const buttons = arr(action.buttons).map(rec);
        return {
          type: 'cta',
          data: {
            actions: buttons.map((b) => ({
              type: 'url',
              label: clip(str(rec(b.value).text), 25),
              value: str(rec(b.value).url),
            })),
            bodyText: body(inter.body, ''),
            headerText: str(rec(inter.header).text),
            footerText: plain(inter.footer),
            ...(inter.header ? { header: inter.header } : {}),
          },
        };
      }
      case 'interactive-message': {
        const buttons = arr(action.buttons).map(rec);
        for (const b of buttons)
          if (b.type !== 'flow' && !(opts.exact && b.type === 'live_agent'))
            notes.push(
              `A "${str(b.type)}" button ("${str(rec(b.value).text)}") has no target in Simple.`,
            );
        return {
          type: 'buttons',
          data: {
            prompt: body(inter.body, inter.footer) || '…',
            options: buttons
              .slice(0, LIMITS.buttons)
              .map((b) => clip(str(rec(b.value).text).trim() || 'Button', LIMITS.buttonLabel)),
            var: claimVar(r, `choice_${id8}`),
            ...(inter.header ? { header: inter.header } : {}),
          },
        };
      }
      case 'flow-list':
      case 'interactive-message-list': {
        const rows: Array<{ title: string; description: string; section: string }> = [];
        for (const s of arr(action.sections).map(rec))
          for (const row of arr(s.rows).map(rec))
            rows.push({
              title: clip(str(rec(row.value).text).trim() || 'Option', LIMITS.rowTitle),
              description: '',
              section: str(s.title),
            });
        return {
          type: 'list',
          data: {
            prompt: body(inter.body, inter.footer) || '…',
            button: clip(str(action.button).trim() || 'Options', LIMITS.listButton),
            var: claimVar(r, `choice_${id8}`),
            options: rows.slice(0, LIMITS.rows),
            ...(inter.header ? { header: inter.header } : {}),
          },
        };
      }
      case 'img-file': {
        const key = str(rec(rec(r.property).property).value);
        return {
          type: 'ask_file',
          data: {
            ...flbDefaultNodeData('ask_file'),
            prompt: plain(first.value) || 'Please send the file or image.',
            var: claimVar(r, `file_${id8}`),
            extensions: flbCleanAskFileExtensions(first.allowedFileTypes),
            saveProperty: key !== '',
            propertyKey: key,
          },
        };
      }
      default: {
        const validate = ASK_TYPES[sub];
        if (!validate) {
          notes.push(`Skipped a "${sub}" step: Simple has nothing like it.`);
          return null;
        }
        const key = str(rec(rec(r.property).property).value);
        return {
          type: 'ask',
          data: {
            ...flbDefaultNodeData('ask'),
            prompt: plain(first.value) || 'Please reply',
            var: claimVar(r, `ask_${id8}`),
            validate,
            saveProperty: key !== '',
            propertyKey: key,
          },
        };
      }
    }
  };

  // Convert every node, then chain each flow's nodes and link each button / row.
  const converted = new Map<string, { type: string; data: Record<string, unknown> }>();
  const chains: Array<{ qid: string; ids: string[] }> = [];
  for (const q of order) {
    let current: string[] = [];
    const flush = () => {
      if (current.length) chains.push({ qid: q, ids: current });
      current = [];
    };
    for (const r of groups.get(q)!) {
      const c = convert(r);
      if (!c) continue;
      const id = idOf(r);
      idByNode.set(str(r.nodeId), id);
      converted.set(id, c);
      current.push(id);
      // A buttons or list step ends its chain: what follows starts another.
      if (c.type === 'buttons' || c.type === 'list') flush();
    }
    flush();
  }

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const edge = (source: string, sourceHandle: string, target: string) =>
    edges.push({ id: `e_${source}_${sourceHandle}`, source, sourceHandle, target });

  const COL = 340;
  const ROW = 190;
  /** The first button or row that leads to a step: the name of a flow that starts there, when nothing else names it. */
  const leadTitle = new Map<string, string>();
  chains.forEach((chain, ci) => {
    chain.ids.forEach((id, si) => {
      const c = converted.get(id)!;
      const data = { ...c.data };
      if (si === 0 && ci > 0) data.journeyName = '';
      nodes.push({
        id,
        type: c.type,
        x: 80 + ci * COL,
        y: 60 + (ci === 0 ? si + 1 : si) * ROW,
        data,
      } as FlowNode);
      const nextId = chain.ids[si + 1];
      if (nextId) edge(id, 'out', nextId);
    });
  });
  // Buttons and rows lead where wabo says, when that node is in the file.
  for (const r of all) {
    const id = idByNode.get(str(r.nodeId));
    const c = id ? converted.get(id) : undefined;
    if (!id || !c || (c.type !== 'buttons' && c.type !== 'list')) continue;
    const inter = rec(rec(arr(r.response)[0]).interactive);
    const action = rec(inter.action);
    const targets: unknown[] =
      c.type === 'buttons'
        ? arr(action.buttons)
        : arr(action.sections).flatMap((s) => arr(rec(s).rows));
    targets.slice(0, arr(c.data.options).length).forEach((t, i) => {
      const v = rec(rec(t).value);
      const to = idByNode.get(str(v.nodeId));
      if (rec(t).type === 'flow' && to) {
        edge(id, `p${i}`, to);
        if (!leadTitle.has(to)) leadTitle.set(to, str(v.text).trim());
      } else if (rec(t).type === 'flow' && str(v.nodeId))
        notes.push(
          `"${str(v.text).trim()}" leads to a flow that is not in this file; it ends there until you link it.`,
        );
    });
  }

  const qidOfAgent = new Map<string, string>();
  if (opts.exact) {
    // A live-agent button hands the chat to an agent: it leads to an Assign step of its own.
    const lastX = 80 + chains.length * COL;
    let agents = 0;
    for (const r of all) {
      const id = idByNode.get(str(r.nodeId));
      const c = id ? converted.get(id) : undefined;
      if (!id || c?.type !== 'buttons') continue;
      arr(
        rec(rec(arr(r.response)[0]).interactive).action &&
          rec(rec(rec(arr(r.response)[0]).interactive).action).buttons,
      ).forEach((b, i) => {
        if (rec(b).type !== 'live_agent') return;
        const aid = `n_agent_${str(rec(b).id).slice(0, 8) || agents}`;
        nodes.push({
          id: aid,
          type: 'assign',
          x: lastX,
          y: 60 + agents * ROW,
          data: {
            team: '',
            userId: '',
            journeyName: '',
            message: `Customer asked for a live agent (button "${str(rec(rec(b).value).text)}")`,
          },
        } as FlowNode);
        qidOfAgent.set(aid, str(r.qid));
        edge(id, `p${i}`, aid);
        agents += 1;
      });
    }
    // A "node to node" action says where a step carries on: it replaces the step's next-in-order wire.
    for (const r of all) {
      const id = idByNode.get(str(r.nodeId));
      const c = id ? converted.get(id) : undefined;
      if (!id || !c) continue;
      for (const a of arr(r.actions).map(rec)) {
        if (a.type !== 'connect_node') continue;
        const to = idByNode.get(str(a.nodeId));
        if (!to) {
          notes.push(
            `A step connects to a node that is not in this file (${str(a.nodeId).slice(0, 8)}); it stays unlinked.`,
          );
          continue;
        }
        if (c.type === 'buttons' || c.type === 'list') continue;
        const at = edges.findIndex((e) => e.source === id && e.sourceHandle === 'out');
        if (at >= 0) edges.splice(at, 1);
        edge(id, 'out', to);
      }
    }
  }

  // Every chain of one wabo flow carries that flow's name, so the Simple list shows it as one flow with all its steps. The name is
  // the one the Intent / FAQ records give it, else the first button or row that leads into it, else "Flow n". The flow the
  // trigger starts keeps the main flow's slot (its name rides on the trigger).
  const qidOfHead = new Map<string, string>([
    ...chains.map((c) => [c.ids[0]!, c.qid] as const),
    ...qidOfAgent,
  ]);
  const flowName = new Map<string, string>();
  const mainQid = chains[0]?.qid;
  const takenNames = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    for (let n = 2; takenNames.has(name.toLowerCase()); n++) name = clip(`${base} (${n})`, 60);
    takenNames.add(name.toLowerCase());
    return name;
  };
  // The flow the trigger starts keeps the main flow's slot (its name rides on the trigger); every flow has a name of its own, or
  // two of them would be listed as one.
  const mainName = mainQid
    ? qidName.get(mainQid)
      ? unique(qidName.get(mainQid)!)
      : unique(MAIN_NAME)
    : MAIN_NAME;
  if (mainQid) flowName.set(mainQid, mainName);
  let flowNo = 0;
  for (const c of chains) {
    if (flowName.has(c.qid)) continue;
    flowNo += 1;
    const lead = chains
      .filter((x) => x.qid === c.qid)
      .map((x) => leadTitle.get(x.ids[0]!))
      .find(Boolean);
    flowName.set(
      c.qid,
      unique(clip(qidName.get(c.qid) || lead || `Flow ${stageNo.get(c.qid) ?? flowNo}`, 60)),
    );
  }
  nodes.forEach((n) => {
    if (n.data.journeyName !== '') return;
    const q = qidOfHead.get(n.id);
    n.data.journeyName = q === mainQid ? mainName : (flowName.get(q ?? '') ?? '');
  });

  const keywords = (mainQid ? (wordsByQid.get(mainQid) ?? []) : []).join(', ') || 'hi';
  const trigger: FlowNode = {
    id: 'n_start000',
    type: 'trigger',
    x: 80,
    y: 60,
    isStart: true,
    data: {
      ...flbDefaultNodeData('trigger'),
      keywords,
      ...(mainName !== MAIN_NAME ? { journeyName: mainName } : {}),
    },
  } as FlowNode;
  const first = chains[0]?.ids[0];
  if (first) edge(trigger.id, 'out', first);

  return {
    graph: { flowNodes: [trigger, ...nodes], flowEdges: edges, vars },
    notes: Array.from(new Set(notes)),
    keywords,
  };
}
