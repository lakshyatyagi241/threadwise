/**
 * INDEPENDENT oracle for the flows and widgets step (chatbots, bot_flow_version(_data), bot_workspace, flows, faq_variations,
 * chatbot_configuration, chatbot_theme), written for the verifier. It imports nothing from transform/, flows/ or load/, and it does NOT
 * run the converter: the rules of spec C sections A and B are written down a second time here, as plain tables and loops. In particular
 * the SHAPE of a flow graph (how many steps, how many links, which step has no way in, where the trigger leads) is re-derived from the
 * node records alone, so a bug in the vendored converter, in the loader's plan or in a "fix" of either makes the target disagree with
 * this one and reconcile fails.
 * Shared on purpose: the pure hash `uuidv5` of util.ts and this folder's text / date helpers (reconcile/oracle.ts).
 */
import { dateOf, hexKey, oidDate, oracleDeleted, text, truthy } from './oracle';

type Doc = Record<string, unknown>;
const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const obj = (v: unknown): Doc => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sv = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const filled = (v: unknown): string | null => (text(v) === '' ? null : text(v));
const keyOf = (d: Doc): string =>
  d._id !== undefined && d._id !== null ? hexKey(d._id) : text(d.id);
const chars = (s: string): string[] => Array.from(s);
const clip = (s: string, n: number): string =>
  chars(s).length <= n ? s : chars(s).slice(0, n).join('');
/** The display string "dd Mon, yyyy h:mm:ss AM" is read as UTC (written again here); anything else as oracle.ts reads a date. */
function odate(v: unknown): Date | null {
  if (typeof v === 'string') {
    const m =
      /^\s*(\d{1,2}) ([A-Za-z]{3}),? (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?([AaPp][Mm])\s*$/.exec(v);
    if (m) {
      const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2]!.toLowerCase());
      if (mon < 0 || mon % 3 !== 0) return null;
      const h = Number(m[4]);
      const day = Number(m[1]);
      if (h < 1 || h > 12 || Number(m[5]) > 59 || Number(m[6]) > 59 || day < 1) return null;
      const d = new Date(
        Date.UTC(
          Number(m[3]),
          mon / 3,
          day,
          (h % 12) + (m[7]!.toLowerCase() === 'pm' ? 12 : 0),
          Number(m[5]),
          Number(m[6]),
        ),
      );
      return d.getUTCDate() === day ? d : null;
    }
  }
  return dateOf(v);
}
const when = (v: unknown): number => odate(v)?.getTime() ?? Number.NEGATIVE_INFINITY;

export interface OInput {
  chatbots: Doc[];
  configs: Doc[];
  themes: Doc[];
  versions: Doc[];
  data: Doc[];
  workspace: Doc[];
  headers: Doc[];
  faqs: Doc[];
  templates: Doc[];
}
export interface OOptions {
  policy: 'published' | 'draft' | 'newest';
  widgetsForWhatsappBots: boolean;
  flowLimit: number;
  widgetLimit: number;
  fallbackAt: string;
}

/** The subTypes that become a step (written again; the converter's own list lives in flows/rules.ts). */
const STEP = new Set([
  'text',
  'delay',
  'media',
  'whatsapp-template',
  'share-location',
  'interactive-button-url',
  'interactive-message',
  'flow-list',
  'interactive-message-list',
  'img-file',
  'name',
  'email',
  'number',
  'alphanumeric',
  'textfield',
]);
const TOKEN_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bEA[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/,
  /-----BEGIN [A-Z ]+-----/,
];
const BUTTONS = 'interactive-message';
const LISTS = new Set(['flow-list', 'interactive-message-list']);

export type NodeClass = 'step' | 'unsupported' | 'bad' | 'duplicate' | 'optinout';

export function classify(docs: Doc[]): Array<{ doc: Doc; cls: NodeClass }> {
  const seen = new Set<string>();
  return docs.map((doc) => {
    if (
      typeof doc.nodeId !== 'string' ||
      typeof doc.qid !== 'string' ||
      typeof doc.subType !== 'string'
    )
      return { doc, cls: 'bad' as const };
    if (seen.has(doc.nodeId)) return { doc, cls: 'duplicate' as const };
    if (/^OPT-(IN|OUT)\b/i.test(doc.qid)) return { doc, cls: 'optinout' as const };
    seen.add(doc.nodeId);
    return { doc, cls: STEP.has(doc.subType) ? ('step' as const) : ('unsupported' as const) };
  });
}

