import { buildCreditsPlan, describePlan, type CreditsPlan } from '../credits/plan';
import { recordOf, type CreditSettings } from '../credits/config';
import { minorText, minorText4, scaledText } from '../credits/decimal';
import { creditTokens, creditWallet, OPENING_SOURCE, usageCharges } from '../transform/credits';
import type { Row, TableSpec } from '../transform/types';
import { sanitizeError, uuidv5 } from '../util';
import { q, sql, withTenant, type TenantTx } from './db';
import type { Env } from './engine';

/**
 * The loader half of the credits step. Everything the rows depend on was decided in pass 1 (credits/plan.ts), from the dump alone;
 * here is what needs the database: the monthly partitions of the two partitioned tables, the opening ledger entry, the two tables with
 * no uuid column (inserted with ids taken from their own sequence, registered in migration.id_map in the SAME transaction), and the
 * wallet row, which is created LAST so that it never says more than its ledger does.
 *
 * Never written: event_outbox, audit_log, notifications, wallet_events, wallet_usage_months, any global table (message_rates ...).
 * No INSERT trigger exists on any table written here (test/credits.spec.ts pins it), so nothing fires.
 */
export const CREDITS_COLLECTION = '_credits';

export class CreditsLoadError extends Error {}

export const OPENING_KEY = (client: string): string => `waboo:${client}:opening`;
export const openingUuid = (client: string): string => uuidv5(`${client}|credit_opening|opening`);
export const LEDGER_PREFIX = (client: string): string => `waboo:${client}:`;

/** The plan, built once per run from the dump (a pure read: nothing is written to build it). */
export async function ensurePlan(
  env: Pick<Env, 'source' | 'client' | 'fallbackAt' | 'creditSettings' | 'credits'>,
): Promise<CreditsPlan> {
  if (env.credits) return env.credits;
  const settings: CreditSettings = env.creditSettings ?? {
    wallet: false,
    opening: null,
    workspaceId: null,
  };
  env.credits = await buildCreditsPlan({
    source: env.source,
    client: env.client,
    settings,
    referenceAt: env.fallbackAt,
  });
  return env.credits;
}

export async function recordCreditOptions(env: Env, plan: CreditsPlan): Promise<void> {
  const counts = {
    ...recordOf(plan.settings),
    plan: {
      creditDocs: plan.stats.creditDocs,
      walletRows: plan.stats.walletRows,
      walletSpend: minorText(plan.stats.walletSpend),
      rounded: plan.stats.rounded,
      roundedResidual: scaledText(plan.stats.roundedResidual),
      belowPrecision: plan.stats.belowPrecision,
      belowResidual: scaledText(plan.stats.belowResidual),
      tokenRows: plan.stats.tokenRows,
      usageRows: plan.stats.usageRows,
      fingerprint: plan.fingerprint,
    },
  };
  await env.db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${env.client}, ${CREDITS_COLLECTION}, 'options', ${env.runId}, 0, 'done', ${JSON.stringify(counts)}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
}

/** Fails BEFORE a row is written when the login may not create partitions (no silent fallback to owner rights). */
async function assertPartitionPrivilege(env: Env): Promise<void> {
  const ok = (
    await env.db.execute(
      sql`SELECT has_function_privilege('ensure_monthly_partition(regclass,date)', 'EXECUTE') AS ok`,
    )
  ).rows[0] as { ok: boolean };
  if (!ok.ok)
    throw new CreditsLoadError(
      'CREDITS_PARTITION_PRIVILEGE: the login this run uses may not call ensure_monthly_partition(), so the monthly partitions of ai_token_usage / usage_charges cannot be created. Grant EXECUTE on it to the worker role; this tool will not create partitions with owner rights behind your back. Nothing was written',
    );
}

