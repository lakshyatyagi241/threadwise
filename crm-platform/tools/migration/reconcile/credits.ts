import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CreditSettings } from '../credits/config';
import type { CreditsPlan } from '../credits/plan';
import type { Source } from '../extract/source';
import { sql, withTenant, type Database } from '../load/db';
import type { IdMap } from '../load/engine';
import { uuidv5 } from '../util';
import { exactText, oracleCredits, text2, text4, type CreditOracle } from './oracle-credits';
import { text } from './oracle';
import { fourDigits, oracleHistory } from './oracle-history';
import type { Report } from './index';

/**
 * The verifier of the credits step. What it believes about the source comes from reconcile/oracle-credits.ts (a second implementation
 * of spec B section 3); what it believes about the target it reads here, with its own SQL. For the organization it checks:
 *   - every wallet_transactions row against the oracle (amount, balance_after, direction, type, unit, time, user, key, constants) and the
 *     opening entry against the CONFIRMED balance of the credit-opening file (not against anything the loader recorded);
 *   - the invariant of the application's hourly job: wallets.balance = sum of the ledger per unit, the chain balance_after(i) -
 *     balance_after(i-1) = amount(i) in SQL, no balance_after below zero, one wallet at most and it holds the confirmed balance;
 *   - the rounding accounting: sum of the exact amounts of the dump = what the ledger posted + the rounding residual + the amounts below
 *     0.01 (+ the rows over the limit), recomputed from the dump and the DB with BigInt: nothing vanishes silently;
 *   - every ai_token_usage row through migration.id_map (the table has no source key) and the token sums per month;
 *   - every usage_charges row and its usage_charge_keys row (wamid, status free, no money, no wallet link);
 *   - rows the source does not account for in any of the five tables, and that wallet_events / wallet_usage_months stay empty.
 * Outbox, audit and notifications are held by the baseline digest of reconcile/index.ts.
 */
type Row = Record<string, unknown>;

export interface CreditsVerifyArgs {
  db: Database;
  orgId: number;
  client: string;
  source: Source;
  settings: CreditSettings;
  recorded: Record<string, unknown> | null;
  plan: CreditsPlan | null;
  referenceAt: string;
  allowExtraRows: boolean;
  alarm: (m: string) => void;
  warnings: string[];
  notPresent: Report['notPresent'];
  idmap: IdMap;
  /** the wallet-history record (migration.run_log _credits / wallet_history): when present the ledger is the full statement, not the one-opening model */
  history?: WalletHistoryMarker | null;
}

export interface WalletHistoryMarker {
  rows: number;
  fingerprint: string;
  target: string;
  unit: string;
  asOf: string;
  opening: string;
}

/** The record wallet-history leaves; null for a client whose wallet is the one-opening-balance model. */
export async function readHistoryMarker(
  db: Database,
  client: string,
): Promise<WalletHistoryMarker | null> {
  const r = (
    await db.execute(
      sql`SELECT counts FROM migration.run_log WHERE source_client = ${client} AND collection = '_credits' AND step = 'wallet_history'`,
    )
  ).rows[0] as { counts?: WalletHistoryMarker } | undefined;
  return r?.counts ?? null;
}

const ts = (ms: number): string => `${new Date(ms).toISOString().slice(0, -1)}000`;
const tsSql = (c: string): string =>
  `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ${c}`;
/** numeric(20,4) text -> its value x 10^4 as BigInt (both sides carry four decimals, so the texts compare exactly) */
const digits = (t: string): bigint => BigInt(t.replace('.', ''));
const lim = (s: string): string => (s.length > 90 ? `${s.slice(0, 90)}...` : s);

async function* pages(
  db: Database,
  orgId: number,
  table: string,
  cols: string,
  size = 5000,
): AsyncGenerator<Row[]> {
  let last = 0;
  for (;;) {
    const res = await withTenant(db, { orgId }, (tx) =>
      tx.execute(
        sql`SELECT ${sql.raw(cols)} FROM ${sql.raw(table)} WHERE org_id = ${orgId} AND id > ${last} ORDER BY id LIMIT ${size}`,
      ),
    );
    const rows = res.rows as Row[];
    if (rows.length === 0) return;
    yield rows;
    last = Number(rows[rows.length - 1]!.id);
  }
}

