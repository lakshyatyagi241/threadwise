import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAccessConfig, type AccessConfig } from '../access/config';
import { coverage } from '../extract/coverage';
import { readManifest, verifyDump } from '../extract/manifest';
import type { Source } from '../extract/source';
import { connect, schemaReady, sql, withPrivileged, withTenant, type Database } from '../load/db';
import { digest, orgTables, quarantineDigest, type Baseline } from '../load/baseline';
import { ctxOf, IdMap, rowUuid } from '../load/engine';
import { ORG_COLLECTION } from '../load/org';
import { prepareAccess } from '../load/access';
import { verifyAccess } from './access';
import { verifyAutomations } from './automation';
import { verifyChat } from './chat';
import { verifyCampaigns } from './campaigns';
import { verifyCredits } from './credits';
import { verifyFaq } from './faq';
import { verifyFlows } from './flows';
import { verifyLeads } from './leads';
import { stepsNotRun } from '../load/steps';
import { resolveFlows, type FlowOptions, type FlowSettings } from '../flows/config';
import { planFlows, recordedFlowOptions } from '../load/flows';
import { CreditsConfigError, resolveCredits, type CreditOptions } from '../credits/config';
import { buildCreditsPlan } from '../credits/plan';
import { openingUuid } from '../load/credits';
import { resolveBroadcast, type BroadcastOptions } from '../broadcast/config';
import { planBroadcast } from '../load/broadcast';
import { resolveInbox, type InboxOptions, type InboxSettings } from '../inbox/config';
import { planFor } from '../load/inbox';
import { STEPS, transformDoc } from '../transform';
import { CONTACT_FIELDS, REJECT_MARKER } from '../transform/contacts';
import { buildIndex } from '../transform/source-index';
import type { HandlerSpec, Outcome, Row, TableSpec } from '../transform/types';
import {
  docKeysWith,
  isDeleted,
  isSecretName,
  mask,
  plain,
  primaryKey,
  scrub,
  setOwn,
  sha256,
  uuidv5,
  type Doc,
} from '../util';
import {
  ContactOracle,
  TableOracle,
  oracleFieldDeps,
  oracleGroups,
  oracleMembers,
  oracleOptionDeps,
} from './oracle';

export interface CollRow {
  collection: string;
  kind: 'collection' | 'derived';
  disposition: string;
  read: number;
  migrated: number;
  quarantined: number;
  excluded: number;
  gap: number;
  deferred: number;
  unaccounted: number;
}
export interface Listed {
  collection: string;
  key: string;
  status: 'quarantined' | 'excluded' | 'unaccounted';
  code: string;
  reason: string;
}
export interface FieldRow {
  step: string;
  field: string;
  seen: number;
  where: string;
  verdict: 'mapped' | 'dropped' | 'stored-in-data' | 'ALARM';
}
export interface Report {
  client: string;
  generatedAt: string;
  collections: CollRow[];
  nonMigrated: Listed[];
  fieldIssues: Record<string, number>;
  /** how many documents of each collection were excluded, by reason (the listing of `nonMigrated` is capped for the big ones) */
  excludedByCode: Record<string, number>;
  fields: FieldRow[];
  fingerprints: Record<string, { rows: number; source: string; target: string }>;
  sample: { size: number; compared: number; mismatches: string[] };
  integrity: string[];
  alarms: string[];
  warnings: string[];
  notPresent: {
    collectionsGap: string[];
    collectionsUnknown: string[];
    collectionsDeferred: string[];
    collectionsOpen: string[];
    droppedFields: string[];
    dataOnlyFields: string[];
  };
  /** steps that never ran for this client (a partial `run --steps`): reported, not alarms, not unaccounted */
  notRun: string[];
  unaccounted: number;
  ok: boolean;
}

export interface ReconcileOptions {
  source: Source;
  dumpsDir: string;
  client: string;
  targetUrl: string;
  outDir?: string;
  seed?: number;
  /** Kept for compatibility: every migrated row is compared in full unless a collection is bigger than `fullCompareMax`. */
  sampleSize?: number;
  /** Above this many documents in a collection, compare a seeded random fraction instead of every row. */
  fullCompareMax?: number;
  /** Trust the manifest's hashes instead of re-hashing the dump files. */
  skipHash?: boolean;
  /** Rows added to the target after cutover are not an error (turns the extra-row checks off). */
  allowExtraRows?: boolean;
  defaultCountryCode?: string | null;
  /** The reviewed permission map and role map the run used (default: the checked-in files). */
  access?: AccessConfig;
  /** The channel map and flags the chats were loaded with (default: <dumps>/<client>/channel-map.json, flags as recorded by the run). */
  inbox?: InboxOptions;
  /** The broadcast switches the run used (default: as recorded by the run). */
  broadcast?: BroadcastOptions;
  /** The credits switches (default: as recorded by the run; the opening file defaults to <dumps>/<client>/credit-opening.json). */
  credits?: CreditOptions;
  /** The flows and widgets switches (default: as recorded by the run). */
  flows?: FlowOptions;
}

/** Quarantine codes the loader writes itself (not derivable from a transform alone). */
const LOAD_TIME_CODES = new Set(['UNIQUE_CONFLICT']);
const FLOW_HANDLERS = new Set<string>([
  'flow_bots',
  'flow_chatbots',
  'flow_headers',
  'flow_versions',
  'flow_nodes',
  'flow_workspace',
  'faq_replies',
  'faq_knowledge',
  'widget_assistants',
  'widgets',
  'widget_config',
  'widget_theme',
]);
/** The listing of excluded documents is capped per collection and reason (the counts are not): a billing log has 180,000 of them. */
const EXCLUDED_LISTED_MAX = 500;
const PRESET_ROLES = ['Owner', 'Admin', 'Manager', 'Agent', 'Viewer'];
/** Columns whose values are personal data: reports show them masked. */
const PII = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'normalized_phone',
  'normalized_email',
  'data',
  'body',
  'lost_reason',
  'label',
  'value',
  'address',
]);

/** Key NAMES are not secrets and are reported (values never are), so a human can review what was dropped. */
const shown = (k: string): string => k;

const show = (col: string, v: unknown): string =>
  PII.has(col) ? mask(typeof v === 'object' && v !== null ? JSON.stringify(v) : v) : norm(v, '');

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Row)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** One comparable string per value; `pg` is the column type when known. */
export function norm(v: unknown, pg: string): string {
  if (v === null || v === undefined) return '∅';
  if (pg === 'timestamptz' || v instanceof Date) {
    // full microsecond precision: the target is read as 'YYYY-MM-DDTHH:MM:SS.ffffff' (UTC); a source millisecond ISO value is padded
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/.test(v)) return v;
    return new Date(v as string | Date).toISOString().slice(0, -1) + '000';
  }
  if (pg === 'jsonb' || (typeof v === 'object' && v !== null))
    return stable(typeof v === 'string' ? JSON.parse(v) : v);
  if (pg === 'bigint' || pg === 'integer' || pg === 'smallint') return String(Number(v));
  if (typeof v === 'boolean') return String(v);
  if (v === 't' || v === 'f') return v === 't' ? 'true' : 'false';
  return String(v);
}
const rowHash = (cols: string[], types: Map<string, string>, row: Row): string =>
  sha256(cols.map((c) => norm(row[c], types.get(c) ?? '')).join('␟'));

