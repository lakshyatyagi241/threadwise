import type { CryptoService } from './crypto.service';
import { tokenHash } from './secret-columns';

/** The slice of `pg.Client` this needs, so a test can drive it with any connection. */
export interface SealDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * A column that held a secret in plaintext (encryption audit E2, E3, E7, E8) and what to fill from it.
 *  - `inPlace`: the value is sealed in its own column (reads accept both forms).
 *  - otherwise `hash` (and `enc` where the value must be shown again) are filled from the legacy `plain` column, and `--scrub` then
 *    blanks (NULLs) the legacy column. Table and column names are constants of this file, never input.
 */
export interface SealTarget {
  name: string;
  table: string;
  /** Primary-key columns, in order. */
  pk: string[];
  plain: string;
  inPlace?: boolean;
  hash?: string;
  enc?: string;
  /** Rows whose plaintext is shorter are left alone (not routable, and not covered by the hash unique index). */
  minLength?: number;
}

export const SEAL_TARGETS: SealTarget[] = [
  {
    name: 'push_subscriptions.auth',
    table: 'push_subscriptions',
    pk: ['org_id', 'id'],
    plain: 'auth',
    inPlace: true,
  },
  // E3: routing tokens in the public webhook URLs (the provider holds the URL, so the value must stay readable: hash + sealed copy)
  ...['telegram_bots', 'line_channels', 'viber_channels', 'wechat_channels'].map(
    (table): SealTarget => ({
      name: `${table}.webhook_token`,
      table,
      pk: ['org_id', 'id'],
      plain: 'webhook_token',
      hash: 'webhook_token_hash',
      enc: 'webhook_token_enc',
    }),
  ),
  // E8: bearer links. The return URL is built when the order is created, so it needs no sealed copy; the tracking link is shown again.
  {
    name: 'orders.return_token',
    table: 'orders',
    pk: ['org_id', 'id'],
    plain: 'return_token',
    hash: 'return_token_hash',
  },
  {
    name: 'wa_orders.recovery_token',
    table: 'wa_orders',
    pk: ['org_id', 'id'],
    plain: 'recovery_token',
    hash: 'recovery_token_hash',
    enc: 'recovery_token_enc',
  },
  // E2: the Shopify / WooCommerce webhook URL secret (also the WooCommerce plugin's HMAC key): hash for the lookup, sealed copy to use
  ...['shopify_integrations', 'woocommerce_integrations'].map((table): SealTarget => ({
    name: `${table}.webhook_secret`,
    table,
    pk: ['org_id', 'id'],
    plain: 'webhook_secret',
    hash: 'webhook_secret_hash',
    enc: 'webhook_secret_enc',
    minLength: 16,
  })),
];

export interface SealReport {
  target: string;
  /** Rows still holding a plaintext value when the run started (or, with `scrub`, rows blanked). */
  found: number;
  /** Rows written (a dry run writes none). */
  done: number;
  /** Rows changed by someone else while we worked: left alone, run again. */
  skipped: number;
}

const PAGE = 500;
const q = (id: string): string => `"${id}"`;

const long = (t: SealTarget): string =>
  t.minLength ? ` AND length(${q(t.plain)}) >= ${t.minLength}` : '';

/** What still needs doing, as a WHERE clause. Sealed blobs start with `v1:`; an empty legacy column means "already scrubbed". */
function pending(t: SealTarget): string {
  if (t.inPlace)
    return `${q(t.plain)} IS NOT NULL AND ${q(t.plain)} <> '' AND ${q(t.plain)} NOT LIKE 'v_:%'`;
  // A trigger may have filled the hash already (a row from the previous release), so a missing sealed copy counts as pending too.
  const missing = t.enc
    ? `(${q(t.hash!)} IS NULL OR ${q(t.enc)} IS NULL)`
    : `${q(t.hash!)} IS NULL`;
  return `${missing} AND ${q(t.plain)} IS NOT NULL AND ${q(t.plain)} <> ''${long(t)}`;
}

/**
 * Seals or hashes every plaintext secret the audit found. Idempotent and resumable: a finished row no longer matches, a row changed
 * while we read it is skipped (the UPDATE is guarded by the value we read). Run it AFTER the release that reads both forms is the
 * only one live; run with `scrub` after setting SECRETS_LEGACY_PLAINTEXT_MIRROR=off.
 */
export async function sealPlaintextSecrets(
  db: SealDb,
  crypto: Pick<CryptoService, 'encrypt'>,
  opts: { dryRun?: boolean; scrub?: boolean; targets?: SealTarget[] } = {},
): Promise<SealReport[]> {
  const reports: SealReport[] = [];
  for (const t of opts.targets ?? SEAL_TARGETS) {
    const report: SealReport = { target: t.name, found: 0, done: 0, skipped: 0 };
    reports.push(report);
    const pk = t.pk.map(q).join(', ');

    if (opts.scrub) {
      if (t.inPlace) continue; // nothing to blank: the column holds the sealed value
      const where = `${q(t.hash!)} IS NOT NULL ${t.enc ? `AND ${q(t.enc)} IS NOT NULL` : ''} AND ${q(t.plain)} IS NOT NULL AND ${q(t.plain)} <> ''${long(t)}`;
      if (opts.dryRun) {
        const c = await db.query(`SELECT count(*)::int AS n FROM ${q(t.table)} WHERE ${where}`);
        report.found = Number(c.rows[0]?.n ?? 0);
      } else {
        const r = await db.query(
          `UPDATE ${q(t.table)} SET ${q(t.plain)} = NULL WHERE ${where} RETURNING 1`,
        );
        report.found = report.done = r.rows.length;
      }
      continue;
    }

    if (opts.dryRun) {
      const c = await db.query(`SELECT count(*)::int AS n FROM ${q(t.table)} WHERE ${pending(t)}`);
      report.found = Number(c.rows[0]?.n ?? 0);
      continue;
    }
    const seen = new Set<string>();
    for (;;) {
      const page = await db.query(
        `SELECT ${pk}, ${q(t.plain)} AS value FROM ${q(t.table)} WHERE ${pending(t)} ORDER BY ${pk} LIMIT ${PAGE}`,
      );
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        const id = t.pk.map((c) => String(row[c])).join('/');
        if (!seen.has(id)) {
          seen.add(id);
          report.found++;
        }
      }
      let progressed = 0;
      for (const row of page.rows) {
        const value = String(row.value);
        const keys = t.pk.map((c) => row[c]);
        const where = t.pk.map((c, i) => `${q(c)} = $${i + 1}`).join(' AND ');
        const guard = `${q(t.plain)} = $${t.pk.length + 1}`;
        const res = t.inPlace
          ? await db.query(
              `UPDATE ${q(t.table)} SET ${q(t.plain)} = $${t.pk.length + 2} WHERE ${where} AND ${guard} RETURNING 1`,
              [...keys, value, crypto.encrypt(value)],
            )
          : await db.query(
              `UPDATE ${q(t.table)} SET ${q(t.hash!)} = $${t.pk.length + 2}${t.enc ? `, ${q(t.enc)} = $${t.pk.length + 3}` : ''} WHERE ${where} AND ${guard} RETURNING 1`,
              [...keys, value, tokenHash(value), ...(t.enc ? [crypto.encrypt(value)] : [])],
            );
        if (res.rows.length === 1) {
          report.done++;
          progressed++;
        } else report.skipped++;
      }
      if (progressed === 0) break; // every row of the page changed under us: stop rather than spin
    }
  }
  return reports;
}
