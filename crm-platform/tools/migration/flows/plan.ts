import type { Source } from '../extract/source';
import {
  FLB_MAX_FLOW_EDGES,
  FLB_MAX_FLOW_NODES,
  flbNormalizeGraph,
} from '../../../packages/contracts/src/flow-builder-editor/graph';
import { flbExtractTrigger } from '../../../packages/contracts/src/flow-builder-editor/trigger';
import { bool, isDeleted, plain, scrub, sha256, str, type Doc } from '../util';
import type { Row, Soft } from '../transform/types';
import { FLOW_CATEGORY, type FlowSettings } from './config';
import {
  arr,
  candidatesFor,
  classifyNodes,
  clipChars,
  docKey,
  isDisplayDate,
  lossOf,
  lossTotal,
  obj,
  s,
  wabooDate,
  type Candidate,
  type NodeVerdict,
} from './rules';
import { waboToGraph } from './wabo-convert';
import { buildFaqPlan, buildWidgetPlan, type FaqVerdict, type WidgetPlan } from './widget';

/**
 * Pass 1 of the flows step, from the dump alone (plus the keys of the contact fields of the target): which bot becomes which flow, which
 * document of every collection ends up where, and the row of every flow. The loader and the verifier both build this plan; the
 * independent oracle (reconcile/oracle-flows.ts) re-derives the parts that can be checked without the converter and compares.
 *
 * "Latest version only" (team decision): one flow per bot, from the version the policy picks; every other version, header and
 * draft document is accounted as excluded OLDER_VERSION / WORKSPACE_NOT_USED. Imported flows are NEVER published or active.
 */
export const BOT_COLLECTIONS = [
  'chatbots',
  'chatbot_configuration',
  'chatbot_theme',
  'bot_flow_version',
  'bot_flow_version_data',
  'bot_workspace',
  'flows',
  'faq_variations',
] as const;

export type DocVerdict =
  | { kind: 'adopt'; table: 'flows' | 'chatbot_widgets'; botId: string }
  | { kind: 'exclude' | 'quarantine'; code: string; reason: string };

export type BotVerdict =
  { kind: 'load' } | { kind: 'exclude' | 'quarantine'; code: string; reason: string };

export interface BotPlan {
  botId: string;
  verdict: BotVerdict;
  /** the flows row (columns of the TableSpec), when verdict is load */
  row: Row | null;
  soft: Soft[];
  /** how the "latest version" was found: version / workspace / unversioned / orphan-version, with its id and status */
  source: { kind: Candidate['kind']; versionId: string | null; status: string | null } | null;
  /** counted for the report and the oracle */
  stats: { nodes: number; edges: number; steps: number; templates: number; loss: number };
}

export interface FlowPlan {
  settings: FlowSettings;
  /** bots in load order (the order of first appearance in the dump) */
  botOrder: string[];
  bots: Map<string, BotPlan>;
  /** `${collection}\0${primaryKey}` -> where the document went */
  docs: Map<string, DocVerdict>;
  faq: Map<string, FaqVerdict>;
  widgets: Map<string, WidgetPlan>;
  widgetOrder: string[];
  /** verdict tally for the log line: `flow load` / `flow exclude WEB_BOT_NO_FLOW` ... */
  tally: Record<string, number>;
  fingerprint: string;
}

export { docKey };

async function readAll(source: Source, client: string, collection: string): Promise<Doc[]> {
  const out: Doc[] = [];
  if (source.collections(client).includes(collection))
    for await (const d of source.read(client, collection)) out.push(d);
  return out;
}

const hasBotId = (d: Doc): boolean => typeof d.botid === 'string' && d.botid.trim() !== '';
const botIdOf = (d: Doc): string => s(d.botid).trim();

const chanOf = (b: Doc | undefined): 'whatsapp' | 'web' | 'other' => {
  const c = (str(b?.channel) ?? 'whatsapp').toLowerCase();
  if (/web|site|widget/.test(c)) return 'web';
  if (/whatsapp|^wa$/.test(c)) return 'whatsapp';
  return 'other';
};

const wordsOf = (v: unknown): string[] => {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === 'string') {
      if (x.trim() !== '') out.push(x);
    } else if (Array.isArray(x)) x.forEach(walk);
  };
  walk(v);
  return out;
};

