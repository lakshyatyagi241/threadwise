import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, withPrivileged, withTenant } from './db';
import { centsOf } from '../credits/decimal';
import { LEDGER_PREFIX } from './credits';

/**
 * wallet-sync: bring the WaDesk wallet to the CURRENT Waboo balance (geta_core.workspace.credits.remaining_amounts, read by
 * pilot/staging/core-opening.cjs into dumps/<client>/core.json) with ONE new, signed ledger row. The opening entry and every row posted
 * before stay exactly as they are (a posted ledger row is immutable); only a new `admin_adjust` row is appended and wallets.balance set to
 * the same value in the same transaction. Until a client goes live on WaDesk, run it again whenever the numbers must match Waboo.
 *
 * The idempotency key is waboo:<client>:wallet-sync:<snapshot time>: the same snapshot never posts twice. Nothing is written when the two
 * balances already agree (to the cent). Dry run by default; --apply needs --confirm-org-slug.
 */
export interface WalletSyncOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  targetUrl: string;
  ownerUrl: string;
  apply: boolean;
  log: (line: string) => void;
}

const SOURCE = 'waboo_migration';

interface CoreSnapshot {
  readOn?: string;
  workspace?: { id?: string; credits?: { remaining_amounts?: number; currency?: string } };
}

const cents = centsOf;
const text = (c: bigint): string => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, '0')}`;

export async function walletSync(o: WalletSyncOptions): Promise<void> {
  let core: CoreSnapshot;
  try {
    core = JSON.parse(readFileSync(join(o.dumpsDir, o.client, 'core.json'), 'utf8')) as CoreSnapshot;
  } catch (e) {
    throw new Error(`WALLETSYNC_NO_CORE: dumps/${o.client}/core.json is missing or not JSON (run core-opening.cjs, then ship): ${(e as Error).message}`);
  }
  const remaining = core.workspace?.credits?.remaining_amounts;
  const unit = String(core.workspace?.credits?.currency ?? 'inr').toUpperCase();
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0)
    throw new Error('WALLETSYNC_NO_BALANCE: core.json has no usable workspace.credits.remaining_amounts');
  if (!core.readOn) throw new Error('WALLETSYNC_NO_READON: core.json does not say when geta_core was read');
  const target = cents(remaining);
  const stamp = core.readOn.replace(/[^0-9TZ]/g, '').slice(0, 20);
  // readOn is a day: the target balance makes the key unique per snapshot AND per balance, so a second sync the same day can post
  const key = `${LEDGER_PREFIX(o.client)}wallet-sync:${stamp}:${target}`;

  const owner = connect(o.ownerUrl, 'owner');
  const worker = connect(o.targetUrl, 'worker');
  try {
    const org = (
      await withPrivileged(owner.db, (tx) =>
        tx.execute(sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org) throw new Error(`WALLETSYNC_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`);
    const orgId = Number(org.id);

    await withTenant(worker.db, { orgId }, async (tx) => {
      const w = (
        await tx.execute(
          sql`SELECT (balance * 100)::bigint::text AS cents FROM wallets WHERE org_id = ${orgId} AND unit = ${unit} FOR UPDATE`,
        )
      ).rows[0] as { cents: string } | undefined;
      if (!w) throw new Error(`WALLETSYNC_NO_WALLET: no ${unit} wallet for this organization (load the credits step first)`);
      const have = BigInt(w.cents);
      const delta = target - have;
      o.log(`  wallet  WaDesk ${text(have)} ${unit}, Waboo (geta_core, read ${core.readOn}) ${text(target)} ${unit}, difference ${text(delta)}`);
      if (delta === 0n) {
        o.log('  wallet  already equal: nothing to post');
        return;
      }
      const done = (
        await tx.execute(sql`SELECT balance_after::text AS b FROM wallet_transactions WHERE org_id = ${orgId} AND idempotency_key = ${key}`)
      ).rows[0] as { b: string } | undefined;
      if (done)
        throw new Error(
          `WALLETSYNC_KEY_USED: the snapshot ${core.readOn} was already posted (balance ${done.b}) but the wallet differs now: take a newer geta_core snapshot (core-opening.cjs), then run again`,
        );
      if (!o.apply) {
        o.log('  wallet  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
        return;
      }
      const amount = text(delta);
      const want = text(target);
      const meta = JSON.stringify({
        legacy: {
          waboo: {
            coreBalance: {
              readOn: core.readOn,
              source: 'geta_core.workspace.credits.remaining_amounts',
              workspaceId: core.workspace?.id ?? null,
              previous: text(have),
              remaining: want,
              delta: amount,
            },
          },
        },
      });
      const note = `Brings the wallet to the current Waboo balance (${want} ${unit}, read from geta_core ${core.readOn}); previous WaDesk balance ${text(have)}. The rows above are unchanged.`;
      await tx.execute(sql`
        INSERT INTO wallet_transactions (org_id, uuid, user_id, kind, type, amount, balance_after, source, description, meta, idempotency_key,
                                         direction, note, actor_type, actor_label, unit)
        VALUES (${orgId}, gen_random_uuid(), NULL, 'credit', 'admin_adjust', ${amount}::numeric, ${want}::numeric, ${SOURCE},
                'Synced to the current Waboo balance (migrated from Waboo)', ${meta}::jsonb, ${key}, ${delta > 0n ? 'in' : 'out'}, ${note},
                'platform_operator', 'waboo-migration', ${unit})`);
      await tx.execute(
        sql`UPDATE wallets SET balance = ${want}::numeric, updated_at = now(), row_version = row_version + 1 WHERE org_id = ${orgId} AND unit = ${unit}`,
      );
      o.log(`  wallet  done: posted ${amount} ${unit}, balance now ${want}`);
    });
  } finally {
    await worker.close();
    await owner.close();
  }
}
