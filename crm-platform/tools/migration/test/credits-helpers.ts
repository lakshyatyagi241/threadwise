import { afterAll, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import {
  acmeCredits,
  globexCredits,
  initechCredits,
  OPENING_ACME,
  OPENING_GLOBEX,
  umbrellaCredits,
  type CreditsDump,
} from './credits-fixtures';

export const OWNER = 'owner@example.test';
export type CreditOpts = NonNullable<RunOptions['credits']>;

export const opts = (
  d: Dumps,
  db: TestDb,
  client: string,
  extra: Partial<RunOptions> = {},
): RunOptions =>
  runOpts(d, db, client, {
    org: { name: client, slug: client, ownerEmail: client === 'acme' ? OWNER : null },
    allowNoOwner: client !== 'acme',
    ...extra,
  });

export const check = (
  d: Dumps,
  db: TestDb,
  client: string,
  credits?: CreditOpts,
  allowExtraRows = false,
) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    credits,
    allowExtraRows,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
export const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);
export const orgOf = (slug: string): string =>
  `(SELECT id FROM organizations WHERE slug = '${slug}')`;

/** A snapshot of everything the credits step writes that does not depend on ids or on when the run happened. */
export async function snapshot(db: TestDb, slug: string): Promise<string> {
  const w = await rows(
    db,
    `SELECT idempotency_key, uuid::text, user_id IS NOT NULL AS has_user, kind, type, amount::text, balance_after::text, source, direction, unit,
            created_at::text, description, meta::text FROM wallet_transactions WHERE org_id = ${orgOf(slug)} ORDER BY idempotency_key`,
  );
  const wl = await rows(
    db,
    `SELECT unit, balance::text, reserved::text FROM wallets WHERE org_id = ${orgOf(slug)} ORDER BY unit`,
  );
  const t = await rows(
    db,
    `SELECT provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against, created_at::text FROM ai_token_usage
     WHERE org_id = ${orgOf(slug)} ORDER BY created_at, provider, model, prompt_tokens, completion_tokens, total_tokens`,
  );
  const u = await rows(
    db,
    `SELECT wamid, category, source, credits, status, meta, created_at::text FROM usage_charges WHERE org_id = ${orgOf(slug)} ORDER BY wamid`,
  );
  const k = await rows(
    db,
    `SELECT provider_message_id, status, uuid::text FROM usage_charge_keys WHERE org_id = ${orgOf(slug)} ORDER BY provider_message_id`,
  );
  const m = await rows(
    db,
    `SELECT source_collection, source_key, target_table FROM migration.id_map WHERE source_client = '${slug}'
       AND source_collection IN ('credit_logs', 'credit_logs_tokens', 'whatsapp_broadcasting_data_usage') ORDER BY 1, 2`,
  );
  return JSON.stringify({ w, wl, t, u, k, m });
}

/** Run a statement against a table whose append-only trigger would refuse it (what a damage case does by hand). */
export const loose = async (
  db: TestDb,
  table: string,
  trigger: string,
  stmt: string,
): Promise<void> => {
  await asOwner(db, async (d) => {
    await d.execute(sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`));
    try {
      await d.execute(sql.raw(stmt));
    } finally {
      await d.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`));
    }
  });
};
export const WALLET_TRG = 'trg_wallet_transactions_immutable';

export const writeOpening = (d: Dumps, client: string, o: Record<string, unknown>): void =>
  writeFileSync(join(d.dir, client, 'credit-opening.json'), JSON.stringify(o));

export const acme = acmeCredits();
export const globex = globexCredits();

/** The dumps (acme, globex, initech, umbrella) and a database that already holds acme and globex. */
export let dumps: Dumps;
export let base: TestDb;
const dbs: TestDb[] = [];
export const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};

export const pick = (c: CreditsDump) => ({
  contact_list: [],
  credit_logs: c.credit_logs,
  whatsapp_broadcasting_data: c.whatsapp_broadcasting_data,
  ...(c.user.length > 0 ? { user: c.user } : {}),
});

export function setupCredits(): void {
  beforeAll(async () => {
    dumps = await customDumps({
      acme: pick(acme),
      globex: pick(globex),
      initech: pick(initechCredits()),
      umbrella: pick(umbrellaCredits()),
    });
    writeOpening(dumps, 'acme', OPENING_ACME);
    writeOpening(dumps, 'globex', OPENING_GLOBEX);
    base = await clone('cr-base');
    await runClient(opts(dumps, base, 'acme'));
    await runClient(opts(dumps, base, 'globex'));
  }, 1_800_000);
  afterAll(async () => {
    for (const d of dbs) await d.drop();
    dumps.cleanup();
  });
}