/** Intent / FAQ records of a bot as the converter wants them: one record per question string (a field may hold a list of them). */
function intentRecords(docs: Doc[]): { records: Doc[]; verdict: Map<Doc, 'used' | 'empty'> } {
  const records: Doc[] = [];
  const verdict = new Map<Doc, 'used' | 'empty'>();
  for (const d of docs) {
    const j = obj(d.journey);
    if (!str(j.qid)) {
      verdict.set(d, 'empty');
      continue;
    }
    verdict.set(d, 'used');
    const q = wordsOf(d.question).length > 0 ? wordsOf(d.question) : wordsOf(d.query);
    if (q.length === 0) records.push({ journey: plain(j) as Doc });
    else for (const w of q) records.push({ journey: plain(j) as Doc, question: w });
  }
  return { records, verdict };
}

const noDate = (): Soft => ({
  code: 'NO_DATE',
  reason:
    'no usable date on the bot, its version or its steps: stamped with the dump manifest time',
});

export interface PlanInput {
  source: Source;
  client: string;
  settings: FlowSettings;
  fallbackAt: string;
  /** keys of the contact fields of the target (module contacts); null = not checked */
  contactFieldKeys: Set<string> | null;
}

export async function buildFlowPlan(a: PlanInput): Promise<FlowPlan> {
  const { source, client, settings } = a;
  const [chatbots, configs, themes, versions, data, workspace, headers, faqs, templates, journey] =
    await Promise.all(
      [
        'chatbots',
        'chatbot_configuration',
        'chatbot_theme',
        'bot_flow_version',
        'bot_flow_version_data',
        'bot_workspace',
        'flows',
        'faq_variations',
        'broadcast_templates',
        'journey',
      ].map((c) => readAll(source, client, c)),
    );
  const docs = new Map<string, DocVerdict>();
  const setDoc = (c: string, d: Doc, v: DocVerdict): void => {
    const k = docKey(c, d);
    if (!docs.has(k)) docs.set(k, v);
  };
  const tally: Record<string, number> = {};
  const tick = (k: string): void => {
    tally[k] = (tally[k] ?? 0) + 1;
  };

  // --- the bots: the union of every botid in the dump, in order of first appearance -------------------------------------------
  const botOrder: string[] = [];
  const known = new Set<string>();
  const see = (id: string): void => {
    if (id !== '' && !known.has(id)) {
      known.add(id);
      botOrder.push(id);
    }
  };
  const chatbotDocs = new Map<string, Doc[]>();
  for (const d of chatbots) {
    const id = str(d.bot_id);
    if (id === null) {
      setDoc('chatbots', d, {
        kind: 'quarantine',
        code: 'NO_BOT_ID',
        reason: 'the bot has no bot_id, so no step, version or widget can be tied to it',
      });
      continue;
    }
    see(id);
    chatbotDocs.set(id, [...(chatbotDocs.get(id) ?? []), d]);
  }
  const group = (list: Doc[], collection: string): Map<string, Doc[]> => {
    const m = new Map<string, Doc[]>();
    for (const d of list) {
      if (!hasBotId(d)) {
        setDoc(collection, d, {
          kind: 'quarantine',
          code: 'NO_BOT_ID',
          reason: 'the record has no botid, so it cannot be tied to a bot',
        });
        continue;
      }
      see(botIdOf(d));
      m.set(botIdOf(d), [...(m.get(botIdOf(d)) ?? []), d]);
    }
    return m;
  };
  const versionsBy = group(versions, 'bot_flow_version');
  const dataBy = group(data, 'bot_flow_version_data');
  const wsBy = group(workspace, 'bot_workspace');
  const headersBy = group(headers, 'flows');
  group(faqs, 'faq_variations'); // sees the botids, flags records without one
  const journeyBy = new Map<string, Doc[]>();
  for (const d of journey)
    if (hasBotId(d)) journeyBy.set(botIdOf(d), [...(journeyBy.get(botIdOf(d)) ?? []), d]);

  const tpl = new Map<string, string>();
  for (const t of templates) {
    const name = str(t.name) ?? str(t.template_name);
    if (!name) continue;
    for (const k of [t.id, t._id, t.template_id, t.meta_template_id]) {
      const key = str(k);
      if (key && !tpl.has(key)) tpl.set(key, name);
    }
  }

  const bots = new Map<string, BotPlan>();
  const excludeAll = (collection: string, list: Doc[], reason: string): void => {
    for (const d of list)
      setDoc(collection, d, { kind: 'exclude', code: 'BOT_NOT_IMPORTED', reason });
  };

  for (const botId of botOrder) {
    const cb = chatbotDocs.get(botId) ?? [];
    const bot = cb[0];
    const vers = versionsBy.get(botId) ?? [];
    const dat = dataBy.get(botId) ?? [];
    const ws = wsBy.get(botId) ?? [];
    const hdr = headersBy.get(botId) ?? [];
    const soft: Soft[] = [];
    const plan: BotPlan = {
      botId,
      verdict: { kind: 'load' },
      row: null,
      soft,
      source: null,
      stats: { nodes: 0, edges: 0, steps: 0, templates: 0, loss: 0 },
    };
    bots.set(botId, plan);
    for (const extra of cb.slice(1))
      setDoc('chatbots', extra, {
        kind: 'exclude',
        code: 'DUPLICATE_BOT',
        reason: 'another chatbots document already holds this bot_id; the first one is used',
      });

    const stop = (kind: 'exclude' | 'quarantine', code: string, reason: string): void => {
      plan.verdict = { kind, code, reason };
      tick(`flow ${kind} ${code}`);
      if (bot) setDoc('chatbots', bot, { kind: 'exclude', code, reason });
      const why = `its bot is not imported as a flow (${code})`;
      excludeAll('bot_flow_version', vers, why);
      excludeAll('bot_flow_version_data', dat, why);
      excludeAll('flows', hdr, why);
      for (const d of ws)
        setDoc('bot_workspace', d, { kind: 'exclude', code: 'BOT_NOT_IMPORTED', reason: why });
    };

    if (bot && isDeleted(bot)) {
      stop('exclude', 'SOFT_DELETED', 'the bot is deleted at the source');
      continue;
    }
    if (bot && bot.is_active === false) {
      stop('exclude', 'BOT_INACTIVE', 'the bot is switched off (is_active false) at the source');
      continue;
    }
    const chan = chanOf(bot);
    if (chan === 'web') {
      stop(
        'exclude',
        'WEB_BOT_NO_FLOW',
        'a website bot has no WhatsApp flow (its widget is imported separately)',
      );
      continue;
    }
    if (chan === 'other') {
      stop('exclude', 'OTHER_CHANNEL_NO_FLOW', `channel "${s(bot?.channel)}" has no flow import`);
      continue;
    }
    if (!bot)
      soft.push({
        code: 'BOT_RECORD_MISSING',
        reason: 'no chatbots document for this bot_id: the flow is named from the bot id',
      });

    // --- intent / FAQ records and the nodes of the draft --------------------------------------------------------------------
    const wsNodes: Doc[] = [];
    const intents: Doc[] = [];
    for (const d of ws) {
      const ty = (str(d.type) ?? '').toLowerCase();
      if (ty === 'flow') wsNodes.push(d);
      else if (ty === 'intent' || ty === 'faq') intents.push(d);
      else
        setDoc('bot_workspace', d, {
          kind: 'quarantine',
          code: 'UNKNOWN_TYPE',
          reason: `bot_workspace record of type "${s(d.type)}" (expected Flow, Intent or FAQ)`,
        });
    }
    const intent = intentRecords(intents);

    // --- the version ----------------------------------------------------------------------------------------------------------
    const { list, ambiguous } = candidatesFor(settings.flowVersion, vers, dat, wsNodes);
    const passed: Array<{ kind: string; versionId: string | null; nodes: number }> = [];
    let chosen: {
      c: Candidate;
      cls: Array<{ doc: Doc; verdict: NodeVerdict }>;
      out: ReturnType<typeof waboToGraph>;
    } | null = null;
    for (const c of list) {
      if (c.docs.length === 0 && c.kind !== 'version') continue;
      const cls = classifyNodes(c.docs);
      const eligible = cls.filter((x) => x.verdict === 'eligible').map((x) => x.doc);
      if (eligible.length === 0) {
        if (c.docs.length > 0 || c.kind === 'version')
          passed.push({ kind: c.kind, versionId: c.versionId, nodes: c.docs.length });
        continue;
      }
      const out = waboToGraph([...c.docs.map((d) => plain(d)), ...intent.records], { exact: true });
      chosen = { c, cls, out };
      break;
    }
    if (!chosen) {
      stop(
        'exclude',
        'NO_NODES',
        'the bot has no step the converter can use in any version or draft',
      );
      continue;
    }
    const { c, cls, out } = chosen;
    const eligible = cls.filter((x) => x.verdict === 'eligible').map((x) => x.doc);
    plan.source = {
      kind: c.kind,
      versionId: c.versionId,
      status: c.version ? (str(c.version.status) ?? null) : null,
    };
    if (passed.length > 0)
      soft.push({
        code: 'VERSION_EMPTY',
        reason: 'a better-ranked version had no step the converter can use; the next one was taken',
        detail: passed,
      });
    if (
      settings.flowVersion === 'published' &&
      !(c.kind === 'version' && (str(c.version?.status) ?? '').toLowerCase() === 'published')
    )
      soft.push({
        code: 'NO_PUBLISHED_VERSION',
        reason:
          'the bot has no usable published version; the latest other version or the draft was imported',
        detail: { used: c.kind, versionId: c.versionId, status: str(c.version?.status) },
      });
    if (ambiguous && c.kind === 'version')
      soft.push({
        code: 'VERSION_AMBIGUOUS',
        reason:
          'two published versions have the same publishedAt; the one with the larger document key was taken',
      });

    // --- verdict of every document of this bot -------------------------------------------------------------------------------
    const nodeCollection = c.kind === 'workspace' ? 'bot_workspace' : 'bot_flow_version_data';
    const used = new Set<Doc>(c.docs);
    const adoptFlow: DocVerdict = { kind: 'adopt', table: 'flows', botId };
    const codeOf: Record<
      Exclude<NodeVerdict, 'eligible'>,
      [string, string, 'exclude' | 'quarantine']
    > = {
      bad: [
        'BAD_NODE',
        'the record lacks a string nodeId, qid or subType, so it is not a step',
        'quarantine',
      ],
      duplicate: [
        'DUPLICATE_NODE',
        'another step of this version already has this nodeId (the first one is used)',
        'exclude',
      ],
      optinout: [
        'OPT_IN_OUT',
        'built-in opt-in / opt-out message: subscription settings, not a flow',
        'exclude',
      ],
      unsupported: [
        'UNSUPPORTED_STEP',
        'the converter has no step for this subType (lost)',
        'exclude',
      ],
    };
    for (const x of cls) {
      if (x.verdict === 'eligible') setDoc(nodeCollection, x.doc, adoptFlow);
      else {
        const [code, reason, kind] = codeOf[x.verdict];
        setDoc(nodeCollection, x.doc, { kind, code, reason });
      }
    }
    for (const d of dat)
      if (!used.has(d))
        setDoc('bot_flow_version_data', d, {
          kind: 'exclude',
          code: 'OLDER_VERSION',
          reason: 'not the latest version (only the latest version is migrated)',
        });
    for (const d of wsNodes)
      if (!used.has(d))
        setDoc('bot_workspace', d, {
          kind: 'exclude',
          code: 'WORKSPACE_NOT_USED',
          reason: 'a draft step; the imported version was taken from a published or saved version',
        });
    for (const d of intents)
      setDoc(
        'bot_workspace',
        d,
        intent.verdict.get(d) === 'used'
          ? adoptFlow
          : {
              kind: 'exclude',
              code: 'EMPTY_INTENT',
              reason:
                'an Intent / FAQ record with no journey: it names no flow and adds no trigger word',
            },
      );
    for (const v of vers)
      setDoc(
        'bot_flow_version',
        v,
        v === c.version
          ? adoptFlow
          : {
              kind: 'exclude',
              code: 'OLDER_VERSION',
              reason: 'not the latest version (only the latest version is migrated)',
            },
      );
    for (const h of hdr) setDoc('flows', h, adoptFlow);

    // --- the graph ------------------------------------------------------------------------------------------------------------
    // a failure from here on leaves the bot's documents pointing at no flow: they become excluded BOT_NOT_IMPORTED
    const fail = (code: string, reason: string): void => {
      plan.verdict = { kind: 'quarantine', code, reason };
      tick(`flow quarantine ${code}`);
      for (const [k, v] of docs)
        if (v.kind === 'adopt' && v.botId === botId && v.table === 'flows')
          docs.set(k, {
            kind: 'exclude',
            code: 'BOT_NOT_IMPORTED',
            reason: `its bot is not imported as a flow (${code})`,
          });
    };
    const supported = eligible.length;
    const rawNodes = out.graph.flowNodes;
    const agents = rawNodes.filter((n) => n.id.startsWith('n_agent_')).length;
    if (rawNodes.length - 1 - agents !== supported) {
      fail(
        'CONVERSION_MISMATCH',
        `the converter produced ${rawNodes.length - 1 - agents} steps for ${supported} usable records`,
      );
      continue;
    }
    const ids = new Set(rawNodes.map((n) => n.id));
    if (ids.size !== rawNodes.length) {
      fail('GRAPH_INVALID', 'the converter gave two steps the same id');
      continue;
    }
    const dangling = out.graph.flowEdges.filter(
      (e) => !ids.has(e.source) || !ids.has(e.target),
    ).length;
    const graph = flbNormalizeGraph(out.graph);
    if (
      graph.flowNodes.length > FLB_MAX_FLOW_NODES ||
      graph.flowEdges.length > FLB_MAX_FLOW_EDGES
    ) {
      fail(
        'GRAPH_TOO_LARGE',
        `${graph.flowNodes.length} steps / ${graph.flowEdges.length} links; a flow holds at most ${FLB_MAX_FLOW_NODES} / ${FLB_MAX_FLOW_EDGES}`,
      );
      continue;
    }
    if (dangling > 0)
      soft.push({
        code: 'DANGLING_EDGES_DROPPED',
        reason: 'links to a step that is not in the graph were dropped by the editor normalisation',
        detail: dangling,
      });

    // templates: the node carries the Waboo template id; the runtime reads a template NAME
    const tplNodes = graph.flowNodes.filter((n) => n.type === 'template');
    let named = 0;
    for (const n of tplNodes) {
      const name = tpl.get(s(n.data.tpl));
      if (name) named++;
      n.data = { ...n.data, tpl: name ?? '' };
    }
    if (tplNodes.length > 0)
      soft.push({
        code: 'TEMPLATE_UNRESOLVED',
        reason:
          'templates are not migrated (they are re-synced from Meta): a step carries the template NAME where the dump could give it, empty otherwise; the flow cannot send until the template exists under that name',
        detail: { steps: tplNodes.length, named, unnamed: tplNodes.length - named },
      });

    // secrets in the text of a step never reach the target
    const sc = scrub(graph);
    if (sc.redacted.length > 0) {
      fail(
        'SECRET_IN_FLOW',
        `a step holds something that looks like a credential (${sc.redacted.slice(0, 5).join(', ')}); the flow is not loaded`,
      );
      continue;
    }

    // contact properties the ask steps write to
    if (a.contactFieldKeys) {
      const missing = [
        ...new Set(
          graph.flowNodes
            .filter((n) => n.data.saveProperty === true && s(n.data.propertyKey) !== '')
            .map((n) => s(n.data.propertyKey))
            .filter((k) => !a.contactFieldKeys!.has(k)),
        ),
      ].sort();
      if (missing.length > 0)
        soft.push({
          code: 'PROPERTY_NOT_FOUND',
          reason: 'an ask step saves into a contact property that has no field in the workspace',
          detail: missing,
        });
    }

    // what the conversion loses
    const loss = lossOf(eligible);
    const unsupported = cls.filter((x) => x.verdict === 'unsupported');
    const bySub: Record<string, number> = {};
    for (const x of unsupported) bySub[s(x.doc.subType)] = (bySub[s(x.doc.subType)] ?? 0) + 1;
    if (lossTotal(loss) > 0 || out.notes.length > 0 || unsupported.length > 0)
      soft.push({
        code: 'CONVERSION_LOSS',
        reason:
          'what the converter does not carry across (quick actions, API actions, template variables, extra responses, other languages, other button kinds); the raw dump is the archive',
        detail: {
          ...loss,
          unsupportedSteps: bySub,
          // the Waboo api_library ids the lost API actions pointed at (ids only): a later api_library builder can re-attach them
          apiLibraryIds: [
            ...new Set(
              eligible.flatMap((d) =>
                arr(d.actions)
                  .map(obj)
                  .map((x) => s(x.apiLibraryId))
                  .filter(Boolean),
              ),
            ),
          ].sort(),
          converterNotes: out.notes,
        },
      });
    if (arr(bot?.chatbot_languages).length > 0 || obj(bot?.multi_lingual).multi_lingual === true)
      soft.push({
        code: 'MULTI_LANGUAGE_NOT_PRESENT',
        reason: 'the bot is multi-language at the source; the flow holds one language',
      });

    // trigger
    const trig = flbExtractTrigger(graph);
    let keywords = trig.keywords;
    if (
      keywords !== null &&
      Array.from(keywords).length > 255 &&
      !['*', '.*', '.+', 'any'].includes(keywords.trim())
    ) {
      soft.push({
        code: 'KEYWORDS_TOO_LONG',
        reason:
          'the trigger words are longer than 255 characters: trigger_keywords is left empty (never widened); the words stay in the trigger step',
        detail: Array.from(keywords).length,
      });
      keywords = null;
    }
    if (out.keywords === 'hi' && !wordsOf(intent.records.map((r) => r.question)).includes('hi'))
      soft.push({
        code: 'DEFAULT_TRIGGER_WORD',
        reason:
          'no Intent / FAQ word for the first flow: the converter\'s default trigger word "hi" is used',
      });

    // cross-checks against the draft copy and the headers
    const wsIds = new Set(wsNodes.map((d) => s(d.nodeId)));
    const jr = (journeyBy.get(botId) ?? []).map((d) => s(d.nodeId));
    if (jr.length > 0 && wsNodes.length > 0) {
      const same = jr.length === wsIds.size && jr.every((n) => wsIds.has(n));
      if (!same)
        soft.push({
          code: 'JOURNEY_DIVERGES',
          reason:
            'the legacy journey copy and bot_workspace do not hold the same steps (cross-check only)',
          detail: { journey: jr.length, workspace: wsIds.size },
        });
    }
    const mainHeaders = hdr.filter((h) => bool(h['main-flow']));
    if (mainHeaders.length > 0) {
      const first = graph.flowEdges.find((e) => e.source === 'n_start000')?.target;
      const doc = eligible.filter((d) => {
        const flat = s(d.nodeId).replace(/-/g, '');
        return first !== undefined && `n_${flat}`.startsWith(first);
      });
      const qid = doc.length === 1 ? s(doc[0]!.qid) : null;
      if (qid && !mainHeaders.some((h) => s(h.qid) === qid))
        soft.push({
          code: 'JOURNEY_MAIN_DIVERGES',
          reason: 'the flow the trigger starts is not the header marked main-flow at the source',
        });
    }
    if (bot)
      soft.push({
        code: 'WABOO_STATE',
        reason: 'the state of the bot at the source (an imported flow is never live)',
        detail: {
          bot_enabled: bot.bot_enabled ?? null,
          chatbot_status: bot.chatbot_status ?? null,
          published_version:
            c.kind === 'version' && (str(c.version?.status) ?? '').toLowerCase() === 'published',
        },
      });

    // --- the row --------------------------------------------------------------------------------------------------------------
    const nodeTimes = eligible
      .map((d) => wabooDate(d.createdAt))
      .filter((x): x is Date => x !== null);
    const nodeUpdates = eligible
      .map((d) => wabooDate(d.updatedAt) ?? wabooDate(d.createdAt))
      .filter((x): x is Date => x !== null);
    const min = (xs: Date[]): Date | null =>
      xs.length ? new Date(Math.min(...xs.map((x) => x.getTime()))) : null;
    const max = (xs: Date[]): Date | null =>
      xs.length ? new Date(Math.max(...xs.map((x) => x.getTime()))) : null;
    if (
      [
        c.version?.createdAt,
        c.version?.publishedAt,
        bot?.created_time,
        ...eligible.flatMap((d) => [d.createdAt, d.updatedAt]),
      ].some(isDisplayDate)
    )
      soft.push({
        code: 'DATE_ZONE_ASSUMED',
        reason:
          'dates written as "dd Mon, yyyy h:mm:ss AM" carry no time zone: they were read as UTC',
      });
    let created =
      wabooDate(c.version?.createdAt) ?? wabooDate(bot?.created_time) ?? min(nodeTimes) ?? null;
    if (!created) {
      created = new Date(a.fallbackAt);
      soft.push(noDate());
    }
    let updated =
      wabooDate(c.version?.publishedAt) ??
      max(nodeUpdates) ??
      wabooDate(bot?.modified_time) ??
      created;
    if (updated < created) updated = created;
    const base = str(bot?.name);
    plan.row = {
      flow_name: clipChars(base ?? `Waboo bot ${botId.slice(-6)}`, 255),
      // a JSON round trip: what is stored is exactly what is compared (no undefined members)
      flow_data: JSON.parse(
        JSON.stringify({
          flowNodes: graph.flowNodes,
          flowEdges: graph.flowEdges,
          vars: graph.vars,
        }),
      ) as Row,
      category: FLOW_CATEGORY,
      trigger_kind: trig.kind,
      trigger_value: trig.valueKind === 'zero' ? 0 : null,
      trigger_keywords: keywords,
      trigger_config: trig.config ?? null,
      provider: 'waba',
      flow_type: 'chat',
      // SAFETY: an imported flow is never live. The API default for is_active is TRUE: it is overridden here and checked by reconcile.
      is_published: false,
      is_active: false,
      published_at: null,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
    };
    plan.stats = {
      nodes: graph.flowNodes.length,
      edges: graph.flowEdges.length,
      steps: supported,
      templates: tplNodes.length,
      loss: lossTotal(loss),
    };
    tick('flow load');
  }

  // --- names: unique per workspace, in load order; then the plan cap ------------------------------------------------------------
  const taken = new Set<string>();
  let loaded = 0;
  for (const botId of botOrder) {
    const p = bots.get(botId)!;
    if (p.verdict.kind !== 'load' || !p.row) continue;
    if (settings.flowLimit > 0 && loaded >= settings.flowLimit) {
      p.verdict = {
        kind: 'quarantine',
        code: 'PLAN_LIMIT',
        reason: `the plan allows ${settings.flowLimit} flows; this bot would be number ${loaded + 1}`,
      };
      p.row = null;
      tick('flow quarantine PLAN_LIMIT');
      tally['flow load'] = (tally['flow load'] ?? 1) - 1;
      // its documents point at no flow any more
      for (const [k, v] of docs)
        if (v.kind === 'adopt' && v.botId === botId && v.table === 'flows')
          docs.set(k, {
            kind: 'exclude',
            code: 'BOT_NOT_IMPORTED',
            reason: 'its bot is over the plan limit (PLAN_LIMIT)',
          });
      continue;
    }
    loaded++;
    let name = String(p.row.flow_name);
    for (let n = 2; taken.has(name.toLowerCase()); n++)
      name = `${clipChars(String(p.row.flow_name), 255 - ` (${n})`.length)} (${n})`;
    taken.add(name.toLowerCase());
    p.row.flow_name = name;
  }
  // the chatbots document of a bot that loaded points at its flow (unless a widget is the better home, decided below)
  for (const botId of botOrder) {
    const p = bots.get(botId)!;
    const bot = (chatbotDocs.get(botId) ?? [])[0];
    if (bot && p.verdict.kind === 'load')
      setDoc('chatbots', bot, { kind: 'adopt', table: 'flows', botId });
  }

  // --- FAQ variations -> keyword replies (inactive) ---------------------------------------------------------------------------
  const faq = buildFaqPlan({
    faqs,
    bots,
    fallbackAt: a.fallbackAt,
    setDoc: (d, v) => setDoc('faq_variations', d, v),
  });
  // --- widgets ----------------------------------------------------------------------------------------------------------------
  const wp = buildWidgetPlan({
    settings,
    chatbotDocs,
    configs,
    themes,
    botOrder,
    bots,
    fallbackAt: a.fallbackAt,
    docs,
    setDoc,
    tick,
  });

  const fingerprint = sha256(
    JSON.stringify({
      s: settings,
      b: botOrder.map((id) => {
        const p = bots.get(id)!;
        return [id, p.verdict.kind, p.row ? sha256(JSON.stringify(p.row)) : null];
      }),
      w: wp.order.map((id) => [id, wp.widgets.get(id)?.verdict.kind]),
      f: [...faq].map(([k, v]) => [k, v.kind]),
    }),
  ).slice(0, 16);
  return {
    settings,
    botOrder,
    bots,
    docs,
    faq: faq,
    widgets: wp.widgets,
    widgetOrder: wp.order,
    tally: { ...tally, ...wp.tally },
    fingerprint,
  };
}
