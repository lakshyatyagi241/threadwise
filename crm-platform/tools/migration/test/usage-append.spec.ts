import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { usageChargesAppend, type UsageAppendOptions } from '../load/usageappend';
import { cl, D, wb } from './credits-fixtures';
import { base, check, clone, dumps, one, orgOf, rows, setupCredits } from './credits-helpers';
import { writeManifest } from '../extract/manifest';
import type { TestDb } from './helpers';

setupCredits();

/** A re-export: more documents in a collection, and a new manifest (the tool refuses a dump that does not match its manifest). */
const ndjson = async (client: string, coll: string, docs: unknown[]): Promise<void> => {
  appendFileSync(
    join(dumps.dir, client, `${coll}.ndjson`),
    docs.map((d) => JSON.stringify(d)).join('\n') + '\n',
  );
  await writeManifest(dumps.source, dumps.dir, client);
};

const appendOpts = (db: TestDb, apply: boolean, client = 'acme'): UsageAppendOptions => ({
  dumpsDir: dumps.dir,
  client,
  orgSlug: client,
  targetUrl: db.workerUrl,
  ownerUrl: db.ownerUrl,
  apply,
  batch: 2,
  log: () => undefined,
});

/** The ledger, the wallet and the tables no step owns, as one text: it must be identical before and after an append. */
const untouched = async (db: TestDb, slug: string): Promise<string> =>
  JSON.stringify([
    await rows(db, `SELECT * FROM wallet_transactions WHERE org_id = ${orgOf(slug)} ORDER BY id`),
    await rows(db, `SELECT * FROM wallets WHERE org_id = ${orgOf(slug)} ORDER BY id`),
    await one(db, `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = ${orgOf(slug)}`),
    await one(db, `SELECT count(*)::int AS n FROM wallet_events WHERE org_id = ${orgOf(slug)}`),
    await one(db, `SELECT count(*)::int AS n FROM wallet_usage_months WHERE org_id = ${orgOf(slug)}`),
  ]);
const n = (db: TestDb, t: string): Promise<number> =>
  one(db, `SELECT count(*)::int AS n FROM ${t} WHERE org_id = ${orgOf('acme')}`);

describe('usage-charges-append', () => {
  it('loads only the new charges, never the ledger or the wallet, and the verifier agrees', async () => {
    const db = await clone('ua-main', base.name);
    // the dump grows after the first load: two charges, one without a message id, one repeated wamid (campaign recipient rows are the broadcast step's, not this one's)
    await ndjson('acme', 'whatsapp_broadcasting_data', [
      wb({ msg: 'wamid.ua.1', at: D('2026-09-10T08:00:00.000Z'), amount: 0.35 }),
      wb({ msg: 'wamid.ua.2', at: D('2026-09-10T08:01:00.000Z'), category: 'marketing', source: 'inbox' }),
      wb({ msg: 'wamid.ua.2', at: D('2026-09-10T08:02:00.000Z') }),
      wb({ msg: null, at: D('2026-09-10T08:03:00.000Z') }),
    ]);

    const pending = await check(dumps, db, 'acme');
    expect(pending.alarms.some((a) => /IDMAP_MISSING: 2 whatsapp_broadcasting_data_usage/.test(a))).toBe(true);

    const keep = await untouched(db, 'acme');
    const charges = await n(db, 'usage_charges');
    const keys = await n(db, 'usage_charge_keys');
    const first = (await rows(db, `SELECT counts FROM migration.run_log WHERE source_client = 'acme' AND step = 'usage_charges'`))[0]!.counts as {
      quarantined: number;
      excluded: number;
    };
    const qBefore = await one(db, `SELECT count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme'`);

    // dry run: the real counts, nothing written (not even a quarantine row or an id_map row)
    const dry = await usageChargesAppend(appendOpts(db, false));
    expect(dry.dryRun).toBe(true);
    expect(dry.steps.usage_charges).toMatchObject({ migrated: 2, quarantined: first.quarantined + 1, excluded: first.excluded + 1 });
    expect(await n(db, 'usage_charges')).toBe(charges);
    expect(await one(db, `SELECT count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme'`)).toBe(qBefore);
    expect(await untouched(db, 'acme')).toBe(keep);

    // apply
    const done = await usageChargesAppend(appendOpts(db, true));
    expect(done.steps.usage_charges!.migrated).toBe(2);
    expect(await n(db, 'usage_charges')).toBe(charges + 2);
    expect(await n(db, 'usage_charge_keys')).toBe(keys + 2);
    expect(await untouched(db, 'acme')).toBe(keep);
    const r = (await rows(
      db,
      `SELECT status, credits, revenue_minor, wallet_tx_id, provider, meta::text AS meta FROM usage_charges WHERE wamid = 'wamid.ua.1' AND org_id = ${orgOf('acme')}`,
    ))[0]!;
    expect(r).toMatchObject({ status: 'free', credits: 0, provider: 'waba' });
    expect(Number(r.revenue_minor)).toBe(0);
    expect(r.wallet_tx_id).toBeNull();
    expect(JSON.parse(String(r.meta)).legacy.waboo.amount).toBe('0.35');

    // the independent verifier now finds nothing missing and nothing extra
    const after = await check(dumps, db, 'acme');
    expect(after.alarms.filter((a) => /IDMAP_MISSING|CREDITS_|TARGET_MISSING|NOT_LOADED|EXTRA/.test(a))).toEqual([]);
    expect(after.alarms).toEqual([]);
    expect(after.ok).toBe(true);

    // idempotent
    const again = await usageChargesAppend(appendOpts(db, true));
    expect(again.steps.usage_charges!.migrated).toBe(0);
    expect(await n(db, 'usage_charges')).toBe(charges + 2);
    expect(await untouched(db, 'acme')).toBe(keep);
  });

  it('appends token rows of new credit_logs documents without posting anything to the wallet', async () => {
    const db = await clone('ua-tokens', base.name);
    const keep = await untouched(db, 'acme');
    const tokens = await n(db, 'ai_token_usage');
    await ndjson('acme', 'credit_logs', [cl({ amount: 0.5, at: D('2026-09-11T10:00:00.000Z') })]);
    const done = await usageChargesAppend(appendOpts(db, true));
    expect(done.steps.credit_tokens!.migrated).toBe(1);
    expect(await n(db, 'ai_token_usage')).toBe(tokens + 1);
    expect(await untouched(db, 'acme')).toBe(keep); // no ledger row for the new credit document: the wallet follows wallet-sync
  });

  it('refuses a client that was never loaded', async () => {
    const db = await clone('ua-none', base.name);
    await expect(usageChargesAppend(appendOpts(db, true, 'initech'))).rejects.toThrow(/APPEND_NO_ORG/);
  });
});
