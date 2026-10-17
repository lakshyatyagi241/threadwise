import { armedFlowUuids } from '../load/flowstate';
import type { Source } from '../extract/source';
import type { FlowSettings } from '../flows/config';
import type { FlowPlan } from '../flows/plan';
import { sql, withTenant, type Database } from '../load/db';
import { uuidv5, type Doc } from '../util';
import { hexKey, text } from './oracle';
import {
  classify,
  oracleBots,
  oracleFaq,
  oracleWidgets,
  type OBot,
  type OInput,
  type OOptions,
} from './oracle-flows';
import type { Report } from './index';

/**
 * The verifier of the flows and widgets step. What it believes about the source comes from reconcile/oracle-flows.ts (a second
 * implementation of spec C: the version, the shape of the graph, the trigger words, the widget rules); what it believes about the target
 * it reads here. For the organization it checks:
 *   - the loader's plan against the oracle, bot by bot (verdict, steps, links, name, trigger words) and for the widgets and FAQ rows,
 *   - every loaded flow IN THE TARGET: columns, and the graph re-derived from the node records: step count, link count, the trigger
 *     and its start flag, every link lands on a step, no step without a way in that the source did not already have, every source
 *     step present exactly once, no template id where a template name belongs, no credential in the text,
 *   - SAFETY, in SQL, with the predicates of the consumers (trigger.service keywordFlow / liveConfigured / enrolment, schedule.sweeper,
 *     flow-reader, the admin counters, the idx_flows_live_trigger index): they must find ZERO imported flows, ZERO active keyword
 *     replies and ZERO active widgets; nothing in the tables a running flow, a subscriber, a visitor or a send would write,
 *   - the widgets (token shape, uniqueness, never a value of the dump) and that no AI key of the dump is anywhere in the target,
 *   - which Waboo settings have no column (NOT PRESENT), counted over the rows that did load.
 * Rows the source does not account for are caught by the generic extra-row check of reconcile/index.ts (the uuid sets) and by the
 * baseline digest (outbox, notifications, subscribers, runs ... must stay empty).
 */
interface Args {
  db: Database;
  orgId: number;
  client: string;
  source: Source;
  plan: FlowPlan;
  settings: FlowSettings;
  referenceAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
  notPresent: Report['notPresent'];
}

const COLLECTIONS = [
  'chatbots',
  'chatbot_configuration',
  'chatbot_theme',
  'bot_flow_version',
  'bot_flow_version_data',
  'bot_workspace',
  'flows',
  'faq_variations',
  'broadcast_templates',
] as const;

const TOKEN_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bEA[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/,
  /-----BEGIN [A-Z ]+-----/,
];

const flat = (nodeId: string): string => nodeId.replace(/-/g, '');
const ts = (iso: string | null): string | null => (iso === null ? null : `${iso.slice(0, -1)}000`);