async function ensurePartitions(env: Env, table: string, months: string[]): Promise<number> {
  if (months.length === 0) return 0;
  await assertPartitionPrivilege(env);
  return withTenant(env.db, { orgId: env.orgId }, async (tx) => {
    for (const m of months) {
      try {
        await tx.execute(
          sql`SELECT ensure_monthly_partition(${sql.raw(`'${table}'`)}::regclass, ${m}::date)`,
        );
      } catch (e) {
        throw new CreditsLoadError(
          `CREDITS_PARTITION: could not create the partition of ${table} for ${m}: ${sanitizeError(e)}`,
        );
      }
    }
    return months.length;
  });
}

const LEDGER_COLS =
  'org_id, uuid, user_id, kind, type, amount, balance_after, source, description, meta, idempotency_key, direction, note, actor_type, actor_label, unit, created_at, updated_at';

/** The rows of the ledger this tool owns, for the checks before and after. */
async function ledgerOf(
  tx: TenantTx,
  orgId: number,
  unit: string,
  client: string,
): Promise<{ foreign: number; ours: number; sum: string }> {
  const r = (
    await tx.execute(sql`
      SELECT count(*) FILTER (WHERE NOT starts_with(idempotency_key, ${LEDGER_PREFIX(client)}))::int AS foreign_rows,
             count(*) FILTER (WHERE starts_with(idempotency_key, ${LEDGER_PREFIX(client)}))::int AS ours,
             round(coalesce(sum(amount), 0), 4)::text AS sum
      FROM wallet_transactions WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit}`)
  ).rows[0] as { foreign_rows: number; ours: number; sum: string };
  return { foreign: r.foreign_rows, ours: r.ours, sum: r.sum };
}

/** The opening entry: an operator's `admin_adjust` anchored to the confirmed balance. Idempotent; refuses if an earlier run wrote another. */
async function ensureOpening(env: Env, plan: CreditsPlan): Promise<number> {
  const o = plan.settings.opening;
  if (!plan.settings.wallet || !o) return 0;
  return withTenant(env.db, { orgId: env.orgId }, async (tx) => {
    const led = await ledgerOf(tx, env.orgId, o.currency, env.client);
    if (led.foreign > 0)
      throw new CreditsLoadError(
        `WALLET_NOT_EMPTY: the ${o.currency} wallet of this organization already has ${led.foreign} ledger row(s) that this migration did not write. The opening entry is computed for an empty ledger; nothing was written`,
      );
    if (!plan.opening) return 0;
    const at = new Date(plan.opening.atMs).toISOString();
    const amount = minorText4(plan.opening.minor);
    const meta = JSON.stringify({
      legacy: {
        waboo: {
          openingBalance: {
            confirmed: o.amountText,
            currency: o.currency,
            confirmedBy: o.confirmedBy,
            asOf: o.asOf,
            migratedSpends: minorText(plan.stats.walletSpend),
            migratedRows: plan.stats.walletRows,
            note: o.note,
          },
        },
      },
    });
    const note = `Opening balance migrated from Waboo: confirmed ${o.amountText} ${o.currency} by ${o.confirmedBy} as of ${o.asOf}`;
    await tx.execute(sql`
      INSERT INTO wallet_transactions (${sql.raw(LEDGER_COLS)})
      VALUES (${env.orgId}, ${openingUuid(env.client)}::uuid, NULL, 'credit', 'admin_adjust', ${amount}::numeric, ${amount}::numeric,
              ${OPENING_SOURCE}, 'Opening balance (migrated from Waboo)', ${meta}::jsonb, ${OPENING_KEY(env.client)}, 'in', ${note},
              'platform_operator', 'waboo-migration', ${o.currency}, ${at}::timestamptz, ${at}::timestamptz)
      ON CONFLICT DO NOTHING`);
    const have = (
      await tx.execute(sql`
        SELECT amount::text AS amount, balance_after::text AS balance_after, direction,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at
        FROM wallet_transactions WHERE org_id = ${env.orgId} AND idempotency_key = ${OPENING_KEY(env.client)}`)
    ).rows[0] as
      { amount: string; balance_after: string; direction: string; at: string } | undefined;
    if (
      !have ||
      have.amount !== amount ||
      have.balance_after !== amount ||
      have.direction !== 'in' ||
      have.at !== `${at.slice(0, -1)}000`
    )
      throw new CreditsLoadError(
        'CREDITS_OPENING_CHANGED: an opening entry from an earlier run exists with a different amount or time (the confirmed balance, the dump or the rounding changed). A posted ledger row is immutable: nothing was written; ask for a privileged delete of the old rows before loading again',
      );
    return 1;
  });
}

