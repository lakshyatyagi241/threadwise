import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { automationProfile, formatAutomationProfile } from '../extract/automation-profile';
import { FlowsConfigError, resolveFlows, type FlowOptions } from '../flows/config';
import { LIMITS, MAIN_NAME, waboToGraph } from '../flows/wabo-convert';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { shapeOf } from '../reconcile/oracle-flows';
import { resolve } from '../registry';
import { STEPS } from '../transform';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import {
  acmeFlows,
  bid,
  chatbot,
  node,
  FAKE_META,
  FAKE_OPENAI,
  FAKE_ROUTER,
  globexFlows,
  nid,
} from './flows-fixtures';

const OWNER = 'owner@example.test';
const opts = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  extra: Partial<RunOptions> = {},
): RunOptions =>
  runOpts(d, db, client, {
    org: { name: client, slug: client, ownerEmail: client === 'acme' ? OWNER : null },
    allowNoOwner: client === 'globex',
    ...extra,
  });
const check = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  flows?: FlowOptions,
  allowExtraRows = false,
) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    flows,
    allowExtraRows,
  });
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);

/** Everything the import wrote that does not depend on ids or on the random embed token. */
async function snapshot(db: TestDb): Promise<string> {
  const f = await rows(
    db,
    `SELECT uuid::text, to_jsonb(f) - 'id' - 'org_id' - 'uuid' AS r FROM flows f ORDER BY uuid`,
  );
  const k = await rows(
    db,
    `SELECT k.uuid::text, to_jsonb(k) - 'id' - 'org_id' - 'uuid' - 'flow_id' AS r, fl.uuid::text AS flow FROM keyword_replies k JOIN flows fl ON fl.org_id = k.org_id AND fl.id = k.flow_id ORDER BY k.uuid`,
  );
  const w = await rows(
    db,
    `SELECT uuid::text, to_jsonb(w) - 'id' - 'org_id' - 'uuid' - 'assistant_id' - 'embed_token' AS r FROM chatbot_widgets w ORDER BY uuid`,
  );
  const a = await rows(
    db,
    `SELECT uuid::text, to_jsonb(a) - 'id' - 'org_id' - 'uuid' AS r FROM ai_chat_assistants a ORDER BY uuid`,
  );
  return JSON.stringify({ f, k, w, a });
}
const TABLES = [
  'flows',
  'keyword_replies',
  'chatbot_widgets',
  'ai_chat_assistants',
  'migration.id_map',
  'migration.quarantine',
];
const totals = async (db: TestDb): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => [t, await one(db, `SELECT count(*)::int AS n FROM ${t}`)] as const),
    ),
  );

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};
const dumpOf = (g: ReturnType<typeof acmeFlows>) => ({ contact_list: [], ...g });

beforeAll(async () => {
  dumps = await customDumps({ acme: dumpOf(acmeFlows()), globex: dumpOf(globexFlows()) });
  base = await clone('fl-base');
  await runClient(opts(dumps, base, 'acme'));
  await runClient(opts(dumps, base, 'globex'));
}, 1_800_000);

afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('registry, configuration, the vendored converter', () => {
  it('the flow collections are migrated, the history and the legacy copy are not, automations wait with a precise reason', () => {
    for (const c of [
      'flows',
      'bot_flow_version',
      'bot_flow_version_data',
      'bot_workspace',
      'faq_variations',
      'chatbots',
      'chatbot_configuration',
      'chatbot_theme',
    ])
      expect(resolve(c).disposition, c).toBe('MIGRATE');
    expect(resolve('flows_version').disposition).toBe('EXCLUDE');
    expect(resolve('automation_version').disposition).toBe('EXCLUDE');
    expect(resolve('automation_node_version').disposition).toBe('EXCLUDE');
    expect(resolve('journey').disposition).toBe('EXCLUDE');
    expect(resolve('automation_metadata').disposition).toBe('MIGRATE'); // built: see test/automation.spec.ts
    expect(resolve('automation_journey').disposition).toBe('MIGRATE');
    expect(resolve('automation_journey').reason).toMatch(/unpublished AND inactive/);
    // chatbot_misc_config is untouched (HIGH RISK, a later builder) and no step of this builder reads it
    expect(resolve('chatbot_misc_config').disposition).toBe('MIGRATE_LATER');
    expect(STEPS.filter((s) => s.collection === 'chatbot_misc_config')).toEqual([]);
    expect(STEPS.some((s) => s.collection === 'document_col')).toBe(false);
    const order = STEPS.map((s) => s.handler);
    expect(order.indexOf('flow_bots')).toBeLessThan(order.indexOf('faq_replies'));
    expect(order.indexOf('widget_assistants')).toBeLessThan(order.indexOf('widgets'));
    expect(order.indexOf('flow_bots')).toBeLessThan(order.indexOf('inbox'));
  });

  it('refuses a bad switch before anything is written', async () => {
    expect(() => resolveFlows({ flowVersion: 'latest' as 'draft' })).toThrow(FlowsConfigError);
    expect(resolveFlows()).toEqual({
      flowVersion: 'published',
      widgetsForWhatsappBots: false,
      flowLimit: 0,
      widgetLimit: 0,
    });
    const db = await clone('fl-cfg');
    await expect(
      runClient(opts(dumps, db, 'acme', { flows: { flowVersion: 'x' as 'draft' } })),
    ).rejects.toThrow(/FLOWS_CONFIG/);
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
  });

  it('drift guard: the vendored converter is the web importer, byte for byte, and its constants are the web constants', () => {
    const web = join(__dirname, '../../../apps/web/src/features/flow-builder-editor/lib');
    const norm = (s: string): string => s.replace(/\r\n/g, '\n');
    const original = norm(readFileSync(join(web, 'wabo-import.ts'), 'utf8'));
    const marker = "import { LIMITS, MAIN_NAME } from './simple-model';\n";
    const vendored = norm(readFileSync(join(__dirname, '../flows/wabo-convert.ts'), 'utf8'));
    const vMarker =
      '// ---- vendored body: byte-for-byte from wabo-import.ts below this line ----\n';
    expect(original.includes(marker)).toBe(true);
    expect(
      vendored.slice(vendored.indexOf(vMarker) + vMarker.length),
      'wabo-import.ts changed: re-copy its body into flows/wabo-convert.ts and read the diff',
    ).toBe(original.slice(original.indexOf(marker) + marker.length));
    const model = norm(readFileSync(join(web, 'simple-model.ts'), 'utf8'));
    const lim = /export const LIMITS = \{([^}]*)\} as const;/.exec(model)![1]!;
    const pairs = [...lim.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]);
    expect(Object.fromEntries(pairs)).toEqual(LIMITS);
    expect(/export const MAIN_NAME = '([^']*)';/.exec(model)![1]).toBe(MAIN_NAME);
  });

  it('the converter still keeps the shapes the plan relies on (buttons, list, live agent, node-to-node, template id)', () => {
    const out = waboToGraph(
      [
        { nodeId: 'a1', qid: 'q', subType: 'text', displayOrder: 0, response: [{ value: 'hi' }] },
        {
          nodeId: 'a2',
          qid: 'q',
          subType: 'whatsapp-template',
          displayOrder: 1,
          response: [{ template_id: 'T9' }],
        },
      ],
      { exact: true },
    );
    expect(out.graph.flowNodes.map((n) => n.type)).toEqual(['trigger', 'message', 'template']);
    expect(out.graph.flowNodes[2]!.data.tpl).toBe('T9');
    expect(out.keywords).toBe('hi');
  });

  it('the oracle derives the shape from node records alone (a loop, a link to a missing step, an orphan chain)', () => {
    const n = (id: string, sub: string, order: number, extra: Record<string, unknown> = {}) => ({
      nodeId: id,
      qid: 'q',
      subType: sub,
      displayOrder: order,
      ...extra,
    });
    const sh = shapeOf(
      [
        n('a', 'text', 0, { actions: [{ type: 'connect_node', nodeId: 'a' }] }),
        n('b', 'interactive-message', 1, {
          response: [
            {
              interactive: {
                action: {
                  buttons: [
                    { type: 'flow', value: { nodeId: 'a' } },
                    { type: 'flow', value: { nodeId: 'ghost' } },
                    { type: 'live_agent', id: 'z' },
                  ],
                },
              },
            },
          ],
        }),
        n('c', 'text', 2),
      ],
      [],
    );
    // trigger + 3 steps + 1 agent; links: trigger->a, a->a (connect replaces a->b), b->a, b->agent
    expect(sh).toMatchObject({ nodeCount: 5, edgeCount: 4, agents: 1, steps: 3, firstNodeId: 'a' });
    expect(sh.orphanCount).toBe(2); // b lost its way in (a's out wire now loops) and c has none
  });

  it('automation-profile lists names and counts only, never node data', async () => {
    const d = await customDumps({
      acme: {
        automation_journey: [
          {
            _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaa1' },
            type: 'trigger',
            class: 'ContactTrigger',
            function: 'added',
            shapeId: 'S1',
            nodeObjectData: { secret: 'EAAXXXXXXXXXXXXXXXXXXXXXXXX' },
          },
          {
            _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaa2' },
            type: 'trigger',
            class: 'ContactTrigger',
            function: 'added',
            shapeId: 'S1',
          },
          {
            _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaa3' },
            type: 'action',
            class: 'a b c d e f g h free text with spaces',
            function: 'send',
            shapeId: 7,
          },
        ],
        automation_metadata: [
          {
            _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaa4' },
            nodes: {
              n1: {
                type: 'condition',
                class: 'C',
                function: 'f',
                shapeId: 'S9',
                query: 'secret filter',
              },
            },
          },
        ],
      },
    });
    try {
      const text = formatAutomationProfile(await automationProfile(d.source, 'acme'));
      expect(text).toMatch(/2\s+type=trigger\s+class=ContactTrigger\s+function=added\s+shape=S1/);
      expect(text).toMatch(/type=action\s+class=\(other text\)/);
      expect(text).toMatch(/type=condition\s+class=C\s+function=f\s+shape=S9/);
      expect(text).not.toMatch(/EAAXXX|secret filter/);
    } finally {
      d.cleanup();
    }
  });
});

