import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryError, planHistory, text4, to4, type CoreWalletEvent, type HistoryPlan } from '../credits/history';
import type { Source } from '../extract/source';
import { badText, type Doc } from '../util';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * wallet-history: gives the organization the COMPLETE wallet statement Waboo shows: every day's WhatsApp charges and reverts, the AI
 * charges, the top-ups, removals and purchases, chained from a derived opening balance to the live Waboo balance (credits/history.ts
 * has the rules and the reasoning). Replaces the one-opening-balance ledger the credits step posts, which showed 4 rows where Waboo
 * shows thousands.
 *
 * Reads: the dump (credit_logs, whatsapp_broadcasting_data) and dumps/<client>/core.json (live balance, timezone, top-ups, purchases).
 * Writes, in ONE transaction: the ledger rows this tool owns (idempotency_key waboo:<client>:...) are replaced by the planned rows and
 * wallets.balance is set to the live balance. A ledger row is immutable by trigger and only a privileged session may delete one, so the
 * transaction runs with the privilege flag, on the owner login, for this organization only. Rows the tool did not write (real WaDesk
 * activity after a cut-over) stop the run (WALLETHISTORY_FOREIGN_ROWS): the rebuild is for a client that is not live on WaDesk yet.
 * The credit_logs spends and the opening entry keep their id and uuid (migration.id_map points at them).
 * Idempotent: the same plan again changes nothing. Dry run by default; --apply needs --confirm-org-slug.
 */
export interface WalletHistoryOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  source: Source;
  apply: boolean;
  log: (line: string) => void;
}

export const HISTORY_COLLECTION = '_credits';
export const HISTORY_STEP = 'wallet_history';

interface CoreFile {
  readOn?: string;
  readAt?: string;
  workspace?: {
    id?: string;
    timezone?: { utc?: unknown[] } | string;
    credits?: { remaining_amounts?: number; currency?: string };
  };
  walletEvents?: CoreWalletEvent[];
}

const ianaOf = (z: unknown): string | null => {
  if (typeof z !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(z)) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return z;
  } catch {
    return null;
  }
};

/**
 * One collection, reduced while it is read to the fields the plan uses (the charge log of a big client is tens of thousands of
 * documents with contact data: keeping them whole ran a 768 MB container out of memory). badText is judged on the WHOLE document first.
 */
const readSlim = async (source: Source, client: string, c: string, keep: string[]): Promise<Doc[]> => {
  const out: Doc[] = [];
  if (source.collections(client).includes(c))
    for await (const d of source.read(client, c)) {
      if (badText(d)) continue;
      const slim: Doc = {};
      for (const k of keep) if (d[k] !== undefined) slim[k] = d[k];
      out.push(slim);
    }
  return out;
};

const KEEP_CHARGES = ['_id', 'id', 'amount', 'created_time', 'revert', 'reverted_at', 'template_category', 'origin'];
const KEEP_CREDIT_LOGS = ['_id', 'id', 'workspace_id', 'credits_deducted', 'created_time', 'description', 'action', 'module'];

/** Reads everything the plan needs; nothing here touches the database. */
export async function buildHistory(
  o: Pick<WalletHistoryOptions, 'dumpsDir' | 'client' | 'source'>,
  workspaceId: string | null,
): Promise<{ plan: HistoryPlan; unit: string; target: bigint; asOf: string; timezone: string }> {
  let core: CoreFile;
  try {
    core = JSON.parse(readFileSync(join(o.dumpsDir, o.client, 'core.json'), 'utf8')) as CoreFile;
  } catch (e) {
    throw new HistoryError(
      `WALLETHISTORY_NO_CORE: dumps/${o.client}/core.json is missing or not JSON (run core-opening.cjs, then ship): ${(e as Error).message}`,
    );
  }
  const target = to4(core.workspace?.credits?.remaining_amounts);
  if (target === null || target < 0n)
    throw new HistoryError(
      'WALLETHISTORY_NO_BALANCE: core.json has no usable workspace.credits.remaining_amounts',
    );
  if (!Array.isArray(core.walletEvents))
    throw new HistoryError(
      'WALLETHISTORY_NO_EVENTS: core.json has no walletEvents (it was written by an older core-opening.cjs): run core-opening.cjs again, then ship',
    );
  const asOf = core.readAt ?? (core.readOn ? `${core.readOn}T23:59:59Z` : '');
  const asOfMs = new Date(asOf).getTime();
  if (!Number.isFinite(asOfMs))
    throw new HistoryError('WALLETHISTORY_NO_READAT: core.json does not say when geta_core was read');
  const tzRaw = core.workspace?.timezone;
  const timezone =
    (typeof tzRaw === 'string'
      ? ianaOf(tzRaw)
      : (tzRaw?.utc ?? []).map(ianaOf).find((z): z is string => z !== null)) ?? 'UTC';
  const unit = String(core.workspace?.credits?.currency ?? 'inr').toUpperCase();
  const mb = (): string => `${Math.round(process.memoryUsage().rss / 1048576)} MB`;
  const creditLogs = await readSlim(o.source, o.client, 'credit_logs', KEEP_CREDIT_LOGS);
  console.log(`  history  memory after credit_logs: ${mb()}`);
  const charges = await readSlim(o.source, o.client, 'whatsapp_broadcasting_data', KEEP_CHARGES);
  console.log(`  history  memory after ${charges.length} charge document(s): ${mb()}`);
  const plan = planHistory({
    client: o.client,
    targetMinor: target,
    asOfMs,
    timezone,
    creditLogs,
    charges,
    events: core.walletEvents,
    workspaceId,
  });
  // a dump newer than core.json would leave its charges out of the statement, which would stop at readAt (ISKM); refuse instead of logging
  if (plan.stats.skippedAfterAsOf > 0)
    throw new HistoryError(
      `WALLETHISTORY_CORE_STALE: the dump holds ${plan.stats.skippedAfterAsOf} record(s) after core.json readAt ${asOf}; re-run core-opening.cjs after the export, then ship. Nothing was written`,
    );
  return { plan, unit, target, asOf, timezone };
}