export async function verifyFlows(a: Args): Promise<void> {
  const { db, orgId, client, plan, settings, alarm } = a;
  const read = async (c: string): Promise<Doc[]> => {
    const out: Doc[] = [];
    if (a.source.collections(client).includes(c))
      for await (const d of a.source.read(client, c)) out.push(d);
    return out;
  };
  const docs = Object.fromEntries(
    await Promise.all(COLLECTIONS.map(async (c) => [c, await read(c)] as const)),
  );
  const input: OInput = {
    chatbots: docs.chatbots!,
    configs: docs.chatbot_configuration!,
    themes: docs.chatbot_theme!,
    versions: docs.bot_flow_version!,
    data: docs.bot_flow_version_data!,
    workspace: docs.bot_workspace!,
    headers: docs.flows!,
    faqs: docs.faq_variations!,
    templates: docs.broadcast_templates!,
  };
  const opt: OOptions = {
    policy: settings.flowVersion,
    widgetsForWhatsappBots: settings.widgetsForWhatsappBots,
    flowLimit: settings.flowLimit,
    widgetLimit: settings.widgetLimit,
    fallbackAt: a.referenceAt,
  };
  const { bots, order } = oracleBots(input, opt);

  // 1. the loader's plan against the oracle ------------------------------------------------------------------------------------
  if (order.join('|') !== plan.botOrder.join('|'))
    alarm(
      'PLAN_ORACLE_MISMATCH: the bots of the plan differ from the bots the oracle finds in the dump',
    );
  const names = new Map<string, string>();
  const loadedBots: OBot[] = [];
  for (const id of order) {
    const o = bots.get(id)!;
    const p = plan.bots.get(id);
    if (!p) {
      alarm(`PLAN_ORACLE_MISMATCH: bot ${id.slice(0, 8)} is not in the plan`);
      continue;
    }
    const want = o.stop ? `${o.stop.kind} ${o.stop.code}` : 'load';
    const got = p.verdict.kind === 'load' ? 'load' : `${p.verdict.kind} ${p.verdict.code}`;
    if (want === 'load' && got === 'quarantine SECRET_IN_FLOW') {
      // the plan also redacts key=value pairs and the like: stricter than the oracle is safe, and visible
      a.warnings.push(
        `FLOWS: bot ${id.slice(0, 8)} is quarantined SECRET_IN_FLOW by a rule the oracle does not apply`,
      );
      continue;
    }
    if (want !== got) {
      alarm(
        `PLAN_ORACLE_MISMATCH: bot ${id.slice(0, 8)} is "${got}" in the plan but the oracle says "${want}"`,
      );
      continue;
    }
    if (o.stop || !o.shape) continue;
    loadedBots.push(o);
    if (
      p.stats.nodes !== o.shape.nodeCount ||
      p.stats.edges !== o.shape.edgeCount ||
      p.stats.steps !== o.shape.steps
    )
      alarm(
        `PLAN_ORACLE_MISMATCH: bot ${id.slice(0, 8)} has ${p.stats.nodes} steps / ${p.stats.edges} links in the plan, the oracle derives ${o.shape.nodeCount} / ${o.shape.edgeCount} from the node records`,
      );
    names.set(id, o.baseName);
  }

  const missing = Number(
    (
      (
        await db.execute(
          sql`SELECT count(*)::int AS n FROM migration.quarantine WHERE source_client = ${client} AND reason_code = 'ADOPT_TARGET_MISSING'`,
        )
      ).rows[0] as { n: number }
    ).n,
  );
  if (missing > 0)
    alarm(
      `ADOPT_TARGET_MISSING: ${missing} document(s) could not be adopted into a flow or widget row that should exist`,
    );

  // 2. the loaded flows, in the target ---------------------------------------------------------------------------------------------
  const rows = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`
        SELECT uuid::text AS uuid, flow_name, flow_data, category, trigger_kind, trigger_keywords, is_published, is_active,
               published_at, provider, flow_type,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
               to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS updated_at
        FROM flows WHERE org_id = ${orgId}`),
    )
  ).rows as Array<Record<string, any>>;
  const byUuid = new Map(rows.map((r) => [String(r.uuid), r]));
  const templateIds = new Set<string>();
  for (const t of input.templates)
    for (const k of [t._id, t.id, t.template_id, t.meta_template_id])
      if (text(k)) templateIds.add(hexKey(k));
  let lossTotals = { flows: 0, steps: 0, links: 0 };
  for (const o of loadedBots) {
    const uuid = uuidv5(`${client}|flow_bots|${o.botId}`);
    const r = byUuid.get(uuid);
    const tag = `flow of bot ${o.botId.slice(0, 8)}`;
    if (!r) {
      alarm(`TARGET_MISSING: the ${tag} does not exist in the target`);
      continue;
    }
    const sh = o.shape!;
    const fd = (typeof r.flow_data === 'string' ? JSON.parse(r.flow_data) : r.flow_data) as {
      flowNodes?: Array<{
        id: string;
        type: string;
        isStart?: boolean;
        data?: Record<string, unknown>;
      }>;
      flowEdges?: Array<{ source: string; sourceHandle: string; target: string }>;
    };
    const nodes = fd?.flowNodes ?? [];
    const edges = fd?.flowEdges ?? [];
    {
      if (nodes.length !== sh.nodeCount)
        alarm(
          `FLOW_GRAPH: ${tag} has ${nodes.length} steps, the node records give ${sh.nodeCount}`,
        );
      if (edges.length !== sh.edgeCount)
        alarm(
          `FLOW_GRAPH: ${tag} has ${edges.length} links, the node records give ${sh.edgeCount}`,
        );
    }
    const ids = new Set(nodes.map((n) => n.id));
    if (ids.size !== nodes.length) alarm(`FLOW_GRAPH: ${tag} has two steps with the same id`);
    const triggers = nodes.filter((n) => n.type === 'trigger');
    const starts = nodes.filter((n) => n.isStart);
    if (triggers.length !== 1 || starts.length !== 1 || starts[0] !== triggers[0])
      alarm(
        `FLOW_GRAPH: ${tag} must have exactly one trigger step and it must be the start (${triggers.length} triggers, ${starts.length} starts)`,
      );
    const lost = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    if (lost.length > 0)
      alarm(`FLOW_GRAPH: ${tag} has ${lost.length} link(s) to a step that does not exist`);
    const into = new Set(edges.map((e) => e.target));
    const orphans = nodes.filter((n) => n.type !== 'trigger' && !into.has(n.id)).length;
    if (orphans !== sh.orphanCount)
      alarm(
        `FLOW_GRAPH: ${tag} has ${orphans} step(s) with no way in; the node records give ${sh.orphanCount} (a new orphan means a link was lost)`,
      );
    const trig = triggers[0];
    const out = edges.find((e) => trig && e.source === trig.id && e.sourceHandle === 'out');
    if (!out) alarm(`FLOW_GRAPH: the trigger of the ${tag} leads nowhere`);
    else if (!`n_${flat(sh.firstNodeId)}`.startsWith(out.target))
      alarm(`FLOW_GRAPH: the trigger of the ${tag} leads to the wrong step`);
    // every source step is there exactly once: its id is n_ + a prefix (8 or more characters) of the node id without dashes
    for (const sid of o.stepIds) {
      const f = `n_${flat(sid)}`;
      const hits = nodes.filter(
        (n) => n.id.length >= 10 && f.startsWith(n.id) && n.type !== 'assign',
      ).length;
      if (hits !== 1) {
        alarm(
          `FLOW_GRAPH: step ${sid.slice(0, 8)} of the ${tag} is present ${hits} times (expected once)`,
        );
        break;
      }
    }
    // template steps carry a NAME, never an id of the dump
    for (const n of nodes.filter((x) => x.type === 'template')) {
      const v = text(n.data?.tpl);
      if (templateIds.has(v) || /^[0-9a-f]{24}$/i.test(v))
        alarm(
          `FLOW_TEMPLATE_ID: a template step of the ${tag} carries a Waboo template id instead of a name`,
        );
    }
    // no credential in the text
    const body = JSON.stringify(fd);
    if (TOKEN_SHAPES.some((re) => re.test(body)))
      alarm(`FLOW_SECRET: the ${tag} holds text that looks like a credential`);
    // columns the oracle knows
    const base = o.baseName;
    if (!(
      r.flow_name === base ||
      new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)$`).test(
        String(r.flow_name),
      )
    ))
      alarm(`FLOW_COLUMN: the ${tag} is named differently from its bot`);
    const kw = sh.keywords;
    const wantKw = chars255(kw) ? null : kw;
    if ((r.trigger_keywords ?? null) !== wantKw)
      alarm(
        `FLOW_COLUMN: trigger_keywords of the ${tag} differ from the words of the Intent / FAQ records`,
      );
    if (
      r.category !== 'Waboo chatbot' ||
      r.provider !== 'waba' ||
      r.flow_type !== 'chat' ||
      r.trigger_kind !== 'keyword'
    )
      alarm(
        `FLOW_COLUMN: category / provider / flow_type / trigger_kind of the ${tag} are not what the import writes`,
      );
    if (r.created_at !== ts(o.created) || (!a.allowExtraRows && r.updated_at !== ts(o.updated)))
      alarm(`FLOW_COLUMN: created_at / updated_at of the ${tag} are not the dates of the source`);
    lossTotals = {
      flows: lossTotals.flows + 1,
      steps: lossTotals.steps + nodes.length,
      links: lossTotals.links + edges.length,
    };
  }
  // the equation behind the step column: every flow in the target belongs to a bot the oracle loads
  const expectedUuids = new Set(loadedBots.map((o) => uuidv5(`${client}|flow_bots|${o.botId}`)));
  if (!a.allowExtraRows)
    for (const r of rows)
      // the flows of the advanced automations (category "Waboo automation") are held to account by reconcile/automation.ts
      if (!expectedUuids.has(String(r.uuid)) && r.category !== 'Waboo automation')
        alarm(
          `EXTRA_ROWS: flows row ${String(r.uuid)} is not accounted for by any bot of the dump`,
        );

  // 3. SAFETY: the consumers' own predicates must find nothing -------------------------------------------------------------------
  const q1 = async (text_: string): Promise<number> =>
    Number(
      (
        (await withTenant(db, { orgId }, (tx) => tx.execute(sql.raw(text_)))).rows[0] as {
          n: number | string;
        }
      ).n,
    );
  const exists = async (t: string): Promise<boolean> =>
    Boolean(
      (
        (await db.execute(sql.raw(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`)))
          .rows[0] as { ok: boolean }
      ).ok,
    );
  if (!a.allowExtraRows) {
    // the flow-state step armed these on purpose (published and active as in Waboo): they are not a safety finding
    const armedNow = await armedFlowUuids(db, client);
    const notArmed = armedNow.size ? ` AND uuid::text NOT IN (${[...armedNow].map((u) => `'${u.replace(/'/g, '')}'`).join(',')})` : '';
    const probes: Array<[string, string]> = [
      ['is_published OR is_active', 'is_published OR is_active'],
      [
        'trigger.service keywordFlow (live keyword flow)',
        "is_published AND is_active AND trigger_kind = 'keyword' AND coalesce(trigger_keywords, '') <> ''",
      ],
      [
        'trigger.service enrolment / liveConfigured / flow-reader (is_published AND is_active)',
        'is_published AND is_active',
      ],
      [
        'schedule.sweeper (schedule, date_field_match)',
        "is_published AND is_active AND trigger_kind IN ('schedule', 'date_field_match')",
      ],
      ['idx_flows_live_trigger / admin overview (live flows)', 'is_published AND is_active'],
      [
        'a trigger armed for a channel or a device',
        'trigger_channel_id IS NOT NULL OR trigger_device_id IS NOT NULL',
      ],
    ];
    for (const [name, where] of probes) {
      const n = await q1(`SELECT count(*) AS n FROM flows WHERE org_id = ${orgId} AND (${where})${notArmed}`);
      if (n > 0)
        alarm(
          `SENDABLE_FLOW: ${n} imported flow(s) are picked up by ${name}: an imported flow must be unpublished AND inactive`,
        );
    }
    const live = await q1(
      `SELECT count(*) AS n FROM keyword_replies WHERE org_id = ${orgId} AND (status OR is_flow_trigger)`,
    );
    if (live > 0)
      alarm(
        `SENDABLE_KEYWORD: ${live} imported keyword reply(ies) are active (status true) or flow triggers: they would answer customers`,
      );
    const wlive = await q1(
      `SELECT count(*) AS n FROM chatbot_widgets WHERE org_id = ${orgId} AND (status <> 'paused' OR jsonb_array_length(coalesce(allowed_domains, '[]'::jsonb)) = 0)`,
    );
    if (wlive > 0)
      alarm(
        `SENDABLE_WIDGET: ${wlive} imported widget(s) are active or have an open allow-list (an empty list answers every origin)`,
      );
    const alive = await q1(
      `SELECT count(*) AS n FROM ai_chat_assistants WHERE org_id = ${orgId} AND status = 'active'`,
    );
    if (alive > 0) alarm(`SENDABLE_ASSISTANT: ${alive} imported AI assistant(s) are active`);
    for (const t of [
      'flow_runs',
      'flow_run_steps',
      'flow_subscribers',
      'flb_geta_publish_syncs',
      'keyword_reply_contents',
      'keyword_reply_logs',
      'auto_reply_lookups',
      'chatbot_widget_visitors',
      'event_outbox',
    ]) {
      if (!(await exists(t))) continue;
      const n = await q1(`SELECT count(*) AS n FROM ${t} WHERE org_id = ${orgId}`);
      if (n > 0)
        alarm(
          `SIDE_EFFECT: ${n} row(s) in ${t}: the import writes none (no run, no subscriber, no log, no outbox event)`,
        );
    }
  }

  // 4. keyword replies from faq_variations ----------------------------------------------------------------------------------------
  const flowLoads = (b: string): boolean =>
    bots.get(b)?.stop === null || bots.get(b)?.stop === undefined
      ? bots.has(b) && !bots.get(b)!.stop
      : false;
  const faq = oracleFaq(input, flowLoads);
  const kr = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`
        SELECT k.uuid::text AS uuid, k.keyword, k.status, k.reply_type, k.is_flow_trigger, k.flow_id, f.uuid::text AS flow_uuid
        FROM keyword_replies k LEFT JOIN flows f ON f.org_id = k.org_id AND f.id = k.flow_id
        WHERE k.org_id = ${orgId}`),
    )
  ).rows as Array<{
    uuid: string;
    keyword: string;
    status: boolean;
    reply_type: string;
    is_flow_trigger: boolean;
    flow_id: number | null;
    flow_uuid: string | null;
  }>;
  const krByUuid = new Map(kr.map((r) => [r.uuid, r]));
  let faqRows = 0;
  for (const [key, v] of faq) {
    const p = plan.faq.get(`faq_variations\u0000${key}`);
    if ('code' in v) {
      if (!p || p.kind === 'load' || p.code !== v.code)
        alarm(
          `PLAN_ORACLE_MISMATCH: faq_variations ${key.slice(0, 8)} is not "${v.code}" in the plan`,
        );
      continue;
    }
    if (!p || p.kind !== 'load' || p.chunks.length !== v.rows) {
      alarm(
        `PLAN_ORACLE_MISMATCH: faq_variations ${key.slice(0, 8)} should become ${v.rows} keyword row(s)`,
      );
      continue;
    }
    const got = new Set<string>();
    for (let i = 0; i < v.rows; i++) {
      const r = krByUuid.get(
        uuidv5(`${client}|faq_variations|${key}${i === 0 ? '' : `#${i + 1}`}`),
      );
      faqRows++;
      if (!r) {
        alarm(
          `TARGET_MISSING: keyword reply ${i + 1} of faq_variations ${key.slice(0, 8)} does not exist`,
        );
        continue;
      }
      if (r.reply_type !== 'flow' || r.flow_uuid !== uuidv5(`${client}|flow_bots|${v.botId}`))
        alarm(
          `KEYWORD_COLUMN: keyword reply of faq_variations ${key.slice(0, 8)} does not start the flow of its bot`,
        );
      for (const w of r.keyword.split(', ')) got.add(w.toLowerCase());
    }
    const want = new Set(v.phrases.map((x) => x.toLowerCase()));
    if ([...want].some((x) => !got.has(x)) || [...got].some((x) => !want.has(x)))
      alarm(
        `KEYWORD_COLUMN: the keywords of faq_variations ${key.slice(0, 8)} are not its phrases`,
      );
  }
  if (!a.allowExtraRows && kr.length !== faqRows)
    alarm(
      `EXTRA_ROWS: keyword_replies holds ${kr.length} row(s), the dump accounts for ${faqRows}`,
    );

  // 5. widgets and assistants -------------------------------------------------------------------------------------------------------
  const ow = oracleWidgets(input, opt, flowLoads);
  if (ow.order.join('|') !== plan.widgetOrder.join('|'))
    alarm('PLAN_ORACLE_MISMATCH: the widgets of the plan differ from the widgets the oracle finds');
  const wr = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`
        SELECT w.uuid::text AS uuid, w.name, w.slug, w.embed_token, w.mode, w.target_whatsapp_cc, w.target_whatsapp_number,
               w.prefilled_message, w.position, w.button_color, w.welcome_message, w.auto_open, w.button_label,
               w.action_button_bg, w.action_button_text_color, w.status, w.allowed_domains, w.assistant_id,
               a.uuid::text AS assistant_uuid, a.ai_model, a.system_prompt, a.status AS assistant_status
        FROM chatbot_widgets w LEFT JOIN ai_chat_assistants a ON a.org_id = w.org_id AND a.id = w.assistant_id
        WHERE w.org_id = ${orgId}`),
    )
  ).rows as Array<Record<string, any>>;
  const wByUuid = new Map(wr.map((r) => [String(r.uuid), r]));
  const tokens = new Map<string, number>();
  for (const r of wr)
    tokens.set(String(r.embed_token), (tokens.get(String(r.embed_token)) ?? 0) + 1);
  const sourceStrings = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.length >= 16 && v.length <= 80) sourceStrings.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Doc).forEach(walk);
  };
  for (const c of ['chatbots', 'chatbot_configuration', 'chatbot_theme'] as const)
    docs[c]!.forEach(walk);
  let widgetRows = 0;
  for (const id of ow.order) {
    const o = ow.widgets.get(id)!;
    const pw = plan.widgets.get(id);
    if (o.stop) {
      if (pw?.verdict.kind === 'load')
        alarm(
          `PLAN_ORACLE_MISMATCH: widget of bot ${id.slice(0, 8)} is over the plan limit but the plan loads it`,
        );
      continue;
    }
    if (!pw || pw.verdict.kind !== 'load') {
      alarm(`PLAN_ORACLE_MISMATCH: widget of bot ${id.slice(0, 8)} is not loaded by the plan`);
      continue;
    }
    widgetRows++;
    const r = wByUuid.get(uuidv5(`${client}|widgets|${id}`));
    const tag = `widget of bot ${id.slice(0, 8)}`;
    if (!r) {
      alarm(`TARGET_MISSING: the ${tag} does not exist in the target`);
      continue;
    }
    const diffs: string[] = [];
    const eq = (col: string, got: unknown, want: unknown): void => {
      if ((got ?? null) !== (want ?? null)) diffs.push(col);
    };
    eq('mode', r.mode, o.mode);
    eq('position', r.position, o.position);
    eq('target_whatsapp_number', r.target_whatsapp_number, o.number);
    eq('target_whatsapp_cc', r.target_whatsapp_cc, null);
    eq('welcome_message', r.welcome_message, o.welcome);
    eq('prefilled_message', r.prefilled_message, o.prefilled);
    eq('button_label', r.button_label, o.label);
    eq('auto_open', r.auto_open, o.autoOpen);
    eq('button_color', r.button_color, o.buttonColor);
    eq('action_button_bg', r.action_button_bg, o.actionBg);
    eq('action_button_text_color', r.action_button_text_color, o.actionText);
    if (!a.allowExtraRows) eq('status', r.status, 'paused');
    if (!(r.name === o.name)) diffs.push('name');
    if (diffs.length > 0)
      alarm(`WIDGET_COLUMN: the ${tag} differs from the oracle in ${diffs.join(', ')}`);
    const dom = Array.isArray(r.allowed_domains) ? r.allowed_domains : [];
    if (!a.allowExtraRows && (dom.length !== 1 || dom[0] !== 'migration-import.invalid'))
      alarm(`SENDABLE_WIDGET: the ${tag} has an allow-list other than the closed one`);
    const tok = String(r.embed_token);
    if (!/^[A-Za-z0-9]{48}$/.test(tok))
      alarm(`WIDGET_TOKEN: the ${tag} has an embed token that is not 48 characters of [A-Za-z0-9]`);
    if ((tokens.get(tok) ?? 0) !== 1)
      alarm(`WIDGET_TOKEN: the embed token of the ${tag} is not unique`);
    if (sourceStrings.has(tok))
      alarm(
        `WIDGET_TOKEN: the embed token of the ${tag} is a value of the dump (a token must be generated, never copied)`,
      );
    if (o.hasAssistant !== (r.assistant_id !== null))
      alarm(`WIDGET_COLUMN: the ${tag} should${o.hasAssistant ? '' : ' not'} have an AI assistant`);
    if (o.hasAssistant && r.assistant_id !== null) {
      if (r.ai_model !== o.model)
        alarm(
          `WIDGET_COLUMN: the assistant of the ${tag} runs another model than the configuration says`,
        );
      if (r.assistant_status !== 'paused')
        alarm(`SENDABLE_ASSISTANT: the assistant of the ${tag} is not paused`);
      const planned = pw.soft.some((s) => s.code === 'PROMPT_REDACTED');
      if (!planned && (r.system_prompt ?? null) !== o.prompt)
        alarm(
          `WIDGET_COLUMN: the prompt of the assistant of the ${tag} differs from the configuration`,
        );
    }
  }
  if (!a.allowExtraRows && wr.length !== widgetRows)
    alarm(
      `EXTRA_ROWS: chatbot_widgets holds ${wr.length} row(s), the dump accounts for ${widgetRows}`,
    );
  // config / theme documents: adopted exactly when a widget uses them
  for (const [list, used, name] of [
    [input.configs, ow.usedConfig, 'chatbot_configuration'],
    [input.themes, ow.usedTheme, 'chatbot_theme'],
  ] as const)
    for (const d of list) {
      const k = d._id !== undefined && d._id !== null ? hexKey(d._id) : text(d.id);
      const v = plan.docs.get(`${name}\u0000${k}`);
      const wantUsed = used.has(k);
      if (wantUsed !== (v?.kind === 'adopt'))
        alarm(
          `PLAN_ORACLE_MISMATCH: ${name} ${k.slice(0, 8)} is ${v?.kind === 'adopt' ? 'adopted' : 'excluded'} by the plan but the oracle says it is ${wantUsed ? 'used by a widget' : 'unused'}`,
        );
    }

  // 6. the node collection, counted by reason: the oracle against the plan --------------------------------------------------------
  const want = new Map<string, number>();
  const bump = (k: string): void => void want.set(k, (want.get(k) ?? 0) + 1);
  const dataBy = new Map<string, Doc[]>();
  for (const d of input.data) {
    const b = typeof d.botid === 'string' ? d.botid.trim() : '';
    if (!b) bump('quarantine NO_BOT_ID');
    else dataBy.set(b, [...(dataBy.get(b) ?? []), d]);
  }
  for (const [b, list] of dataBy) {
    const o = bots.get(b);
    if (!o || o.stop || !o.shape) {
      for (let i = 0; i < list.length; i++) bump('exclude BOT_NOT_IMPORTED');
      continue;
    }
    if (o.candidate === 'workspace') {
      for (let i = 0; i < list.length; i++) bump('exclude OLDER_VERSION');
      continue;
    }
    const inSel = list.filter((d) =>
      o.versionId === null ? text(d.version_id) === '' : text(d.version_id) === o.versionId,
    );
    for (const x of classify(inSel))
      bump(
        x.cls === 'step'
          ? 'adopt'
          : x.cls === 'bad'
            ? 'quarantine BAD_NODE'
            : `exclude ${({ unsupported: 'UNSUPPORTED_STEP', duplicate: 'DUPLICATE_NODE', optinout: 'OPT_IN_OUT' } as Record<string, string>)[x.cls]}`,
      );
    for (let i = 0; i < list.length - inSel.length; i++) bump('exclude OLDER_VERSION');
  }
  const have = new Map<string, number>();
  for (const [k, v] of plan.docs) {
    if (!k.startsWith('bot_flow_version_data\u0000')) continue;
    const key = v.kind === 'adopt' ? 'adopt' : `${v.kind} ${v.code}`;
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  for (const k of new Set([...want.keys(), ...have.keys()]))
    if ((want.get(k) ?? 0) !== (have.get(k) ?? 0))
      alarm(
        `PLAN_ORACLE_MISMATCH: bot_flow_version_data "${k}": the plan has ${have.get(k) ?? 0}, the oracle ${want.get(k) ?? 0}`,
      );

  // 7. no AI key of the dump is anywhere in the target -------------------------------------------------------------------------------
  const secrets = [...ow.widgets.values()].flatMap((w) => w.secretValues);
  if (secrets.length > 0) {
    for (const [table, col] of [
      ['chatbot_widgets', 'to_jsonb(t)::text'],
      ['ai_chat_assistants', 'to_jsonb(t)::text'],
      ['flows', 'to_jsonb(t)::text'],
    ] as const) {
      const body = (
        (
          await withTenant(db, { orgId }, (tx) =>
            tx.execute(
              sql.raw(
                `SELECT coalesce(string_agg(${col}, ' '), '') AS b FROM ${table} t WHERE org_id = ${orgId}`,
              ),
            ),
          )
        ).rows[0] as { b: string }
      ).b;
      if (secrets.some((s) => body.includes(s)))
        alarm(`SECRET_LEAK: a key of the AI configuration of the dump appears in ${table}`);
    }
    const qb = (
      (
        await db.execute(
          sql`SELECT coalesce(string_agg(doc::text || reason, ' '), '') AS b FROM migration.quarantine WHERE source_client = ${client}`,
        )
      ).rows[0] as { b: string }
    ).b;
    if (secrets.some((s) => qb.includes(s)))
      alarm(
        'SECRET_LEAK: a key of the AI configuration of the dump appears in migration.quarantine',
      );
  }

  // 8. NOT PRESENT: counted over the rows that did load ---------------------------------------------------------------------------------
  const soft = (
    await db.execute(sql`
      SELECT reason_code AS code, doc FROM migration.quarantine
      WHERE source_client = ${client} AND collection IN ('flow_bots', 'widgets', 'faq_variations') AND source_key LIKE '%#%'`)
  ).rows as Array<{ code: string; doc: { detail?: any } | null }>;
  const sum = (code: string, f: (d: any) => number): number =>
    soft.filter((s) => s.code === code).reduce((n, s) => n + f(s.doc?.detail ?? {}), 0);
  const nf = loadedBots.length;
  const loss = soft.filter((s) => s.code === 'CONVERSION_LOSS');
  const lossKeys = [
    'quickActions',
    'apiActions',
    'otherActions',
    'templateVariables',
    'multiLanguage',
    'extraResponses',
    'headers',
    'liveAgentButtons',
    'otherButtons',
  ];
  const parts = lossKeys
    .map((k) => `${k} ${loss.reduce((n, s) => n + (Number(s.doc?.detail?.[k]) || 0), 0)}`)
    .filter((x) => !x.endsWith(' 0'));
  if (nf > 0)
    a.notPresent.droppedFields.push(
      `NOT PRESENT (flows): ${loss.length} of ${nf} flows lose something in conversion (${parts.join(', ') || 'only unsupported steps'}); per-flow counts are in migration.quarantine CONVERSION_LOSS`,
    );
  const unsupported = loss.reduce(
    (n, s) =>
      n +
      Object.values((s.doc?.detail?.unsupportedSteps ?? {}) as Record<string, number>).reduce(
        (x, y) => x + Number(y),
        0,
      ),
    0,
  );
  if (unsupported > 0)
    a.notPresent.droppedFields.push(
      `NOT PRESENT (flows): ${unsupported} step(s) of an unsupported subType were left out (UNSUPPORTED_STEP)`,
    );
  const tpls = sum('TEMPLATE_UNRESOLVED', (d) => Number(d.steps) || 0);
  if (tpls > 0)
    a.notPresent.droppedFields.push(
      `NOT PRESENT (flows): ${tpls} template step(s) wait for the template sync (${sum('TEMPLATE_UNRESOLVED', (d) => Number(d.unnamed) || 0)} have no name at all)`,
    );
  const cnp = soft.filter((s) => s.code === 'CONFIG_NOT_PRESENT');
  const keyCounts = new Map<string, number>();
  for (const s of cnp)
    for (const k of [
      ...(s.doc?.detail?.configuration ?? []),
      ...(s.doc?.detail?.theme ?? []),
    ] as string[])
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  for (const [k, n] of [...keyCounts].sort())
    a.notPresent.droppedFields.push(
      `NOT PRESENT (widgets): configuration / theme key "${k}" (${n} of ${widgetRows} widgets) has no column`,
    );
  const refs = soft.filter((s) => s.code === 'FILE_REF_PENDING').length;
  if (refs > 0)
    a.notPresent.droppedFields.push(
      `NOT PRESENT (widgets): ${refs} widget(s) have an image that is a file reference (comes with the files step)`,
    );
  void lossTotals;
  for (const code of [
    'TEMPLATE_UNRESOLVED',
    'NO_PUBLISHED_VERSION',
    'VERSION_EMPTY',
    'PROPERTY_NOT_FOUND',
    'DEFAULT_TRIGGER_WORD',
    'JOURNEY_DIVERGES',
  ])
    if (soft.some((s) => s.code === code))
      a.warnings.push(
        `FLOWS: ${soft.filter((s) => s.code === code).length} flow(s) carry the soft issue ${code} (see migration.quarantine)`,
      );
  // the soft rows owed: every planned soft code of a loaded flow has its quarantine row
  const have2 = new Map<string, number>();
  for (const s of soft) have2.set(s.code, (have2.get(s.code) ?? 0) + 1);
  const owed = new Map<string, number>();
  for (const p of plan.bots.values())
    if (p.verdict.kind === 'load')
      for (const c of new Set(p.soft.map((x) => x.code))) owed.set(c, (owed.get(c) ?? 0) + 1);
  for (const w of plan.widgets.values())
    if (w.verdict.kind === 'load')
      for (const c of new Set(w.soft.map((x) => x.code))) owed.set(c, (owed.get(c) ?? 0) + 1);
  for (const [c, n] of owed)
    if ((have2.get(c) ?? 0) < n)
      alarm(
        `SOFT_ISSUES_MISSING: ${n} ${c} soft issue(s) are owed by the loaded rows, the quarantine log has ${have2.get(c) ?? 0}`,
      );
}

function chars255(s: string): boolean {
  return Array.from(s).length > 255 && !['*', '.*', '.+', 'any'].includes(s.trim());
}