describe('the load', () => {
  it('reconcile passes for both clients: the equation holds and every independent check agrees', async () => {
    for (const client of ['acme', 'globex'] as const) {
      const r = await check(dumps, base, client);
      expect(r.alarms, client).toEqual([]);
      expect(r.integrity).toEqual([]);
      expect(r.ok).toBe(true);
    }
    const r = await check(dumps, base, 'acme');
    const row = (c: string) => r.collections.find((x) => x.collection === c)!;
    for (const c of [
      'chatbots',
      'bot_flow_version',
      'bot_flow_version_data',
      'bot_workspace',
      'flows',
      'faq_variations',
      'chatbot_configuration',
      'chatbot_theme',
    ])
      expect(row(c), c).toMatchObject({ unaccounted: 0 });
    expect(row('bot_flow_version_data')).toMatchObject({
      read: 18,
      migrated: 10,
      quarantined: 1,
      excluded: 7,
    });
    expect(r.excludedByCode['bot_flow_version_data: UNSUPPORTED_STEP']).toBe(1);
    expect(r.excludedByCode['bot_flow_version_data: DUPLICATE_NODE']).toBe(1);
    expect(r.excludedByCode['bot_flow_version_data: OPT_IN_OUT']).toBe(1);
    expect(r.excludedByCode['bot_flow_version_data: OLDER_VERSION']).toBe(2);
    expect(r.excludedByCode['chatbots: WEB_BOT_NO_FLOW']).toBeUndefined(); // the website bot's home is its widget
    expect(r.excludedByCode['chatbots: SOFT_DELETED']).toBe(1);
    expect(r.excludedByCode['chatbots: BOT_INACTIVE']).toBe(1);
    expect(r.excludedByCode['chatbot_theme: NO_WIDGET']).toBe(1);
    const np = r.notPresent.droppedFields.join('\n');
    expect(np).toMatch(/NOT PRESENT \(flows\): .*quickActions 1/);
    expect(np).toMatch(/apiActions 1/);
    expect(np).toMatch(/NOT PRESENT \(widgets\): configuration \/ theme key "banned_users"/);
    expect(np).toMatch(/template step/);
  });

  it('one flow per bot, latest version only, named and filed, with a trigger from the Intent / FAQ words', async () => {
    const f = await rows(
      base,
      `SELECT f.*, f.flow_data AS fd FROM flows f JOIN organizations o ON o.id = f.org_id WHERE o.slug = 'acme' ORDER BY f.flow_name`,
    );
    expect(f.map((x) => x.flow_name)).toEqual([
      'Numbered Bot',
      'Support Bot',
      'Support Bot (2)',
      'Waboo bot 000000',
    ]);
    const a = f.find((x) => x.flow_name === 'Support Bot')!;
    expect(a).toMatchObject({
      category: 'Waboo chatbot',
      provider: 'waba',
      flow_type: 'chat',
      trigger_kind: 'keyword',
      trigger_value: null,
      user_id: null,
      row_version: 1,
    });
    expect(a.trigger_keywords).toBe('pricing, cost, what is the price');
    const types = a.fd.flowNodes.map((n: any) => n.type);
    expect(types.filter((t: string) => t === 'trigger')).toHaveLength(1);
    expect(types).toContain('assign'); // the live-agent button
    expect(types).toContain('template');
    expect(new Date(a.created_at).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(new Date(a.updated_at).toISOString()).toBe('2026-03-05T00:00:00.000Z'); // the version's publishedAt, not now()
    // nothing of the older version or of the draft
    const texts = JSON.stringify(a.fd);
    expect(texts).not.toContain(nid(21).slice(0, 8));
    expect(texts).not.toContain(nid(22).slice(0, 8));
    // the template id became a name where the dump knew it, empty where not
    const tpl = a.fd.flowNodes
      .filter((n: any) => n.type === 'template')
      .map((n: any) => n.data.tpl)
      .sort();
    expect(tpl).toEqual(['', 'welcome_offer']);
    // a draft-only bot comes from bot_workspace
    const b = f.find((x) => x.flow_name === 'Support Bot (2)')!;
    expect(b.fd.flowNodes.map((n: any) => n.type)).toEqual([
      'trigger',
      'message',
      'list',
      'message',
    ]);
  });

  it('SAFETY: no imported flow is published or active, no trigger is armed, no consumer predicate finds anything', async () => {
    const hits = async (q: string): Promise<number> => (await rows(base, q)).length;
    expect(
      await hits(
        `SELECT id FROM flows WHERE is_published OR is_active OR published_at IS NOT NULL`,
      ),
    ).toBe(0);
    // trigger.service keywordFlow / liveConfigured / enrolment, flow-reader, the overview counters, idx_flows_live_trigger
    expect(
      await hits(
        `SELECT id FROM flows WHERE is_published AND is_active AND trigger_kind = 'keyword' AND coalesce(trigger_keywords, '') <> ''`,
      ),
    ).toBe(0);
    expect(await hits(`SELECT id FROM flows WHERE is_published AND is_active`)).toBe(0);
    // schedule.sweeper tickOnce
    expect(
      await hits(
        `SELECT f.id FROM flows f WHERE f.is_published AND f.is_active AND f.trigger_kind IN ('schedule', 'date_field_match')`,
      ),
    ).toBe(0);
    expect(
      await hits(
        `SELECT id FROM flows WHERE trigger_channel_id IS NOT NULL OR trigger_device_id IS NOT NULL OR trigger_last_occurrence IS NOT NULL`,
      ),
    ).toBe(0);
    expect(await hits(`SELECT id FROM keyword_replies WHERE status OR is_flow_trigger`)).toBe(0);
    expect(
      await hits(
        `SELECT id FROM chatbot_widgets WHERE status <> 'paused' OR jsonb_array_length(allowed_domains) = 0`,
      ),
    ).toBe(0);
    expect(await hits(`SELECT id FROM ai_chat_assistants WHERE status <> 'paused'`)).toBe(0);
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
      'notifications',
      'audit_log',
      'webhook_deliveries',
    ]) {
      const ex = await rows(base, `SELECT to_regclass('public.${t}') IS NOT NULL AS ok`);
      if (ex[0]!.ok) expect(await one(base, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(0);
    }
    // no INSERT trigger on the tables written, and no row was UPDATEd (touch_row bumps row_version)
    const trg = await rows(
      base,
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('flows','keyword_replies','chatbot_widgets','ai_chat_assistants') AND (t.tgtype & 4) <> 0`,
    );
    expect(trg).toEqual([]);
    expect(await one(base, `SELECT count(*)::int AS n FROM flows WHERE row_version <> 1`)).toBe(0);
  });

  it('keyword replies from faq_variations are inactive, start the flow, carry the phrases and nothing else', async () => {
    const k = await rows(
      base,
      `SELECT k.*, f.flow_name FROM keyword_replies k JOIN flows f ON f.org_id = k.org_id AND f.id = k.flow_id JOIN organizations o ON o.id = k.org_id WHERE o.slug = 'acme' ORDER BY k.keyword`,
    );
    expect(k.length).toBeGreaterThanOrEqual(2); // the 255-character limit splits the list
    for (const r of k) {
      expect(r).toMatchObject({
        status: false,
        reply_type: 'flow',
        is_flow_trigger: false,
        matching_method: 'exact',
        flow_name: 'Support Bot',
        trigger_count: 0,
      });
      expect(Array.from(r.keyword as string).length).toBeLessThanOrEqual(255);
    }
    const all = k.flatMap((r) => (r.keyword as string).split(', '));
    expect(all).toContain('how much');
    expect(all).not.toContain('How Much'); // a duplicate ignoring case
    expect(all).toContain('price  please'.replace('  ', ' ')); // the comma became a space
    expect(all.some((x) => x.startsWith('zzzz'))).toBe(false); // the 300-character phrase cannot be a keyword
    const soft = await rows(
      base,
      `SELECT split_part(source_key, '#', 2) AS code FROM migration.quarantine WHERE collection = 'faq_variations' AND source_key LIKE '%#%'`,
    );
    expect(soft.map((s) => s.code).sort()).toEqual([
      'PHRASE_COMMA_REPLACED',
      'PHRASE_TOO_LONG_DROPPED',
      'QID_NOT_ADDRESSABLE',
    ]);
    // the record of an unknown bot and the empty one load nothing
    const q = await rows(
      base,
      `SELECT reason_code FROM migration.quarantine WHERE collection = 'faq_variations' AND source_key NOT LIKE '%#%'`,
    );
    expect(q).toEqual([]);
  });

  it('widgets: one row per website bot or numbered bot, paused, closed, a fresh token, AI as plain configuration, keys never copied', async () => {
    const w = await rows(
      base,
      `SELECT w.*, a.system_prompt, a.ai_model, a.temperature, a.status AS astatus, a.language FROM chatbot_widgets w LEFT JOIN ai_chat_assistants a ON a.org_id = w.org_id AND a.id = w.assistant_id JOIN organizations o ON o.id = w.org_id WHERE o.slug = 'acme' ORDER BY w.name`,
    );
    expect(w.map((x) => x.name)).toEqual(['Numbered Bot', 'Web Widget']);
    const web = w.find((x) => x.name === 'Web Widget')!;
    expect(web).toMatchObject({
      status: 'paused',
      mode: 'both',
      position: 'bottom_left',
      button_color: '#112233',
      header_bg: '#112233',
      action_button_bg: '#445566',
      action_button_text_color: '#FFFFFF',
      welcome_message: 'Hi, how can we help?',
      prefilled_message: 'I want to know more',
      button_label: 'Chat now',
      auto_open: true,
      ai_model: 'gpt-4o-mini',
      astatus: 'paused',
      language: 'en',
      row_version: 1,
    });
    expect(web.allowed_domains).toEqual(['migration-import.invalid']);
    expect(web.embed_token).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(web.system_prompt).toBe('You are a helpful assistant for Acme.');
    expect(Number(web.temperature)).toBe(0.4);
    expect(web.launcher).toMatchObject({
      introMessage: 'We reply fast',
      desktop: { side: 'left', sideSpacing: 20, bottomSpacing: 30 },
      colour: '#112233',
    });
    const num = w.find((x) => x.name === 'Numbered Bot')!;
    expect(num).toMatchObject({
      mode: 'whatsapp',
      target_whatsapp_number: '919876543210',
      target_whatsapp_cc: null,
      assistant_id: null,
      button_color: '#075E54',
    }); // the theme was missing: defaults
    expect(new Set(w.map((x) => x.embed_token)).size).toBe(2);
    // no key of the dump is anywhere
    for (const t of [
      'chatbot_widgets',
      'ai_chat_assistants',
      'flows',
      'keyword_replies',
      'migration.quarantine',
      'migration.id_map',
      'migration.run_log',
    ])
      for (const secret of [FAKE_OPENAI, FAKE_ROUTER, FAKE_META])
        expect(
          await one(
            base,
            `SELECT count(*)::int AS n FROM ${t} x WHERE to_jsonb(x)::text LIKE '%${secret}%'`,
          ),
          `${t} ${secret.slice(0, 6)}`,
        ).toBe(0);
    // the soft issues name the keys, never the values
    const names = await rows(
      base,
      `SELECT doc FROM migration.quarantine WHERE source_key LIKE '%#AI_KEYS_NOT_COPIED'`,
    );
    expect(names[0]!.doc.detail.sort()).toEqual(['normalKey', 'openRouterKey']);
  });

  it('a website bot has no flow; a deleted, a switched-off and a leaking bot load nothing, a nameless orphan gets a name from its id', async () => {
    const q = await rows(
      base,
      `SELECT source_key, reason_code FROM migration.quarantine WHERE collection = 'flow_bots' AND source_key NOT LIKE '%#%'`,
    );
    expect(q.map((x) => x.reason_code)).toEqual(['SECRET_IN_FLOW']);
    const f = await rows(
      base,
      `SELECT flow_name FROM flows f JOIN organizations o ON o.id = f.org_id WHERE o.slug = 'acme' AND flow_name LIKE 'Waboo bot%'`,
    );
    expect(f).toHaveLength(1);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM flows f JOIN organizations o ON o.id = f.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(1);
  });

  it('conversion losses are counted per flow as soft issues, with the library ids the API actions pointed at', async () => {
    const r = await rows(
      base,
      `SELECT doc FROM migration.quarantine WHERE collection = 'flow_bots' AND source_key LIKE '%#CONVERSION_LOSS'`,
    );
    const big = r.map((x) => x.doc.detail).find((d) => d.quickActions > 0)!;
    expect(big).toMatchObject({
      quickActions: 1,
      apiActions: 1,
      templateVariables: 1,
      extraResponses: 1,
      headers: 1,
      liveAgentButtons: 1,
      otherButtons: 1,
      apiLibraryIds: ['api-lib-1'],
    });
    expect(big.unsupportedSteps).toEqual({ button: 1 });
    const t = await rows(
      base,
      `SELECT doc FROM migration.quarantine WHERE source_key LIKE '%#TEMPLATE_UNRESOLVED'`,
    );
    expect(t[0]!.doc.detail).toEqual({ steps: 2, named: 1, unnamed: 1 });
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.quarantine WHERE source_key LIKE '%#PROPERTY_NOT_FOUND'`,
      ),
    ).toBeGreaterThan(0);
  });

  it('every source key is in id_map, both the ObjectId and the string id, and they point at the flow / widget the document went into', async () => {
    const m = await rows(
      base,
      `SELECT source_collection, count(*)::int AS n FROM migration.id_map WHERE source_client = 'acme' GROUP BY 1`,
    );
    const by = Object.fromEntries(m.map((x) => [x.source_collection, x.n]));
    expect(by.bot_flow_version_data).toBe(20); // 10 adopted steps, ObjectId and string id each
    expect(by.flow_bots).toBe(4);
    expect(by.widgets).toBe(2);
    const x = await rows(
      base,
      `SELECT m.target_table FROM migration.id_map m WHERE m.source_client = 'acme' AND m.source_collection = 'chatbots'`,
    );
    expect(new Set(x.map((r) => r.target_table))).toEqual(new Set(['flows', 'chatbot_widgets']));
  });
});

