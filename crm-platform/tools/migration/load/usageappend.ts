import { readManifest, verifyDump } from '../extract/manifest';
import { NdjsonDirSource } from '../extract/source';
import { buildCreditsPlan } from '../credits/plan';
import { CreditsConfigError, type CreditSettings } from '../credits/config';
import { creditTokens, usageCharges } from '../transform/credits';
import { sanitizeError } from '../util';
import { digest, orgTables, recordQuarantineDigest } from './baseline';
import { installCreditsLoader } from './credits';
import { connect, schemaReady, sql, withPrivileged, withTenant, type Database } from './db';
import { IdMap, runStep, type Counts, type Env } from './engine';
import { ORG_COLLECTION } from './org';
import { acquireRunLock, startHeartbeat, type LockConn } from './run';

installCreditsLoader();

/**
 * usage-charges-append: loads ONLY the billing-log rows (usage_charges + usage_charge_keys) and the AI token rows (ai_token_usage) of
 * source documents that are not yet in migration.id_map. It is the credits catch-up for a client whose first load is long done:
 *
 *  - the wallet ledger is NOT part of it. A posted ledger row is immutable and carries a balance_after computed from the confirmed
 *    opening balance, so a re-export changes the plan's opening entry and `run` refuses (CREDITS_OPENING_CHANGED). The wallet row itself
 *    is brought to the current Waboo balance by `wallet-sync` (geta_core). A historical charge is not a ledger posting: usage_charges
 *    rows are written `free` (credits 0, revenue 0, no wallet link) and keep Waboo's billed amount as exact text in meta, see the README.
 *  - same rows as the first load: this runs the very same step specs (transform/credits.ts), with a plan built from the same dump and
 *    the recorded switches (workspace) but with the wallet part OFF, so no opening file is needed and nothing is computed for the ledger.
 *  - nothing else moves: wallet_transactions, wallets, wallet_events, wallet_usage_months, event_outbox, audit and every other table the
 *    bulk steps do not own are digested before and after, INSIDE the same transaction; any difference aborts and rolls back everything.
 *  - one transaction for the whole append (all or nothing). A dry run (default) runs the same code and rolls it back, so its counts are
 *    the real ones, partitions and quarantine included. Idempotent: a document already in id_map is skipped, a wamid already keyed is a
 *    counted UNIQUE_CONFLICT quarantine.
 *
 * There is no link to resolve: a billing-log row is tied to nothing but its wamid (campaign, contact, template and delivery fields are
 * deliberately not kept, see USAGE_FIELDS), so the only unresolved case is a row that cannot be keyed or dated (counted quarantine).
 */
export interface UsageAppendOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  skipHash?: boolean;
  batch?: number;
  lockWaitSeconds?: number;
  log: (line: string) => void;
}

export interface UsageAppendResult {
  dryRun: boolean;
  steps: Record<string, Counts>;
}

export const APPEND_STEP = 'usage-append';
const CREDITS_COLLECTION = '_credits';
const LEDGER_TABLES = ['wallet_transactions', 'wallets'];

export class UsageAppendError extends Error {}
class DryRunRollback extends Error {}

/** The plan's switches: the recorded workspace, wallet OFF (the append never builds a ledger). Pure. */
export function appendSettings(recorded: { workspaceId?: unknown } | null): CreditSettings {
  const ws = typeof recorded?.workspaceId === 'string' && recorded.workspaceId ? recorded.workspaceId : null;
  return { wallet: false, opening: null, workspaceId: ws };
}

/** Tables whose row digests differ between two snapshots (a table present on one side only counts). Pure. */
export function changedTables(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((t) => JSON.stringify(before[t] ?? []) !== JSON.stringify(after[t] ?? []))
    .sort();
}

/** The ledger, the wallet and every table no bulk step owns (outbox, audit, notifications, wallet events ...). */
async function snapshot(db: Database, orgId: number): Promise<Record<string, string[]>> {
  return withTenant(db, { orgId }, async (tx) => {
    const tables = [...(await orgTables(tx)), ...LEDGER_TABLES];
    const d = await digest(tx, orgId, tables);
    delete d.organizations; // the organization row is not touched, and the counters on it are not ours to judge
    return d;
  });
}

