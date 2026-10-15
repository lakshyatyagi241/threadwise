import type { Source } from '../extract/source';
import { minorOfScaled, mulScaled, plainDecimal, scaled } from '../credits/decimal';
import {
  assertTargetAllowed,
  connect,
  schemaReady,
  sql,
  withPrivileged,
  type GuardOptions,
} from '../load/db';
import { readManifest } from '../extract/manifest';
import { str, type Doc } from '../util';

/**
 * `pricing-seed`: credits_mapping_new -> message_rates (the WhatsApp price per country and category). An OPERATOR command, never part of
 * a client run: message_rates is a GLOBAL platform table (read by everyone, written only by a privileged session), and the Waboo
 * collection has no client key (it is a platform rate card copied into each Waboo database).
 *
 *  - DRY RUN by default: prints exactly what it would write, writes nothing.
 *  - --apply needs the owner connection (MIGRATION_DATABASE_URL), an explicit --factor (the unit of a Waboo price is unconfirmed), and
 *    a typed confirmation phrase. It NEVER overwrites: a key that already holds a different price blocks the run (--skip-conflicts
 *    writes only the keys that are not there yet), an equal one is left alone. Everything happens in one transaction and is recorded
 *    in wallet_platform_log (the platform's own trail for rate imports) and in migration.run_log.
 *  - Email / SMS prices, margins, dial codes, country names and AI model prices have no table: counted, never written
 *    (proposals/pricing-extras.sql). The models[] array holds provider keys and is never read.
 */
export const CATEGORIES = ['authentication', 'marketing', 'service', 'utility'] as const;
/** WALLET_LIMITS.maxPriceMinor of the application (hundredths). */
export const MAX_PRICE_MINOR = 100_000_000n;

export interface RateRow {
  country: string;
  category: string;
  /** hundredths of the platform currency, what message_rates.credits holds */
  credits: number;
  /** the name of the Waboo document (a country name, or "other") */
  from: string;
}
export interface Skipped {
  doc: string;
  code: string;
  reason: string;
}
export interface PricingPlan {
  rows: RateRow[];
  skipped: Skipped[];
  docs: number;
  countries: number;
  /** documents with a value that has no home, by kind */
  notPresent: { emailSms: number; dialCodes: number; marginsNotApplied: number; modelDocs: number };
  /** report-only: the currency and rate a config document claims (the unit question OQ-2) */
  config: Array<{ currency: string | null; rate: string | null }>;
}

const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** A price from a number / numeric string, or from {price} (the inner shape is not in the masked profile: {price, margin} is the guess). */
function priceOf(v: unknown): { price: string | null; hasMargin: boolean; shape: boolean } {
  if (isObj(v)) {
    const p = plainDecimal(v.price);
    return { price: p, hasMargin: v.margin !== undefined && v.margin !== null, shape: true };
  }
  const p = plainDecimal(v);
  return { price: p, hasMargin: false, shape: p !== null };
}

/**
 * withMargin: the customer price is price + margin, both absolute amounts in the document's currency. Confirmed 2026-10-12 against
 * Waboo's own charges: Singapore marketing 5.366 + 0.59 = 5.956 and utility 1.173 + 0.352 = 1.525 are exactly what a message cost.
 */