describe('dry run, idempotency, resume, the switches', () => {
  it('a dry run writes nothing', async () => {
    const db = await clone('fl-dry');
    await runClient(opts(dumps, db, 'acme', { dryRun: true }));
    expect(Object.values(await totals(db)).every((n) => n === 0)).toBe(true);
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
  });

  it('a second run loads nothing new, with and without --force, and keeps every token', async () => {
    const db = await clone('fl-idem');
    await runClient(opts(dumps, db, 'acme'));
    const t1 = await totals(db);
    const s1 = await snapshot(db);
    const tok = await rows(db, `SELECT embed_token FROM chatbot_widgets ORDER BY uuid`);
    await runClient(opts(dumps, db, 'acme'));
    await runClient(opts(dumps, db, 'acme', { force: true }));
    expect(await totals(db)).toEqual(t1);
    expect(await snapshot(db)).toBe(s1);
    expect(await rows(db, `SELECT embed_token FROM chatbot_widgets ORDER BY uuid`)).toEqual(tok);
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
  });

  it('a run killed in the middle of the steps resumes to exactly the result of a clean run', async () => {
    const clean = await clone('fl-clean');
    await runClient(opts(dumps, clean, 'acme'));
    for (const hook of ['afterBatch', 'midBatch'] as const) {
      const db = await clone(`fl-kill-${hook}`);
      await expect(
        runClient(
          opts(dumps, db, 'acme', {
            batchSize: 2,
            [hook]: ({ step, batch }: { step: string; batch: number }) => {
              if (step === 'flow_nodes' && batch === 3) throw new Error('simulated crash');
            },
          } as Partial<RunOptions>),
        ),
      ).rejects.toThrow(/simulated crash/);
      await runClient(opts(dumps, db, 'acme', { batchSize: 2 }));
      expect(await snapshot(db)).toBe(await snapshot(clean));
      expect(await totals(db)).toEqual(await totals(clean));
      expect((await check(dumps, db, 'acme')).alarms).toEqual([]);
    }
  });

  it('--flow-version draft takes the draft copy, and reconcile reads the switch the run recorded', async () => {
    const db = await clone('fl-draft');
    await runClient(opts(dumps, db, 'acme', { flows: { flowVersion: 'draft' } }));
    const a = await rows(db, `SELECT flow_data FROM flows WHERE flow_name = 'Support Bot'`);
    expect(JSON.stringify(a[0]!.flow_data)).toContain(nid(31).slice(0, 8)); // the draft step
    expect(JSON.stringify(a[0]!.flow_data)).not.toContain(nid(2).slice(0, 8));
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
    // other switches than the run's are a warning, not silently different
    const r2 = await check(dumps, db, 'acme', { flowVersion: 'published' });
    expect(r2.warnings.join('\n')).toMatch(/option flowVersion differs/);
  });

  it('--widgets-for-whatsapp-bots (Q7) also makes a widget of a WhatsApp bot that has widget settings', async () => {
    const d = acmeFlows();
    d.chatbots.push({
      ...d.chatbots[0]!,
      _id: { $oid: 'bbbbbbbbbbbbbbbbbbbbbb01' },
      id: 'cb9',
      name: 'Plain WhatsApp',
      bot_id: bid(50),
      chatbot_configuration: 'cfg-plain',
      chatbot_theme: 'x',
    });
    d.chatbot_configuration.push({
      ...d.chatbot_configuration[0]!,
      _id: { $oid: 'bbbbbbbbbbbbbbbbbbbbbb02' },
      id: 'cfg-plain',
    });
    const custom = await customDumps({ acme: dumpOf(d) });
    try {
      const off = await clone('fl-q7-off');
      await runClient(opts(custom, off, 'acme'));
      expect(await one(off, `SELECT count(*)::int AS n FROM chatbot_widgets`)).toBe(2);
      const on = await clone('fl-q7-on');
      await runClient(opts(custom, on, 'acme', { flows: { widgetsForWhatsappBots: true } }));
      expect(await one(on, `SELECT count(*)::int AS n FROM chatbot_widgets`)).toBe(3);
      expect((await check(custom, on, 'acme')).alarms).toEqual([]);
      expect((await check(custom, off, 'acme')).alarms).toEqual([]);
    } finally {
      custom.cleanup();
    }
  });

  it('the plan limit (Q15) quarantines the overflow instead of exceeding it', async () => {
    const db = await clone('fl-limit');
    await runClient(opts(dumps, db, 'acme', { flows: { flowLimit: 2, widgetLimit: 1 } }));
    expect(await one(db, `SELECT count(*)::int AS n FROM flows`)).toBe(2);
    expect(await one(db, `SELECT count(*)::int AS n FROM chatbot_widgets`)).toBe(1);
    const q = await rows(
      db,
      `SELECT reason_code FROM migration.quarantine WHERE reason_code = 'PLAN_LIMIT'`,
    );
    expect(q).toHaveLength(3);
    expect((await check(dumps, db, 'acme')).alarms).toEqual([]);
  });
});

