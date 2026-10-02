import type { CryptoService } from '../../../common/crypto/crypto.service';

/** The slice of `pg.Client` this needs, so a test can drive it with any connection. */
export interface SecretsDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type SecretsCrypto = Pick<CryptoService, 'isCurrent' | 'reencrypt'>;

export interface ReencryptReport {
  target: string;
  scanned: number;
  /** Already sealed with the current key. */
  current: number;
  /** Moved to the current key (or, in a dry run, the number that would move). */
  rewritten: number;
  /** Could not be opened with any key in the ring, or changed while we worked: left untouched. */
  failed: string[];
}

interface Target {
  name: string;
  /** Keyset page of rows after `after` (null = from the start): `{ ref, blob }` per row. */
  page(db: SecretsDb, after: unknown[] | null, limit: number): Promise<Row[]>;
  /** Writes `next` over `previous` only if the row still holds `previous`; true when it did. */
  swap(db: SecretsDb, ref: unknown[], previous: string, next: string): Promise<boolean>;
}

interface Row {
  ref: unknown[];
  label: string;
  blob: string;
}

/**
 * Every column the auth domain keeps ciphertext in. Another domain that stores
 * its own `CryptoService` blobs (API signing secrets, channel credentials, ...)
 * passes a `Target` of the same shape in `extraTargets`.
 */
export const AUTH_SECRET_TARGETS: Target[] = [
  {
    name: 'platform_settings (secret values)',
    async page(db, after, limit) {
      const res = await db.query(
        `SELECT key, value FROM platform_settings
         WHERE is_secret AND jsonb_typeof(value) = 'string' AND ($1::text IS NULL OR key > $1)
         ORDER BY key LIMIT $2`,
        [after?.[0] ?? null, limit],
      );
      return res.rows.map((r) => ({
        ref: [r.key],
        label: String(r.key),
        blob: String(r.value),
      }));
    },
    async swap(db, ref, previous, next) {
      const res = await db.query(
        `UPDATE platform_settings SET value = $3::jsonb
         WHERE key = $1 AND is_secret AND value = $2::jsonb RETURNING 1`,
        [ref[0], JSON.stringify(previous), JSON.stringify(next)],
      );
      return res.rows.length === 1;
    },
  },
  {
    name: 'user_security.mfa_secret_enc',
    async page(db, after, limit) {
      const res = await db.query(
        `SELECT org_id, user_id, mfa_secret_enc AS blob FROM user_security
         WHERE mfa_secret_enc IS NOT NULL
           AND ($1::bigint IS NULL OR (org_id, user_id) > ($1::bigint, $2::bigint))
         ORDER BY org_id, user_id LIMIT $3`,
        [after?.[0] ?? null, after?.[1] ?? null, limit],
      );
      return res.rows.map((r) => ({
        ref: [r.org_id, r.user_id],
        label: `user ${String(r.org_id)}/${String(r.user_id)}`,
        blob: String(r.blob),
      }));
    },
    async swap(db, ref, previous, next) {
      const res = await db.query(
        `UPDATE user_security SET mfa_secret_enc = $4
         WHERE org_id = $1 AND user_id = $2 AND mfa_secret_enc = $3 RETURNING 1`,
        [ref[0], ref[1], previous, next],
      );
      return res.rows.length === 1;
    },
  },
  {
    name: 'platform_operators.mfa_secret_enc',
    async page(db, after, limit) {
      const res = await db.query(
        `SELECT id, mfa_secret_enc AS blob FROM platform_operators
         WHERE mfa_secret_enc IS NOT NULL AND ($1::bigint IS NULL OR id > $1::bigint)
         ORDER BY id LIMIT $2`,
        [after?.[0] ?? null, limit],
      );
      return res.rows.map((r) => ({
        ref: [r.id],
        label: `operator ${String(r.id)}`,
        blob: String(r.blob),
      }));
    },
    async swap(db, ref, previous, next) {
      const res = await db.query(
        `UPDATE platform_operators SET mfa_secret_enc = $3
         WHERE id = $1 AND mfa_secret_enc = $2 RETURNING 1`,
        [ref[0], previous, next],
      );
      return res.rows.length === 1;
    },
  },
];

const PAGE = 500;

/**
 * Re-seals every stored secret that is not under the current key (TW-AUTH-047).
 * Idempotent and resumable: a row already under the current key is skipped, and
 * a write only lands if the row still holds the blob that was read, so running
 * it beside live traffic cannot clobber a secret that was just changed. A blob
 * no key in the ring opens is reported by name and left alone: it is never
 * deleted, because the missing key may still be recoverable.
 *
 * Run it from a connection that is allowed past row-level security (the
 * migration role with `app.privileged` on); the command-line wrapper does that.
 */
export async function reencryptSecrets(
  db: SecretsDb,
  crypto: SecretsCrypto,
  options: { dryRun?: boolean; extraTargets?: Target[] } = {},
): Promise<ReencryptReport[]> {
  const reports: ReencryptReport[] = [];
  for (const target of [...AUTH_SECRET_TARGETS, ...(options.extraTargets ?? [])]) {
    const report: ReencryptReport = {
      target: target.name,
      scanned: 0,
      current: 0,
      rewritten: 0,
      failed: [],
    };
    let after: unknown[] | null = null;
    for (;;) {
      const rows = await target.page(db, after, PAGE);
      for (const row of rows) {
        report.scanned++;
        if (crypto.isCurrent(row.blob)) {
          report.current++;
          continue;
        }
        let next: string;
        try {
          next = crypto.reencrypt(row.blob);
        } catch {
          report.failed.push(row.label);
          continue;
        }
        if (options.dryRun) {
          report.rewritten++;
        } else if (await target.swap(db, row.ref, row.blob, next)) {
          report.rewritten++;
        } else {
          report.failed.push(`${row.label} (changed while running; run again)`);
        }
      }
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1]!.ref;
    }
    reports.push(report);
  }
  return reports;
}