export async function reconcile(opts: ReconcileOptions): Promise<Report> {
  const { source, client, dumpsDir } = opts;
  const alarms: string[] = [];
  const kindCount = new Map<string, number>();
  const alarm = (msg: string): void => {
    const kind = msg.split(':')[0]!;
    const n = (kindCount.get(kind) ?? 0) + 1;
    kindCount.set(kind, n);
    if (n <= 50) alarms.push(msg);
  };
  const integrity: string[] = [];
  const warnings: string[] = [];
  const listed: Listed[] = [];
  const collections = new Map<string, CollRow>();
  const mk = (collection: string, kind: CollRow['kind'], disposition: string): CollRow => {
    const key = `${kind}:${collection}`;
    if (!collections.has(key)) {
      collections.set(key, {
        collection,
        kind,
        disposition,
        read: 0,
        migrated: 0,
        quarantined: 0,
        excluded: 0,
        gap: 0,
        deferred: 0,
        unaccounted: 0,
      });
    }
    return collections.get(key)!;
  };

  // 1. the dump is what the manifest says it is, and parses
  const manifest = readManifest(dumpsDir, client);
  if (opts.skipHash) {
    if (!manifest)
      alarm(
        `NO_MANIFEST: run \`manifest --client ${client}\` before migrating so counts are fixed`,
      );
  } else {
    for (const p of await verifyDump(source, dumpsDir, client)) alarm(p);
  }
  const manifestDocs = new Map<string, number>();
  for (const m of manifest?.collections ?? []) {
    manifestDocs.set(m.collection, m.docs);
    if (m.badLines > 0)
      alarm(
        `PARSE_ERRORS: ${m.collection} has ${m.badLines} line(s) that are not valid JSON objects (not counted as documents)`,
      );
  }
  const fallbackAt = manifest?.generatedAt ?? new Date(0).toISOString();

  // 2. registry coverage: every collection has a decision
  const cov = await coverage(source, dumpsDir, client);
  const notPresent: Report['notPresent'] = {
    collectionsGap: [],
    collectionsUnknown: [],
    collectionsDeferred: [],
    collectionsOpen: [],
    droppedFields: [],
    dataOnlyFields: [],
  };
  for (const r of cov) {
    const count = manifestDocs.get(r.collection) ?? r.count;
    const row = mk(r.collection, 'collection', r.reg.disposition);
    row.read = count;
    if (r.reg.disposition === 'EXCLUDE') row.excluded = count;
    else if (r.reg.disposition === 'GAP') {
      row.gap = count;
      notPresent.collectionsGap.push(`${r.collection} (${count}): ${r.reg.reason}`);
    } else if (r.reg.disposition === 'MIGRATE_LATER') {
      row.deferred = count;
      notPresent.collectionsDeferred.push(`${r.collection} (${count}): ${r.reg.reason}`);
    } else if (r.reg.disposition === 'OPEN') {
      row.deferred = count;
      notPresent.collectionsOpen.push(`${r.collection} (${count}): ${r.reg.reason}`);
    } else if (r.reg.disposition === 'UNKNOWN') {
      row.unaccounted = count;
      notPresent.collectionsUnknown.push(`${r.collection} (${count})`);
      alarm(`UNKNOWN_COLLECTION: ${r.collection} (${count} docs) is not in the registry`);
    }
  }

  const target = connect(opts.targetUrl, 'reconcile');
  const db: Database = target.db;
  const fingerprints: Report['fingerprints'] = {};
  const notRunAll: string[] = [];
  const fieldRows: FieldRow[] = [];
  const fieldIssues: Record<string, number> = {};
  const excludedBy = new Map<string, number>();
  const sample = { size: opts.sampleSize ?? 200, compared: 0, mismatches: [] as string[] };
  try {
    if (!(await schemaReady(db))) {
      alarm('NO_MIGRATION_SCHEMA: nothing has been loaded (migration.* does not exist)');
      return finish();
    }
    const idmap = new IdMap();
    await idmap.load(db, client);
    const org = idmap.get(ORG_COLLECTION, client);
    if (!org) {
      alarm('NO_ORG: the organization was not created for this client (no migration.id_map entry)');
      return finish();
    }
    const orgId = org.id;
    const idx = await buildIndex(source, client, fallbackAt);
    const ownerEmail =
      (
        (
          await db.execute(
            sql`SELECT counts->>'ownerEmail' AS e FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = 'org'`,
          )
        ).rows[0] as { e: string | null } | undefined
      )?.e ?? null;
    const accessConfig = opts.access ?? loadAccessConfig();
    const prepared = await prepareAccess({
      source,
      client,
      db,
      orgId,
      config: accessConfig,
      ownerEmail,
    });
    const ctx = ctxOf({
      client,
      orgId,
      idmap,
      idx,
      defaultCountryCode: opts.defaultCountryCode ?? null,
      fallbackAt,
      access: prepared.access,
    });

    // a partial run (`run --steps`): the steps that never ran are reported as NOT RUN and verified by nothing; null = loaded before partial runs
    const notRun = await stepsNotRun(db, client);
    const stepRan = (h: string): boolean => !notRun || !notRun.has(h);
    const anyRan = (...hs: string[]): boolean => hs.some(stepRan);
    const notRunList = notRunAll;

    // chat history: the channel map, then the loader's plan (the verdict of every document), recomputed from the dump and the target
    let inboxSettings: InboxSettings | null = null;
    let inboxProblem: string | null = null;
    if (
      anyRan('inbox') &&
      source.collections(client).includes('chathistory') &&
      (manifestDocs.get('chathistory') ?? 0) > 0
    ) {
      try {
        const rec = (
          await db.execute(
            sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_chat' AND step = 'options'`,
          )
        ).rows[0] as { counts?: Record<string, unknown> } | undefined;
        const was = rec?.counts ?? {};
        const o = opts.inbox ?? {};
        inboxSettings = resolveInbox(
          {
            keepDeletedContactChats: (o.keepDeletedContactChats ?? was.keepDeletedContactChats) as
              boolean | undefined,
            threadStatus: (o.threadStatus ?? was.threadStatus) as 'waboo' | 'closed' | undefined,
            assignAgents: (o.assignAgents ?? was.assignAgents) as boolean | undefined,
            windowHours: (o.windowHours ?? was.windowHours) as number | undefined,
            channelMap: o.channelMap,
            channelMapPath: o.channelMapPath,
          },
          dumpsDir,
          client,
        );
        ctx.chat = await planFor({
          db,
          orgId,
          client,
          source,
          fallbackAt,
          idmap,
          idx,
          settings: inboxSettings,
        });
      } catch (e) {
        inboxProblem = e instanceof Error ? e.message : String(e);
        alarm(inboxProblem.startsWith('INBOX') ? inboxProblem : `INBOX_PLAN: ${inboxProblem}`);
      }
    }

    // broadcasts: the switches the run used, then the plan of pass 1 (campaign verdicts and counters), recomputed from the dump
    let bcastSettings: ReturnType<typeof resolveBroadcast> | null = null;
    const bcastDocs =
      (manifestDocs.get('broadcasting') ?? 0) +
      (manifestDocs.get('whatsapp_broadcasting_data') ?? 0);
    if (bcastDocs > 0 && anyRan('campaigns', 'recipients')) {
      try {
        const rec = (
          await db.execute(
            sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_bcast' AND step = 'options'`,
          )
        ).rows[0] as { counts?: Record<string, unknown> } | undefined;
        const was = (rec?.counts ?? {}) as BroadcastOptions;
        const o = opts.broadcast ?? {};
        bcastSettings = resolveBroadcast({
          failedSendAttempts: o.failedSendAttempts ?? was.failedSendAttempts,
          keepTestBroadcasts: o.keepTestBroadcasts ?? was.keepTestBroadcasts,
          nonTerminalStatus: o.nonTerminalStatus ?? was.nonTerminalStatus,
        });
        if (!rec?.counts)
          alarm(
            'BROADCAST_OPTIONS: no record of the broadcast switches of the run (migration.run_log _bcast)',
          );
        else
          for (const [k, v] of Object.entries(bcastSettings))
            if ((was as Record<string, unknown>)[k] !== v)
              warnings.push(
                `BROADCAST: option ${k} differs from the run that loaded the campaigns (run: ${String((was as Record<string, unknown>)[k])}, reconcile: ${String(v)}); pass the same flags`,
              );
        ctx.bcast = await planBroadcast({
          env: { source, client, db, orgId, dumpsDir },
          settings: bcastSettings,
        });
      } catch (e) {
        alarm(`BROADCAST_PLAN: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // credits: the switches the run used (and the opening file), then the plan of pass 1, recomputed from the dump
    let creditSettings: ReturnType<typeof resolveCredits> | null = null;
    let creditRecord: Record<string, unknown> | null = null;
    if (anyRan('credit_wallet', 'credit_tokens', 'usage_charges')) {
      const rec = (
        await db.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_credits' AND step = 'options'`,
        )
      ).rows[0] as { counts?: Record<string, unknown> } | undefined;
      creditRecord = rec?.counts ?? null;
      const was = creditRecord ?? {};
      const o = opts.credits ?? {};
      try {
        creditSettings = resolveCredits(
          {
            openingPath: o.openingPath,
            noWallet: o.noWallet ?? (was.wallet === false ? true : undefined),
            workspaceId:
              o.workspaceId ?? (typeof was.workspaceId === 'string' ? was.workspaceId : undefined),
          },
          dumpsDir,
          client,
          manifestDocs.get('credit_logs') ?? 0,
        );
        ctx.credits = await buildCreditsPlan({
          source,
          client,
          settings: creditSettings,
          referenceAt: fallbackAt,
        });
        if (!creditRecord)
          alarm(
            'CREDITS_OPTIONS: no record of the credits switches of the run (migration.run_log _credits)',
          );
      } catch (e) {
        alarm(
          `CREDITS_PLAN: ${e instanceof CreditsConfigError ? e.message : e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // flows and widgets: the switches the run used (and the plan caps it read), then the plan of pass 1, recomputed from the dump
    let flowSettings: FlowSettings | null = null;
    {
      const flowDocs = [
        'chatbots',
        'bot_flow_version',
        'bot_flow_version_data',
        'bot_workspace',
        'flows',
        'faq_variations',
        'chatbot_configuration',
        'chatbot_theme',
      ].reduce((n, c) => n + (manifestDocs.get(c) ?? 0), 0);
      if (flowDocs > 0 && anyRan(...FLOW_HANDLERS)) {
        try {
          const was = ((await recordedFlowOptions(db, client)) ?? {}) as Partial<FlowSettings>;
          const o = opts.flows ?? {};
          flowSettings = resolveFlows({
            flowVersion: o.flowVersion ?? was.flowVersion,
            widgetsForWhatsappBots: o.widgetsForWhatsappBots ?? was.widgetsForWhatsappBots,
            flowLimit: o.flowLimit ?? was.flowLimit,
            widgetLimit: o.widgetLimit ?? was.widgetLimit,
          });
          if (!(await recordedFlowOptions(db, client)))
            alarm(
              'FLOWS_OPTIONS: no record of the flows switches of the run (migration.run_log _flows)',
            );
          else
            for (const [k, v] of Object.entries(flowSettings))
              if ((was as Record<string, unknown>)[k] !== v)
                warnings.push(
                  `FLOWS: option ${k} differs from the run that loaded the flows (run: ${String((was as Record<string, unknown>)[k])}, reconcile: ${String(v)}); pass the same flags`,
                );
          ctx.flows = await planFlows({
            env: { source, client, db, orgId, fallbackAt },
            settings: flowSettings,
          });
        } catch (e) {
          alarm(`FLOWS_PLAN: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const q = await db.execute(
      sql`SELECT collection, source_key, reason_code, reason FROM migration.quarantine WHERE source_client = ${client}`,
    );
    const quarantine = new Map<string, { code: string; reason: string }>();
    const quarantineRows = q.rows as Array<{
      collection: string;
      source_key: string;
      reason_code: string;
      reason: string;
    }>;
    for (const r of quarantineRows) {
      quarantine.set(`${r.collection}\u0000${r.source_key}`, {
        code: r.reason_code,
        reason: r.reason,
      });
      if (r.source_key.includes('#')) {
        const k = `${r.collection}: ${r.reason_code}`;
        fieldIssues[k] = (fieldIssues[k] ?? 0) + 1;
      }
    }
    const wrongOrg = await db.execute(
      sql`SELECT count(*)::int AS n FROM migration.id_map WHERE source_client = ${client} AND target_org_id <> ${orgId}`,
    );
    if ((wrongOrg.rows[0] as { n: number }).n > 0)
      integrity.push(
        `WRONG_ORG: ${(wrongOrg.rows[0] as { n: number }).n} id_map rows of ${client} point at another organization`,
      );

    await checkOrg(db, client, orgId, alarm, warnings);

    // the independent oracle for contacts (does not use the loader's transform code)
    const read = async (c: string): Promise<Doc[]> => {
      const out: Doc[] = [];
      if (source.collections(client).includes(c))
        for await (const d of source.read(client, c)) out.push(d);
      return out;
    };
    const oracle = new ContactOracle(
      await read('contact_lifecycle_stages'),
      await read('contact_properties_fields'),
      await read('contact_properties_field_options'),
      opts.defaultCountryCode ?? null,
      fallbackAt,
    );

    // 3. bulk steps
    const claimed = new Map<string, number>();
    const rollups = new Map<string, { s: string[]; t: string[]; rows: number }>();
    const expectedUuids = new Map<string, Set<string>>();
    // rows the `update` command changed carry row_version > 1: exactly the recorded version is fine, any other one is a later edit
    const bumped = new Map<string, number>();
    try {
      const b = await db.execute(
        sql`SELECT target_uuid::text AS uuid, max(written_version) AS v FROM migration.id_map WHERE source_client = ${client} AND written_version IS NOT NULL AND target_uuid IS NOT NULL GROUP BY target_uuid`,
      );
      for (const r of b.rows as Array<{ uuid: string; v: number }>) bumped.set(r.uuid, Number(r.v));
    } catch {
      // an id_map from before update mode has no written_version column: nothing was ever updated
    }
    const seenKeys = new Set<string>(); // `${mapCollection}\0${key}` of every source document, for the stale-quarantine check
    const contactOrder: string[] = []; // uuids of the migrated contacts in source order
    const faqItems: Array<{ base: string; outcome: Extract<Outcome, { kind: 'rows' }> }> = []; // the loaded FAQ documents, for reconcile/faq.ts
    const expectedPrimary = new Map<string, string>(); // `${mapCollection}\0${primary key}` -> uuid of the first row
    const aliasCandidates: Array<{ k: string; uuid: string }> = [];
    const primariesByCollection = new Map<string, Set<string>>();
    const uniqueSeen = new Map<string, string>(); // `${table}\0${unique key}` of every loaded document
    const tableOracle = new TableOracle(await read('contact_lifecycle_stages'), fallbackAt);
    for (const spec of STEPS) {
      if (!stepRan(spec.handler)) {
        if (source.collections(client).includes(spec.collection)) notRunList.push(spec.handler);
        continue;
      }
      if (spec.handler === 'inbox' && !ctx.chat) continue; // no map / no plan: the alarm above says so, and the documents show up as UNCLAIMED
      if ((spec.handler === 'campaigns' || spec.handler === 'recipients') && !ctx.bcast) continue; // same, for the broadcast plan
      if (
        (spec.handler === 'credit_wallet' ||
          spec.handler === 'credit_tokens' ||
          spec.handler === 'usage_charges') &&
        !ctx.credits
      )
        continue; // same, for the credits plan
      if (FLOW_HANDLERS.has(spec.handler) && !ctx.flows) continue; // no plan: the alarm above says so
      const real = !spec.virtual;
      const label = real ? spec.collection : spec.mapCollection;
      if (real && !source.collections(client).includes(spec.collection)) continue;
      const row = mk(label, real ? 'collection' : 'derived', 'MIGRATE');
      const fieldSeen = new Map<string, number>();
      let chunk: Array<{ base: string; outcome: Outcome; doc: Doc }> = [];
      const total = manifestDocs.get(spec.collection) ?? 0;
      const fullMax = opts.fullCompareMax ?? 250_000;
      const frac = total > fullMax ? fullMax / total : 1;
      const occurrences = new Map<string, number>();
      const droppedPaths = new Map<string, number>();

      const flush = async (): Promise<void> => {
        if (chunk.length === 0) return;
        const items = chunk;
        chunk = [];
        await verifyChunk(spec, items, {
          db,
          orgId,
          client,
          seed: opts.seed ?? 1,
          frac,
          quarantine,
          fingerprints: rollups,
          sample,
          alarm,
          row,
          listed,
          mapCollection: spec.mapCollection,
          expected: expectedUuids,
          oracle,
          tableOracle,
          allowExtra: Boolean(opts.allowExtraRows),
          bumped,
        });
      };
      const stream = spec.read
        ? spec.read({ idx, source, client, ctx })
        : source.read(client, spec.collection);
      for await (const doc of stream) {
        if (spec.only && !spec.only(doc)) continue;
        for (const k of Object.keys(doc)) fieldSeen.set(k, (fieldSeen.get(k) ?? 0) + 1);
        claimed.set(label, (claimed.get(label) ?? 0) + 1);
        if (spec.dynamic && !isDeleted(doc)) {
          // which credential-looking keys the shared scrub removes (names only: a human reviews them, values are never kept)
          const extra: Doc = {};
          for (const [k, v] of Object.entries(doc)) {
            if (
              !Object.hasOwn(CONTACT_FIELDS, k) &&
              !REJECT_MARKER.test(k) &&
              v !== null &&
              v !== undefined
            )
              setOwn(extra, k, plain(v));
          }
          for (const p of scrub(extra).redacted)
            droppedPaths.set(p, (droppedPaths.get(p) ?? 0) + 1);
        }
        const keys = docKeysWith(doc, spec.aliasKeys);
        const base = keys[0]?.key ?? primaryKey(doc);
        const occ = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, occ);
        seenKeys.add(`${spec.mapCollection}\u0000${base}`);
        (
          primariesByCollection.get(spec.mapCollection) ??
          primariesByCollection.set(spec.mapCollection, new Set()).get(spec.mapCollection)!
        ).add(base);
        if (occ > 1) seenKeys.add(`${spec.mapCollection}\u0000${base}#dup${occ}`);
        const qkey = occ > 1 ? `${base}#dup${occ}` : base;
        const qd =
          quarantine.get(`${spec.mapCollection}\u0000${qkey}`) ??
          (occ === 1
            ? quarantine.get(`${spec.mapCollection}\u0000${base}#UNIQUE_CONFLICT`)
            : undefined);
        const table0 = Object.keys(spec.tables)[0]!;
        const ukey = tableOracle.uniqueKey(table0, doc);
        const outcome = transformDoc(spec, doc, ctx);
        const inMap = occ === 1 && keys.length > 0 && Boolean(idmap.get(spec.mapCollection, base));
        if (occ > 1) {
          if (qd?.code === 'DUPLICATE_KEY') {
            row.quarantined++;
            listed.push({
              collection: label,
              key: qkey,
              status: 'quarantined',
              code: qd.code,
              reason: qd.reason,
            });
          } else {
            row.unaccounted++;
            listed.push({
              collection: label,
              key: qkey,
              status: 'unaccounted',
              code: 'NOT_LOADED',
              reason: 'a repeated primary key that was neither quarantined nor loaded',
            });
          }
        } else if (inMap) {
          if (outcome.kind === 'exclude') {
            alarm(
              `EXCLUDED_BUT_LOADED: ${label} ${base} is excluded (${outcome.code}) yet has a target row`,
            );
            row.unaccounted++;
          } else if (outcome.kind === 'quarantine') {
            alarm(
              `TRANSFORM_DRIFT: ${label} ${base} was loaded but the transform now quarantines it (${outcome.code})`,
            );
            row.unaccounted++;
          } else {
            chunk.push({ base, outcome, doc });
            if (spec.handler === 'faq_knowledge' && outcome.kind === 'rows') faqItems.push({ base, outcome });
            row.migrated++;
            // an adopting document points at a row that already exists (the owner, a preset role)
            const first =
              outcome.kind === 'rows'
                ? rowUuid(client, spec.mapCollection, base, outcome.rows[0]!.sub)
                : String(
                    (
                      (
                        await withTenant(db, { orgId }, (tx) =>
                          tx.execute(
                            sql`SELECT uuid::text AS uuid FROM ${sql.raw(`"${outcome.table}"`)} WHERE org_id = ${orgId} AND ${sql.raw(`"${outcome.column}"`)} = ${outcome.value} ORDER BY id LIMIT 1`,
                          ),
                        )
                      ).rows[0] as { uuid: string } | undefined
                    )?.uuid ?? '',
                  );
            expectedPrimary.set(`${spec.mapCollection}\u0000${base}`, first);
            for (const k of keys.slice(1))
              aliasCandidates.push({ k: `${spec.mapCollection}\u0000${k.key}`, uuid: first });
            if (spec.handler === 'contacts') contactOrder.push(first);
            if (ukey !== null && !uniqueSeen.has(`${table0}\u0000${ukey}`))
              uniqueSeen.set(`${table0}\u0000${ukey}`, base);
          }
        } else if (qd) {
          // B5: a quarantine row must be what the transform would say about this document, or a load-time conflict
          const expectCode =
            keys.length === 0 ? 'NO_KEY' : outcome.kind === 'quarantine' ? outcome.code : null;
          // UNIQUE_CONFLICT is written by the loader itself: believe it only if an earlier loaded document owns the same unique key
          const conflictOk =
            LOAD_TIME_CODES.has(qd.code) &&
            outcome.kind === 'rows' &&
            (ukey === null || uniqueSeen.has(`${table0}\u0000${ukey}`));
          const fine =
            qd.code === expectCode ||
            conflictOk ||
            (qd.code === 'ADOPT_TARGET_MISSING' &&
              outcome.kind === 'adopt' &&
              (FLOW_HANDLERS.has(spec.handler) || spec.handler === 'automation_nodes'));
          if (!fine) {
            alarm(
              `FALSE_QUARANTINE: ${label} ${qkey} is quarantined as ${qd.code}, but from the source the document would ${outcome.kind === 'rows' ? 'load' : outcome.kind === 'adopt' ? 'be adopted by an existing row' : outcome.kind === 'exclude' ? `be excluded (${outcome.code})` : `be quarantined as ${outcome.code}`}`,
            );
            row.unaccounted++;
          } else {
            row.quarantined++;
            listed.push({
              collection: label,
              key: qkey,
              status: 'quarantined',
              code: qd.code,
              reason: qd.reason,
            });
          }
        } else if (keys.length > 0 && outcome.kind === 'exclude') {
          row.excluded++;
          const ek = `${label}: ${outcome.code}`;
          const nEx = (excludedBy.get(ek) ?? 0) + 1;
          excludedBy.set(ek, nEx);
          if (nEx <= EXCLUDED_LISTED_MAX)
            listed.push({
              collection: label,
              key: base,
              status: 'excluded',
              code: outcome.code,
              reason: outcome.reason,
            });
        } else {
          row.unaccounted++;
          listed.push({
            collection: label,
            key: base,
            status: 'unaccounted',
            code: 'NOT_LOADED',
            reason: 'neither migrated, quarantined nor excluded',
          });
        }
        if (chunk.length >= 500) await flush();
      }
      await flush();
      if (!real) row.read = claimed.get(label) ?? 0;
      checkFields(spec, label, fieldSeen, fieldRows, alarm, notPresent);
      for (const [p, n] of droppedPaths) {
        notPresent.droppedFields.push(
          `${label}.${p} (${n} docs): credential-looking, the value is never copied`,
        );
      }
      if (spec.dynamic) {
        const found = await withTenant(db, { orgId }, (tx) =>
          tx.execute(
            sql`SELECT key FROM fields WHERE org_id = ${orgId} AND module_key = 'contacts'`,
          ),
        );
        const have = new Set((found.rows as Array<{ key: string }>).map((r) => r.key));
        for (const [k, n] of fieldSeen) {
          if (Object.hasOwn(spec.fields, k) || REJECT_MARKER.test(k)) continue;
          if (have.has(k)) {
            fieldRows.push({
              step: spec.handler,
              field: shown(k),
              seen: n,
              where: 'contacts.data (matching fields row)',
              verdict: 'stored-in-data',
            });
          } else if (!idx.contactKeys.has(k)) {
            // every value is a credential or empty: nothing was copied (the key NAME is listed, never a value)
            fieldRows.push({
              step: spec.handler,
              field: k,
              seen: n,
              where: 'not copied: every value is empty or a credential',
              verdict: 'dropped',
            });
            notPresent.droppedFields.push(
              `${label}.${k} (${n} docs): every value is empty or a credential, nothing to copy`,
            );
          } else {
            fieldRows.push({
              step: spec.handler,
              field: shown(k),
              seen: n,
              where: 'NO fields row in the target',
              verdict: 'ALARM',
            });
            alarm(
              `FIELD_UNMAPPED: ${label}.${shown(k)} (${n} docs) has no mapping and no fields row`,
            );
          }
        }
      }
    }
    // the opening ledger entry belongs to no document: it is the one wallet_transactions row the uuid set must also expect
    if (ctx.credits?.opening)
      (
        expectedUuids.get('wallet_transactions') ??
        expectedUuids.set('wallet_transactions', new Set()).get('wallet_transactions')!
      ).add(openingUuid(client));
    // a collection whose steps never ran is NOT RUN: read, but neither migrated nor unaccounted
    for (const r of collections.values()) {
      if (r.disposition !== 'MIGRATE' || r.kind !== 'collection') continue;
      const mine = STEPS.filter((s) => !s.virtual && s.collection === r.collection);
      if (mine.length > 0 && mine.every((s) => !stepRan(s.handler))) {
        r.disposition = 'NOT RUN';
        r.deferred = r.read;
      }
    }
    // real collections: read comes from the manifest; docs the steps never claimed are unaccounted
    for (const r of collections.values()) {
      if (r.disposition !== 'MIGRATE' || r.kind !== 'collection') continue;
      const stepsOf = STEPS.filter((s) => !s.virtual && s.collection === r.collection);
      if (stepsOf.length === 0) continue;
      const unclaimed = r.read - (claimed.get(r.collection) ?? 0);
      if (unclaimed > 0) {
        r.unaccounted += unclaimed;
        alarm(`UNCLAIMED: ${unclaimed} docs of ${r.collection} were read by no step`);
      }
    }
    for (const [t, r] of rollups)
      fingerprints[t] = {
        rows: r.rows,
        source: sha256(r.s.sort().join('')),
        target: sha256(r.t.sort().join('')),
      };
    for (const [t, f] of Object.entries(fingerprints))
      if (f.source !== f.target)
        alarm(
          `FINGERPRINT_ROLLUP_MISMATCH: ${t} source ${f.source.slice(0, 12)} != target ${f.target.slice(0, 12)}`,
        );

    // 3b. migration.id_map must equal the expected mapping, both ways (a bogus key, a swapped target, a missing alias)
    const expectedAlias = new Map<string, string>();
    for (const a of aliasCandidates) {
      const [mc, key] = a.k.split('\u0000') as [string, string];
      if (primariesByCollection.get(mc)?.has(key) || expectedAlias.has(a.k)) continue;
      expectedAlias.set(a.k, a.uuid);
    }
    const mapRows = (
      await db.execute(
        sql`SELECT source_collection, source_key, target_uuid::text AS uuid FROM migration.id_map WHERE source_client = ${client} AND source_collection <> ${ORG_COLLECTION}`,
      )
    ).rows as Array<{ source_collection: string; source_key: string; uuid: string | null }>;
    const haveMap = new Map<string, string | null>();
    for (const m of mapRows) {
      const k = `${m.source_collection}\u0000${m.source_key}`;
      haveMap.set(k, m.uuid);
      const want = expectedPrimary.get(k) ?? expectedAlias.get(k);
      if (want === undefined) {
        // settings-style collections are not mapped any more; anything else here has no source document behind it
        alarm(
          `IDMAP_EXTRA: id_map has a key of ${m.source_collection} that no migrated source document owns (${m.source_key})`,
        );
      } else if (m.uuid !== want) {
        alarm(
          `IDMAP_WRONG: id_map key ${m.source_key} of ${m.source_collection} points at a different row than its document produced`,
        );
      }
    }
    for (const k of [...expectedPrimary.keys(), ...expectedAlias.keys()]) {
      if (!haveMap.has(k))
        alarm(`IDMAP_MISSING: id_map has no entry for ${k.replace('\u0000', ' ')}`);
    }

    // 3c. display ids follow the allocator: the Nth migrated contact in source order holds CON-(base + N), no gaps, no swaps
    if (contactOrder.length > 0) {
      const ids = await withTenant(db, { orgId }, (tx) =>
        tx.execute(
          sql`SELECT uuid::text AS uuid, display_id FROM contacts WHERE org_id = ${orgId} AND legacy_id IS NOT NULL`,
        ),
      );
      const dmap = new Map(
        (ids.rows as Array<{ uuid: string; display_id: string | null }>).map((r) => [
          r.uuid,
          r.display_id,
        ]),
      );
      const firstNo = Number(
        /^CON-(\d+)$/.exec(String(dmap.get(contactOrder[0]!) ?? ''))?.[1] ?? NaN,
      );
      if (Number.isFinite(firstNo)) {
        let wrong = 0;
        let sample = '';
        contactOrder.forEach((u, i) => {
          const want = `CON-${String(firstNo + i).padStart(5, '0')}`;
          if (dmap.get(u) !== want) {
            wrong++;
            if (!sample) sample = `${dmap.get(u) ?? 'none'} but source order says ${want}`;
          }
        });
        if (wrong > 0)
          alarm(
            `DISPLAY_ID: ${wrong} contact(s) do not hold the display id their position in the source gives (first: ${sample})`,
          );
      }
    }

    // 3d. relations, recomputed independently from the source documents
    {
      const [lists, contacts, fieldDocs, optionDocs, fdeps, odeps] = await Promise.all(
        [
          'marketing_list',
          'contact_list',
          'contact_properties_fields',
          'contact_properties_field_options',
          'contact_properties_field_dependancy_mapping',
          'contact_properties_field_options_dependancy_mapping',
        ].map(read),
      );
      const members = oracleMembers(
        contacts!,
        oracleGroups(lists!),
        (d) => oracle.expect(d) !== null,
      );
      const got = (
        await withTenant(db, { orgId }, (tx) =>
          tx.execute(sql`SELECT c.legacy_id AS a, lower(g.name) AS b FROM contact_group_members m
            JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
            WHERE m.org_id = ${orgId}`),
        )
      ).rows as Array<{ a: string; b: string }>;
      const gotMembers = new Set(got.map((r) => `${r.a}\u0000${r.b}`));
      const missing = [...members].filter((x) => !gotMembers.has(x)).length;
      const extra = [...gotMembers].filter((x) => !members.has(x)).length;
      if (stepRan('group_members') && missing + extra > 0)
        alarm(
          `ORACLE_MISMATCH: contact_group_members differ from the independent membership (${missing} missing, ${extra} unexpected)`,
        );

      const keys = new Set(
        (
          (
            await withTenant(db, { orgId }, (tx) =>
              tx.execute(
                sql`SELECT key FROM fields WHERE org_id = ${orgId} AND module_key = 'contacts'`,
              ),
            )
          ).rows as Array<{ key: string }>
        ).map((r) => r.key),
      );
      const wantF = oracleFieldDeps(fieldDocs!, fdeps!, keys);
      const gotF = new Set(
        (
          (
            await withTenant(db, { orgId }, (tx) =>
              tx.execute(
                sql`SELECT c.key AS a, p.key AS b FROM field_dependencies d JOIN fields c ON c.org_id = d.org_id AND c.id = d.field_id JOIN fields p ON p.org_id = d.org_id AND p.id = d.depends_on_field_id WHERE d.org_id = ${orgId}`,
              ),
            )
          ).rows as Array<{ a: string; b: string }>
        ).map((r) => `${r.a}\u0000${r.b}`),
      );
      if (
        stepRan('field_deps') &&
        ([...wantF].some((x) => !gotF.has(x)) || [...gotF].some((x) => !wantF.has(x)))
      )
        alarm('ORACLE_MISMATCH: field_dependencies differ from the independent dependency list');

      const opts = new Set(
        (
          (
            await withTenant(db, { orgId }, (tx) =>
              tx.execute(
                sql`SELECT f.key AS f, o.value AS v FROM field_options o JOIN fields f ON f.org_id = o.org_id AND f.id = o.field_id WHERE o.org_id = ${orgId}`,
              ),
            )
          ).rows as Array<{ f: string; v: string }>
        ).map((r) => `${r.f}\u0000${r.v}`),
      );
      const wantO = oracleOptionDeps(fieldDocs!, optionDocs!, odeps!, opts);
      const gotO = new Set(
        (
          (
            await withTenant(db, { orgId }, (tx) =>
              tx.execute(sql`SELECT pf.key AS pf, po.value AS pv, cf.key AS cf, co.value AS cv FROM field_option_dependencies d
          JOIN field_options po ON po.org_id = d.org_id AND po.id = d.parent_option_id JOIN fields pf ON pf.org_id = po.org_id AND pf.id = po.field_id
          JOIN field_options co ON co.org_id = d.org_id AND co.id = d.child_option_id JOIN fields cf ON cf.org_id = co.org_id AND cf.id = co.field_id
          WHERE d.org_id = ${orgId}`),
            )
          ).rows as Array<{ pf: string; pv: string; cf: string; cv: string }>
        ).map((r) => `${r.pf}\u0000${r.pv}\u0000${r.cf}\u0000${r.cv}`),
      );
      if (
        stepRan('field_option_deps') &&
        ([...wantO].some((x) => !gotO.has(x)) || [...gotO].some((x) => !wantO.has(x)))
      )
        alarm(
          'ORACLE_MISMATCH: field_option_dependencies differ from the independent dependency list',
        );
    }

    // 3d2. roles, grants, users and their per-user rows against the independent oracle; NO-ADMIN over the whole organization
    if (ctx.chat || inboxProblem) {
      await verifyChat({
        db,
        orgId,
        client,
        source,
        settings: inboxSettings,
        plan: ctx.chat ?? null,
        referenceAt: fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
        fields: fieldRows,
        notPresent,
        threadsRow: mk('chat_threads (derived)', 'derived', 'MIGRATE'),
      });
    }
    if (ctx.bcast && bcastSettings) {
      await verifyCampaigns({
        db,
        orgId,
        client,
        source,
        settings: bcastSettings,
        plan: ctx.bcast,
        defaultCc: opts.defaultCountryCode ?? null,
        referenceAt: fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
        notPresent,
      });
    }
    if (creditSettings && anyRan('credit_wallet', 'credit_tokens', 'usage_charges')) {
      await verifyCredits({
        db,
        orgId,
        client,
        source,
        settings: creditSettings,
        recorded: creditRecord,
        plan: ctx.credits ?? null,
        referenceAt: fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
        notPresent,
        idmap,
      });
    }
    if (ctx.flows && flowSettings) {
      await verifyFlows({
        db,
        orgId,
        client,
        source,
        plan: ctx.flows,
        settings: flowSettings,
        referenceAt: fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
        notPresent,
      });
    }
    if (ctx.flows && anyRan('faq_knowledge'))
      await verifyFaq({
        db,
        orgId,
        client,
        items: faqItems,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
      });
    if (anyRan('automation_flows', 'automation_nodes'))
      await verifyAutomations({
        db,
        orgId,
        client,
        source,
        fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
        notPresent,
      });
    if (anyRan('lead_sources', 'lead_events', 'lead_events_leads', 'attributions'))
      await verifyLeads({
        db,
        orgId,
        client,
        source,
        referenceAt: fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        ran: stepRan,
        alarm,
        warnings,
        notPresent,
      });
    if (anyRan('roles', 'users'))
      await verifyAccess({
        db,
        orgId,
        client,
        access: prepared.access,
        roleDocs: await read('roles'),
        userDocs: await read('user'),
        contactDocs: await read('contact_list'),
        hasUsers: idx.hasUsers,
        defaultCc: opts.defaultCountryCode ?? null,
        fallbackAt,
        allowExtraRows: Boolean(opts.allowExtraRows),
        alarm,
        warnings,
      });

    // 3e. quarantine: every row as recorded at load time (a deleted, edited or "resolved" row is noticed)
    {
      const rec = (
        await db.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = 'quarantine-digest'`,
        )
      ).rows[0] as { counts?: { rows?: string[] } } | undefined;
      if (!Array.isArray(rec?.counts?.rows)) {
        alarm('QUARANTINE_DIGEST: no digest of migration.quarantine was recorded at load time');
      } else {
        const now = await quarantineDigest(db, client);
        const left = [...now];
        let gone = 0;
        for (const h of rec!.counts!.rows!) {
          const i = left.indexOf(h);
          if (i >= 0) left.splice(i, 1);
          else gone++;
        }
        if (gone > 0 || left.length > 0) {
          alarm(
            `QUARANTINE_CHANGED: ${gone} quarantine row(s) were changed or deleted and ${left.length} added since the load (a reviewer who marks rows resolved must re-run \`run\` to record the new state)`,
          );
        }
      }
    }

    // 4. quarantine rows that point at nothing in the source
    const badKeys = new Set(
      source.badLines(client).map((b) => `${b.collection}\u0000line:${b.line}`),
    );
    for (const r of quarantineRows) {
      const stepCollection = STEPS.some((s) => s.mapCollection === r.collection);
      if (r.reason_code === 'PARSE_ERROR') {
        if (!badKeys.has(`${r.collection}\u0000${r.source_key}`))
          alarm(
            `QUARANTINE_ORPHAN: ${r.collection} ${r.source_key} (PARSE_ERROR) matches no unparseable line in the dump`,
          );
        continue;
      }
      if (!stepCollection) continue;
      const base = r.source_key.split('#')[0]!;
      if (
        !seenKeys.has(`${r.collection}\u0000${base}`) &&
        !seenKeys.has(`${r.collection}\u0000${r.source_key}`)
      ) {
        alarm(
          `QUARANTINE_ORPHAN: ${r.collection} ${r.source_key} (${r.reason_code}) matches no document in the source`,
        );
      }
    }
    for (const b of source.badLines(client)) {
      if (!quarantine.has(`${b.collection}\u0000line:${b.line}`))
        alarm(
          `BAD_LINE_NOT_QUARANTINED: ${b.file.split(/[\\/]/).pop()} line ${b.line} is not valid JSON and has no quarantine row`,
        );
      else alarm(`PARSE_ERRORS: ${b.file.split(/[\\/]/).pop()} line ${b.line}: ${b.error}`);
    }

    // 5. extra rows. Every table the bulk steps own must hold exactly the rows the source accounts for (an empty source means an empty
    //    table); every OTHER org table must still hold exactly what provisioning left, which is what the baseline digest records
    if (!opts.allowExtraRows) {
      // tables with no uuid (grants, user_roles ...) and the roles / users tables (presets and the owner live there too) are held by
      // the access verifier instead
      const stepTables = new Set(
        STEPS.filter((s) => stepRan(s.handler)).flatMap((s) =>
          Object.entries(s.tables)
            .filter(([t, ts]) => !ts.keyless && !ts.noUuid && t !== 'roles' && t !== 'users')
            .map(([t]) => t),
        ),
      );
      for (const table of stepTables) {
        const want = expectedUuids.get(table) ?? new Set<string>();
        const have = await withTenant(db, { orgId }, (tx) =>
          tx.execute(
            sql`SELECT uuid::text AS uuid FROM ${sql.raw(`"${table}"`)} WHERE org_id = ${orgId}`,
          ),
        );
        const extra = (have.rows as Array<{ uuid: string }>).filter((r) => !want.has(r.uuid));
        if (extra.length > 0) {
          alarm(
            `EXTRA_ROWS: ${extra.length} row(s) in ${table} are not accounted for by any source document (first uuid ${extra[0]!.uuid})`,
          );
        }
      }
      const base = (
        await db.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = 'baseline'`,
        )
      ).rows[0] as { counts?: Baseline } | undefined;
      if (!base?.counts) {
        alarm(
          'BASELINE: no digest of the provisioned organization was recorded (migration.run_log _org baseline)',
        );
      } else {
        const known = new Set(await withTenant(db, { orgId }, (tx) => orgTables(tx)));
        const bad = Object.entries(base.counts).filter(
          ([t, v]) => (t !== 'organizations' && !known.has(t)) || !Array.isArray(v),
        );
        if (bad.length > 0) {
          // the record itself was overwritten (a table that does not exist, or a value that is not a list of row digests)
          alarm(
            'BASELINE: the recorded digest of the provisioned organization is damaged (migration.run_log _org baseline)',
          );
          base.counts = {};
        }
        const now = await withTenant(db, { orgId }, (tx) => digest(tx, orgId, [...known]));
        for (const table of new Set([...Object.keys(base.counts), ...Object.keys(now)])) {
          const was = [...(base.counts[table] ?? [])];
          const is = [...(now[table] ?? [])];
          const left = [...is];
          let gone = 0;
          for (const h of was) {
            const i = left.indexOf(h);
            if (i >= 0) left.splice(i, 1);
            else gone++;
          }
          if (gone > 0)
            alarm(
              `BASELINE_CHANGED: ${table}: ${gone} row(s) that provisioning created were changed or deleted`,
            );
          if (left.length > 0)
            alarm(
              `EXTRA_ROWS: ${table}: ${left.length} row(s) were added that this migration does not create${gone > 0 ? ' (or changed)' : ''}`,
            );
        }
      }
    }

    // 6. display ids and the counter
    await withTenant(db, { orgId }, async (tx) => {
      const r = await tx.execute(sql`
        SELECT count(*)::int AS n, count(*) FILTER (WHERE display_id IS NULL)::int AS nulls,
               count(*) FILTER (WHERE display_id IS NOT NULL AND display_id !~ '^CON-[0-9]{5,}$')::int AS bad,
               (count(display_id) - count(DISTINCT display_id))::int AS dups,
               coalesce(max(substring(display_id from 5)::bigint) FILTER (WHERE display_id ~ '^CON-[0-9]{5,}$'), 0)::bigint AS maxn
        FROM contacts WHERE org_id = ${orgId} AND legacy_id IS NOT NULL`);
      const c = r.rows[0] as { n: number; nulls: number; bad: number; dups: number; maxn: number };
      if (c.nulls > 0) alarm(`DISPLAY_ID: ${c.nulls} migrated contact(s) have no display_id`);
      if (c.bad > 0)
        alarm(`DISPLAY_ID: ${c.bad} migrated contact(s) have a display_id that is not CON-nnnnn`);
      if (c.dups > 0)
        alarm(`DISPLAY_ID: ${c.dups} duplicated display_id value(s) among migrated contacts`);
      if (c.n > 0) {
        const seq = await tx.execute(
          sql`SELECT current_value FROM sequence_counters WHERE org_id = ${orgId} AND module_key = 'contacts'`,
        );
        const cur = seq.rows[0]
          ? Number((seq.rows[0] as { current_value: number }).current_value)
          : null;
        if (cur === null || cur < Number(c.maxn))
          alarm(
            `SEQUENCE_COUNTER: sequence_counters(contacts) is ${cur ?? 'missing'}, below the highest imported display id ${c.maxn}: the next new contact would reuse an id`,
          );
        else if (cur !== Number(c.maxn) && !opts.allowExtraRows)
          alarm(
            `SEQUENCE_COUNTER: sequence_counters(contacts) is ${cur} but the highest imported display id is ${c.maxn}: the counter was changed`,
          );
      }
    });

    // 7. referential integrity, inside the tenant (RLS) context so a row in another org is invisible
    await withTenant(db, { orgId }, async (tx) => {
      const checks: Array<[string, string]> = [
        [
          'contact_notes -> contacts',
          'SELECT count(*)::int n FROM contact_notes t WHERE NOT EXISTS (SELECT 1 FROM contacts p WHERE p.org_id = t.org_id AND p.id = t.contact_id)',
        ],
        [
          'contact_group_members -> contacts',
          'SELECT count(*)::int n FROM contact_group_members t WHERE NOT EXISTS (SELECT 1 FROM contacts p WHERE p.org_id = t.org_id AND p.id = t.contact_id)',
        ],
        [
          'contact_group_members -> contact_groups',
          'SELECT count(*)::int n FROM contact_group_members t WHERE NOT EXISTS (SELECT 1 FROM contact_groups p WHERE p.org_id = t.org_id AND p.id = t.group_id)',
        ],
        [
          'contact_tags -> contacts/tags',
          'SELECT count(*)::int n FROM contact_tags t WHERE NOT EXISTS (SELECT 1 FROM contacts p WHERE p.org_id = t.org_id AND p.id = t.contact_id) OR NOT EXISTS (SELECT 1 FROM tags p WHERE p.org_id = t.org_id AND p.id = t.tag_id)',
        ],
        [
          'field_options -> fields',
          'SELECT count(*)::int n FROM field_options t WHERE NOT EXISTS (SELECT 1 FROM fields p WHERE p.org_id = t.org_id AND p.id = t.field_id)',
        ],
        [
          'fields -> field_sections',
          'SELECT count(*)::int n FROM fields t WHERE t.section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM field_sections p WHERE p.org_id = t.org_id AND p.id = t.section_id)',
        ],
        [
          'field_dependencies -> fields',
          'SELECT count(*)::int n FROM field_dependencies t WHERE NOT EXISTS (SELECT 1 FROM fields p WHERE p.org_id = t.org_id AND p.id = t.field_id) OR NOT EXISTS (SELECT 1 FROM fields p WHERE p.org_id = t.org_id AND p.id = t.depends_on_field_id)',
        ],
        [
          'field_option_dependencies -> field_options',
          'SELECT count(*)::int n FROM field_option_dependencies t WHERE NOT EXISTS (SELECT 1 FROM field_options p WHERE p.org_id = t.org_id AND p.id = t.parent_option_id) OR NOT EXISTS (SELECT 1 FROM field_options p WHERE p.org_id = t.org_id AND p.id = t.child_option_id)',
        ],
        [
          'status_options.stage_option_id -> status_options',
          'SELECT count(*)::int n FROM status_options t WHERE t.stage_option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM status_options p WHERE p.org_id = t.org_id AND p.id = t.stage_option_id)',
        ],
      ];
      for (const [name, text] of checks) {
        const n = ((await tx.execute(sql.raw(text))).rows[0] as { n: number }).n;
        if (n > 0)
          integrity.push(`ORPHANS: ${n} rows in ${name} point at a parent that does not exist`);
      }
    });
    for (const table of [
      'contacts',
      'fields',
      'field_sections',
      'field_options',
      'status_options',
      'tags',
      'contact_groups',
      'contact_notes',
      'field_dependencies',
      'field_option_dependencies',
      'contact_group_members',
      'roles',
      'users',
      'messages',
      'wpcampaigns',
      'wp_campaign_contacts',
      'flows',
      'keyword_replies',
      'faqs',
      'chatbot_widgets',
      'ai_chat_assistants',
      'lead_sources',
      'lead_events',
      'contact_attributions',
    ]) {
      const r = await withTenant(db, { orgId }, (tx) =>
        tx.execute(sql`
          SELECT count(*)::int AS n FROM migration.id_map m
          WHERE m.source_client = ${client} AND m.target_table = ${table}
            AND NOT EXISTS (SELECT 1 FROM ${sql.raw(`"${table}"`)} t WHERE t.org_id = ${orgId} AND t.id = m.target_id AND t.uuid = m.target_uuid)`),
      );
      const n = (r.rows[0] as { n: number }).n;
      if (n > 0)
        integrity.push(
          `TARGET_MISSING: ${n} id_map keys point at ${table} rows that do not exist in org ${orgId}, or whose uuid differs`,
        );
    }
  } finally {
    await target.close();
  }
  return finish();

  function finish(): Report {
    const rows = [...collections.values()];
    for (const r of rows) {
      if (r.disposition !== 'MIGRATE') continue;
      const sum = r.migrated + r.quarantined + r.excluded + r.unaccounted;
      if (r.kind === 'collection' && sum !== r.read) {
        alarm(
          `EQUATION: ${r.collection} read ${r.read} != migrated ${r.migrated} + quarantined ${r.quarantined} + excluded ${r.excluded} + unaccounted ${r.unaccounted}`,
        );
        r.unaccounted += Math.abs(r.read - sum);
      }
    }
    for (const [kind, n] of kindCount)
      if (n > 50) alarms.push(`${kind}: ... and ${n - 50} more of the same kind`);
    for (const l of listed) {
      if (l.status === 'unaccounted' && l.code === 'NOT_LOADED')
        alarm(`NOT_LOADED: ${l.collection} ${l.key}: ${l.reason}`);
    }
    const unaccounted = rows.reduce((a, r) => a + r.unaccounted, 0);
    const targetMissing = integrity.filter((i) => i.startsWith('TARGET_MISSING')).length;
    // a failing report always says why
    if (unaccounted + targetMissing > 0 && alarms.length === 0 && integrity.length === 0) {
      alarm(
        `UNACCOUNTED: ${unaccounted + targetMissing} document(s) are neither migrated, quarantined nor excluded (see the per-collection table)`,
      );
    }
    const report: Report = {
      client,
      generatedAt: new Date().toISOString(),
      collections: rows,
      nonMigrated: listed,
      fieldIssues,
      excludedByCode: Object.fromEntries(excludedBy),
      fields: fieldRows,
      fingerprints,
      sample,
      integrity,
      alarms,
      warnings,
      notPresent,
      notRun: [...new Set(notRunAll)],
      unaccounted: unaccounted + targetMissing,
      ok: false,
    };
    report.ok = report.unaccounted === 0 && alarms.length === 0 && integrity.length === 0;
    if (opts.outDir) writeReport(report, opts.outDir);
    return report;
  }
}

function checkFields(
  spec: HandlerSpec,
  label: string,
  seen: Map<string, number>,
  out: FieldRow[],
  alarm: (m: string) => void,
  np: Report['notPresent'],
): void {
  for (const [k, n] of seen) {
    const where = Object.hasOwn(spec.fields, k) ? spec.fields[k]! : undefined;
    if (where === undefined) continue; // dynamic keys are handled by the caller
    const dropped = where.startsWith('drop:');
    out.push({
      step: spec.handler,
      field: k,
      seen: n,
      where,
      verdict: dropped ? 'dropped' : 'mapped',
    });
    if (dropped) np.droppedFields.push(`${label}.${k} (${n} docs): ${where.slice(5)}`);
  }
  if (!spec.dynamic) {
    for (const [k, n] of seen) {
      if (Object.hasOwn(spec.fields, k)) continue;
      if (spec.extraKeysStored && !isSecretName(k)) {
        // carried in the row (messages.meta.legacy.extra), scrubbed
        out.push({
          step: spec.handler,
          field: k,
          seen: n,
          where: 'messages.meta.legacy.extra',
          verdict: 'stored-in-data',
        });
        continue;
      }
      if (isSecretName(k)) {
        // an extra attribute named like a credential is removed by the shared scrub: its NAME is listed, never a value
        out.push({
          step: spec.handler,
          field: k,
          seen: n,
          where: 'not copied: credential-looking',
          verdict: 'dropped',
        });
        np.droppedFields.push(
          `${label}.${k} (${n} docs): credential-looking, the value is never copied`,
        );
      } else {
        out.push({ step: spec.handler, field: k, seen: n, where: 'NOT MAPPED', verdict: 'ALARM' });
        alarm(
          `FIELD_UNMAPPED: ${label}.${k} (${n} docs) is neither mapped nor in the dropped list`,
        );
      }
    }
  }
}

interface Verify {
  db: Database;
  orgId: number;
  client: string;
  seed: number;
  frac: number;
  quarantine: Map<string, { code: string; reason: string }>;
  fingerprints: Map<string, { s: string[]; t: string[]; rows: number }>;
  sample: { size: number; compared: number; mismatches: string[] };
  alarm: (m: string) => void;
  row: CollRow;
  listed: Listed[];
  mapCollection: string;
  expected: Map<string, Set<string>>;
  oracle: ContactOracle;
  tableOracle: TableOracle;
  allowExtra: boolean;
  /** target uuid -> the row_version the `update` command left on a row it updated (accepted in place of the loaded 1) */
  bumped: Map<string, number>;
}

/** Compare EVERY column the loader writes (and the defaults of the ones it does not), row by row, plus the independent oracle for contacts. */
async function verifyChunk(
  spec: HandlerSpec,
  items: Array<{ base: string; outcome: Outcome; doc: Doc }>,
  v: Verify,
): Promise<void> {
  const byTable = new Map<
    string,
    Array<{ uuid: string; row: Row; base: string; sub: string; doc: Doc }>
  >();
  for (const it of items) {
    if (it.outcome.kind !== 'rows') continue;
    for (const r of it.outcome.rows) {
      if (spec.tables[r.table]?.keyless) continue; // no uuid: held by the access verifier
      if (spec.tables[r.table]?.noUuid) continue; // no uuid column: held by the credits verifier
      const uuid = rowUuid(v.client, v.mapCollection, it.base, r.sub);
      byTable.set(r.table, [
        ...(byTable.get(r.table) ?? []),
        { uuid, row: r.row, base: it.base, sub: r.sub, doc: it.doc },
      ]);
      const set = v.expected.get(r.table) ?? new Set<string>();
      set.add(uuid);
      v.expected.set(r.table, set);
    }
  }
  const missingDocs = new Set<string>();
  for (const [table, list] of byTable) {
    const ts: TableSpec = spec.tables[table]!;
    const types = new Map(ts.columns.map((c) => [c.name, c.pg as string]));
    // columns the live application legitimately changes after cutover (receipts, stars ...) are not compared under --allow-extra-rows
    const skip = new Set([
      ...(ts.skipCompare ?? []),
      ...(v.allowExtra ? (ts.liveColumns ?? []) : []),
    ]);
    const compareCols = ts.columns.map((c) => c.name).filter((n) => !skip.has(n));
    const constCols = Object.keys(ts.constants ?? {});
    const selectCols = [
      ...new Set([
        ...ts.columns.map((c) => c.name),
        ...constCols,
        ...(table === 'contacts' ? ['normalized_phone', 'normalized_email'] : []),
      ]),
    ];
    const colSql = sql.raw(
      [
        'uuid::text AS uuid',
        ...selectCols.map((n) =>
          types.get(n) === 'timestamptz'
            ? `to_char("${n}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "${n}"`
            : types.get(n) === 'date'
              ? `to_char("${n}", 'YYYY-MM-DD') AS "${n}"`
              : types.get(n) === 'time'
                ? `to_char("${n}", 'HH24:MI:SS') AS "${n}"`
                : `"${n}"`,
        ),
      ].join(', '),
    );
    const res = await withTenant(v.db, { orgId: v.orgId }, (tx) =>
      tx.execute(sql`SELECT ${colSql} FROM ${sql.raw(`"${table}"`)} WHERE org_id = ${v.orgId}
        AND uuid IN (SELECT jsonb_array_elements_text(${JSON.stringify(list.map((l) => l.uuid))}::jsonb)::uuid)`),
    );
    const found = new Map((res.rows as Row[]).map((r) => [r.uuid as string, r]));
    const roll = v.fingerprints.get(table) ?? { s: [], t: [], rows: 0 };
    v.fingerprints.set(table, roll);
    for (const l of list) {
      const t = found.get(l.uuid);
      if (!t) {
        if (v.quarantine.has(`${v.mapCollection}\u0000${l.base}${l.sub}#UNIQUE_CONFLICT`)) continue;
        missingDocs.add(l.base);
        v.listed.push({
          collection: spec.collection,
          key: l.base,
          status: 'unaccounted',
          code: 'TARGET_MISSING',
          reason: `${table} row ${l.uuid} is gone`,
        });
        v.alarm(
          `TARGET_MISSING: ${table} row for ${spec.collection} ${l.base}${l.sub} (uuid ${l.uuid}) does not exist in the target`,
        );
        continue;
      }
      // seeded sampling only for collections too big to compare in full
      if (
        v.frac < 1 &&
        parseInt(sha256(`${v.seed}|${l.uuid}`).slice(0, 8), 16) / 0xffffffff >= v.frac
      )
        continue;
      v.sample.compared++;
      roll.rows++;
      roll.s.push(`${l.uuid}:${rowHash(compareCols, types, l.row)}`);
      roll.t.push(`${l.uuid}:${rowHash(compareCols, types, t)}`);
      const diff = compareCols.filter(
        (c) => norm(l.row[c], types.get(c)!) !== norm(t[c], types.get(c)!),
      );
      for (const [c, want0] of Object.entries(ts.constants ?? {})) {
        const want = c === 'row_version' && v.bumped.has(l.uuid) ? v.bumped.get(l.uuid) : want0;
        if (!skip.has(c) && norm(t[c], '') !== norm(want, '')) diff.push(c);
      }
      if (diff.length > 0) {
        v.alarm(
          `FINGERPRINT_MISMATCH: ${table} ${spec.collection} ${l.base}${l.sub}: ${diff.map((c) => `${c} source=${show(c, c in l.row ? l.row[c] : ts.constants?.[c])} target=${show(c, t[c])}`).join('; ')}`,
        );
        v.sample.mismatches.push(`${table} ${l.base}${l.sub}: ${diff.join(',')}`);
      }
      if (table === 'contacts') {
        const want = v.oracle.expect(l.doc);
        if (!want) {
          v.alarm(
            `ORACLE_MISMATCH: contacts ${spec.collection} ${l.base}: the independent check says this document must not become a contact`,
          );
        } else {
          const bad = Object.entries(want).filter(
            ([c, w]) =>
              norm(t[c], c.endsWith('_at') ? 'timestamptz' : '') !==
              norm(w, c.endsWith('_at') ? 'timestamptz' : ''),
          );
          if (bad.length > 0)
            v.alarm(
              `ORACLE_MISMATCH: contacts ${spec.collection} ${l.base}: ${bad.map(([c, w]) => `${c} expected=${show(c, w)} target=${show(c, t[c])}`).join('; ')}`,
            );
        }
      } else {
        // the other tables: the same independent re-implementation (name / key normalisation, ordering, defaults, dates)
        const want = spec.virtual ? null : v.tableOracle.expectTable(table, l.doc);
        if (want) {
          const bad = Object.entries(want).filter(
            ([c, w]) =>
              norm(t[c], c.endsWith('_at') ? 'timestamptz' : '') !==
              norm(w, c.endsWith('_at') ? 'timestamptz' : ''),
          );
          if (bad.length > 0)
            v.alarm(
              `ORACLE_MISMATCH: ${table} ${spec.collection} ${l.base}${l.sub}: ${bad.map(([c, w]) => `${c} expected=${show(c, w)} target=${show(c, t[c])}`).join('; ')}`,
            );
        }
      }
    }
  }
  if (missingDocs.size > 0) {
    v.row.migrated -= missingDocs.size;
    v.row.unaccounted += missingDocs.size;
  }
}

/** The organization and what provisioning must have left behind (B6). */
async function checkOrg(
  db: Database,
  client: string,
  orgId: number,
  alarm: (m: string) => void,
  warnings: string[],
): Promise<void> {
  const logRow = await db.execute(
    sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = ${ORG_COLLECTION} AND step = 'org'`,
  );
  const want = (logRow.rows[0] as { counts?: Record<string, unknown> } | undefined)?.counts;
  if (!want)
    alarm('ORG_STATE: no record of what organization this tool created (migration.run_log _org)');
  // a second organization carrying this client's marker is a duplicate import. Organizations of other tenants are invisible to the
  // worker, so this one read-only count lifts RLS (the verifier is the only reader that does; nothing is written).
  const marker = await withPrivileged(db, (tx) =>
    tx.execute(
      sql`SELECT count(*)::int AS n FROM organizations WHERE settings->'legacy'->'waboo'->>'client' = ${client} OR uuid = ${uuidv5(`${client}|${ORG_COLLECTION}`)}::uuid`,
    ),
  );
  const leak = await withPrivileged(db, (tx) =>
    tx.execute(sql`
      SELECT count(*)::int AS n FROM contacts c
      WHERE c.legacy_id IS NOT NULL AND c.org_id <> ${orgId}
        AND EXISTS (SELECT 1 FROM migration.id_map m WHERE m.source_client = ${client} AND m.source_collection = 'contact_list' AND m.source_key = c.legacy_id)
        AND NOT EXISTS (SELECT 1 FROM migration.id_map m WHERE m.source_collection = 'contact_list' AND m.source_key = c.legacy_id AND m.target_org_id = c.org_id)`),
  );
  const foreign = await withPrivileged(db, (tx) =>
    tx.execute(sql`
      SELECT count(*)::int AS n FROM contacts c
      WHERE c.legacy_id IS NOT NULL AND c.org_id <> ${orgId}
        AND NOT EXISTS (SELECT 1 FROM migration.id_map m WHERE m.source_collection = 'contact_list' AND m.source_key = c.legacy_id AND m.target_org_id = c.org_id)`),
  );
  const leaked = (leak.rows[0] as { n: number }).n + (foreign.rows[0] as { n: number }).n;
  if (leaked > 0)
    alarm(
      `LEAKED_ROWS: ${leaked} contact(s) carrying a migrated legacy id sit in an organization the migration did not put them in`,
    );
  if ((marker.rows[0] as { n: number }).n !== 1) {
    alarm(
      `ORG_STATE: ${(marker.rows[0] as { n: number }).n} organizations carry the legacy marker of client ${client} (expected exactly 1)`,
    );
  }
  await withTenant(db, { orgId }, async (tx) => {
    const o = (
      await tx.execute(
        sql`SELECT slug, name, status, plan, settings FROM organizations WHERE id = ${orgId}`,
      )
    ).rows[0] as
      | {
          slug: string;
          name: string;
          status: string;
          plan: string;
          settings: Record<string, unknown>;
        }
      | undefined;
    if (!o) {
      alarm(`TARGET_MISSING: organization ${orgId} does not exist`);
      return;
    }
    if (want) {
      for (const k of ['slug', 'name', 'status', 'plan'] as const) {
        if (String(o[k]) !== String(want[k]))
          alarm(
            `ORG_STATE: organizations.${k} is "${String(o[k])}" but the tool created "${String(want[k])}"`,
          );
      }
    }
    const { ownerUserId, ...rest } = o.settings as Record<string, unknown>;
    if (stable(rest) !== stable({ legacy: { waboo: { client } } }))
      alarm(
        'ORG_STATE: organizations.settings was changed after the migration (it holds only the legacy marker and ownerUserId)',
      );
    const plan = (
      await tx.execute(
        sql`SELECT billing_cycle, trial_ends_at FROM org_plan_state WHERE org_id = ${orgId}`,
      )
    ).rows[0] as { billing_cycle: string; trial_ends_at: unknown } | undefined;
    if (!plan) alarm('ORG_STATE: org_plan_state row is missing');
    else if (
      want &&
      (plan.billing_cycle !== String(want.billingCycle ?? 'monthly') ||
        (plan.trial_ends_at !== null) !== Boolean(want.trial))
    )
      alarm(
        'ORG_STATE: org_plan_state was changed (billing cycle or trial differs from what the tool created)',
      );
    const ws = await tx.execute(
      sql`SELECT count(*)::int AS n FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    if ((ws.rows[0] as { n: number }).n !== 1)
      alarm('ORG_STATE: the default workspace_settings row is missing');
    const roles = (await tx.execute(sql`SELECT name FROM roles WHERE org_id = ${orgId}`))
      .rows as Array<{ name: string }>;
    const names = new Set(roles.map((r) => r.name));
    const lacking = PRESET_ROLES.filter((r) => !names.has(r));
    if (lacking.length > 0) alarm(`ORG_STATE: preset role(s) missing: ${lacking.join(', ')}`);
    const ownerEmail = want?.ownerEmail ? String(want.ownerEmail) : null;
    if (ownerEmail) {
      const u = (
        await tx.execute(sql`
        SELECT u.uuid::text AS uuid, EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.name = 'Owner') AS is_owner,
               EXISTS (SELECT 1 FROM user_security s WHERE s.org_id = u.org_id AND s.user_id = u.id) AS has_security,
               u.password_hash IS NULL AS no_password, u.auth_subject IS NULL AS no_subject, u.status = 'active' AS active,
               u.joined_at IS NULL AS not_joined, u.invited_at IS NOT NULL AS invited,
               (SELECT s.email_verified_at IS NOT NULL FROM user_security s WHERE s.org_id = u.org_id AND s.user_id = u.id) AS verified
        FROM users u WHERE u.org_id = ${orgId} AND u.email = ${ownerEmail}`)
      ).rows[0] as
        | {
            uuid: string;
            is_owner: boolean;
            has_security: boolean;
            no_password: boolean;
            no_subject: boolean;
            active: boolean;
            not_joined: boolean;
            invited: boolean;
            verified: boolean | null;
          }
        | undefined;
      if (!u) alarm('ORG_STATE: the owner user is missing');
      else {
        if (!u.is_owner) alarm('ORG_STATE: the owner user no longer has the Owner role');
        if (!u.has_security) alarm('ORG_STATE: the owner user has no user_security row');
        if (!u.no_password)
          alarm('ORG_STATE: the owner user has a password hash (the migration creates none)');
        if (!u.no_subject)
          alarm(
            'ORG_STATE: the owner user has an auth_subject (the migration leaves it for the first sign-in)',
          );
        if (!u.active || !u.not_joined || !u.invited)
          alarm('ORG_STATE: the owner user is not in the invited, active, not-yet-joined state');
        if (Boolean(u.verified) !== Boolean(want?.ownerVerified))
          alarm('ORG_STATE: the owner email verification state differs from what the tool created');
        if (ownerUserId !== u.uuid)
          alarm('ORG_STATE: organizations.settings.ownerUserId does not point at the owner user');
      }
    } else {
      const own = await tx.execute(
        sql`SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = ${orgId} AND r.name = 'Owner' LIMIT 1`,
      );
      if (own.rows.length === 0)
        warnings.push(
          'THE ORGANIZATION HAS NO OWNER: nobody can sign in until a user with the Owner role exists.',
        );
    }
  });
}