/**
 * After the last batch: the ledger must add up to the confirmed balance, then (and only then) the wallet row is created with that balance.
 * Idempotent; a wallet that already exists must already hold it. Nothing here updates a ledger row.
 */
export async function finishCredits(env: Env): Promise<{ wallet: string | null }> {
  const plan = await ensurePlan(env);
  const o = plan.settings.opening;
  if (!plan.settings.wallet || !o) return { wallet: null };
  await ensureOpening(env, plan);
  return withTenant(env.db, { orgId: env.orgId }, async (tx) => {
    const led = await ledgerOf(tx, env.orgId, o.currency, env.client);
    if (led.foreign > 0)
      throw new CreditsLoadError(
        `WALLET_NOT_EMPTY: the ${o.currency} wallet holds ${led.foreign} ledger row(s) this migration did not write`,
      );
    const want = minorText4(o.minor);
    if (led.sum !== want)
      throw new CreditsLoadError(
        `WALLET_LEDGER_MISMATCH: the ledger of the ${o.currency} wallet adds up to ${led.sum} but the confirmed balance is ${o.amountText} (${led.ours} of the expected ${plan.stats.walletRows + (plan.opening ? 1 : 0)} rows are there: a row was quarantined or is missing). The wallet row was NOT created`,
      );
    if (o.minor === 0n && led.ours === 0) return { wallet: null };
    await tx.execute(sql`
      INSERT INTO wallets (org_id, unit, balance, reserved) VALUES (${env.orgId}, ${o.currency}, ${want}::numeric, 0)
      ON CONFLICT (org_id, unit) DO NOTHING`);
    const w = (
      await tx.execute(
        sql`SELECT balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = ${env.orgId} AND unit = ${o.currency}`,
      )
    ).rows[0] as { balance: string; reserved: string };
    if (w.balance !== want || Number(w.reserved) !== 0)
      throw new CreditsLoadError(
        `WALLET_EXISTS_DIFFERENT: a ${o.currency} wallet already exists with balance ${w.balance} (reserved ${w.reserved}), not the confirmed ${want}. It was left untouched`,
      );
    return { wallet: want };
  });
}

// ------------------------------------------------------------------------------------------------ tables with no uuid column

async function allocate(tx: TenantTx, seq: string, n: number): Promise<number[]> {
  const got = await tx.execute(
    sql`SELECT nextval(${seq}::regclass)::bigint AS id FROM generate_series(1, ${n})`,
  );
  return (got.rows as Array<{ id: number | string }>)
    .map((r) => Number(r.id))
    .sort((a, b) => a - b);
}

async function insertTokens(
  spec: TableSpec,
  tx: TenantTx,
  orgId: number,
  items: Array<{ uuid: string; row: Row }>,
): Promise<{ ids: Map<string, number>; inserted: number }> {
  const ids = await allocate(tx, 'ai_token_usage_id_seq', items.length);
  const rows = items.map((it, i) => ({ id: ids[i], ...it.row }));
  const cols = [
    ['id', 'bigint'] as [string, string],
    ...spec.columns.map((c) => [c.name, c.pg] as [string, string]),
  ];
  await tx.execute(sql`
    INSERT INTO ai_token_usage (org_id, ${sql.raw(cols.map(([n]) => q(n)).join(', '))})
    SELECT ${orgId}::bigint, ${sql.raw(cols.map(([n]) => `x.${q(n)}`).join(', '))}
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(${sql.raw(cols.map(([n, t]) => `${q(n)} ${t}`).join(', '))})`);
  return { ids: new Map(items.map((it, i) => [it.uuid, ids[i]!])), inserted: items.length };
}