/** Words of one record: a string, or a list of strings, from `question` else `query`. */
function wordList(d: Doc): string[] {
  const pick = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [v]).filter(
      (x): x is string => typeof x === 'string' && x.trim() !== '',
    );
  const q = pick(d.question);
  return q.length > 0 ? q : pick(d.query);
}

export interface Shape {
  /** all steps + the trigger + one assign step per live-agent button */
  nodeCount: number;
  edgeCount: number;
  /** steps (not the trigger) with no link leading to them */
  orphanCount: number;
  agents: number;
  agentIdClash: boolean;
  steps: number;
  /** nodeId of the step the trigger leads to */
  firstNodeId: string;
  firstQid: string;
  keywords: string;
  templates: number;
}

/**
 * The shape of the graph for these records (`all` = the records the converter accepted: steps and unsupported, in file order;
 * `refs` = every record that carries a journey, i.e. nodes and Intent / FAQ records, with their question words already expanded).
 */
export function shapeOf(all: Doc[], refs: Doc[]): Shape {
  const groups = new Map<string, Doc[]>();
  for (const d of all) groups.set(sv(d.qid), [...(groups.get(sv(d.qid)) ?? []), d]);
  for (const [q, g] of groups)
    groups.set(
      q,
      g
        .map((d, i) => ({ d, i }))
        .sort((a, b) => Number(a.d.displayOrder ?? 0) - Number(b.d.displayOrder ?? 0) || a.i - b.i)
        .map((x) => x.d),
    );
  const refCount = new Map<string, number>();
  const words = new Map<string, string[]>();
  for (const r of refs) {
    const q = sv(obj(r.journey).qid);
    if (!q) continue;
    refCount.set(q, (refCount.get(q) ?? 0) + 1);
    const w = wordList(r)[0];
    const list = words.get(q) ?? [];
    const lw = w === undefined ? '' : w.trim().toLowerCase();
    if (lw && lw.length <= 40 && !list.includes(lw)) list.push(lw);
    words.set(q, list);
  }
  const stage = (q: string): number => {
    const ns = groups
      .get(q)!
      .map((d) => parseInt(sv(d.stage), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ns.length ? Math.min(...ns) : 1e9;
  };
  const order = [...groups.keys()].sort(
    (a, b) =>
      (refCount.get(b) ?? 0) - (refCount.get(a) ?? 0) ||
      stage(a) - stage(b) ||
      groups.get(b)!.length - groups.get(a)!.length,
  );
  const isStep = (d: Doc): boolean => STEP.has(sv(d.subType));
  const branching = (d: Doc): boolean => sv(d.subType) === BUTTONS || LISTS.has(sv(d.subType));
  const chains: Doc[][] = [];
  for (const q of order) {
    let cur: Doc[] = [];
    for (const d of groups.get(q)!) {
      if (!isStep(d)) continue;
      cur.push(d);
      if (branching(d)) {
        chains.push(cur);
        cur = [];
      }
    }
    if (cur.length) chains.push(cur);
  }
  const id = (d: Doc): string => sv(d.nodeId);
  const steps = new Set(chains.flat().map(id));
  const edge = new Map<string, string>();
  const k = (from: string, handle: string): string => `${from}\u0001${handle}`;
  for (const ch of chains)
    ch.forEach((d, i) => ch[i + 1] && edge.set(k(id(d), 'out'), id(ch[i + 1]!)));
  edge.set(k('\u0000trigger', 'out'), id(chains[0]![0]!));
  let templates = 0;
  for (const d of chains.flat()) {
    if (sv(d.subType) === 'whatsapp-template') templates++;
    if (!branching(d)) continue;
    const act = obj(obj(obj(arr(d.response)[0]).interactive).action);
    const targets =
      sv(d.subType) === BUTTONS
        ? arr(act.buttons)
        : arr(act.sections).flatMap((s) => arr(obj(s).rows));
    const shown = Math.min(targets.length, sv(d.subType) === BUTTONS ? 3 : 10);
    targets.slice(0, shown).forEach((t, i) => {
      const to = sv(obj(obj(t).value).nodeId);
      if (obj(t).type === 'flow' && steps.has(to)) edge.set(k(id(d), `p${i}`), to);
    });
  }
  let agents = 0;
  const agentIds = new Set<string>();
  let clash = false;
  for (const ch of chains)
    for (const d of ch) {
      if (sv(d.subType) !== BUTTONS) continue;
      arr(obj(obj(obj(arr(d.response)[0]).interactive).action).buttons).forEach((b, i) => {
        if (obj(b).type !== 'live_agent') return;
        const aid = sv(obj(b).id).slice(0, 8) || String(agents);
        if (agentIds.has(aid)) clash = true;
        agentIds.add(aid);
        edge.set(k(id(d), `p${i}`), `\u0000agent:${agents}`);
        agents += 1;
      });
    }
  for (const d of chains.flat()) {
    if (branching(d)) continue;
    for (const a of arr(d.actions).map(obj))
      if (a.type === 'connect_node' && steps.has(sv(a.nodeId)))
        edge.set(k(id(d), 'out'), sv(a.nodeId));
  }
  const inbound = new Set(edge.values());
  const main = order.find((q) => chains.some((c) => sv(c[0]!.qid) === q)) ?? '';
  const mainQid = sv(chains[0]![0]!.qid);
  void main;
  return {
    nodeCount: 1 + steps.size + agents,
    edgeCount: edge.size,
    orphanCount: [...steps].filter((s) => !inbound.has(s)).length,
    agents,
    agentIdClash: clash,
    steps: steps.size,
    firstNodeId: id(chains[0]![0]!),
    firstQid: mainQid,
    keywords: (words.get(mainQid) ?? []).join(', ') || 'hi',
    templates,
  };
}

export interface OBot {
  botId: string;
  /** null = loads */
  stop: { kind: 'exclude' | 'quarantine'; code: string } | null;
  baseName: string;
  candidate: 'version' | 'workspace' | 'unversioned' | 'orphan-version' | null;
  versionId: string | null;
  shape: Shape | null;
  /** the nodeIds of the steps */
  stepIds: string[];
  created: string | null;
  updated: string | null;
  liveAgentIds: number;
}

const iso = (d: Date): string => d.toISOString();

export function oracleBots(
  input: OInput,
  o: OOptions,
): { bots: Map<string, OBot>; order: string[] } {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  const by = (list: Doc[], field: string): Map<string, Doc[]> => {
    const m = new Map<string, Doc[]>();
    for (const d of list) {
      const b = typeof d[field] === 'string' ? (d[field] as string).trim() : '';
      if (!b) continue;
      m.set(b, [...(m.get(b) ?? []), d]);
    }
    return m;
  };
  for (const d of input.chatbots) add(text(d.bot_id));
  for (const l of [input.versions, input.data, input.workspace, input.headers, input.faqs])
    for (const d of l) if (typeof d.botid === 'string') add(d.botid.trim());
  const cb = by(input.chatbots, 'bot_id');
  const vers = by(input.versions, 'botid');
  const dat = by(input.data, 'botid');
  const ws = by(input.workspace, 'botid');
  const bots = new Map<string, OBot>();
  for (const botId of order) {
    const bot = (cb.get(botId) ?? [])[0];
    const o2: OBot = {
      botId,
      stop: null,
      baseName: clip(text(bot?.name) || `Waboo bot ${botId.slice(-6)}`, 255),
      candidate: null,
      versionId: null,
      shape: null,
      stepIds: [],
      created: null,
      updated: null,
      liveAgentIds: 0,
    };
    bots.set(botId, o2);
    if (bot && oracleDeleted(bot)) {
      o2.stop = { kind: 'exclude', code: 'SOFT_DELETED' };
      continue;
    }
    if (bot && bot.is_active === false) {
      o2.stop = { kind: 'exclude', code: 'BOT_INACTIVE' };
      continue;
    }
    const ch = text(bot?.channel).toLowerCase() || 'whatsapp';
    if (/web|site|widget/.test(ch)) {
      o2.stop = { kind: 'exclude', code: 'WEB_BOT_NO_FLOW' };
      continue;
    }
    if (!/whatsapp|^wa$/.test(ch)) {
      o2.stop = { kind: 'exclude', code: 'OTHER_CHANNEL_NO_FLOW' };
      continue;
    }
    // records of the draft
    const wsNodes: Doc[] = [];
    const intents: Doc[] = [];
    for (const d of ws.get(botId) ?? []) {
      const t = text(d.type).toLowerCase();
      if (t === 'flow') wsNodes.push(d);
      else if (t === 'intent' || t === 'faq') intents.push(d);
    }
    const intentRefs: Doc[] = [];
    for (const d of intents) {
      const q = sv(obj(d.journey).qid);
      if (!q) continue;
      const w = wordList(d);
      if (w.length === 0) intentRefs.push({ journey: d.journey });
      else for (const x of w) intentRefs.push({ journey: d.journey, question: x });
    }
    // candidates, best first
    const myVersions = vers.get(botId) ?? [];
    const myData = dat.get(botId) ?? [];
    const byVersion = new Map<string, Doc[]>();
    const loose: Doc[] = [];
    for (const d of myData) {
      const v = text(d.version_id);
      if (v === '') loose.push(d);
      else byVersion.set(v, [...(byVersion.get(v) ?? []), d]);
    }
    const bigger = (a: Doc, b: Doc, f: string): number =>
      when(b[f]) - when(a[f]) || (keyOf(a) < keyOf(b) ? 1 : keyOf(a) > keyOf(b) ? -1 : 0);
    type Cand = {
      kind: NonNullable<OBot['candidate']>;
      versionId: string | null;
      version: Doc | null;
      docs: Doc[];
    };
    const asVersion = (v: Doc): Cand => ({
      kind: 'version',
      versionId: filled(v.version_id),
      version: v,
      docs: byVersion.get(text(v.version_id)) ?? [],
    });
    const wsCand: Cand = { kind: 'workspace', versionId: null, version: null, docs: wsNodes };
    const cands: Cand[] = [];
    const used = new Set<Doc>();
    const pushV = (v: Doc | undefined): void => {
      if (v && !used.has(v)) {
        used.add(v);
        cands.push(asVersion(v));
      }
    };
    const publishedList = myVersions
      .filter((v) => text(v.status).toLowerCase() === 'published')
      .sort((a, b) => bigger(a, b, 'publishedAt'));
    if (o.policy === 'draft') cands.push(wsCand);
    if (o.policy === 'newest') {
      const latest = (v: Doc): number => Math.max(when(v.createdAt), when(v.publishedAt));
      for (const v of [...myVersions].sort(
        (a, b) => latest(b) - latest(a) || (keyOf(a) < keyOf(b) ? 1 : -1),
      ))
        pushV(v);
    } else {
      pushV(publishedList[0]);
      for (const v of [...myVersions].sort((a, b) => bigger(a, b, 'createdAt'))) pushV(v);
    }
    if (o.policy !== 'draft') cands.push(wsCand);
    cands.push({ kind: 'unversioned', versionId: null, version: null, docs: loose });
    const knownIds = new Set(myVersions.map((v) => text(v.version_id)));
    const orphans = [...byVersion].filter(([id]) => !knownIds.has(id));
    orphans.sort(
      (a, b) =>
        Math.max(...b[1].map((d) => when(d.createdAt))) -
          Math.max(...a[1].map((d) => when(d.createdAt))) || (a[0] < b[0] ? 1 : -1),
    );
    for (const [id, docs] of orphans)
      cands.push({ kind: 'orphan-version', versionId: id, version: null, docs });

    let picked: { c: Cand; cls: ReturnType<typeof classify> } | null = null;
    for (const c of cands) {
      const cls = classify(c.docs);
      if (cls.some((x) => x.cls === 'step')) {
        picked = { c, cls };
        break;
      }
    }
    if (!picked) {
      o2.stop = { kind: 'exclude', code: 'NO_NODES' };
      continue;
    }
    const { c, cls } = picked;
    const all = cls.filter((x) => x.cls === 'step' || x.cls === 'unsupported').map((x) => x.doc);
    const shape = shapeOf(all, [...c.docs, ...intentRefs]);
    o2.candidate = c.kind;
    o2.versionId = c.versionId;
    o2.shape = shape;
    o2.stepIds = cls.filter((x) => x.cls === 'step').map((x) => sv(x.doc.nodeId));
    if (TOKEN_SHAPES.some((re) => re.test(JSON.stringify(all.map((d) => d.response))))) {
      o2.stop = { kind: 'quarantine', code: 'SECRET_IN_FLOW' };
      continue;
    }
    if (shape.agentIdClash) {
      o2.stop = { kind: 'quarantine', code: 'GRAPH_INVALID' };
      continue;
    }
    if (shape.nodeCount > 500 || shape.edgeCount > 2000) {
      o2.stop = { kind: 'quarantine', code: 'GRAPH_TOO_LARGE' };
      continue;
    }
    // dates: the version's, else the bot's, else the steps'
    const steps = cls.filter((x) => x.cls === 'step').map((x) => x.doc);
    const ds = (f: string): Date[] =>
      steps.map((d) => odate(d[f])).filter((x): x is Date => x !== null);
    const created =
      odate(c.version?.createdAt) ??
      odate(bot?.created_time) ??
      (ds('createdAt').length
        ? new Date(Math.min(...ds('createdAt').map((x) => x.getTime())))
        : null) ??
      new Date(o.fallbackAt);
    const ups = steps
      .map((d) => odate(d.updatedAt) ?? odate(d.createdAt))
      .filter((x): x is Date => x !== null);
    let updated =
      odate(c.version?.publishedAt) ??
      (ups.length ? new Date(Math.max(...ups.map((x) => x.getTime()))) : null) ??
      odate(bot?.modified_time) ??
      created;
    if (updated < created) updated = created;
    o2.created = iso(created);
    o2.updated = iso(updated);
    o2.liveAgentIds = shape.agents;
  }
  // the plan cap, in load order
  let loaded = 0;
  for (const id of order) {
    const b = bots.get(id)!;
    if (b.stop) continue;
    if (o.flowLimit > 0 && loaded >= o.flowLimit)
      b.stop = { kind: 'quarantine', code: 'PLAN_LIMIT' };
    else loaded++;
  }
  return { bots, order };
}

/** `bot -> [phrases]` of faq_variations, the way keyword rows must carry them (union over the rows of a document). */
export function oracleFaq(
  input: OInput,
  loads: (botId: string) => boolean,
): Map<string, { botId: string; phrases: string[]; rows: number } | { code: string }> {
  const out = new Map<
    string,
    { botId: string; phrases: string[]; rows: number } | { code: string }
  >();
  for (const d of input.faqs) {
    const k = keyOf(d);
    const b = typeof d.botid === 'string' ? d.botid.trim() : '';
    if (!b) {
      out.set(k, { code: 'NO_BOT_ID' });
      continue;
    }
    if (!loads(b)) {
      out.set(k, { code: 'FLOW_NOT_LOADED' });
      continue;
    }
    const seen = new Set<string>();
    const phrases: string[] = [];
    for (const p of arr(d.phrases)) {
      if (typeof p !== 'string') continue;
      const t = p.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      if (!t || chars(t).length > 255 || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      phrases.push(t);
    }
    if (phrases.length === 0) {
      out.set(k, { code: 'NO_PHRASES' });
      continue;
    }
    let rows = 1;
    let len = 0;
    for (const p of phrases) {
      const add = chars(p).length + (len === 0 ? 0 : 2);
      if (len + add > 255 && len > 0) {
        rows++;
        len = chars(p).length;
      } else len += add;
    }
    out.set(k, { botId: b, phrases, rows });
  }
  return out;
}

export interface OWidget {
  botId: string;
  stop: string | null;
  mode: 'ai' | 'whatsapp' | 'both';
  name: string;
  hasAssistant: boolean;
  number: string | null;
  position: 'bottom_right' | 'bottom_left';
  welcome: string | null;
  prefilled: string | null;
  label: string;
  autoOpen: boolean;
  buttonColor: string;
  actionBg: string;
  actionText: string;
  model: string | null;
  prompt: string | null;
  /** key NAMES holding secrets in the AI configuration: their values must be nowhere in the target */
  secretValues: string[];
  configKey: string | null;
  themeKey: string | null;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const hexOf = (v: unknown): string | null =>
  typeof v === 'string' && HEX.test(v.trim()) && v.trim().length <= 16 ? v.trim() : null;

export function oracleWidgets(
  input: OInput,
  o: OOptions,
  flowLoads: (botId: string) => boolean,
): {
  widgets: Map<string, OWidget>;
  order: string[];
  usedConfig: Set<string>;
  usedTheme: Set<string>;
} {
  void flowLoads;
  const widgets = new Map<string, OWidget>();
  const order: string[] = [];
  const usedConfig = new Set<string>();
  const usedTheme = new Set<string>();
  const first = new Map<string, Doc>();
  for (const d of input.chatbots)
    if (text(d.bot_id) && !first.has(text(d.bot_id))) first.set(text(d.bot_id), d);
  const find = (list: Doc[], key: string): Doc | undefined =>
    key === '' ? undefined : list.find((d) => text(d.id) === key || keyOf(d) === key);
  let loaded = 0;
  for (const [botId, bot] of first) {
    if (oracleDeleted(bot) || bot.is_active === false) continue;
    const ch = text(bot.channel).toLowerCase() || 'whatsapp';
    const web = /web|site|widget/.test(ch);
    const number = filled(bot.whatsapp_number);
    const cfg0 = find(input.configs, text(bot.chatbot_configuration));
    const th0 = find(input.themes, text(bot.chatbot_theme));
    const cfg = cfg0 && !oracleDeleted(cfg0) ? cfg0 : undefined;
    const th = th0 && !oracleDeleted(th0) ? th0 : undefined;
    const wants =
      web ||
      (/whatsapp|^wa$/.test(ch) &&
        (number !== null || (o.widgetsForWhatsappBots && cfg !== undefined)));
    if (!wants) continue;
    const c = cfg ?? {};
    const t = th ?? {};
    const ai: Doc = {};
    for (const [k, v] of Object.entries(c))
      if (k.trim() === 'ai_configuration' && k !== 'ai_configuration') Object.assign(ai, obj(v));
    Object.assign(ai, obj(c.ai_configuration));
    const aiOn = truthy(ai.enabled);
    const waText = [
      'whatsapp_prefilled_message_text',
      'whatsapp_welcome_message_text',
      'whatsapp_cta_button_text',
      'whatsapp_subheader_text',
    ].some((k) => filled(c[k]) !== null);
    const mode = aiOn && (waText || number !== null) ? 'both' : aiOn ? 'ai' : 'whatsapp';
    const primary = hexOf(obj(t.primary).main);
    const btn = obj(t.button);
    const digits = (number ?? '').replace(/\D/g, '');
    const side = (v: unknown): 'bottom_right' | 'bottom_left' | null =>
      /left/i.test(sv(v)) ? 'bottom_left' : /right/i.test(sv(v)) ? 'bottom_right' : null;
    const w: OWidget = {
      botId,
      stop: null,
      mode,
      name: clip(text(bot.name) || `Waboo bot ${botId.slice(-6)}`, 120),
      hasAssistant: aiOn,
      number: digits.length >= 7 && digits.length <= 15 ? digits : null,
      position: side(c.desktop_display_position) ?? side(c.display_position) ?? 'bottom_right',
      welcome: clipOrNull(
        mode === 'whatsapp'
          ? (filled(c.whatsapp_welcome_message_text) ?? filled(c.welcome_message_text))
          : (filled(c.welcome_message_text) ?? filled(c.whatsapp_welcome_message_text)),
        2000,
      ),
      prefilled: clipOrNull(
        filled(c.whatsapp_prefilled_message_text) ?? filled(c.prefilled_message_text),
        2000,
      ),
      label: clip(
        filled(c.cta_button_text) ?? filled(c.whatsapp_cta_button_text) ?? 'Start chat',
        80,
      ),
      autoOpen: truthy(c.desktop_auto_triggering),
      buttonColor: primary ?? '#075E54',
      actionBg: hexOf(btn.background) ?? primary ?? '#075E54',
      actionText: hexOf(btn.text) ?? '#FFFFFF',
      model: aiOn ? (filled(ai.model) ?? filled(c.modelName) ?? 'gpt-4o-mini') : null,
      prompt: aiOn ? (filled(ai.prompt) ?? filled(c.prompt) ?? filled(bot.prompt)) : null,
      // a field NAMED like a key can hold something harmless: Karma's `openRouterKey` is the model name ("openai/gpt-4o-mini", equal to the
      // config's own model), which the assistant row carries on purpose. A model name is not a credential: a real OpenRouter / OpenAI key has
      // a prefix and is far longer, and never has the shape provider/model.
      secretValues: Object.entries(ai)
        .filter(
          ([k, v]) =>
            /key|token|secret/i.test(k) &&
            typeof v === 'string' &&
            v.length >= 8 &&
            !(
              v === ai.model ||
              v === ai.modelName ||
              (v.length < 60 && /^[\w.-]+\/[\w.:-]+$/.test(v))
            ),
        )
        .map(([, v]) => v as string),
      configKey: cfg ? keyOf(cfg) : null,
      themeKey: th ? keyOf(th) : null,
    };
    widgets.set(botId, w);
    order.push(botId);
    if (o.widgetLimit > 0 && loaded >= o.widgetLimit) {
      w.stop = 'PLAN_LIMIT';
      continue;
    }
    loaded++;
    if (cfg) usedConfig.add(keyOf(cfg));
    if (th) usedTheme.add(keyOf(th));
  }
  return { widgets, order, usedConfig, usedTheme };
}

function clipOrNull(v: string | null, n: number): string | null {
  return v === null ? null : clip(v, n);
}

export { oidDate };