export function toMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(
    `# Reconciliation: ${r.client}`,
    '',
    `Generated ${r.generatedAt}. **${r.ok ? 'PASS' : 'FAIL'}**  (unaccounted ${r.unaccounted}, alarms ${r.alarms.length}, integrity ${r.integrity.length})`,
    '',
  );
  if (r.warnings.length) L.push('## WARNINGS', '', ...r.warnings.map((a) => `- ${a}`), '');
  L.push(
    '## Per collection',
    '',
    '| collection | kind | decision | read | migrated | quarantined | excluded | gap | deferred | unaccounted |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const c of r.collections)
    L.push(
      `| ${c.collection} | ${c.kind} | ${c.disposition} | ${c.read} | ${c.migrated} | ${c.quarantined} | ${c.excluded} | ${c.gap} | ${c.deferred} | ${c.unaccounted} |`,
    );
  L.push(
    '',
    'Equation for MIGRATE collections: read = migrated + quarantined + excluded; unaccounted must be 0.',
    '',
  );
  if (Object.keys(r.excludedByCode ?? {}).length)
    L.push(
      '## Excluded, by reason',
      '',
      ...Object.entries(r.excludedByCode).map(([k, n]) => `- ${k}: ${n}`),
      '',
    );
  if (r.alarms.length) L.push('## ALARMS', '', ...r.alarms.slice(0, 200).map((a) => `- ${a}`), '');
  if (r.integrity.length)
    L.push('## Integrity failures', '', ...r.integrity.map((a) => `- ${a}`), '');
  L.push('## Non-migrated source keys', '');
  const byColl = new Map<string, Listed[]>();
  for (const n of r.nonMigrated) byColl.set(n.collection, [...(byColl.get(n.collection) ?? []), n]);
  for (const [c, list] of byColl) {
    L.push(`### ${c} (${list.length})`, '');
    for (const n of list.slice(0, 50)) L.push(`- ${n.key}: ${n.status} ${n.code} - ${n.reason}`);
    if (list.length > 50) L.push(`- ... ${list.length - 50} more (all in reconcile.json)`);
    L.push('');
  }
  if (Object.keys(r.fieldIssues).length)
    L.push(
      '## Field-level issues (document migrated, value quarantined)',
      '',
      ...Object.entries(r.fieldIssues).map(([k, n]) => `- ${k}: ${n}`),
      '',
    );
  L.push(
    '## Field coverage',
    '',
    '| step | field | docs | goes to | verdict |',
    '|---|---|---:|---|---|',
  );
  for (const f of r.fields)
    L.push(`| ${f.step} | ${f.field} | ${f.seen} | ${f.where} | ${f.verdict} |`);
  L.push(
    '',
    '## Row fingerprints (sha256 over every compared column, source vs target)',
    '',
    '| table | rows | source | target | match |',
    '|---|---:|---|---|---|',
  );
  for (const [t, f] of Object.entries(r.fingerprints))
    L.push(
      `| ${t} | ${f.rows} | ${f.source.slice(0, 16)} | ${f.target.slice(0, 16)} | ${f.source === f.target ? 'yes' : 'NO'} |`,
    );
  L.push(
    '',
    `Rows compared column by column: ${r.sample.compared}; mismatches: ${r.sample.mismatches.length}.`,
    '',
  );
  const list = (title: string, xs: string[]): void => {
    L.push('', title, ...(xs.length ? xs.map((x) => `- ${x}`) : ['- none']));
  };
  L.push('## NOT RUN (steps that never ran for this client: not verified, not an error)');
  L.push(...(r.notRun.length ? r.notRun.map((x) => `- ${x}`) : ['- none']), '');
  L.push('## NOT PRESENT IN WADESK');
  list('### Collections with no target table (GAP)', r.notPresent.collectionsGap);
  list('### Collections not in the registry (UNKNOWN)', r.notPresent.collectionsUnknown);
  list('### Undecided (OPEN)', r.notPresent.collectionsOpen);
  list(
    '### Source fields with no target column (dropped, with reason)',
    r.notPresent.droppedFields,
  );
  list('### Deferred to phase 2 (MIGRATE_LATER)', r.notPresent.collectionsDeferred);
  L.push('');
  return L.join('\n');
}

/** The report is shared (the panel, the PR evidence): an e-mail address that rode in on an example (an automation node's config, a field value) is replaced before it is written. */
const EMAIL_IN_REPORT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g;
const redactReport = (s: string): string => s.replace(EMAIL_IN_REPORT, '<email>');

export function writeReport(r: Report, outDir: string): void {
  const dir = join(outDir, r.client);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reconcile.json'), redactReport(JSON.stringify(r, null, 2)));
  writeFileSync(join(dir, 'reconcile.md'), redactReport(toMarkdown(r)));
}