async function mapOf(
  db: Database,
  client: string,
  collection: string,
  table: string,
): Promise<Map<string, number>> {
  const r = await db.execute(sql`
    SELECT source_key, target_id FROM migration.id_map
    WHERE source_client = ${client} AND source_collection = ${collection} AND target_table = ${table}`);
  return new Map(
    (r.rows as Array<{ source_key: string; target_id: number | string }>).map((x) => [
      x.source_key,
      Number(x.target_id),
    ]),
  );
}

export async function verifyCredits(a: CreditsVerifyArgs): Promise<void> {
  const { db, orgId, client, source, settings, alarm, warnings } = a;
  const has = (c: string): boolean => source.collections(client).includes(c);
  const read = async function* (c: string): AsyncGenerator<Row> {
    if (has(c)) for await (const d of source.read(client, c)) yield d as Row;
  };
  const o = settings.opening;
  const oracle: CreditOracle = await oracleCredits(
    read('credit_logs'),
    read('whatsapp_broadcasting_data'),
    {
      wallet: settings.wallet,
      workspaceId: settings.workspaceId,
      openingMinor: o ? o.minor : null,
      unit: o ? o.currency : null,
      asOfMs: o ? new Date(o.asOf).getTime() : null,
      referenceAt: a.referenceAt,
    },
  );

  // ---- the run recorded what it was given; the file reconcile reads now must be the same one
  if (a.recorded) {
    const rec = (a.recorded.opening ?? null) as {
      amount?: string;
      currency?: string;
      asOf?: string;
      sha256?: string;
    } | null;
    if (
      (rec === null) !== (o === null) ||
      (rec &&
        o &&
        (rec.sha256 !== o.sha256 || rec.amount !== o.amountText || rec.currency !== o.currency))
    )
      alarm(
        'CREDITS_OPENING_DIFFERS: the credit-opening file reconcile reads is not the one the run loaded with (amount, currency or content differ); pass --credit-opening <the original file>',
      );
    if (a.recorded.wallet !== settings.wallet)
      warnings.push(
        `CREDITS: the run's --no-wallet switch (${String(a.recorded.wallet === false)}) differs from reconcile's`,
      );
  }

  // ---- the loader's plan against the oracle (two implementations of the same rules)
  if (a.plan) {
    const p = a.plan;
    let bad = 0;
    for (const [k, w] of oracle.wallet) {
      const e = p.wallet.get(k);
      if (w.kind === 'load') {
        if (!e || e.minor !== w.minor || e.balanceAfter !== w.balanceAfter || e.atMs !== w.atMs)
          bad++;
      } else if (e) bad++;
    }
    if (p.wallet.size !== [...oracle.wallet.values()].filter((w) => w.kind === 'load').length)
      bad++;
    const tokLoad = [...oracle.tokens.values()].filter((t) => t.kind === 'load').length;
    const useLoad = [...oracle.usage.values()].filter((t) => t.kind === 'load').length;
    if (p.stats.tokenRows !== tokLoad) bad++;
    if (p.stats.usageRows !== useLoad || p.usageFirst.size !== useLoad) bad++;
    if ((p.opening?.minor ?? 0n) !== (oracle.opening?.minor ?? 0n)) bad++;
    if (bad > 0)
      alarm(
        `PLAN_ORACLE_MISMATCH: the loader's credits plan and the independent oracle disagree on ${bad} point(s) (a posting, a balance_after, a token or usage count, the opening entry)`,
      );
  }

  // ---- wallet_transactions
  const expected = new Map<string, Row>();
  const mark = (k: string, r: Row): void => {
    expected.set(k, r);
  };
  const unit = o?.currency ?? null;
  const userMap = new Map<string, number | undefined>();
  const userOf = (raw: unknown): number | null => {
    const t = text(raw);
    if (t === '') return null;
    if (!userMap.has(t)) userMap.set(t, a.idmap.get('user', t)?.id);
    return userMap.get(t) ?? null;
  };
  const docsById = new Map<string, Row>();
  if (has('credit_logs'))
    for await (const d of source.read(client, 'credit_logs')) {
      const k = text((d as Row)._id) || text((d as Row).id);
      if (k !== '' && !docsById.has(k) && oracle.wallet.get(k)?.kind === 'load')
        docsById.set(k, d as Row);
    }
  for (const [k, w] of oracle.wallet) {
    if (w.kind !== 'load' || !unit) continue;
    const d = docsById.get(k)!;
    const desc = text(d.description).slice(0, 500) || null;
    mark(`waboo:${client}:credit_log:${k}`, {
      uuid: uuidv5(`${client}|credit_logs|${k}`),
      user_id: userOf(d.user_id),
      kind: 'credit',
      type: 'spend',
      amount: text4(-w.minor),
      balance_after: text4(w.balanceAfter),
      source: 'waboo_ai',
      description: desc,
      direction: 'out',
      note: null,
      actor_type: 'system',
      actor_label: 'waboo-migration',
      unit,
      created_at: ts(w.atMs),
      updated_at: ts(w.atMs),
      subject_type: null,
      subject_id: null,
      operator_id: null,
      request_id: null,
      row_version: 1,
    });
  }
  if (oracle.opening && unit)
    mark(`waboo:${client}:opening`, {
      uuid: uuidv5(`${client}|credit_opening|opening`),
      user_id: null,
      kind: 'credit',
      type: 'admin_adjust',
      amount: text4(oracle.opening.minor),
      balance_after: text4(oracle.opening.minor),
      source: 'waboo_migration',
      description: 'Opening balance (migrated from Waboo)',
      direction: 'in',
      actor_type: 'platform_operator',
      actor_label: 'waboo-migration',
      unit,
      created_at: ts(oracle.opening.atMs),
      updated_at: ts(oracle.opening.atMs),
      subject_type: null,
      subject_id: null,
      operator_id: null,
      request_id: null,
      row_version: 1,
    });
  const found = new Set<string>();
  let extra = 0;
  let extraFirst = '';
  // a client with a wallet history has the full statement: judged by verifyHistory below, not by the one-opening-balance model
  if (!a.history)
  for await (const rows of pages(
    db,
    orgId,
    'wallet_transactions',
    `id, uuid::text AS uuid, idempotency_key, user_id, kind, type, amount::text AS amount, balance_after::text AS balance_after, source, description, meta, direction, note, actor_type, actor_label, unit, ${tsSql('created_at')}, ${tsSql('updated_at')}, subject_type, subject_id, operator_id, request_id, row_version`,
  )) {
    for (const r of rows) {
      const key = String(r.idempotency_key);
      const want = expected.get(key);
      if (!want) {
        extra++;
        extraFirst ||= key;
        continue;
      }
      found.add(key);
      const bad: string[] = [];
      for (const [c, w] of Object.entries(want)) {
        const got = r[c];
        const same =
          typeof w === 'number'
            ? got !== null && got !== undefined && Number(got) === w
            : (got ?? null) === (w ?? null);
        if (!same) bad.push(`${c} expected=${lim(String(w))} target=${lim(String(got))}`);
      }
      // the preserved source detail
      const meta = r.meta as { legacy?: { waboo?: Row } } | null;
      if (key.includes(':credit_log:')) {
        const id = key.split(':credit_log:')[1]!;
        const w = oracle.wallet.get(id)!;
        const wb = meta?.legacy?.waboo ?? {};
        if (wb.id !== id || wb.credits_deducted !== w.exact)
          bad.push('meta.legacy.waboo (id / credits_deducted text)');
      }
      if (bad.length > 0) alarm(`CREDITS_MISMATCH: wallet_transactions ${key}: ${bad.join('; ')}`);
    }
  }
  if (!a.history)
    for (const k of expected.keys())
      if (!found.has(k)) alarm(`TARGET_MISSING: wallet_transactions row ${k} is gone`);
  if (!a.history && extra > 0 && !a.allowExtraRows)
    alarm(
      `CREDITS_EXTRA_ROWS: ${extra} wallet_transactions row(s) of the organization are not accounted for by credit_logs or the opening entry (first key ${lim(extraFirst)})`,
    );

  // the invariants of the application's hourly reconcile, recomputed in SQL
  const wal = await withTenant(db, { orgId }, async (tx) => {
    const w = (
      await tx.execute(
        sql`SELECT unit, balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = ${orgId} ORDER BY unit`,
      )
    ).rows as Array<{ unit: string; balance: string; reserved: string }>;
    const l = (
      await tx.execute(sql`
        SELECT coalesce(unit, '') AS unit, round(sum(amount), 4)::text AS sum, count(*)::int AS n, min(balance_after)::text AS min_after
        FROM wallet_transactions WHERE org_id = ${orgId} GROUP BY 1 ORDER BY 1`)
    ).rows as Array<{ unit: string; sum: string; n: number; min_after: string }>;
    const chain = (
      await tx.execute(sql`
        SELECT count(*)::int AS n FROM (
          SELECT amount, balance_after, lag(balance_after) OVER w AS prev FROM wallet_transactions WHERE org_id = ${orgId}
          WINDOW w AS (PARTITION BY coalesce(unit, '') ORDER BY created_at, coalesce(meta->'legacy'->'waboo'->>'id', '') COLLATE "C")
        ) t WHERE (prev IS NULL AND balance_after <> amount) OR (prev IS NOT NULL AND balance_after - prev <> amount)`)
    ).rows[0] as { n: number };
    return { w, l, chain: chain.n };
  });
  for (const l of wal.l) {
    const w = wal.w.find((x) => x.unit === l.unit);
    if (!w) {
      alarm(
        `WALLET_MISSING: the ${l.unit || '(platform)'} ledger has ${l.n} row(s) but no wallets row`,
      );
      continue;
    }
    if (digits(w.balance) !== digits(l.sum))
      alarm(
        `WALLET_BALANCE: wallets.balance ${w.balance} != sum of the ledger ${l.sum} (${l.unit}): the app's hourly reconcile would flag it`,
      );
    if (!a.history && digits(l.min_after) < 0n)
      alarm(
        `WALLET_NEGATIVE: a balance_after of the ${l.unit} ledger is below zero (${l.min_after})`,
      );
  }
  if (wal.chain > 0 && wal.l.length > 0)
    alarm(
      `WALLET_CHAIN: ${wal.chain} ledger row(s) whose balance_after does not follow from the row before it plus its amount`,
    );
  if (a.history) await verifyHistory(a, a.history);
  const wantWallet =
    o && settings.wallet && (o.minor > 0n || oracle.opening !== null || oracle.spendMinor > 0n)
      ? o
      : null;
  for (const w of wal.w) {
    if (!wantWallet || w.unit !== wantWallet.currency) {
      if (!a.allowExtraRows)
        alarm(`WALLET_EXTRA: a ${w.unit} wallet exists that the migration does not create`);
      continue;
    }
    if (Number(w.reserved) !== 0)
      alarm(
        `WALLET_RESERVED: the wallet holds reserved ${w.reserved}, the migration reserves nothing`,
      );
    if (!a.history && !a.allowExtraRows && w.balance !== text4(wantWallet.minor))
      alarm(
        `WALLET_ANCHOR: wallets.balance ${w.balance} is not the confirmed balance ${text4(wantWallet.minor)} (${wantWallet.confirmedBy})`,
      );
  }
  if (wantWallet && !wal.w.some((w) => w.unit === wantWallet.currency))
    alarm(
      `WALLET_MISSING: no ${wantWallet.currency} wallets row, but the confirmed balance is ${wantWallet.amountText}`,
    );

  // the rounding accounting, from the dump and the DB (exact integers)
  const postedDb = await sumSpends(db, orgId, unit);
  if (settings.wallet && o && !a.history) {
    if (postedDb !== oracle.postedSum)
      alarm(
        `CREDITS_ACCOUNTING: the ledger posted ${exactText(postedDb)} of spends but the dump says ${exactText(oracle.postedSum)} after rounding; exact total ${exactText(oracle.exactAll)} = posted ${exactText(oracle.postedSum)} + rounding residual ${exactText(oracle.roundedResidual)} + below 0.01 ${exactText(oracle.belowSum)} + over the limit ${exactText(oracle.overLimitSum)}`,
      );
    warnings.push(
      `CREDITS ROUNDING: ${oracle.roundedRows} credit row(s) had more than two fraction digits (residual ${exactText(oracle.roundedResidual)} in total, can be negative); ${oracle.belowRows} row(s) under 0.01 were not posted (${exactText(oracle.belowSum)} in total); exact total of the dump ${exactText(oracle.exactAll)}, posted ${text2(oracle.spendMinor)}. The opening entry absorbs it, so the balance is exactly the confirmed ${o.amountText}`,
    );
  }

  // ---- ai_token_usage
  const tokMap = await mapOf(db, client, 'credit_logs_tokens', 'ai_token_usage');
  const wantTok = new Map<number, Row>();
  const pendingTok: string[] = []; // load per the dump, in no id_map: not loaded yet (usage-charges-append), not damage of a loaded row
  for (const [k, t] of oracle.tokens) {
    if (t.kind !== 'load') continue;
    const id = tokMap.get(k);
    if (id === undefined) {
      pendingTok.push(k);
      continue;
    }
    wantTok.set(id, {
      provider: t.provider,
      model: t.model,
      prompt_tokens: t.prompt,
      completion_tokens: t.completion,
      total_tokens: t.total,
      billed_against: 'admin',
      created_at: ts(t.atMs),
    });
  }
  if (pendingTok.length > 0)
    alarm(
      `IDMAP_MISSING: ${pendingTok.length} credit_logs_tokens document(s) load per the dump but are in no id_map (first keys ${pendingTok.slice(0, 3).join(', ')}): not loaded yet; \`usage-charges-append\` loads them (it never touches the ledger or the wallet)`,
    );
  const seenTok = new Set<number>();
  let extraTok = 0;
  const monthsDb = new Map<string, { n: number; p: number; c: number; t: number }>();
  for await (const rows of pages(
    db,
    orgId,
    'ai_token_usage',
    `id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against, ${tsSql('created_at')}`,
  )) {
    for (const r of rows) {
      const id = Number(r.id);
      const want = wantTok.get(id);
      const m = String(r.created_at).slice(0, 7);
      const b = monthsDb.get(m) ?? { n: 0, p: 0, c: 0, t: 0 };
      b.n++;
      b.p += Number(r.prompt_tokens);
      b.c += Number(r.completion_tokens);
      b.t += Number(r.total_tokens);
      monthsDb.set(m, b);
      if (!want) {
        extraTok++;
        continue;
      }
      seenTok.add(id);
      const bad = Object.entries(want)
        .filter(([c, w]) =>
          typeof w === 'number' ? Number(r[c]) !== w : (r[c] ?? null) !== (w ?? null),
        )
        .map(([c, w]) => `${c} expected=${lim(String(w))} target=${lim(String(r[c]))}`);
      if (bad.length > 0) alarm(`CREDITS_MISMATCH: ai_token_usage ${id}: ${bad.join('; ')}`);
    }
  }
  for (const id of wantTok.keys())
    if (!seenTok.has(id)) alarm(`TARGET_MISSING: ai_token_usage row ${id} is gone`);
  if (extraTok > 0 && !a.allowExtraRows)
    alarm(
      `CREDITS_EXTRA_ROWS: ${extraTok} ai_token_usage row(s) of the organization are not in migration.id_map (a duplicate load or a row added later)`,
    );
  if (!a.allowExtraRows)
    for (const m of monthsDb.keys())
      if (!oracle.tokenMonths.has(m))
        alarm(`TOKEN_PARITY: month ${m} holds token rows the dump has none for`);
  for (const [m, w] of oracle.tokenMonths) {
    const g = monthsDb.get(m);
    if (!g || g.n !== w.n || g.p !== w.prompt || g.c !== w.completion || g.t !== w.total)
      if (!(a.allowExtraRows && g && g.n >= w.n))
        alarm(
          `TOKEN_PARITY: month ${m}: dump ${w.n} rows / ${w.prompt} + ${w.completion} / total ${w.total}; target ${g ? `${g.n} rows / ${g.p} + ${g.c} / total ${g.t}` : 'nothing'}`,
        );
  }

  // ---- usage_charges and their keys
  const useMap = await mapOf(db, client, 'whatsapp_broadcasting_data_usage', 'usage_charges');
  const pendingUse: string[] = [];
  const wantUse = new Map<
    number,
    { key: string; u: CreditOracle['usage'] extends Map<string, infer V> ? V : never }
  >();
  for (const [k, u] of oracle.usage) {
    if (u.kind !== 'load') continue;
    const id = useMap.get(k);
    if (id === undefined) {
      pendingUse.push(k);
      continue;
    }
    wantUse.set(id, { key: k, u });
  }
  if (pendingUse.length > 0) {
    const months = new Map<string, number>();
    for (const k of pendingUse) {
      const m = ts(oracle.usage.get(k)!.atMs).slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + 1);
    }
    alarm(
      `IDMAP_MISSING: ${pendingUse.length} whatsapp_broadcasting_data_usage document(s) load per the dump but are in no id_map (first keys ${pendingUse.slice(0, 3).join(', ')}; per month ${[...months].sort().map(([m, n]) => `${m}=${n}`).join(' ')}): not loaded yet; \`usage-charges-append\` loads them (it never touches the ledger or the wallet)`,
    );
  }
  const seenUse = new Set<number>();
  let extraUse = 0;
  for await (const rows of pages(
    db,
    orgId,
    'usage_charges',
    `id, provider, wamid, category, source, credits, revenue_minor, status, billing_mode, meta, wallet_tx_id, user_id, to_country, cost_minor, price_credits, shortfall_credits, free_reason, cost_micros, refunded_at, refund_tx_id, currency, ${tsSql('created_at')}`,
  )) {
    for (const r of rows) {
      const id = Number(r.id);
      const w = wantUse.get(id);
      // a row the migration wrote must be inert; a row the live application wrote after cutover is its own business
      if (
        w &&
        (r.wallet_tx_id !== null ||
          r.status === 'charged' ||
          Number(r.credits) !== 0 ||
          Number(r.revenue_minor) !== 0)
      )
        alarm(
          `CHARGE_WITH_MONEY: usage_charges ${id} carries money or a wallet link (a historical charge must never debit or credit the wallet)`,
        );
      if (!w) {
        extraUse++;
        continue;
      }
      seenUse.add(id);
      const want: Row = {
        provider: 'waba',
        wamid: w.u.wamid,
        category: w.u.category,
        source: w.u.source,
        credits: 0,
        revenue_minor: 0,
        status: 'free',
        billing_mode: 'plan',
        wallet_tx_id: null,
        user_id: null,
        to_country: null,
        cost_minor: null,
        price_credits: 0,
        shortfall_credits: 0,
        free_reason: null,
        cost_micros: null,
        refunded_at: null,
        refund_tx_id: null,
        currency: null,
        created_at: ts(w.u.atMs),
      };
      const bad = Object.entries(want)
        .filter(([c, x]) =>
          typeof x === 'number' ? Number(r[c]) !== x : (r[c] ?? null) !== (x ?? null),
        )
        .map(([c, x]) => `${c} expected=${lim(String(x))} target=${lim(String(r[c]))}`);
      let meta: { legacy?: { waboo?: Row } } = {};
      try {
        meta = JSON.parse(String(r.meta ?? '{}')) as typeof meta;
      } catch {
        bad.push('meta is not JSON');
      }
      const wb = meta.legacy?.waboo ?? {};
      for (const f of ['amount', 'reseller_amount', 'reseller_margin', 'cost'])
        if ((wb[f] ?? null) !== (w.u.amounts[f] ?? null)) bad.push(`meta.${f}`);
      if ((wb.revert ?? null) !== w.u.revert || (wb.id ?? null) !== w.u.legacyId)
        bad.push('meta.revert / meta.id');
      if (bad.length > 0)
        alarm(`CREDITS_MISMATCH: usage_charges ${id} (${w.key}): ${bad.join('; ')}`);
    }
  }
  for (const id of wantUse.keys())
    if (!seenUse.has(id)) alarm(`TARGET_MISSING: usage_charges row ${id} is gone`);
  if (extraUse > 0 && !a.allowExtraRows)
    alarm(
      `CREDITS_EXTRA_ROWS: ${extraUse} usage_charges row(s) of the organization are not in migration.id_map (a charge added after the load)`,
    );

  // the keys: one per charge, free, pointing at their charge
  const wantKeys = new Map<string, { id: number; atMs: number }>();
  for (const [id, w] of wantUse) wantKeys.set(w.u.wamid, { id, atMs: w.u.atMs });
  let extraKeys = 0;
  for await (const rows of pages(
    db,
    orgId,
    'usage_charge_keys',
    `id, provider_message_id, charge_id, ${tsSql('charge_created_at')}, status`,
  )) {
    for (const r of rows) {
      const w = wantKeys.get(String(r.provider_message_id));
      if (!w) {
        extraKeys++;
        continue;
      }
      wantKeys.delete(String(r.provider_message_id));
      if (Number(r.charge_id) !== w.id || r.charge_created_at !== ts(w.atMs) || r.status !== 'free')
        alarm(
          `CREDITS_MISMATCH: usage_charge_keys ${lim(String(r.provider_message_id))}: charge link, time or status differ from the charge`,
        );
    }
  }
  for (const k of wantKeys.keys())
    alarm(`TARGET_MISSING: usage_charge_keys row for ${lim(k)} is gone`);
  if (extraKeys > 0 && !a.allowExtraRows)
    alarm(
      `CREDITS_EXTRA_ROWS: ${extraKeys} usage_charge_keys row(s) of the organization have no migrated charge`,
    );

  // ---- nothing the live application would have written for a wallet
  if (!a.allowExtraRows)
    for (const t of ['wallet_events', 'wallet_usage_months']) {
      const n = (
        await withTenant(db, { orgId }, (tx) =>
          tx.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(t)} WHERE org_id = ${orgId}`),
        )
      ).rows[0] as { n: number };
      if (n.n > 0) alarm(`SIDE_EFFECT: ${n.n} row(s) in ${t}: the migration writes none`);
    }

  // ---- what usage-charges-append did (the catch-up of the billing log and the token rows after the first load)
  const ap = (
    await db.execute(
      sql`SELECT counts, updated_at::text AS at FROM migration.run_log WHERE source_client = ${client} AND collection = '_credits' AND step = 'usage-append'`,
    )
  ).rows[0] as { counts?: Record<string, { migrated?: number } | string>; at: string } | undefined;
  if (ap?.counts) {
    const n = (k: string): number => Number((ap.counts![k] as { migrated?: number } | undefined)?.migrated ?? 0);
    warnings.push(
      `CREDITS APPEND: usage-charges-append last ran ${ap.at.slice(0, 19)} UTC: ${n('usage_charges')} usage charge(s) and ${n('credit_tokens')} token row(s) were added after the first load (the ledger and the wallet are not part of it; the wallet follows wallet-sync)`,
    );
  }

  // ---- NOT PRESENT
  const np = a.notPresent.droppedFields;
  if (oracle.cachedTokenDocs > 0)
    np.push(
      `credit_logs.cached_input_tokens (${oracle.cachedTokenDocs} docs): ai_token_usage has no column for it; it is kept as text in wallet_transactions.meta of the posted rows only`,
    );
  if (settings.wallet && (oracle.belowRows > 0 || oracle.roundedRows > 0))
    np.push(
      `credit_logs.credits_deducted: ${oracle.roundedRows} row(s) rounded to hundredths (residual ${exactText(oracle.roundedResidual)}), ${oracle.belowRows} row(s) under 0.01 not posted (${exactText(oracle.belowSum)} in total): the exact text of every posted row is in meta.legacy.waboo.credits_deducted; the rest only in the raw archive`,
    );
  const nonBroadcast = [...oracle.usage.values()].length;
  if (nonBroadcast > 0)
    np.push(
      `whatsapp_broadcasting_data (${nonBroadcast} non-broadcast rows): credits / revenue_minor / cost are 0 on purpose (a historical charge is written as free); the billed amounts, the refund flags and the Waboo id are text in usage_charges.meta; the phone, contact, delivery status and error of those sends are not kept; to_country is NULL`,
    );
  if (has('credits_mapping_new')) {
    let docs = 0;
    let withModels = 0;
    let withEmailSms = 0;
    let withDial = 0;
    for await (const d of source.read(client, 'credits_mapping_new')) {
      docs++;
      const r = d as Row;
      if (r.models !== undefined) withModels++;
      if (r.email !== undefined || r.sms !== undefined) withEmailSms++;
      if (r.dial_code !== undefined) withDial++;
    }
    np.push(
      `credits_mapping_new (${docs} docs): not written by a client run (global tables): the operator command pricing-seed writes message_rates only. No table for: email / SMS price and margin (${withEmailSms} docs), dial codes and country names (${withDial} docs), AI model prices (${withModels} doc(s), the key fields inside are never read); proposal proposals/pricing-extras.sql`,
    );
  }
  if (has('credits_expenses'))
    np.push(
      `credits_expenses: excluded by decision (direction unknown; a purchase is inside the confirmed opening balance)`,
    );
}

async function sumSpends(db: Database, orgId: number, unit: string | null): Promise<bigint> {
  if (unit === null) return 0n;
  const r = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`
        SELECT round(coalesce(-sum(amount), 0) * 100)::text AS s FROM wallet_transactions
        WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit} AND type = 'spend' AND source = 'waboo_ai'`),
    )
  ).rows[0] as { s: string };
  return BigInt(r.s) * 10n ** 16n;
}

/**
 * The wallet history, judged on its own: the ledger is recomputed from the dump and core.json by reconcile/oracle-history.ts and every
 * wallet_transactions row of the organization is compared with it (amount, balance_after, type, time); a missing row, an extra row, a
 * wallet that is not the live balance, or a core snapshot that moved since the ledger was built are findings.
 */
async function verifyHistory(a: CreditsVerifyArgs, h: WalletHistoryMarker): Promise<void> {
  const { db, orgId, client, source, alarm, warnings } = a;
  const has = (c: string): boolean => source.collections(client).includes(c);
  const anyFile =
    source.fileOf(client, 'whatsapp_broadcasting_data') ?? source.fileOf(client, 'credit_logs');
  if (!anyFile) {
    warnings.push(
      'WALLET HISTORY: the source has no file to find core.json next to; the history was not re-checked',
    );
    return;
  }
  let core: {
    readAt?: string;
    readOn?: string;
    workspace?: { timezone?: { utc?: unknown[] } | string; credits?: { remaining_amounts?: unknown } };
    walletEvents?: Array<Record<string, unknown>>;
  };
  try {
    core = JSON.parse(readFileSync(join(dirname(anyFile), 'core.json'), 'utf8'));
  } catch {
    alarm('HISTORY_NO_CORE: the wallet was rebuilt from core.json but the file is not readable now');
    return;
  }
  const readAll = async (c: string): Promise<Array<Record<string, unknown>>> => {
    const out: Array<Record<string, unknown>> = [];
    if (has(c)) for await (const d of source.read(client, c)) out.push(d as Record<string, unknown>);
    return out;
  };
  const tzRaw = core.workspace?.timezone;
  const zones = typeof tzRaw === 'string' ? [tzRaw] : (tzRaw?.utc ?? []);
  const timezone =
    (zones.find((z) => {
      try {
        return typeof z === 'string' && !!new Intl.DateTimeFormat('en', { timeZone: z });
      } catch {
        return false;
      }
    }) as string | undefined) ?? 'UTC';
  const asOf = core.readAt ?? (core.readOn ? `${core.readOn}T23:59:59Z` : '');
  const balanceText = String(core.workspace?.credits?.remaining_amounts ?? '');
  const want = oracleHistory({
    client,
    balanceText,
    asOf,
    timezone,
    creditLogs: await readAll('credit_logs'),
    charges: await readAll('whatsapp_broadcasting_data'),
    events: core.walletEvents ?? [],
    workspaceId: a.settings.workspaceId,
  });
  const unit = h.unit;
  const rows = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`
        SELECT idempotency_key AS key, amount::text AS amount, balance_after::text AS balance_after, type,
               (extract(epoch FROM created_at) * 1000)::bigint::text AS ms
        FROM wallet_transactions WHERE org_id = ${orgId} AND coalesce(unit, '') = ${unit}`),
    )
  ).rows as Array<{ key: string; amount: string; balance_after: string; type: string; ms: string }>;
  const have = new Map(rows.map((r) => [r.key, r]));
  const bad: string[] = [];
  let missing = 0;
  let differ = 0;
  for (const w of want.rows) {
    const r = have.get(w.key);
    if (!r) {
      missing++;
      if (bad.length < 6) bad.push(`missing ${w.key}`);
      continue;
    }
    const diff: string[] = [];
    if (fourDigits(r.amount) !== w.amount) diff.push(`amount ${r.amount}`);
    if (fourDigits(r.balance_after) !== w.balanceAfter) diff.push(`balance_after ${r.balance_after}`);
    if (r.type !== w.type) diff.push(`type ${r.type}`);
    if (BigInt(r.ms) !== BigInt(w.atMs)) diff.push(`time ${r.ms}`);
    if (diff.length > 0) {
      differ++;
      if (bad.length < 6) bad.push(`${w.key}: ${diff.join('; ')}`);
    }
  }
  const wantKeys = new Set(want.rows.map((r) => r.key));
  const extra = rows.filter((r) => !wantKeys.has(r.key));
  if (missing + differ > 0)
    alarm(
      `HISTORY_MISMATCH: the wallet ledger differs from the one recomputed from the dump and core.json (${missing} missing, ${differ} different): ${bad.join(' | ')}`,
    );
  if (extra.length > 0 && !a.allowExtraRows)
    alarm(
      `HISTORY_EXTRA_ROWS: ${extra.length} wallet_transactions row(s) that the dump and core.json do not account for (first ${lim(extra[0]!.key)})`,
    );
  if (balanceText !== '' && fourDigits(balanceText) !== fourDigits(h.target))
    warnings.push(
      `WALLET HISTORY: core.json now says the live balance is ${balanceText} but the ledger was built for ${h.target}: run wallet-history again`,
    );
  const w = (
    await withTenant(db, { orgId }, (tx) =>
      tx.execute(sql`SELECT balance::text AS balance FROM wallets WHERE org_id = ${orgId} AND unit = ${unit}`),
    )
  ).rows[0] as { balance: string } | undefined;
  if ((!w || fourDigits(w.balance) !== fourDigits(h.target)) && !a.allowExtraRows)
    alarm(
      `HISTORY_BALANCE: wallets.balance ${w?.balance ?? '(none)'} is not the live Waboo balance the history ends at (${h.target})`,
    );
  warnings.push(
    `WALLET HISTORY: ${want.rows.length} ledger row(s) recomputed from the dump and core.json (opening ${text4(want.opening / 100n)} ${unit}); ${want.rows.length - missing - differ} match the database`,
  );
}
