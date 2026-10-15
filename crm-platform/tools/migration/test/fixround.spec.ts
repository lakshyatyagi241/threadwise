/**
 * Fix-round tests (D1..D8, B1..B7 extras, the shared scrub, the org inputs, the registry changes). Invented data only.
 * The adversarial damage matrix and friends live in verify-extra.spec.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { NdjsonDirSource } from '../extract/source';
import { hashFile, writeManifest } from '../extract/manifest';
import { assertTargetAllowed, isLocalHost } from '../load/db';
import { normalizeSlug, slugWithSuffix, SLUG_MAX } from '../load/org';
import { runClient } from '../load/run';
import { reconcile } from '../reconcile';
import { resolve } from '../registry';
import { phoneOf, transformHooks } from '../transform/contacts';
import { bool, isDeleted, isSecretEntry, isSecretName, sanitizeError, scrub } from '../util';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';

type J = Record<string, unknown>;
const oidHex = (n: number): string => `65f0c1c2${n.toString(16).padStart(16, '0')}`;
const O = (n: number): J => ({ $oid: oidHex(n) });
const D = (iso: string): J => ({ $date: iso });
const T1 = '2026-03-01T10:00:00.000Z';

const dbs: TestDb[] = [];
const dumps: Dumps[] = [];
const clone = async (label: string): Promise<TestDb> => {
  const d = await cloneDb(label);
  dbs.push(d);
  return d;
};
const dump = async (c: Parameters<typeof customDumps>[0]): Promise<Dumps> => {
  const d = await customDumps(c);
  dumps.push(d);
  return d;
};
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const d of dumps) d.cleanup();
});
const q = async (db: TestDb, text: string): Promise<Array<Record<string, unknown>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, unknown>>);
const verify = (d: Dumps, db: TestDb, client: string) =>
  reconcile({ source: d.source, dumpsDir: d.dir, client, targetUrl: db.workerUrl });
const contact = (n: number, extra: J = {}): J => ({
  _id: O(n),
  id: `c${n}`,
  created_time: D(T1),
  modified_time: D(T1),
  is_deleted: false,
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('D1 phones', () => {
  it.each([
    ['9812345680 ext 12', '91'],
    ['9812345680 x12', '91'],
    ['9812345680#12', '91'],
    ['call me', null],
    ['+91 12', null],
    ['+919812345680123456', null],
    ['', null],
  ])('%s is not guessed at', (raw, cc) => {
    expect(phoneOf(raw, cc, null)).toBeNull();
  });
  it('still reads real numbers', () => {
    expect(phoneOf('(981) 234-5681', '91', null)).toBe('+919812345681');
    expect(phoneOf('0091-98123-45679', null, null)).toBe('+919812345679');
    expect(phoneOf('+44 20 7183 8750', null, null)).toBe('+442071838750');
  });
});

describe('D7 soft delete spellings', () => {
  it.each([[true], ['true'], ['1'], ['yes'], [1], ['Y']])('is_deleted %s', (v) => {
    expect(isDeleted({ is_deleted: v })).toBe(true);
    expect(bool(v)).toBe(true);
  });
  it.each([[false], ['false'], ['0'], [0], ['no'], [null], [undefined]])(
    'is_deleted %s is live',
    (v) => {
      expect(isDeleted({ is_deleted: v })).toBe(false);
    },
  );
  it('deleted_time counts, an empty string does not', () => {
    expect(isDeleted({ deleted_time: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isDeleted({ deleted_time: new Date() })).toBe(true);
    expect(isDeleted({ deleted_time: '' })).toBe(false);
    expect(isDeleted({ deleted_time: null })).toBe(false);
  });
});

describe('D3 production guard', () => {
  it('accepts only local-looking hosts without an explicit allow', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'crm-postgres'])
      expect(isLocalHost(h)).toBe(true);
    for (const h of ['db.example.com', 'prod-db.geta.internal.invalid', '10.0.0.5'])
      expect(isLocalHost(h)).toBe(false);
  });
  it('prints host/db/role and refuses the rest', () => {
    expect(assertTargetAllowed('postgres://crm_worker_user:x@localhost:5432/crm', 'target')).toBe(
      'target: host=localhost port=5432 db=crm role=crm_worker_user',
    );
    expect(() =>
      assertTargetAllowed('postgres://u:x@prod.example.com:5432/crm_prod', 'target', {
        dryRun: true,
      }),
    ).toThrow(/refusing to run against prod\.example\.com/);
    // allowed host: a dry run is fine, a real write also needs the exact database name typed
    const allow = { allowHosts: ['prod.example.com'] };
    expect(() =>
      assertTargetAllowed('postgres://u:x@prod.example.com/crm_prod', 'target', {
        ...allow,
        dryRun: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertTargetAllowed('postgres://u:x@prod.example.com/crm_prod', 'target', {
        ...allow,
        dryRun: false,
      }),
    ).toThrow(/--confirm-db-name=crm_prod/);
    expect(() =>
      assertTargetAllowed('postgres://u:x@prod.example.com/crm_prod', 'target', {
        ...allow,
        confirmDbName: 'crm_stage',
      }),
    ).toThrow(/--confirm-db-name=crm_prod/);
    expect(() =>
      assertTargetAllowed('postgres://u:x@prod.example.com/crm_prod', 'target', {
        ...allow,
        confirmDbName: 'crm_prod',
      }),
    ).not.toThrow();
  });
});

describe('D6 slugs', () => {
  it('never exceed the login schema, suffix included', () => {
    const base = normalizeSlug('A Very Long Workspace Name That Goes On And On Forever And Ever');
    expect(base.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slugWithSuffix(base, 'abc123').length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slugWithSuffix(base, 'abc1232').endsWith('-abc1232')).toBe(true);
    expect(normalizeSlug('Acme & Co.')).toBe('acme-co');
    expect(() => normalizeSlug('!!')).toThrow(/no usable characters/);
  });
});

describe('shared scrub: secrets dropped, counters kept', () => {
  it('drops secret names by value type and the always-secret list, keeps numeric counters and prices', () => {
    const r = scrub({
      normalKey: 'v1',
      openRouterKey: 'v2',
      auth_key: 'v3',
      access_token: 'v4',
      refresh_token: 'v5',
      client_secret: 'v6',
      apiKey: 'v7',
      api_key: 'v8',
      Authorization: 'Bearer abcdefgh12345',
      private_key: 'v9',
      password: 123456,
      passwd: 'x',
      x_auth_token: { nested: 1 },
      tokens_used: 42,
      input_tokens: 3,
      output_tokens: 2,
      cached_input_tokens: 1,
      token_usage: { a: 1 },
      token_count: 7,
      input_token_price: 0.25,
      output_token_price: 0.5,
      cached_input_token_price: '0.1',
      some_token: 12,
      flag_key: true,
      keyword: 'beach',
      referrer_keyword: 'sea',
      author: 'Ann',
      monkey: 'banana',
      name: 'ok',
      models: [
        {
          model: 'm1',
          apiKey: 'zz',
          openRouterKey: 'yy',
          input_token_price: 0.1,
          cfg: { normalKey: 'deep', ttl: 5 },
        },
      ],
      memo: 'Bearer abcdefghijklmnop',
      jwt_like: 'eyJhbGciOi.eyJzdWIiOiIx.c2ln',
      meta: 'EAAB' + 'x'.repeat(30),
      list: ['Bearer abcdefghijkl', 'fine'],
    });
    const v = r.value as J;
    expect(Object.keys(v).sort()).toEqual(
      [
        'author',
        'cached_input_token_price',
        'cached_input_tokens',
        'flag_key',
        'input_token_price',
        'input_tokens',
        'keyword',
        'list',
        'models',
        'monkey',
        'name',
        'output_token_price',
        'output_tokens',
        'referrer_keyword',
        'some_token',
        'token_count',
        'token_usage',
        'tokens_used',
      ].sort(),
    );
    expect(v.tokens_used).toBe(42);
    expect(v.input_token_price).toBe(0.25);
    expect(v.list).toEqual(['fine']);
    expect(v.models).toEqual([{ model: 'm1', input_token_price: 0.1, cfg: { ttl: 5 } }]);
    expect(JSON.stringify(r.redacted)).toContain('models[0].apiKey');
    // the redacted list never holds a value
    expect(JSON.stringify(r)).not.toMatch(/v1|abcdefgh|deep/);
  });
  it('name checks', () => {
    for (const n of [
      'normalKey',
      'openRouterKey',
      'auth_key',
      'access_token',
      'api_token',
      'client_secret',
      'xApiKey',
      'Authorization',
      'private_key',
    ])
      expect(isSecretName(n), n).toBe(true);
    for (const n of [
      'tokens_used',
      'input_tokens',
      'cached_input_tokens',
      'token_usage',
      'token_count',
      'input_token_price',
      'keyword',
      'author',
      'monkey',
      'first_name',
    ])
      expect(isSecretName(n), n).toBe(false);
    expect(isSecretEntry('some_token', 5)).toBe(false);
    expect(isSecretEntry('some_token', 'abc')).toBe(true);
    expect(isSecretEntry('note', 'EAAB' + 'y'.repeat(30))).toBe(true);
    expect(isSecretEntry('note', 'hello')).toBe(false);
  });
});

describe('registry decisions of the fix round', () => {
  it('follows the team list', () => {
    const d = (c: string) => resolve(c).disposition;
    for (const c of [
      'broadcast_templates',
      'credits_mapping',
      'credits_mapping_new', // stage 2 credits: done by the operator command pricing-seed, never by a client run
      'credits_expenses',
      'entry_points',
      'source_registry',
      'company_properties_fields',
      'company_properties_field_options',
      'company_properties_field_dependancy_mapping',
      'company_properties_field_options_dependancy_mapping',
      'deals',
      'deal_pipelines',
      'deal_properties',
      'leads',
      'journey',
      'project',
      'project_configuration',
      'workspace_settings',
    ])
      expect(d(c), c).toBe('EXCLUDE');
    expect(d('leadrepo')).toBe('OPEN');
    for (const c of [
      'medium_registry',
      'visitor_logs',
      'visitor_logs_view',
      'file_manager',
      'chatbot_misc_config',
    ])
      expect(d(c), c).toBe('MIGRATE_LATER');
    // advanced automations are built (stage 2)
    for (const c of ['automation_journey', 'automation_metadata']) expect(d(c), c).toBe('MIGRATE');
    // stage 2: flows and chatbot widgets are built; the version history and the legacy copy are not migrated
    for (const c of [
      'bot_flow_version',
      'bot_flow_version_data',
      'flows',
      'bot_workspace',
      'faq_variations',
      'chatbots',
      'chatbot_configuration',
      'chatbot_theme',
    ])
      expect(d(c), c).toBe('MIGRATE');
    expect(d('flows_version')).toBe('EXCLUDE');
    expect(d('marketing_list')).toBe('MIGRATE');
    // stage 2: broadcasts
    expect(d('broadcasting')).toBe('MIGRATE');
    expect(d('whatsapp_broadcasting_data')).toBe('MIGRATE');
    // stage 2: credits
    expect(d('credit_logs')).toBe('MIGRATE');
    // stage 2: chat history = inbox
    expect(d('chathistory')).toBe('MIGRATE');
    expect(d('chathistory_view')).toBe('EXCLUDE');
    // stage 2: roles and users are built
    expect(d('roles')).toBe('MIGRATE');
    expect(d('user')).toBe('MIGRATE');
    expect(resolve('chatbot_misc_config').reason).toMatch(/HIGH RISK/);
    expect(resolve('chatbot_misc_config').targets).not.toContain('chatbot_widgets');
    expect(resolve('credits_mapping_new').targets).toEqual([]);
    expect(resolve('credits_mapping_new').reason).toMatch(/pricing-seed/);
    expect(resolve('broadcast_templates').reason).toMatch(/re-sync/);
    expect(resolve('journey').reason).toMatch(/bot_workspace/);
    expect(resolve('flows_version').reason).toMatch(/latest version only/);
    expect(resolve('nobody_knows_this').disposition).toBe('UNKNOWN');
  });
});

describe('D5 reading the dump', () => {
  it('strips a BOM, reads CRLF, and reports a truncated last line with file and line (manifest does not count it as a document)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migtool-read-'));
    dumps.push({
      dir,
      source: new NdjsonDirSource(dir),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    });
    mkdirSync(join(dir, 'k'));
    const line = (n: number): string => JSON.stringify({ _id: O(n), first_name: `N${n}` });
    writeFileSync(
      join(dir, 'k', 'contact_list.ndjson'),
      `${String.fromCharCode(0xfeff)}${line(1)}\r\n${line(2)}\r\n{"_id":{"$oid":"${oidHex(3)}"},"first_na`,
    );
    const source = new NdjsonDirSource(dir);
    const got: unknown[] = [];
    for await (const d of source.read('k', 'contact_list')) got.push(d);
    expect(got).toHaveLength(2);
    expect(source.badLines('k')).toMatchObject([{ collection: 'contact_list', line: 3 }]);
    const h = await hashFile(join(dir, 'k', 'contact_list.ndjson'));
    expect(h).toMatchObject({ docs: 2, badLines: 1 });
    await writeManifest(source, dir, 'k');
  });

  it('a bad line is quarantined with its line number, the rest loads, and the run then fails loudly', async () => {
    const d = await dump({
      trunc: {
        contact_list:
          [contact(1, { first_name: 'A' })].map((x) => JSON.stringify(x)).join('\n') +
          '\n' +
          JSON.stringify(contact(2, { first_name: 'B' })) +
          '\n{"_id":{"$oid":"x"},"first_na',
      },
    });
    const db = await clone('trunc');
    await expect(runClient(runOpts(d, db, 'trunc'))).rejects.toThrow(/contact_list\.ndjson line 3/);
    const n = await q(db, 'SELECT count(*)::int AS n FROM contacts');
    expect(n[0]!.n).toBe(2);
    const qr = await q(
      db,
      `SELECT source_key, reason_code, reason FROM migration.quarantine WHERE reason_code = 'PARSE_ERROR'`,
    );
    expect(qr).toHaveLength(1);
    expect(qr[0]).toMatchObject({ source_key: 'line:3' });
    expect(String(qr[0]!.reason)).toMatch(/contact_list\.ndjson line 3/);
    const r = await verify(d, db, 'trunc');
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(/PARSE_ERRORS/);
  });

  it('a NUL character quarantines that one document and nothing else', async () => {
    const d = await dump({
      nul: {
        contact_list: [contact(1, { first_name: 'Fine' }), contact(2, { first_name: 'A\u0000B' })],
      },
    });
    const db = await clone('nul2');
    await runClient(runOpts(d, db, 'nul'));
    expect((await q(db, 'SELECT count(*)::int AS n FROM contacts'))[0]!.n).toBe(1);
    expect(
      await q(db, `SELECT reason_code FROM migration.quarantine WHERE source_key = '${oidHex(2)}'`),
    ).toEqual([{ reason_code: 'NUL_CHAR' }]);
    expect((await verify(d, db, 'nul')).ok).toBe(true);
  });
});

describe('D4 keys', () => {
  it('a repeated primary key is quarantined, a string id that equals another key is a KEY_COLLISION soft issue, both documents load', async () => {
    const d = await dump({
      keys: {
        contact_list: [
          contact(1, { first_name: 'First' }),
          contact(1, { first_name: 'SameOidAgain', id: 'other' }),
          contact(11, { first_name: 'A' }),
          { ...contact(12, { first_name: 'B' }), id: oidHex(11) },
        ],
        contact_notes: [
          {
            _id: O(50),
            id: 'n1',
            contact_id: oidHex(11),
            context: 'for A',
            created_at: D(T1),
            is_deleted: false,
          },
        ],
      },
    });
    const db = await clone('keys');
    await runClient(runOpts(d, db, 'keys', { batchSize: 1 }));
    const names = (await q(db, 'SELECT name FROM contacts ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['First', 'A', 'B']);
    const qs = (
      await q(
        db,
        `SELECT source_key, reason_code FROM migration.quarantine WHERE collection = 'contact_list'`,
      )
    ).map((r) => `${String(r.source_key)}:${String(r.reason_code)}`);
    expect(qs).toEqual(
      expect.arrayContaining([
        `${oidHex(1)}#dup2:DUPLICATE_KEY`,
        `${oidHex(12)}#KEY_COLLISION:KEY_COLLISION`,
      ]),
    );
    const note = await q(
      db,
      'SELECT c.name FROM contact_notes n JOIN contacts c ON c.id = n.contact_id',
    );
    expect(note).toEqual([{ name: 'A' }]);
    const r = await verify(d, db, 'keys');
    expect(r.alarms).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('org inputs and owner', () => {
  const stagesDoc = (): J[] => [
    {
      _id: O(900),
      id: 'st1',
      label: 'Lead',
      position: 1,
      default: true,
      is_deleted: false,
      created_time: D(T1),
      deleted_time: '',
    },
    {
      _id: O(901),
      id: 'st2',
      label: 'Customer',
      position: 2,
      default: false,
      is_deleted: false,
      created_time: D(T1),
      deleted_time: '',
    },
  ];
  it('creates the org from the inputs, makes the owner like the app does, uses the default stage, and says loudly when there is no owner', async () => {
    const d = await dump({
      own: {
        contact_lifecycle_stages: stagesDoc(),
        contact_list: [
          contact(1, { first_name: 'NoStage' }),
          contact(2, { first_name: 'Bad', lifecycle_stage: 'nonsense' }),
          contact(3, { first_name: 'Cust', lifecycle_stage: 'st2' }),
        ],
        project: [
          { _id: O(1), name: 'IGNORED NAME', domain: 'ignored.example.test', created_time: D(T1) },
        ],
      },
      noown: { contact_list: [contact(1, { first_name: 'X' })] },
    });
    const db = await clone('org');
    const lines: string[] = [];
    const s = await runClient(
      runOpts(d, db, 'own', {
        org: {
          name: 'Own Workspace',
          slug: 'Own Workspace!',
          plan: 'starter',
          ownerEmail: ' Owner@Example.TEST ',
          ownerName: 'Olive Owner',
        },
        log: (l) => lines.push(l),
      }),
    );
    expect(s.warnings).toEqual([]);
    const org = await q(
      db,
      `SELECT id, slug, name, plan, settings FROM organizations WHERE slug = 'own-workspace'`,
    );
    expect(org).toHaveLength(1);
    expect(org[0]).toMatchObject({ name: 'Own Workspace', plan: 'starter' });
    const u = await q(
      db,
      `SELECT u.email::text AS email, u.full_name, u.password_hash, u.status, u.auth_subject, u.invited_at IS NOT NULL AS invited, u.joined_at, r.name AS role, u.uuid::text AS uuid FROM users u JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id`,
    );
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({
      email: 'owner@example.test',
      full_name: 'Olive Owner',
      password_hash: null,
      status: 'active',
      auth_subject: null,
      invited: true,
      joined_at: null,
      role: 'Owner',
    });
    expect((org[0]!.settings as J).ownerUserId).toBe(u[0]!.uuid);
    expect((await q(db, `SELECT count(*)::int AS n FROM user_security`))[0]!.n).toBe(1);
    // lifecycle: no stage / unresolvable -> the workspace's default stage (what the app does), not the literal 'new'
    expect(
      (await q(db, `SELECT name, lifecycle_stage FROM contacts ORDER BY id`)).map(
        (r) => `${String(r.name)}:${String(r.lifecycle_stage)}`,
      ),
    ).toEqual(['NoStage:lead', 'Bad:lead', 'Cust:customer']);
    expect(await verify(d, db, 'own').then((r) => [r.alarms, r.ok])).toEqual([[], true]);
    // a second run with the same inputs changes nothing
    await runClient(
      runOpts(d, db, 'own', {
        org: { name: 'Own Workspace', slug: 'Own Workspace!', ownerEmail: 'owner@example.test' },
      }),
    );
    expect((await q(db, `SELECT count(*)::int AS n FROM users`))[0]!.n).toBe(1);
    expect((await q(db, `SELECT count(*)::int AS n FROM organizations`))[0]!.n).toBe(1);

    const t = await runClient(runOpts(d, db, 'noown', { log: (l) => lines.push(l) }));
    expect(t.warnings.join(' ')).toMatch(/NO OWNER/);
    expect(lines.join('\n')).toMatch(/WARNING: THE ORGANIZATION HAS NO OWNER/);
    const r = await verify(d, db, 'noown');
    expect(r.warnings.join(' ')).toMatch(/NO OWNER/);
    expect(r.ok).toBe(true);
    // no stage defined at all: the column default
    expect(
      (await q(db, `SELECT lifecycle_stage FROM contacts WHERE name = 'X'`))[0]!.lifecycle_stage,
    ).toBe('new');
    // project is not imported
    expect(JSON.stringify(await q(db, 'SELECT settings FROM organizations'))).not.toMatch(
      /ignored/i,
    );
  });

  it('slugs: a long one is truncated, and a second client asking for the same slug gets a suffix, all within 40 characters', async () => {
    const d = await dump({
      s1: { contact_list: [contact(1, { first_name: 'A' })] },
      s2: { contact_list: [contact(2, { first_name: 'B' })] },
    });
    const db = await clone('slugs');
    const slug = 'An Extremely Long Workspace Name That Keeps Going Past Forty Characters';
    await runClient(runOpts(d, db, 's1', { org: { slug } }));
    await runClient(runOpts(d, db, 's2', { org: { slug } }));
    const rows = (await q(db, 'SELECT slug FROM organizations ORDER BY id')).map((r) =>
      String(r.slug),
    );
    expect(rows).toHaveLength(2);
    for (const s of rows) {
      expect(s.length).toBeLessThanOrEqual(40);
      expect(s).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    expect(new Set(rows).size).toBe(2);
  });
});

describe('D8 dates and keys', () => {
  it('a document with no date at all is stamped with the manifest time (never 1970) and flagged', async () => {
    const d = await dump({ nodate: { contact_list: [{ id: 'plain', first_name: 'NoDates' }] } });
    const db = await clone('nodate');
    await runClient(runOpts(d, db, 'nodate'));
    const at = String((await q(db, `SELECT created_at FROM contacts`))[0]!.created_at);
    const manifestAt = (
      JSON.parse(readFileSync(join(d.dir, 'nodate', 'manifest.json'), 'utf8')) as {
        generatedAt: string;
      }
    ).generatedAt;
    expect(new Date(at).toISOString()).toBe(manifestAt);
    expect(
      await q(db, `SELECT reason_code FROM migration.quarantine WHERE reason_code = 'NO_DATE'`),
    ).toHaveLength(1);
    expect((await verify(d, db, 'nodate')).ok).toBe(true);
  });
  it('run refuses a dump that differs from manifest.json unless --skip-hash', async () => {
    const d = await dump({ hashed: { contact_list: [contact(1, { first_name: 'A' })] } });
    writeFileSync(
      join(d.dir, 'hashed', 'contact_list.ndjson'),
      JSON.stringify(contact(1, { first_name: 'Changed' })) + '\n',
    );
    const db = await clone('hashed');
    await expect(runClient(runOpts(d, db, 'hashed'))).rejects.toThrow(
      /does not match manifest\.json/,
    );
    await runClient(runOpts(d, db, 'hashed', { skipHash: true }));
    expect((await q(db, 'SELECT name FROM contacts'))[0]!.name).toBe('Changed');
  });
});

describe('B2 the verifier does not trust the loader code', () => {
  it('a bug injected into the phone transform makes reconcile fail even though source and target agree with the loader', async () => {
    const d = await dump({
      bug: {
        contact_list: [
          contact(1, { first_name: 'A', mobile_phone_number: '9812345678', country_code: '91' }),
        ],
      },
    });
    const db = await clone('bug');
    const real = transformHooks.phoneOf;
    transformHooks.phoneOf = (raw, cc, def) => {
      const p = real(raw, cc, def);
      return p ? `${p.slice(0, -1)}0` : p; // drops the last digit
    };
    try {
      await runClient(runOpts(d, db, 'bug'));
    } finally {
      transformHooks.phoneOf = real;
    }
    const r = await verify(d, db, 'bug');
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(
      /ORACLE_MISMATCH: contacts contact_list \w+: .*phone expected=\*\*\*78 target=\*\*\*70/,
    );
    expect(r.alarms.join('\n')).not.toMatch(/9812345678|\+919812345670/);
  });
});

describe('secrets never reach the target, quarantine, reports or logs', () => {
  it('invented credential keys and values, post-load scan of every column of every table', async () => {
    const N = 'XSECRETX';
    const d = await dump({
      secx: {
        contact_properties_fields: [
          {
            _id: O(1),
            id: 'f1',
            name: 'openRouterKey',
            label: 'k',
            type: 'string',
            is_deleted: false,
            parent_id: null,
            secret_note: `${N}-field`,
          },
          {
            _id: O(2),
            id: 'f2',
            name: 'tokens_used',
            label: 'tokens used',
            type: 'number',
            is_deleted: false,
            parent_id: null,
          },
          {
            _id: O(3),
            id: 'f3',
            name: 'keyword',
            label: 'keyword',
            type: 'string',
            is_deleted: false,
            parent_id: null,
          },
        ],
        contact_list: [
          contact(1, {
            first_name: 'Sec',
            normalKey: `${N}-a`,
            openRouterKey: `${N}-b`,
            auth_key: `${N}-c`,
            access_token: `${N}-d`,
            password: 123456,
            tokens_used: 42,
            input_token_price: 0.25,
            keyword: 'beach',
            author: 'Ann',
            memo: `Bearer ${N}abcdefgh`,
            models: [{ model: 'm1', apiKey: `${N}-e`, input_token_price: 0.1 }],
          }),
          contact(2, { normalKey: `${N}-q`, access_token: `${N}-r`, only_secret_key: `${N}-s` }), // no identity: quarantined whole
        ],
        user: [
          {
            _id: O(60),
            email: 'u@example.test',
            password: `$2b$12$${N}hashhashhash`,
            auth_key: `${N}-u`,
          },
        ],
        broadcast_templates: [{ _id: O(70), name: 't', access_token: `${N}-t`, components: [] }],
      },
    });
    const db = await clone('secx');
    const logs: string[] = [];
    await runClient(runOpts(d, db, 'secx', { allowNoOwner: true, log: (l) => logs.push(l) }));
    // kept: counters, prices, harmless words
    const c = (await q(db, `SELECT data FROM contacts WHERE legacy_id = '${oidHex(1)}'`))[0]!
      .data as J;
    expect(c).toMatchObject({
      tokens_used: 42,
      input_token_price: 0.25,
      keyword: 'beach',
      author: 'Ann',
      models: [{ model: 'm1', input_token_price: 0.1 }],
    });
    expect(Object.keys(c).sort()).toEqual([
      'author',
      'input_token_price',
      'keyword',
      'models',
      'tokens_used',
    ]);
    expect(
      (await q(db, `SELECT key FROM fields WHERE module_key = 'contacts' ORDER BY key`)).map(
        (r) => r.key,
      ),
    ).toEqual(['input_token_price', 'keyword', 'models', 'tokens_used', 'author'].sort());

    const out = mkdtempSync(join(tmpdir(), 'migtool-secout-'));
    dumps.push({
      dir: out,
      source: new NdjsonDirSource(out),
      cleanup: () => rmSync(out, { recursive: true, force: true }),
    });
    const r = await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'secx',
      targetUrl: db.workerUrl,
      outDir: out,
    });
    expect(r.alarms).toEqual([]);
    expect(r.ok).toBe(true);
    const report = readdirSync(join(out, 'secx'))
      .map((f) => readFileSync(join(out, 'secx', f), 'utf8'))
      .join('\n');

    const bad =
      /XSECRETX|normalKey|openRouterKey|auth_key|access_token|apiKey|only_secret_key|"password"/i;
    // the report lists the NAMES of the dropped keys for a human to review, never a value
    expect(report).not.toMatch(/XSECRETX/);
    expect(report).toMatch(/contact_list\.normalKey \(\d+ docs\): credential-looking/);
    expect(report).toMatch(/contact_list\.models\[0\]\.apiKey/);
    expect(logs.join('\n')).not.toMatch(bad);
    // in the database a credential shows up as a JSON key ("name":) or as one of the invented values; permission names such as
    // settings.api_keys in the preset roles are legitimate text and are not JSON keys
    const inDb =
      /XSECRETX|"(normalKey|openRouterKey|auth_key|access_token|apiKey|only_secret_key|password)":/i;
    // every column of every table in the target, tenant tables and the tool's own
    const tables = await q(
      db,
      `SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'migration')`,
    );
    const hits: string[] = [];
    for (const t of tables) {
      const n = (
        await q(
          db,
          `SELECT count(*)::int AS n FROM ${String(t.t)} x WHERE row_to_json(x)::text ~* '${inDb.source.replace(/'/g, "''")}'`,
        )
      )[0]!.n as number;
      if (n > 0) hits.push(`${String(t.t)}: ${n}`);
    }
    expect(hits, 'tables holding a credential-looking name or value').toEqual([]);
    // the quarantined no-identity contact is there, scrubbed
    const qd = await q(
      db,
      `SELECT doc FROM migration.quarantine WHERE source_key = '${oidHex(2)}'`,
    );
    expect(qd).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('round 2: errors, locks, invariants', () => {
  it('sanitizeError never carries parameters, SQL or personal data', () => {
    const e = Object.assign(
      new Error('Failed query: INSERT INTO contacts ... params: bob@example.test,+919812345678'),
      {
        cause: {
          code: '22P05',
          message: 'unsupported Unicode escape for bob@example.test',
          constraint: 'uq_x',
          table: 'contacts',
        },
      },
    );
    expect(sanitizeError(e)).toBe(
      'database error (SQLSTATE 22P05, constraint uq_x, table contacts)',
    );
    expect(
      sanitizeError(new Error('Failed query: select 1\nparams: bob@example.test')),
    ).not.toMatch(/bob@/);
    expect(sanitizeError(new Error('plain message'))).toBe('plain message');
  });

  it('a lone surrogate quarantines that one document (LONE_SURROGATE) and the run output holds no other contact data', async () => {
    const lone = String.fromCharCode(0xd83d);
    const d = await dump({
      sur: {
        contact_list: [
          contact(1, { first_name: `Anita${lone}`, email: 'anita.sur@example.test' }),
          contact(2, { first_name: 'Bimal', email: 'bimal.sur@example.test' }),
        ],
      },
    });
    const db = await clone('sur');
    const lines: string[] = [];
    await runClient(runOpts(d, db, 'sur', { log: (l) => lines.push(l) }));
    expect(await q(db, 'SELECT name FROM contacts')).toEqual([{ name: 'Bimal' }]);
    expect(
      await q(db, `SELECT reason_code FROM migration.quarantine WHERE source_key = '${oidHex(1)}'`),
    ).toEqual([{ reason_code: 'LONE_SURROGATE' }]);
    expect(lines.join('\n')).not.toMatch(/@example\.test/);
  });

  it('a second real run of one client waits for the first and then gives a clear message, never a raw error', async () => {
    const d = await dump({ lk: { contact_list: [contact(1, { first_name: 'A' })] } });
    const db = await clone('lk');
    const first = runClient(
      runOpts(d, db, 'lk', {
        batchSize: 1,
        afterBatch: () => new Promise((r) => setTimeout(r, 1500)),
      }),
    );
    await new Promise((r) => setTimeout(r, 400));
    await expect(runClient(runOpts(d, db, 'lk', { lockWaitSeconds: 1 }))).rejects.toThrow(
      /another run is active for client lk/,
    );
    await first;
  });

  it('a failing reconcile always says why (never ok=false with no alarm)', async () => {
    const d = await dump({
      inv: { contact_list: [contact(1, { first_name: 'A' }), contact(2, { first_name: 'B' })] },
    });
    const db = await clone('inv');
    await runClient(runOpts(d, db, 'inv'));
    // forget the id_map rows of one document: it is now neither migrated, quarantined nor excluded
    await asOwner(db, async (x) => {
      await x.execute(sql.raw(`TRUNCATE migration.id_map`));
    });
    const r = await verify(d, db, 'inv');
    expect(r.ok).toBe(false);
    expect(r.alarms.length + r.integrity.length).toBeGreaterThan(0);
  });

  it('plain CRM names that merely contain key / auth / private are kept; free text and JSON-in-a-string are scrubbed', () => {
    const kept = scrub({
      key_account: 'Yes',
      primary_key: 'abc',
      private_notes: 'call',
      auth_status: 'pending',
    }).value as Record<string, unknown>;
    expect(Object.keys(kept).sort()).toEqual([
      'auth_status',
      'key_account',
      'primary_key',
      'private_notes',
    ]);
    const t = scrub({
      note: 'please use api_key=sk-live-1234567890abcdef now',
      blob: '{"token":"abc","ok":1}',
    }).value as Record<string, string>;
    expect(t.note).not.toMatch(/1234567890abcdef/);
    expect(JSON.parse(t.blob)).toEqual({ ok: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('round 3: scrub by word, docker names, registry', () => {
  it('long opaque strings under names that merely contain key / auth / pass are kept; real credential names are dropped', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const b64 = 'A'.repeat(60) + '==';
    const hex40 = 'a1b2c3d4e5'.repeat(4);
    const kept = scrub({
      author_id: uuid,
      author_photo: b64,
      author_image: b64,
      passport_photo: b64,
      monkey_id: hex40,
      keyword_blob: b64,
    }).value as Record<string, unknown>;
    expect(Object.keys(kept).sort()).toEqual([
      'author_id',
      'author_image',
      'author_photo',
      'keyword_blob',
      'monkey_id',
      'passport_photo',
    ]);
    const dropped = scrub({
      session_key: b64,
      tokens_blob: hex40,
      oauth_state: hex40,
      api_secret_value: hex40,
    }).value as Record<string, unknown>;
    expect(Object.keys(dropped)).toEqual([]);
  });

  it('password_hint / password_changed_at / token_expiry are metadata and kept unless their value is secret-shaped', () => {
    const k = scrub({
      password_hint: 'first pet',
      password_changed_at: '2026-03-01',
      token_expiry: '2026-12-31',
      password_hash: '$2b$12$abc',
      access_token_expiry: 'Bearer abcdefghijkl',
    }).value as Record<string, unknown>;
    expect(Object.keys(k).sort()).toEqual(['password_changed_at', 'password_hint', 'token_expiry']);
  });

  it('bare postgres and db are no longer docker-local by default', () => {
    expect(isLocalHost('postgres')).toBe(false);
    expect(isLocalHost('db')).toBe(false);
    expect(isLocalHost('crm-platform-postgres')).toBe(true);
    expect(isLocalHost('postgres', ['postgres'])).toBe(true);
  });

  it('team decisions of round 3', () => {
    for (const c of [
      'sms_broadcasting_data',
      'email_broadcasting_data',
      'company_saved_views',
      'automation_version',
      'automation_node_version',
    ])
      expect(resolve(c).disposition, c).toBe('EXCLUDE');
    expect(resolve('openchat_logs').disposition).toBe('OPEN');
    for (const c of ['contact_task_config', 'document_col']) {
      expect(resolve(c).disposition).toBe('GAP');
      expect(resolve(c).reason).toMatch(/no team decision: ask manager/);
    }
    expect(resolve('contact_lifecycle_stages').disposition).toBe('MIGRATE');
    expect(resolve('contact_lifecycle_stages').reason).toMatch(/needs manager confirmation/);
  });
});
