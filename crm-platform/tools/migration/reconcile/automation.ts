import { armedFlowUuids } from '../load/flowstate';
import type { Source } from '../extract/source';
import { sql, withTenant, type Database } from '../load/db';
import { looksLikeToken, scrub, type Doc } from '../util';
import { CATEGORY, flowUuid, oracleAutomations } from './oracle-automation';
import type { Report } from './index';

/**
 * The verifier of the advanced automations. What it believes about the source comes from reconcile/oracle-automation.ts (a second
 * implementation of the rules: imports nothing from transform/, flows/ or automation/); what it believes about the target it reads here.
 *   - the loader's verdicts (kind and code) against the oracle's, document by document, for both collections,
 *   - every loaded flow IN THE TARGET: columns, the node and link counts the oracle derives, exactly one trigger and it is the start,
 *     every link has both ends, every Waboo node is present exactly once with the WaDesk type the mapping gives, the trigger kind,
 *     the placeholder and detached counts, no credential in the graph,
 *   - SAFETY with the predicates of the consumers (trigger.service, schedule.sweeper, launch / engine, flow-reader, the admin counters,
 *     idx_flows_live_trigger): zero hits; nothing in the tables a run, a subscriber or a send would write,
 *   - extra rows: a flow of this category that no automation accounts for; id_map both ways (metadata keys, automationId, journey rows),
 *   - the soft issues owed by the loaded rows, and the NOT PRESENT lines (counted).
 */
interface Args {
  db: Database;
  orgId: number;
  client: string;
  source: Source;
  fallbackAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
  notPresent: Report['notPresent'];
}

type Rec = Record<string, any>;
const read = async (s: Source, client: string, c: string): Promise<Doc[]> => {
  const out: Doc[] = [];
  if (s.collections(client).includes(c)) for await (const d of s.read(client, c)) out.push(d);
  return out;
};