export async function usageChargesAppend(o: UsageAppendOptions): Promise<UsageAppendResult> {
  const source = new NdjsonDirSource(o.dumpsDir);
  const manifest = readManifest(o.dumpsDir, o.client);
  if (!manifest) throw new UsageAppendError(`APPEND_NO_MANIFEST: ${o.client}: no manifest.json in the dump`);
  if (!o.skipHash) {
    const problems = await verifyDump(source, o.dumpsDir, o.client);
    if (problems.length > 0)
      throw new UsageAppendError(
        `APPEND_DUMP_CHANGED: the dump does not match manifest.json:\n  ${problems.join('\n  ')}`,
      );
  }
  const have = new Set(source.collections(o.client));
  if (!have.has('whatsapp_broadcasting_data'))
    throw new UsageAppendError(`APPEND_NO_BILLING_LOG: the dump of ${o.client} has no whatsapp_broadcasting_data`);

  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  const lockConn = await worker.pool.connect();
  let stopBeat: () => void = () => undefined;
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) throw new UsageAppendError(`APPEND_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);
    // one run per client at a time, the same lock `run` and `update` take
    await acquireRunLock(lockConn as LockConn, o.client, o.lockWaitSeconds ?? 120, 15, o.log);
    stopBeat = startHeartbeat(lockConn as LockConn, o.client);
    if (!(await schemaReady(worker.db)))
      throw new UsageAppendError('APPEND_NO_SCHEMA: migration schema is missing: run `init` once as the owner first');

    // the first load must be there: this is a catch-up, not a first load (that is `run`)
    const steps = new Set(
      (
        (await worker.db.execute(
          sql`SELECT step FROM migration.run_log WHERE source_client = ${o.client} AND collection IN ('whatsapp_broadcasting_data_usage', 'credit_logs_tokens')`,
        )).rows as Array<{ step: string }>
      ).map((r) => r.step),
    );
    if (!steps.has('usage_charges'))
      throw new UsageAppendError(
        `APPEND_NOT_LOADED: the usage_charges step never ran for ${o.client}: this is a catch-up for a loaded client; use \`run\` for a first load`,
      );
    const rec = (
      await worker.db.execute(
        sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = ${CREDITS_COLLECTION} AND step = 'options'`,
      )
    ).rows[0] as { counts?: { workspaceId?: unknown } } | undefined;
    if (!rec?.counts)
      throw new UsageAppendError(
        'APPEND_NO_OPTIONS: no record of the credits switches of the first load (migration.run_log _credits options): the workspace filter cannot be taken from it',
      );
    const settings = appendSettings(rec.counts);
    const doTokens = steps.has('credit_tokens') && have.has('credit_logs');

    const idmap = new IdMap();
    await idmap.load(worker.db, o.client);
    let plan;
    try {
      plan = await buildCreditsPlan({ source, client: o.client, settings, referenceAt: manifest.generatedAt });
    } catch (e) {
      throw new UsageAppendError(e instanceof CreditsConfigError ? e.message : sanitizeError(e));
    }
    o.log(
      `${o.client}: the dump holds ${plan.stats.usageRows} loadable usage charge(s) (${plan.stats.usageDuplicates} duplicate wamid)${doTokens ? ` and ${plan.stats.tokenRows} token row(s)` : ''}; documents already in id_map are skipped`,
    );

    const result: UsageAppendResult = { dryRun: !o.apply, steps: {} };
    const body = async (db: Database): Promise<void> => {
      const env: Env = {
        source,
        client: o.client,
        dumpsDir: o.dumpsDir,
        db,
        orgId,
        idmap,
        // the two specs read no index (no contact, user or campaign is looked up: a billing row is keyed by its wamid alone)
        idx: {} as Env['idx'],
        batchSize: o.batch ?? 500,
        defaultCountryCode: null,
        fallbackAt: manifest.generatedAt,
        creditSettings: settings,
        credits: plan,
        pkCache: new Map(),
        force: true, // the first load's checkpoint says "done" for an older dump: re-read, id_map decides what is new
        runId: `${APPEND_STEP}-${Date.now()}`,
        log: o.log,
      };
      const before = await snapshot(db, orgId);
      result.steps.usage_charges = await runStep(env, usageCharges);
      if (doTokens) result.steps.credit_tokens = await runStep(env, creditTokens);
      const after = await snapshot(db, orgId);
      const moved = changedTables(before, after);
      if (moved.length > 0)
        throw new UsageAppendError(
          `APPEND_SIDE_EFFECT: ${moved.join(', ')} changed during the append (the ledger, the wallet and the tables no step owns must not move). Everything was rolled back; if the live application was writing at the same moment, run again`,
        );
      await recordQuarantineDigest(db, o.client, ORG_COLLECTION);
      if (o.apply)
        await db.execute(sql`
          INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
          VALUES (${o.client}, ${CREDITS_COLLECTION}, ${APPEND_STEP}, ${env.runId}, 0, 'done', ${JSON.stringify({ at: new Date().toISOString(), ...result.steps })}::jsonb)
          ON CONFLICT (source_client, collection, step) DO UPDATE SET run_id = EXCLUDED.run_id, counts = EXCLUDED.counts, updated_at = now()`);
    };
    // ONE transaction (withTenant inside it becomes savepoints): all or nothing; a dry run rolls it back at the end
    try {
      await worker.db.transaction(async (outer) => {
        await body(outer as unknown as Database);
        if (!o.apply) throw new DryRunRollback();
      });
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
    for (const [name, c] of Object.entries(result.steps))
      o.log(
        `  ${name.padEnd(16)} read ${c.read}, already loaded ${c.already}, ${o.apply ? 'inserted' : 'would insert'} ${c.migrated}, quarantined ${c.quarantined}, excluded ${c.excluded}`,
      );
    o.log(
      o.apply
        ? '  usage-charges-append done: the ledger, the wallet and every table no step owns are byte-identical to before. Run reconcile next.'
        : '  usage-charges-append DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)',
    );
    return result;
  } finally {
    stopBeat();
    await lockConn.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    lockConn.release();
    await worker.close();
    await owner.close();
  }
}