/**
 * A charge is claimed through usage_charge_keys first (UNIQUE per org and wamid: the application's own idempotency gate), carrying the
 * charge's id and time, so no UPDATE of the key is needed afterwards. A wamid the org already holds a key for is not written again (the
 * engine quarantines that document UNIQUE_CONFLICT).
 */
async function insertUsage(
  spec: TableSpec,
  tx: TenantTx,
  orgId: number,
  items: Array<{ uuid: string; row: Row }>,
): Promise<{ ids: Map<string, number>; inserted: number }> {
  const ids = await allocate(tx, 'usage_charges_id_seq', items.length);
  const rows: Array<Row & { id: number; uuid: string }> = items.map((it, i) => ({
    ...it.row,
    id: ids[i]!,
    uuid: it.uuid,
  }));
  const claimed = await tx.execute(sql`
    INSERT INTO usage_charge_keys (org_id, uuid, provider_message_id, charge_id, charge_created_at, status)
    SELECT ${orgId}::bigint, x.uuid, x.wamid, x.id, x.created_at, 'free'
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(uuid uuid, wamid text, id bigint, created_at timestamptz)
    ON CONFLICT (org_id, provider_message_id) DO NOTHING
    RETURNING provider_message_id`);
  const won = new Set(
    (claimed.rows as Array<{ provider_message_id: string }>).map((r) => r.provider_message_id),
  );
  const mine = rows.filter((r) => won.has(String(r.wamid)));
  if (mine.length > 0) {
    const cols = [
      ['id', 'bigint'] as [string, string],
      ...spec.columns.map((c) => [c.name, c.pg] as [string, string]),
    ];
    await tx.execute(sql`
      INSERT INTO usage_charges (org_id, ${sql.raw(cols.map(([n]) => q(n)).join(', '))})
      SELECT ${orgId}::bigint, ${sql.raw(cols.map(([n]) => `x.${q(n)}`).join(', '))}
      FROM jsonb_to_recordset(${JSON.stringify(mine)}::jsonb) AS x(${sql.raw(cols.map(([n, t]) => `${q(n)} ${t}`).join(', '))})`);
  }
  return {
    ids: new Map(mine.map((r) => [String(r.uuid), Number(r.id)])),
    inserted: mine.length,
  };
}

/** Wires the loader hooks into the shared step specs (the specs are also used by the verifier, which needs none of this). */
export function installCreditsLoader(): void {
  const prepareWallet = async (env: Env): Promise<void> => {
    const plan = await ensurePlan(env);
    if (plan.settings.wallet && plan.settings.opening) {
      await ensureOpening(env, plan);
      env.log(
        `  credits            wallet unit ${plan.settings.opening.currency}: it must be the currency this workspace is billed in (organizations.settings.currency, else the platform currency); the tool does not change organization settings`,
      );
    }
    env.log(`  credits            ${describePlan(plan)}`);
  };
  creditWallet.prepare = prepareWallet;
  creditTokens.prepare = async (env) => {
    const plan = await ensurePlan(env);
    const n = await ensurePartitions(env, 'ai_token_usage', plan.months.ai_token_usage);
    env.log(`  credits            ${n} monthly partition(s) of ai_token_usage ensured`);
  };
  usageCharges.prepare = async (env) => {
    const plan = await ensurePlan(env);
    const n = await ensurePartitions(env, 'usage_charges', plan.months.usage_charges);
    env.log(`  credits            ${n} monthly partition(s) of usage_charges ensured`);
  };
  for (const spec of [creditWallet, creditTokens, usageCharges])
    spec.fingerprint = (env) => env.credits?.fingerprint ?? '';
  const tok = creditTokens.tables.ai_token_usage!;
  tok.custom = (tx, orgId, items) => insertTokens(tok, tx, orgId, items);
  const use = usageCharges.tables.usage_charges!;
  use.custom = (tx, orgId, items) => insertUsage(use, tx, orgId, items);
}