export async function verifyAutomations(a: Args): Promise<void> {
  const { db, orgId, client, alarm } = a;
  const [metaDocs, journeyDocs] = await Promise.all([
    read(a.source, client, 'automation_metadata'),
    read(a.source, client, 'automation_journey'),
  ]);
  const o = oracleAutomations(metaDocs, journeyDocs, a.fallbackAt);
  const q = async (text: string): Promise<Array<Record<string, any>>> =>
    (await withTenant(db, { orgId }, (tx) => tx.execute(sql.raw(text)))).rows as Array<
      Record<string, any>
    >;

  // 1. the verdicts the loader recorded, against the oracle's -----------------------------------------------------------------------
  const quar = (
    await db.execute(
      sql`SELECT collection, source_key, reason_code, doc FROM migration.quarantine WHERE source_client = ${client} AND collection IN ('automation_metadata', 'automation_journey')`,
    )
  ).rows as Array<{ collection: string; source_key: string; reason_code: string; doc: any }>;
  const hard = new Map<string, string>(); // collection \0 key -> code
  const softRows = new Map<string, Array<{ code: string; doc: any }>>();
  for (const r of quar) {
    if (r.source_key.includes('#')) {
      const base = r.source_key.slice(0, r.source_key.indexOf('#'));
      const k = `${r.collection}\u0000${base}`;
      softRows.set(k, [...(softRows.get(k) ?? []), { code: r.reason_code, doc: r.doc }]);
    } else hard.set(`${r.collection}\u0000${r.source_key}`, r.reason_code);
  }
  const idmap = new Map<string, { table: string; uuid: string }>();
  for (const r of (
    await db.execute(
      sql`SELECT source_collection AS c, source_key AS k, target_table AS t, target_uuid::text AS u FROM migration.id_map WHERE source_client = ${client} AND source_collection IN ('automation_metadata', 'automation_journey')`,
    )
  ).rows as Array<{ c: string; k: string; t: string; u: string }>)
    idmap.set(`${r.c}\u0000${r.k}`, { table: r.t, uuid: r.u });

  const lists = new Map<string, string>(); // marketing_list key -> uuid of its group
  for (const r of (
    await db.execute(
      sql`SELECT source_key AS k, target_uuid::text AS u FROM migration.id_map WHERE source_client = ${client} AND source_collection = 'marketing_list'`,
    )
  ).rows as Array<{ k: string; u: string }>)
    lists.set(r.k, r.u);
  const flows = await q(
    `SELECT uuid::text AS uuid, flow_name, flow_data, category, trigger_kind, trigger_value, trigger_keywords, trigger_config, trigger_channel_id,
            trigger_device_id, trigger_last_occurrence, is_published, is_active, published_at, provider, flow_type,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS updated_at
     FROM flows WHERE org_id = ${orgId}`,
  );
  const byUuid = new Map(flows.map((f) => [String(f.uuid), f]));
  // flows the flow-state step armed on purpose (published and active as in Waboo); everything else must stay inert
  const armed = await armedFlowUuids(db, client);
  const notArmed = armed.size ? ` AND uuid::text NOT IN (${[...armed].map((u) => `'${u.replace(/'/g, '')}'`).join(',')})` : '';
  const ts = (iso: string): string => iso.replace('Z', '').padEnd(26, '0');
  const expected = new Set<string>();

  for (const [key, v] of o.meta) {
    const hardCode = hard.get(`automation_metadata\u0000${key}`);
    const mapped = idmap.get(`automation_metadata\u0000${key}`);
    if (v.kind !== 'load') {
      if (v.kind === 'quarantine' && hardCode !== v.code)
        alarm(
          `AUTOMATION_VERDICT: automation_metadata ${key.slice(-8)} should be quarantined ${v.code}, the log says ${hardCode ?? 'nothing'}`,
        );
      if (v.kind === 'exclude' && (hardCode || mapped))
        alarm(
          `AUTOMATION_VERDICT: automation_metadata ${key.slice(-8)} should be excluded (${v.code}) but is ${hardCode ?? 'loaded'}`,
        );
      continue;
    }
    const au = v.auto;
    const uuid = flowUuid(client, key);
    expected.add(uuid);
    const tag = `flow of automation ${key.slice(-8)}`;
    if (hardCode) {
      alarm(
        `AUTOMATION_VERDICT: automation_metadata ${key.slice(-8)} should load but is quarantined ${hardCode}`,
      );
      continue;
    }
    const r = byUuid.get(uuid);
    if (!r) {
      alarm(`TARGET_MISSING: the ${tag} does not exist in the target`);
      continue;
    }
    if (mapped?.uuid !== uuid || mapped.table !== 'flows')
      alarm(`AUTOMATION_ID_MAP: automation_metadata ${key.slice(-8)} does not point at its flow`);
    if (au.automationId && idmap.get(`automation_metadata\u0000${au.automationId}`)?.uuid !== uuid)
      alarm(`AUTOMATION_ID_MAP: automationId of ${key.slice(-8)} does not resolve to its flow`);
    // columns
    if (r.flow_name !== au.name)
      alarm(`AUTOMATION_COLUMN: flow_name of the ${tag} is not the name of the automation`);
    if (r.category !== CATEGORY || r.provider !== 'waba' || r.flow_type !== 'chat')
      alarm(
        `AUTOMATION_COLUMN: category / provider / flow_type of the ${tag} are not what the import writes`,
      );
    if (r.trigger_kind !== au.triggerKind)
      alarm(
        `AUTOMATION_COLUMN: trigger_kind of the ${tag} is ${r.trigger_kind}, the source gives ${au.triggerKind}`,
      );
    if (r.trigger_keywords !== null)
      alarm(`AUTOMATION_COLUMN: trigger_keywords of the ${tag} must be empty`);
    // an armed flow was updated when it was published (the app does the same), so its updated_at moves on; created_at never does
    if (
      r.created_at !== ts(au.created) ||
      (!a.allowExtraRows && !armed.has(String(r.uuid)) && r.updated_at !== ts(au.updated))
    )
      alarm(
        `AUTOMATION_COLUMN: created_at / updated_at of the ${tag} are not the dates of the source`,
      );
    // SAFETY (columns)
    if (armed.has(String(r.uuid))) {
      if (r.is_published !== true || r.is_active !== true || r.published_at === null)
        if (!a.allowExtraRows)
          alarm(`FLOW_STATE: the ${tag} was armed (live in Waboo) but is not published and active with a publish date`);
    } else if (r.is_published !== false || r.is_active !== false || r.published_at !== null) {
      if (!a.allowExtraRows)
        alarm(`SENDABLE_FLOW: the ${tag} is published, active or has a publish date`);
    }
    // the scheduler stamps trigger_last_occurrence on a live date trigger even with no channel connected: fine for an armed flow
    if (
      r.trigger_channel_id !== null ||
      r.trigger_device_id !== null ||
      (r.trigger_last_occurrence !== null && !armed.has(String(r.uuid)))
    )
      if (!a.allowExtraRows)
        alarm(
          `SENDABLE_FLOW: the trigger of the ${tag} is armed (channel / device / last occurrence)`,
        );
    // the graph
    const fd = (typeof r.flow_data === 'string' ? JSON.parse(r.flow_data) : r.flow_data) as {
      flowNodes?: Array<{ id: string; type: string; isStart?: boolean; data?: Rec }>;
      flowEdges?: Array<{ source: string; sourceHandle: string; target: string }>;
    };
    const nodes = fd?.flowNodes ?? [];
    const edges = fd?.flowEdges ?? [];
    if (!a.allowExtraRows) {
      if (nodes.length !== au.nodeCount)
        alarm(
          `AUTOMATION_GRAPH: the ${tag} has ${nodes.length} nodes, the definition gives ${au.nodeCount}`,
        );
      if (edges.length !== au.edgeCount)
        alarm(
          `AUTOMATION_GRAPH: the ${tag} has ${edges.length} links, the definition gives ${au.edgeCount}`,
        );
    }
    const ids = new Set(nodes.map((n) => n.id));
    if (ids.size !== nodes.length)
      alarm(`AUTOMATION_GRAPH: the ${tag} has two nodes with the same id`);
    const triggers = nodes.filter((n) => n.type === 'trigger');
    const starts = nodes.filter((n) => n.isStart);
    if (triggers.length !== 1 || starts.length !== 1 || starts[0] !== triggers[0])
      alarm(
        `AUTOMATION_GRAPH: the ${tag} must have exactly one trigger and it must be the start (${triggers.length} triggers, ${starts.length} starts)`,
      );
    const lost = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    if (lost.length > 0)
      alarm(
        `AUTOMATION_GRAPH: the ${tag} has ${lost.length} link(s) to a node that does not exist`,
      );
    const trig = triggers[0];
    if (trig && !a.allowExtraRows && String((trig.data as Rec)?.kind) !== au.triggerKind)
      alarm(`AUTOMATION_GRAPH: the trigger node of the ${tag} is not of kind ${au.triggerKind}`);
    // every Waboo node, exactly once, with the type the mapping gives
    const NOT_PRIMARY = new Set([
      'chain',
      'split_condition',
      'detached_delivered',
      'detached_failed',
    ]);
    for (const wid of au.nodeIds) {
      const hits = nodes.filter(
        (n) =>
          (n.data as Rec)?._waboo?.id === wid &&
          !NOT_PRIMARY.has(String((n.data as Rec)._waboo.role)),
      );
      if (hits.length !== 1) {
        alarm(
          `AUTOMATION_GRAPH: node ${wid.slice(0, 8)} of the ${tag} is present ${hits.length} times (expected once)`,
        );
        break;
      }
      const want = wid === au.primary ? 'trigger' : au.typeOf.get(wid);
      if (!a.allowExtraRows && hits[0]!.type !== want) {
        alarm(
          `AUTOMATION_GRAPH: node ${wid.slice(0, 8)} of the ${tag} is a ${hits[0]!.type}, the mapping gives ${want}`,
        );
        break;
      }
    }
    // placeholders and detached branches counted
    const ph = nodes.filter(
      (n) =>
        (n.data as Rec)?._waboo?.placeholder === true &&
        !String((n.data as Rec)._waboo.role).startsWith('detached'),
    ).length;
    const det = nodes.filter((n) =>
      String((n.data as Rec)?._waboo?.role ?? '').startsWith('detached'),
    ).length;
    if (!a.allowExtraRows && ph !== au.placeholders)
      alarm(
        `AUTOMATION_GRAPH: the ${tag} has ${ph} placeholder node(s), the definition gives ${au.placeholders}`,
      );
    if (!a.allowExtraRows)
      for (const x of nodes.filter((n) =>
        String((n.data as Rec)?._waboo?.role ?? '').startsWith('detached'),
      ))
        if (edges.some((e) => e.target === x.id))
          alarm(`AUTOMATION_GRAPH: a detached event node of the ${tag} is reachable`);
    void det;
    // a placeholder is inert
    for (const n of nodes.filter((x) => (x.data as Rec)?._waboo?.placeholder === true)) {
      const d = n.data as Rec;
      const inert =
        (n.type === 'update_contact' && d.field === '') ||
        (n.type === 'condition' && (d.conditions?.length ?? 0) === 0 && !d.conditionGroup) ||
        (n.type === 'trigger' && d.kind === 'manual_enroll');
      if (!inert)
        alarm(`AUTOMATION_GRAPH: a placeholder node of the ${tag} is not inert (${n.type})`);
    }
    // group trigger -> the list through id_map
    if (au.triggerKind === 'group_join' && trig && !a.allowExtraRows) {
      const ref = au.listKey ? lists.get(au.listKey) : undefined;
      if (String((trig.data as Rec)?.groupId ?? '') !== (ref ?? ''))
        alarm(
          `AUTOMATION_GRAPH: the group trigger of the ${tag} does not point at the group the id_map gives for its list`,
        );
    }
    // no credential in the graph
    if (scrub(fd).redacted.length > 0)
      alarm(`AUTOMATION_SECRET: the ${tag} holds a credential-looking entry`);
  }

  // 2. the journey rows --------------------------------------------------------------------------------------------------------------
  for (const [key, v] of o.journey) {
    const hardCode = hard.get(`automation_journey\u0000${key}`);
    const mapped = idmap.get(`automation_journey\u0000${key}`);
    if (v.kind === 'adopt') {
      const want = flowUuid(client, v.metaKey);
      if (hardCode)
        alarm(
          `AUTOMATION_VERDICT: automation_journey ${key.slice(-8)} should be adopted but is quarantined ${hardCode}`,
        );
      else if (mapped?.uuid !== want || mapped.table !== 'flows')
        alarm(
          `AUTOMATION_ID_MAP: automation_journey ${key.slice(-8)} does not point at the flow of its automation`,
        );
    } else if (v.kind === 'quarantine') {
      if (hardCode !== v.code)
        alarm(
          `AUTOMATION_VERDICT: automation_journey ${key.slice(-8)} should be quarantined ${v.code}, the log says ${hardCode ?? 'nothing'}`,
        );
      if (mapped)
        alarm(
          `AUTOMATION_ID_MAP: quarantined automation_journey ${key.slice(-8)} has an id_map row`,
        );
    } else if (hardCode || mapped)
      alarm(
        `AUTOMATION_VERDICT: automation_journey ${key.slice(-8)} should be excluded (${v.code}) but is ${hardCode ?? 'mapped'}`,
      );
  }
  // id_map has no row the oracle does not expect
  const wantMap = new Set<string>();
  for (const [k, v] of o.meta) if (v.kind === 'load') wantMap.add(`automation_metadata\u0000${k}`);
  for (const [k, v] of o.journey)
    if (v.kind === 'adopt') wantMap.add(`automation_journey\u0000${k}`);
  for (const k of idmap.keys()) {
    const [c, key] = k.split('\u0000') as [string, string];
    const isAlias =
      c === 'automation_metadata' &&
      [...o.meta.values()].some((v) => v.kind === 'load' && v.auto.automationId === key);
    if (!wantMap.has(k) && !isAlias)
      alarm(
        `AUTOMATION_ID_MAP: ${c} ${key.slice(-8)} has an id_map row the source does not justify`,
      );
  }

  // 3. SAFETY with the consumers' predicates -------------------------------------------------------------------------------------------
  if (!a.allowExtraRows && [...o.meta.values()].some((v) => v.kind === 'load')) {
    const n1 = async (where: string): Promise<number> =>
      Number(
        (await q(`SELECT count(*) AS n FROM flows WHERE org_id = ${orgId} AND (${where})${notArmed}`))[0]!.n,
      );
    for (const [name, where] of [
      [
        'trigger.service enrolLive / liveConfigured / launch / flow-reader / admin counters (is_published AND is_active)',
        'is_published AND is_active',
      ],
      [
        'schedule.sweeper (schedule, date_field_match)',
        "is_published AND is_active AND trigger_kind IN ('schedule', 'date_field_match')",
      ],
      [
        'trigger.service keywordFlow',
        "is_published AND is_active AND trigger_kind = 'keyword' AND coalesce(trigger_keywords, '') <> ''",
      ],
      [
        'a trigger armed for a channel or a device',
        'trigger_channel_id IS NOT NULL OR trigger_device_id IS NOT NULL',
      ],
      ['published or active at all', `(is_published OR is_active) AND category = '${CATEGORY}'`],
    ] as const) {
      const n = await n1(where);
      if (n > 0)
        alarm(
          `SENDABLE_FLOW: ${n} flow(s) are picked up by ${name}: an imported automation must be unpublished AND inactive`,
        );
    }
    for (const t of [
      'flow_runs',
      'flow_run_steps',
      'flow_subscribers',
      'flow_connected_devices',
      'flb_geta_publish_syncs',
      'event_outbox',
    ]) {
      const ex = (await db.execute(sql.raw(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`)))
        .rows[0] as { ok: boolean };
      if (!ex.ok) continue;
      const n = Number((await q(`SELECT count(*) AS n FROM ${t} WHERE org_id = ${orgId}`))[0]!.n);
      if (n > 0)
        alarm(
          `SIDE_EFFECT: ${n} row(s) in ${t}: the import writes none (no run, no subscriber, no log, no outbox event)`,
        );
    }
  }

  // 4. extra rows -----------------------------------------------------------------------------------------------------------------------
  if (!a.allowExtraRows)
    for (const f of flows)
      if (f.category === CATEGORY && !expected.has(String(f.uuid)))
        alarm(
          `EXTRA_ROWS: flows row ${f.uuid} (category ${CATEGORY}) is not accounted for by any automation of the dump`,
        );

  // 5. no credential of the source anywhere in the target ---------------------------------------------------------------------------------
  const secrets = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.length >= 16 && v.length <= 400 && looksLikeToken(v)) secrets.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Doc).forEach(walk);
  };
  walk(metaDocs);
  walk(journeyDocs);
  if (secrets.size > 0) {
    const all =
      JSON.stringify(flows.map((f) => f.flow_data)) + JSON.stringify(quar.map((r) => r.doc));
    for (const s of secrets)
      if (all.includes(s)) {
        alarm(
          'AUTOMATION_SECRET: a credential of the dump appears in flows or in migration.quarantine',
        );
        break;
      }
  }

  // 6. soft issues owed and NOT PRESENT -------------------------------------------------------------------------------------------------------
  const loaded = [...o.meta.values()].filter((v) => v.kind === 'load').length;
  const sums = new Map<string, number>();
  let withLoss = 0;
  for (const [k, rows] of softRows) {
    if (!k.startsWith('automation_metadata\u0000')) continue;
    for (const r of rows) {
      if (r.code === 'CONVERSION_LOSS') {
        withLoss++;
        for (const [lk, lv] of Object.entries((r.doc?.detail ?? {}) as Record<string, number>))
          sums.set(lk, (sums.get(lk) ?? 0) + Number(lv));
      }
    }
  }
  for (const [k, v] of o.meta) {
    if (v.kind !== 'load') continue;
    const rows = softRows.get(`automation_metadata\u0000${k}`) ?? [];
    for (const need of ['AUTOMATION_STATE'])
      if (!rows.some((r) => r.code === need))
        alarm(`SOFT_ISSUES_MISSING: automation ${k.slice(-8)} has no ${need} soft issue`);
    const ph = rows.find((r) => r.code === 'PLACEHOLDER_NODES');
    if ((ph ? Number(ph.doc?.detail) : 0) !== v.auto.placeholders)
      alarm(
        `SOFT_ISSUES_MISSING: automation ${k.slice(-8)} PLACEHOLDER_NODES is ${ph ? ph.doc?.detail : 0}, the definition gives ${v.auto.placeholders}`,
      );
    const dt = rows.find((r) => r.code === 'EVENT_BRANCH_DETACHED');
    if ((dt ? Number(dt.doc?.detail) : 0) !== v.auto.detachedPorts)
      alarm(
        `SOFT_ISSUES_MISSING: automation ${k.slice(-8)} EVENT_BRANCH_DETACHED is ${dt ? dt.doc?.detail : 0}, the definition gives ${v.auto.detachedPorts}`,
      );
  }
  if (loaded > 0) {
    const parts = [...sums].sort().map(([k, n]) => `${k} ${n}`);
    a.notPresent.droppedFields.push(
      `NOT PRESENT (automations): ${withLoss} of ${loaded} automation flows lose or approximate something in conversion (${parts.join(', ') || 'nothing counted'}); per-flow counts are in migration.quarantine CONVERSION_LOSS. Run counters, history, other versions, the UI layout beyond positions, template variables and buttons are not kept`,
    );
    a.warnings.push(
      `AUTOMATIONS: ${loaded} automation flow(s) were imported unpublished and inactive: a person must review each, bind a channel, and publish`,
    );
  }
}