const iso = (ms: number): string => new Date(ms).toISOString();

export async function walletHistory(o: WalletHistoryOptions): Promise<void> {
  const owner = connect(o.ownerUrl, 'owner');
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org)
      throw new Error(
        `WALLETHISTORY_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`,
      );
    const orgId = Number(org.id);

    // the credits step's workspace switch, as the first load recorded it
    const rec = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(
          sql`SELECT counts FROM migration.run_log WHERE source_client = ${o.client} AND collection = '_credits' AND step = 'options'`,
        ),
      )
    ).rows[0] as { counts?: { workspaceId?: string | null } } | undefined;
    const { plan, unit, target, asOf, timezone } = await buildHistory(
      o,
      rec?.counts?.workspaceId ?? null,
    );
    const s = plan.stats;
    o.log(
      `  history  ${plan.rows.length} ledger row(s): ${s.deductionRows} daily WhatsApp deduction(s) + ${s.revertedRows} for reverted messages + ${s.refundRows} revert(s) (from ${s.chargeDocs} charge document(s); ${s.neutralReverted} refused at send time, net zero), ${s.aiRows} AI charge(s), ${s.eventRows} top-up / removal / purchase row(s); opening ${text4(plan.openingMinor)} ${unit}`,
    );
    o.log(
      `  history  chain ends at the live Waboo balance ${text4(target)} ${unit} (geta_core read ${asOf}); days counted in ${timezone}; ${s.skippedAfterAsOf} record(s) after that moment left out`,
    );
    if (plan.belowZero > 0)
      o.log(
        `  history  the wallet overdrew: ${plan.belowZero} ledger row(s) end below zero, lowest ${text4(plan.lowest)} ${unit} (Waboo lets a wallet go a few messages into overdraft)`,
      );
    o.log(
      `  history  top-up checkpoints: ${plan.checkpoints - plan.checkpointMisses.length} of ${plan.checkpoints} match the balance Waboo logged before them (to 1.00)${
        plan.checkpointMisses.length > 0
          ? `; off: ${plan.checkpointMisses
              .slice(0, 12)
              .map((m) => `${m.at.slice(0, 10)} logged ${m.logged} chain ${m.chain}`)
              .join('; ')}`
          : ''
      }`,
    );

    await withTenant(owner.db, { orgId }, async (tx) => {
      await tx.execute(sql`select set_config('app.privileged', 'on', true)`);
      const w = (
        await tx.execute(
          sql`SELECT balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = ${orgId} AND unit = ${unit} FOR UPDATE`,
        )
      ).rows[0] as { balance: string; reserved: string } | undefined;
      if (w && Number(w.reserved) !== 0)
        throw new Error(
          `WALLETHISTORY_RESERVED: the wallet holds reserved ${w.reserved}; the rebuild is only for a wallet nobody is using`,
        );
      const prefix = `waboo:${o.client}:`;
      const have = (
        await tx.execute(sql`
          SELECT id, idempotency_key AS key, amount::text AS amount, balance_after::text AS balance_after, type,
                 (extract(epoch FROM created_at) * 1000)::bigint::text AS ms
          FROM wallet_transactions WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit}`)
      ).rows as Array<{
        id: number | string;
        key: string;
        amount: string;
        balance_after: string;
        type: string;
        ms: string;
      }>;
      const foreign = have.filter((r) => !r.key.startsWith(prefix));
      if (foreign.length > 0)
        throw new Error(
          `WALLETHISTORY_FOREIGN_ROWS: the ${unit} ledger holds ${foreign.length} row(s) this migration did not write (WaDesk activity?). The rebuild is for a client that is not live on WaDesk yet; nothing was written`,
        );
      const want = new Map(plan.rows.map((r) => [r.key, r]));
      const same =
        have.length === want.size &&
        have.every((r) => {
          const p = want.get(r.key);
          return (
            p !== undefined &&
            to4(r.amount) === p.minor &&
            to4(r.balance_after) === p.balanceAfter &&
            r.type === p.type &&
            BigInt(r.ms) === BigInt(p.atMs)
          );
        });
      if (same && w && to4(w.balance) === target) {
        o.log(
          `  history  already complete: ${have.length} ledger row(s) equal the plan, wallet ${w.balance} ${unit}`,
        );
        return;
      }
      o.log(
        `  history  ledger now: ${have.length} row(s), wallet ${w?.balance ?? '(none)'}; ${o.apply ? 'REPLACING it with' : 'would be replaced by'} ${plan.rows.length} row(s)`,
      );
      if (!o.apply) {
        o.log('  history  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
        return;
      }
      const keepId = new Map(have.map((r) => [r.key, Number(r.id)]));
      await tx.execute(
        sql`DELETE FROM wallet_transactions WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit} AND starts_with(idempotency_key, ${prefix})`,
      );
      const payload = plan.rows.map((r) => ({
        id: keepId.get(r.key) ?? null,
        uuid: r.uuid,
        type: r.type,
        amount: text4(r.minor),
        balance_after: text4(r.balanceAfter),
        source: r.source,
        description: r.description,
        meta: r.meta,
        key: r.key,
        direction: r.minor < 0n ? 'out' : 'in',
        note: r.note,
        actor_type: r.actorType,
        at: iso(r.atMs),
      }));
      for (let i = 0; i < payload.length; i += 500) {
        await tx.execute(sql`
          INSERT INTO wallet_transactions (org_id, id, uuid, user_id, kind, type, amount, balance_after, source, description, meta, idempotency_key,
                                           direction, note, actor_type, actor_label, unit, created_at, updated_at)
          OVERRIDING SYSTEM VALUE
          SELECT ${orgId}, coalesce(x.id, nextval(pg_get_serial_sequence('wallet_transactions', 'id'))), x.uuid, NULL, 'credit', x.type, x.amount, x.balance_after,
                 x.source, x.description, x.meta, x.key, x.direction, x.note, x.actor_type, 'waboo-migration', ${unit}, x.at, x.at
          FROM jsonb_to_recordset(${JSON.stringify(payload.slice(i, i + 500))}::jsonb)
               AS x(id bigint, uuid uuid, type text, amount numeric, balance_after numeric, source text, description text, meta jsonb, key text,
                    direction text, note text, actor_type text, at timestamptz)`);
      }
      await tx.execute(sql`
        INSERT INTO wallets (org_id, unit, balance, reserved) VALUES (${orgId}, ${unit}, ${text4(target)}::numeric, 0)
        ON CONFLICT (org_id, unit) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now(), row_version = wallets.row_version + 1`);
      const chk = (
        await tx.execute(sql`
          SELECT count(*)::int AS n, round(sum(amount), 4)::text AS sum, min(balance_after)::text AS lo FROM wallet_transactions
          WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit}`)
      ).rows[0] as { n: number; sum: string; lo: string };
      if (chk.n !== plan.rows.length || to4(chk.sum) !== target || to4(chk.lo) !== plan.lowest)
        throw new Error(
          `WALLETHISTORY_CHECK: after the write the ledger has ${chk.n} row(s) adding up to ${chk.sum} (lowest balance ${chk.lo}); expected ${plan.rows.length}, ${text4(target)} and a lowest balance of ${text4(plan.lowest)}. Rolled back`,
        );
      await tx.execute(sql`
        INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
        VALUES (${o.client}, ${HISTORY_COLLECTION}, ${HISTORY_STEP}, 'wallet-history', 0, 'done',
                ${JSON.stringify({ rows: plan.rows.length, fingerprint: plan.fingerprint, target: text4(target), unit, asOf, opening: text4(plan.openingMinor), at: new Date().toISOString() })}::jsonb)
        ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
      o.log(`  history  done: ${plan.rows.length} ledger row(s), wallet ${text4(target)} ${unit}`);
    });
  } finally {
    await owner.close();
  }
}
