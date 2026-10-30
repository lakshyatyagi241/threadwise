import type { Source } from '../extract/source';
import {
  assertTargetAllowed,
  connect,
  schemaReady,
  sql,
  withPrivileged,
  type GuardOptions,
} from '../load/db';
import { sanitizeError, type Doc } from '../util';
import {
  planWorkspaceMargins,
  verifyWorkspaceMargins,
  type DbMarginRow,
  type MarginVerdict,
  type MetaCostRow,
  type WorkspaceMarginPlan,
  type WorkspaceMarginRow,
} from './workspace-margins';

/**
 * `pricing-workspace`: the workspace's own `credits_mapping_new` -> `workspace_message_margins` of that ONE organization. An OPERATOR
 * command (the organization must already have been created by this tool for the client). Dry run by default.
 *
 *  - --apply needs the owner connection, an explicit --factor (what 1 Waboo price unit is in the platform currency) and a typed
 *    confirmation. It never overwrites: a key that holds a different margin blocks the run (--skip-conflicts writes only the keys that
 *    are not there). One transaction; provenance in migration.run_log (`_pricing_workspace`).
 *  - --verify reads the table back and proves every row against the dump and the Meta cost the application holds now. Writes nothing.
 *  - The margins only take effect while `wallet.pricing_mode` is `margin`; in `fixed` mode every workspace is charged the one global
 *    typed price (message_rates.credits), so a per-workspace price cannot be honoured. The command says so and reads the switch.
 */
export class WorkspacePricingError extends Error {}