export function planPricing(docs: Doc[], factorText: string, withMargin = false): PricingPlan {
  const f = plainDecimal(factorText);
  if (f === null || f.startsWith('-') || scaled(f) === 0n)
    throw new Error('the factor must be a positive decimal such as 1 or 0.012');
  const factor = scaled(f);
  const plan: PricingPlan = {
    rows: [],
    skipped: [],
    docs: docs.length,
    countries: 0,
    notPresent: { emailSms: 0, dialCodes: 0, marginsNotApplied: 0, modelDocs: 0 },
    config: [],
  };
  const seen = new Set<string>();
  for (const d of docs) {
    const name = str(d.name) ?? '(no name)';
    if (Array.isArray(d.models)) {
      plan.notPresent.modelDocs++;
      plan.skipped.push({
        doc: name,
        code: 'MODEL_DOC_SKIPPED',
        reason: 'AI model price list (no table; its provider key fields are never read)',
      });
      continue;
    }
    if (d.conversion_rate !== undefined || d.country_currency !== undefined) {
      plan.config.push({
        currency: str(d.country_currency),
        rate: plainDecimal(d.conversion_rate),
      });
      plan.skipped.push({
        doc: name,
        code: 'CONFIG_DOC_SKIPPED',
        reason: 'platform currency / conversion config (report only: it is the unit question)',
      });
      continue;
    }
    const isOther = name.toLowerCase() === 'other';
    const code = (str(d.code) ?? '').toUpperCase();
    if (!isOther && !/^[A-Z]{2}$/.test(code)) {
      plan.skipped.push({
        doc: name,
        code: 'NO_COUNTRY_CODE',
        reason: 'no two-letter ISO code (a dial code is not unique, so none is guessed)',
      });
      continue;
    }
    const country = isOther ? '' : code;
    if (seen.has(country)) {
      plan.skipped.push({
        doc: name,
        code: 'DUPLICATE_COUNTRY',
        reason: `a second document for ${country === '' ? 'the default row' : country}: the first one wins`,
      });
      continue;
    }
    seen.add(country);
    if (isObj(d.email) || isObj(d.sms)) plan.notPresent.emailSms++;
    if (d.dial_code !== undefined) plan.notPresent.dialCodes++;
    const wa = isObj(d.whatsapp) ? d.whatsapp : null;
    if (!wa) {
      plan.skipped.push({ doc: name, code: 'NO_WHATSAPP', reason: 'no whatsapp prices' });
      continue;
    }
    plan.countries++;
    for (const cat of CATEGORIES) {
      const p = priceOf(wa[cat]);
      if (p.hasMargin && !withMargin) plan.notPresent.marginsNotApplied++;
      if (p.price === null) {
        plan.skipped.push({
          doc: `${name}/${cat}`,
          code: 'BAD_PRICE',
          reason: p.shape
            ? 'the price is not a number'
            : 'no price (the shape of the category is unknown)',
        });
        continue;
      }
      if (p.price.startsWith('-')) {
        plan.skipped.push({ doc: `${name}/${cat}`, code: 'BAD_PRICE', reason: 'negative price' });
        continue;
      }
      const marginText = withMargin && isObj(wa[cat]) ? plainDecimal((wa[cat] as Doc).margin) : null;
      const base =
        scaled(p.price) + (marginText !== null && !marginText.startsWith('-') ? scaled(marginText) : 0n);
      const credits = minorOfScaled(mulScaled(base, factor));
      if (credits > MAX_PRICE_MINOR) {
        plan.skipped.push({
          doc: `${name}/${cat}`,
          code: 'PRICE_OVER_LIMIT',
          reason: 'above the 1,000,000.00 limit',
        });
        continue;
      }
      plan.rows.push({ country, category: cat, credits: Number(credits), from: name });
    }
  }
  return plan;
}