describe('the verifier catches damage', () => {
  const damage: Array<[string, string, RegExp]> = [
    [
      'delete a flow',
      `DELETE FROM flows WHERE flow_name = 'Numbered Bot'`,
      /TARGET_MISSING|UNACCOUNTED|EQUATION|IDMAP|TARGET_MISSING/,
    ],
    [
      'switch a flow to active',
      `UPDATE flows SET is_active = true WHERE flow_name = 'Numbered Bot'`,
      /SENDABLE_FLOW|FINGERPRINT_MISMATCH/,
    ],
    [
      'publish a flow',
      `UPDATE flows SET is_published = true, published_at = now() WHERE flow_name = 'Numbered Bot'`,
      /SENDABLE_FLOW|FINGERPRINT_MISMATCH/,
    ],
    [
      'change a step',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowNodes,1,data,text}', '"changed"') WHERE flow_name = 'Support Bot'`,
      /FINGERPRINT_MISMATCH/,
    ],
    [
      'drop a link',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowEdges}', (flow_data->'flowEdges') - 1) WHERE flow_name = 'Support Bot'`,
      /FLOW_GRAPH|FINGERPRINT_MISMATCH/,
    ],
    [
      'add an extra flow',
      `INSERT INTO flows (org_id, flow_name) SELECT org_id, 'Extra' FROM flows LIMIT 1`,
      /EXTRA_ROWS/,
    ],
    [
      'arm a trigger for a channel',
      `UPDATE flows SET trigger_device_id = 5 WHERE flow_name = 'Numbered Bot'`,
      /SENDABLE_FLOW|FINGERPRINT_MISMATCH/,
    ],
    [
      'change a widget colour',
      `UPDATE chatbot_widgets SET button_color = '#000000' WHERE name = 'Web Widget'`,
      /FINGERPRINT_MISMATCH|WIDGET_COLUMN/,
    ],
    [
      'activate a widget',
      `UPDATE chatbot_widgets SET status = 'active' WHERE name = 'Web Widget'`,
      /SENDABLE_WIDGET|FINGERPRINT_MISMATCH/,
    ],
    [
      'open the allow-list of a widget',
      `UPDATE chatbot_widgets SET allowed_domains = '[]' WHERE name = 'Web Widget'`,
      /SENDABLE_WIDGET|FINGERPRINT_MISMATCH/,
    ],
    [
      'give a widget a short token',
      `UPDATE chatbot_widgets SET embed_token = 'short' WHERE name = 'Web Widget'`,
      /WIDGET_TOKEN/,
    ],
    [
      'activate a keyword reply',
      `UPDATE keyword_replies SET status = true WHERE id = (SELECT min(id) FROM keyword_replies)`,
      /SENDABLE_KEYWORD|FINGERPRINT_MISMATCH/,
    ],
    [
      'delete a keyword reply',
      `DELETE FROM keyword_replies WHERE id = (SELECT min(id) FROM keyword_replies)`,
      /TARGET_MISSING|KEYWORD_COLUMN|IDMAP|UNACCOUNTED/,
    ],
    [
      'add a keyword reply content',
      `INSERT INTO keyword_reply_contents (org_id, keyword_reply_id, content) SELECT org_id, id, 'x' FROM keyword_replies LIMIT 1`,
      /SIDE_EFFECT/,
    ],
    [
      'add an outbox row',
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) SELECT id, 'flows', 1, 'flow.created', '{}' FROM organizations WHERE slug = 'acme'`,
      /SIDE_EFFECT|EXTRA_ROWS|BASELINE/,
    ],
    [
      'leak a key into an assistant',
      `UPDATE ai_chat_assistants SET system_prompt = '${FAKE_OPENAI}'`,
      /SECRET_LEAK|FINGERPRINT_MISMATCH/,
    ],
    [
      'delete an id_map row',
      `DELETE FROM migration.id_map WHERE source_collection = 'flow_bots' AND source_client = 'acme' AND source_key = '${bid(4)}'`,
      /IDMAP_MISSING|NOT_LOADED|EXTRA_ROWS/,
    ],
    [
      'delete a quarantine row',
      `DELETE FROM migration.quarantine WHERE reason_code = 'CONVERSION_LOSS' AND source_client = 'acme'`,
      /QUARANTINE_CHANGED|SOFT_ISSUES_MISSING/,
    ],
  ];
  for (const [name, stmt, expected] of damage) {
    it(`catches: ${name}`, async () => {
      const db = await clone('fl-dmg', base.name);
      await asOwner(db, (d) => d.execute(sql.raw(stmt)));
      const r = await check(dumps, db, 'acme');
      expect(r.ok, name).toBe(false);
      expect(r.alarms.join('\n'), name).toMatch(expected);
    });
  }

  it('--allow-extra-rows (after cutover) accepts a published flow and a changed widget, but not a lost flow', async () => {
    const db = await clone('fl-live', base.name);
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          `UPDATE flows SET is_published = true, is_active = true WHERE flow_name = 'Numbered Bot'`,
        ),
      ),
    );
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          `UPDATE chatbot_widgets SET status = 'active', allowed_domains = '["a.test"]' WHERE name = 'Web Widget'`,
        ),
      ),
    );
    expect((await check(dumps, db, 'acme', undefined, true)).alarms).toEqual([]);
    await asOwner(db, (d) =>
      d.execute(sql.raw(`DELETE FROM flows WHERE flow_name = 'Numbered Bot'`)),
    );
    expect((await check(dumps, db, 'acme', undefined, true)).ok).toBe(false);
  });
});

describe('Rhythm-style dates and optional AI settings', () => {
  it('reads "dd Mon, yyyy h:mm:ss AM" as UTC with a soft DATE_ZONE_ASSUMED, falls back to NO_DATE, never throws', async () => {
    const { wabooDate } = await import('../flows/rules');
    expect(wabooDate('5 Mar, 2026 3:04:05 PM')?.toISOString()).toBe('2026-03-05T15:04:05.000Z');
    expect(wabooDate('12 Dec, 2025 12:00:00 AM')?.toISOString()).toBe('2025-12-12T00:00:00.000Z');
    expect(wabooDate('12 Dec, 2025 12:30:00 PM')?.toISOString()).toBe('2025-12-12T12:30:00.000Z');
    expect(wabooDate('31 Feb, 2026 1:00:00 AM')).toBeNull();
    expect(wabooDate('7 Foo, 2026 1:00:00 AM')).toBeNull();
    expect(wabooDate('13:00 yesterday')).toBeNull();
    const B = bid(60);
    const mk = (n: number, at: unknown, order: number) => ({
      ...node({ bot: B, version: null, qid: 'R', node: n, sub: 'text', order }),
      createdAt: at,
      updatedAt: at,
    });
    const bot = chatbot(60, { name: 'Rhythm Bot' });
    delete (bot as Record<string, unknown>).prompt;
    delete (bot as Record<string, unknown>).chatbot_configuration;
    delete (bot as Record<string, unknown>).created_time;
    delete (bot as Record<string, unknown>).modified_time;
    const none = chatbot(61, { name: 'No Dates' });
    delete (none as Record<string, unknown>).created_time;
    delete (none as Record<string, unknown>).modified_time;
    const d = await customDumps({
      acme: {
        contact_list: [],
        chatbots: [bot, none],
        bot_workspace: [
          mk(1, '5 Mar, 2026 3:04:05 PM', 0),
          mk(2, { $date: '2026-03-06T00:00:00Z' }, 1),
          { ...mk(3, 'garbage', 0), botid: bid(61), qid: 'S' },
        ],
      },
    });
    const db = await clone('fl-dates');
    try {
      await runClient(opts(d, db, 'acme'));
      const f = await rows(
        db,
        `SELECT flow_name, created_at, updated_at FROM flows ORDER BY flow_name`,
      );
      const rh = f.find((x) => x.flow_name === 'Rhythm Bot')!;
      expect(new Date(rh.created_at).toISOString()).toBe('2026-03-05T15:04:05.000Z');
      expect(new Date(rh.updated_at).toISOString()).toBe('2026-03-06T00:00:00.000Z');
      const soft = await rows(
        db,
        `SELECT split_part(source_key, '#', 2) AS code FROM migration.quarantine WHERE collection = 'flow_bots' AND source_key LIKE '%#%'`,
      );
      const codes = soft.map((s) => s.code);
      expect(codes).toContain('DATE_ZONE_ASSUMED');
      expect(codes).toContain('NO_DATE');
      expect(await one(db, `SELECT count(*)::int AS n FROM chatbot_widgets`)).toBe(0);
      const r = await check(d, db, 'acme');
      expect(r.alarms).toEqual([]);
    } finally {
      d.cleanup();
    }
  });
});