export interface WorkspacePricingOptions {
  source: Source;
  client: string;
  orgSlug: string;
  factor?: string;
  apply: boolean;
  verify: boolean;
  skipConflicts: boolean;
  ownerUrl: string;
  guard?: Pick<GuardOptions, 'allowHosts' | 'allowDockerHosts' | 'confirmDbName'>;
  confirm?: (phrase: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface WorkspacePricingResult {
  plan: WorkspaceMarginPlan;
  orgId: number;
  pricingMode: string | null;
  new: WorkspaceMarginRow[];
  same: WorkspaceMarginRow[];
  conflicts: Array<WorkspaceMarginRow & { existing: number }>;
  applied: number;
  verdict?: MarginVerdict;
}

const key = (r: { country: string; category: string }): string =>
  `${r.country || '(default)'}|${r.category}`;

export async function workspacePricing(
  o: WorkspacePricingOptions,
): Promise<WorkspacePricingResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const docs: Doc[] = [];
  if (o.source.collections(o.client).includes('credits_mapping_new'))
    for await (const d of o.source.read(o.client, 'credits_mapping_new')) docs.push(d);
  if (docs.length === 0)
    throw new WorkspacePricingError(`${o.client}: the dump has no credits_mapping_new documents`);
  const factorAssumed = o.factor === undefined;
  const factor = o.factor ?? '1';

  log(assertTargetAllowed(o.ownerUrl, 'owner ', { ...o.guard, dryRun: !o.apply }));
  const c = connect(o.ownerUrl, 'pricing-workspace');
  try {
    const org = (
      await withPrivileged(c.db, (tx) =>
        tx.execute(
          sql`SELECT id FROM organizations WHERE slug = ${o.orgSlug} AND settings #>> '{legacy,waboo,client}' = ${o.client}`,
        ),
      )
    ).rows[0] as { id: number | string } | undefined;
    if (!org)
      throw new WorkspacePricingError(
        `PRICING_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`,
      );
    const orgId = Number(org.id);

    const { costs, stored } = await withPrivileged(c.db, async (tx) => {
      const cr = await tx.execute(
        sql`SELECT country_code, category, meta_cost_micros::text AS micros, meta_cost_minor::text AS minor FROM message_rates WHERE is_active`,
      );
      const costs = (
        cr.rows as Array<{
          country_code: string;
          category: string;
          micros: string | null;
          minor: string | null;
        }>
      ).map<MetaCostRow>((r) => ({
        country: r.country_code,
        category: r.category,
        micros:
          r.micros !== null ? Number(r.micros) : r.minor !== null ? Number(r.minor) * 10_000 : null,
      }));
      const sr = await tx.execute(
        sql`SELECT country_code, category, margin_bps FROM workspace_message_margins WHERE org_id = ${orgId}`,
      );
      const stored = (
        sr.rows as Array<{ country_code: string; category: string; margin_bps: number }>
      ).map<DbMarginRow>((r) => ({
        country: r.country_code,
        category: r.category,
        marginBps: r.margin_bps,
      }));
      return { costs, stored };
    });

    // the switch and the workspace's billing currency: read on their own, so a failure here cannot abort the reads above
    let mode: string | null = null;
    let orgCurrency = '';
    try {
      const r = await withPrivileged(c.db, async (tx) => ({
        mode: (
          (
            await tx.execute(
              sql`SELECT value #>> '{}' AS v FROM platform_settings WHERE key = 'wallet.pricing_mode'`,
            )
          ).rows as Array<{ v: string | null }>
        )[0]?.v,
        cur: (
          (
            await tx.execute(
              sql`SELECT upper(settings->>'currency') AS cur FROM organizations WHERE id = ${orgId}`,
            )
          ).rows as Array<{ cur: string | null }>
        )[0]?.cur,
      }));
      mode = r.mode ?? null;
      orgCurrency = r.cur ?? '';
    } catch (e) {
      log(
        `  WARNING: could not read wallet.pricing_mode / the organization currency (${sanitizeError(e)})`,
      );
    }

    const plan = planWorkspaceMargins(docs, costs, factor);
    const res: WorkspacePricingResult = {
      plan,
      orgId,
      pricingMode: mode,
      new: [],
      same: [],
      conflicts: [],
      applied: 0,
    };
    const have = new Map(stored.map((r) => [key(r), r.marginBps]));
    for (const r of plan.rows) {
      const h = have.get(key(r));
      if (h === undefined) res.new.push(r);
      else if (h === r.marginBps) res.same.push(r);
      else res.conflicts.push({ ...r, existing: h });
    }

    log(
      `${o.apply ? 'APPLY' : o.verify ? 'VERIFY (reads only)' : 'DRY RUN (nothing is written)'} pricing-workspace for ${o.client} -> organization ${orgId}`,
    );
    log(
      `  ${plan.docs} credits_mapping_new document(s): ${plan.rows.length} price(s) can be reproduced exactly, ${plan.issues.length} issue(s)`,
    );
    log(
      `  factor ${factor}${factorAssumed ? ' (ASSUMED 1: pass --factor to say what 1 Waboo unit is in the platform currency)' : ''}`,
    );
    log(
      `  against the table now: ${res.new.length} new, ${res.same.length} already equal, ${res.conflicts.length} CONFLICT (never overwritten)`,
    );
    if (orgCurrency)
      log(
        `  WARNING: the organization bills in ${orgCurrency}. The Meta costs used here are the platform-currency message_rates; the application prices a workspace in another currency from that currency's Meta card, so the margins below are only proven for the platform currency`,
      );
    if (mode === 'fixed')
      log(
        `  WARNING: wallet.pricing_mode is "fixed": these margins take effect only in "margin" mode; until then every workspace pays the global typed price`,
      );
    for (const r of res.new.slice(0, 20))
      log(
        `    + ${r.country || '(default)'} ${r.category.padEnd(14)} waboo ${r.price}+${r.margin} = ${(r.chargeMinor / 100).toFixed(2)} -> ${r.marginBps} bps`,
      );
    if (res.new.length > 20) log(`    ... and ${res.new.length - 20} more`);
    for (const r of res.conflicts.slice(0, 20))
      log(
        `    ! ${r.country || '(default)'} ${r.category.padEnd(14)} table ${r.existing} bps vs Waboo ${r.marginBps} bps`,
      );
    const byCode = new Map<string, number>();
    for (const i of plan.issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
    if (byCode.size > 0)
      log(`  not written: ${[...byCode].map(([k, n]) => `${k} ${n}`).join(', ')}`);

    if (o.verify) {
      res.verdict = verifyWorkspaceMargins(plan, stored, costs);
      const v = res.verdict;
      log(
        `  read-back: ${v.ok ? 'OK, every price matches Waboo' : `MISMATCH missing ${v.missing.length}, extra ${v.extra.length}, wrong margin ${v.wrongMargin.length}, wrong charge ${v.wrongCharge.length}`}`,
      );
      for (const l of [...v.missing, ...v.extra, ...v.wrongMargin, ...v.wrongCharge].slice(0, 20))
        log(`    ${l}`);
    }
    if (res.verdict && !res.verdict.ok)
      throw new WorkspacePricingError(
        '--verify: the table does not match Waboo (see the lines above)',
      );
    if (!o.apply) return res;

    if (factorAssumed)
      throw new WorkspacePricingError(
        '--apply needs an explicit --factor (the unit of a Waboo price is unconfirmed)',
      );
    if (plan.issues.some((i) => i.code === 'NO_META_COST' || i.code === 'NOT_REPRESENTABLE'))
      log(
        '  NOTE: some keys have no exact margin (listed above); they stay on the plan / platform layer and are NOT Waboo-exact',
      );
    if (res.conflicts.length > 0 && !o.skipConflicts)
      throw new WorkspacePricingError(
        `${res.conflicts.length} key(s) already hold a different margin; nothing is overwritten. Resolve them, or pass --skip-conflicts`,
      );
    if (res.new.length === 0) {
      log('  nothing to write: every key is already there');
      return res;
    }
    const phrase = `SEED ${res.new.length} workspace_message_margins ${o.client}`;
    const typed = o.confirm ? await o.confirm(phrase) : '';
    if (typed.trim() !== phrase)
      throw new WorkspacePricingError(
        `confirmation does not match: type exactly "${phrase}". Nothing was written`,
      );

    await withPrivileged(c.db, async (tx) => {
      const payload = JSON.stringify(
        res.new.map((r) => ({
          c: r.country,
          k: r.category,
          b: r.marginBps,
          n: `Waboo price ${r.price} + margin ${r.margin} = ${(r.chargeMinor / 100).toFixed(2)} per message (migrated)`,
        })),
      );
      const ins = await tx.execute(sql`
        INSERT INTO workspace_message_margins (org_id, country_code, category, margin_bps, note, set_by)
        SELECT ${orgId}, x.c, x.k, x.b, x.n, 'waboo-migration'
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(c text, k text, b integer, n text)
        ON CONFLICT (org_id, country_code, category) DO NOTHING
        RETURNING 1 AS one`);
      if (ins.rows.length !== res.new.length)
        throw new WorkspacePricingError(
          `only ${ins.rows.length} of ${res.new.length} rows were inserted (the table changed under the run): rolled back`,
        );
      if (await schemaReady(c.db))
        await tx.execute(sql`
          INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
          VALUES (${o.client}, '_pricing_workspace', 'seed', 'pricing-workspace', ${res.new.length}, 'done',
                  ${JSON.stringify({ written: res.new.length, same: res.same.length, conflicts: res.conflicts.length, factor, issues: plan.issues.length })}::jsonb)
          ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, last_key = EXCLUDED.last_key, updated_at = now()`);
    });
    res.applied = res.new.length;

    // read back what is really in the table and prove it
    const after = await withPrivileged(c.db, async (tx) =>
      (
        (
          await tx.execute(
            sql`SELECT country_code, category, margin_bps FROM workspace_message_margins WHERE org_id = ${orgId}`,
          )
        ).rows as Array<{ country_code: string; category: string; margin_bps: number }>
      ).map<DbMarginRow>((r) => ({
        country: r.country_code,
        category: r.category,
        marginBps: r.margin_bps,
      })),
    );
    // only the keys this run wrote (or found equal): a skipped conflict, or an override outside the plan, is not this run's to judge
    const mine = { ...plan, rows: [...res.new, ...res.same] };
    const own = new Set(mine.rows.map(key));
    res.verdict = verifyWorkspaceMargins(
      mine,
      after.filter((r) => own.has(key(r))),
      costs,
    );
    log(`  written: ${res.applied} row(s); read-back ${res.verdict.ok ? 'OK' : 'MISMATCH'}`);
    if (!res.verdict.ok)
      throw new WorkspacePricingError('read-back does not match Waboo: see the lines above');
    return res;
  } finally {
    await c.close();
  }
}