export interface SeedOptions {
  source: Source;
  dumpsDir: string;
  client: string;
  compareWith?: string;
  /** multiplier from the Waboo price unit to the platform currency; required for --apply */
  factor?: string;
  apply: boolean;
  skipConflicts: boolean;
  /** customer price = price + margin (absolute amounts): see planPricing */
  withMargin?: boolean;
  ownerUrl?: string;
  /** the dry run may read the table with this login instead (message_rates is readable by every role) */
  readUrl?: string;
  guard?: Pick<GuardOptions, 'allowHosts' | 'allowDockerHosts' | 'confirmDbName'>;
  /** the typed confirmation: the CLI reads a line from the terminal; tests pass the phrase */
  confirm?: (phrase: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface SeedResult {
  plan: PricingPlan;
  factor: string;
  factorAssumed: boolean;
  new: RateRow[];
  same: RateRow[];
  conflicts: Array<RateRow & { existing: number }>;
  applied: number;
  dryRun: boolean;
  compare?: { onlyHere: string[]; onlyThere: string[]; differ: string[] };
}

export class PricingError extends Error {}

const key = (r: { country: string; category: string }): string =>
  `${r.country || '(default)'}|${r.category}`;

async function docsOf(source: Source, client: string): Promise<Doc[]> {
  const out: Doc[] = [];
  if (source.collections(client).includes('credits_mapping_new'))
    for await (const d of source.read(client, 'credits_mapping_new')) out.push(d);
  return out;
}

export async function pricingSeed(o: SeedOptions): Promise<SeedResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const factorAssumed = o.factor === undefined;
  const factor = o.factor ?? '1';
  const docs = await docsOf(o.source, o.client);
  if (docs.length === 0)
    throw new PricingError(`${o.client}: the dump has no credits_mapping_new documents`);
  const plan = planPricing(docs, factor, Boolean(o.withMargin));
  const res: SeedResult = {
    plan,
    factor,
    factorAssumed,
    new: [],
    same: [],
    conflicts: [],
    applied: 0,
    dryRun: !o.apply,
    compare: undefined,
  };

  if (o.compareWith) {
    if (o.apply)
      throw new PricingError(
        '--compare-with is for the dry run only: apply one client at a time, after the diff is read',
      );
    const other = planPricing(await docsOf(o.source, o.compareWith), factor, Boolean(o.withMargin));
    const mine = new Map(plan.rows.map((r) => [key(r), r.credits]));
    const theirs = new Map(other.rows.map((r) => [key(r), r.credits]));
    res.compare = {
      onlyHere: [...mine.keys()].filter((k) => !theirs.has(k)).sort(),
      onlyThere: [...theirs.keys()].filter((k) => !mine.has(k)).sort(),
      differ: [...mine.keys()].filter((k) => theirs.has(k) && theirs.get(k) !== mine.get(k)).sort(),
    };
  }

  // the table as it stands (read-only; the owner connection when given, else the worker's read access to the global table)
  const url = o.apply ? o.ownerUrl : (o.ownerUrl ?? o.readUrl);
  let existing = new Map<string, number>();
  const readExisting = async (): Promise<Map<string, number>> => {
    if (!url) return new Map();
    const c = connect(url, 'pricing-seed');
    try {
      const r = await c.db.execute(sql`SELECT country_code, category, credits FROM message_rates`);
      return new Map(
        (r.rows as Array<{ country_code: string; category: string; credits: number }>).map((x) => [
          key({ country: x.country_code, category: x.category }),
          Number(x.credits),
        ]),
      );
    } finally {
      await c.close();
    }
  };
  if (url) {
    log(assertTargetAllowed(url, o.apply ? 'owner ' : 'reader', { ...o.guard, dryRun: !o.apply }));
    existing = await readExisting();
  }
  for (const r of plan.rows) {
    const have = existing.get(key(r));
    if (have === undefined) res.new.push(r);
    else if (have === r.credits) res.same.push(r);
    else res.conflicts.push({ ...r, existing: have });
  }

  log(
    `${o.apply ? 'APPLY' : 'DRY RUN (nothing is written)'} pricing-seed for ${o.client}: message_rates`,
  );
  log(
    `  ${plan.docs} credits_mapping_new document(s): ${plan.countries} priced, ${plan.skipped.length} not used; ${plan.rows.length} rate row(s) to consider`,
  );
  log(
    `  factor ${factor}${factorAssumed ? ' (ASSUMED 1: the unit of a Waboo price is unconfirmed, pass --factor to say what 1 Waboo unit is in the platform currency)' : ''}; credits are hundredths of the platform currency`,
  );
  if (url)
    log(
      `  against the table now: ${res.new.length} new, ${res.same.length} already equal, ${res.conflicts.length} CONFLICT (a different price is there; never overwritten)`,
    );
  else
    log('  (no MIGRATION_DATABASE_URL: the table was not read, so new / conflict cannot be told)');
  for (const r of res.new.slice(0, 25))
    log(
      `    + ${r.country || '(default)'} ${r.category.padEnd(14)} ${(r.credits / 100).toFixed(2)}  [${r.from}]`,
    );
  if (res.new.length > 25) log(`    ... and ${res.new.length - 25} more`);
  for (const r of res.conflicts.slice(0, 25))
    log(
      `    ! ${r.country || '(default)'} ${r.category.padEnd(14)} table ${(r.existing / 100).toFixed(2)} vs Waboo ${(r.credits / 100).toFixed(2)}`,
    );
  const np = plan.notPresent;
  log(
    `  NOT PRESENT (no table, never written): email / SMS prices ${np.emailSms} doc(s), dial codes ${np.dialCodes}, margins ${np.marginsNotApplied} (percent or absolute amount is unknown, OQ-4b), AI model price lists ${np.modelDocs} doc(s); see proposals/pricing-extras.sql`,
  );
  for (const c of plan.config)
    log(
      `  config document: currency ${c.currency ?? '?'}, conversion rate ${c.rate ?? '?'} (report only)`,
    );
  const byCode = new Map<string, number>();
  for (const s of plan.skipped) byCode.set(s.code, (byCode.get(s.code) ?? 0) + 1);
  if (byCode.size > 0) log(`  not used: ${[...byCode].map(([c, n]) => `${c} ${n}`).join(', ')}`);
  if (res.compare)
    log(
      `  compared with ${o.compareWith}: ${res.compare.differ.length} price(s) differ, ${res.compare.onlyHere.length} only here, ${res.compare.onlyThere.length} only there${res.compare.differ.length + res.compare.onlyHere.length + res.compare.onlyThere.length === 0 ? ' (IDENTICAL: a platform-wide rate card)' : ''}`,
    );

  if (!o.apply) return res;

  // ---- apply: every refusal happens before anything is written
  if (!url)
    throw new PricingError(
      '--apply needs the owner connection: set MIGRATION_DATABASE_URL (global tables are written by a privileged session only)',
    );
  if (factorAssumed)
    throw new PricingError(
      '--apply needs an explicit --factor: the unit of a Waboo price is unconfirmed (README OQ-2); the dry run assumed 1',
    );
  if (res.conflicts.length > 0 && !o.skipConflicts)
    throw new PricingError(
      `${res.conflicts.length} key(s) already hold a different price in message_rates; nothing is overwritten. Resolve them, or pass --skip-conflicts to write only the ${res.new.length} key(s) that are not there yet`,
    );
  if (res.new.length === 0) {
    log('  nothing to write: every key is already there');
    return res;
  }
  const phrase = `SEED ${res.new.length} message_rates ${o.client}`;
  const typed = o.confirm ? await o.confirm(phrase) : '';
  if (typed.trim() !== phrase)
    throw new PricingError(
      `confirmation does not match: type exactly "${phrase}". Nothing was written`,
    );

  const c = connect(url, 'pricing-seed');
  try {
    const sha =
      readManifest(o.dumpsDir, o.client)?.collections.find(
        (x) => x.collection === 'credits_mapping_new',
      )?.sha256 ?? null;
    await withPrivileged(c.db, async (tx) => {
      const payload = JSON.stringify(
        res.new.map((r) => ({ c: r.country, k: r.category, v: r.credits })),
      );
      const ins = await tx.execute(sql`
        INSERT INTO message_rates (country_code, category, credits)
        SELECT x.c, x.k, x.v FROM jsonb_to_recordset(${payload}::jsonb) AS x(c text, k text, v integer)
        ON CONFLICT (country_code, category) DO NOTHING
        RETURNING 1 AS one`);
      if (ins.rows.length !== res.new.length)
        throw new PricingError(
          `only ${ins.rows.length} of ${res.new.length} rows were inserted (the table changed under the run): rolled back, nothing was written`,
        );
      await tx.execute(sql`
        INSERT INTO wallet_platform_log (event, severity, actor_type, actor_label, message, payload)
        VALUES ('rates.import', 'info', 'platform_operator', 'waboo-migration',
                ${`Imported ${res.new.length} WhatsApp rate row(s) from the Waboo credits_mapping_new of client ${o.client}`},
                ${JSON.stringify({ tool: 'tools/migration pricing-seed', client: o.client, rows: res.new.length, skippedConflicts: res.conflicts.length, factor, collectionSha256: sha })}::jsonb)`);
    });
    if (await schemaReady(c.db))
      await c.db.execute(sql`
        INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
        VALUES (${o.client}, '_pricing', 'seed', 'pricing-seed', ${res.new.length}, 'done',
                ${JSON.stringify({ written: res.new.length, same: res.same.length, conflicts: res.conflicts.length, factor, collectionSha256: sha })}::jsonb)
        ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, last_key = EXCLUDED.last_key, updated_at = now()`);
    res.applied = res.new.length;
  } finally {
    await c.close();
  }
  log(
    `  written: ${res.applied} row(s) to message_rates (provenance in wallet_platform_log and migration.run_log)`,
  );
  return res;
}
