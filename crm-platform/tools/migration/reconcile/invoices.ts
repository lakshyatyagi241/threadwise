import { createHash } from 'node:crypto';
import { readInvoices } from '../invoices/zoho';
import { sql, withTenant, type Database } from '../load/db';

/**
 * The verifier of the wallet-invoices step (`wallet_legacy_invoices`): the table holds exactly the invoices of dumps/<client>/zoho_invoices.json
 * that are fit to store, each with the HTML the provider rendered. No file (the step was skipped, or Zoho was not reachable) means the table
 * must be empty; a row the file does not have, a missing one, or different HTML is an alarm. Invoices a wallet row names but the file lacks are
 * only a warning: the provider did not have them (the step already said so).
 */
interface Args {
  db: Database;
  orgId: number;
  client: string;
  dumpsDir: string;
  alarm: (m: string) => void;
  warnings: string[];
}

export const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex');

/** What is wrong between the fetched file (`want`: id -> md5 of the HTML; null when the file is missing) and the table (`have`). Pure. */
export function invoiceAlarms(
  client: string,
  want: Map<string, string> | null,
  have: Map<string, string>,
): string[] {
  if (!want)
    return have.size > 0
      ? [
          `INVOICES_EXTRA: wallet_legacy_invoices holds ${have.size} row(s) but dumps/${client}/zoho_invoices.json is missing`,
        ]
      : [];
  const out: string[] = [];
  const extra = [...have.keys()].filter((id) => !want.has(id));
  const missing = [...want.keys()].filter((id) => !have.has(id));
  const changed = [...want]
    .filter(([id, h]) => have.has(id) && have.get(id) !== h)
    .map(([id]) => id);
  if (extra.length > 0)
    out.push(
      `INVOICES_EXTRA: ${extra.length} row(s) in wallet_legacy_invoices are not in the fetched invoices file (first ${extra[0]})`,
    );
  if (missing.length > 0)
    out.push(
      `INVOICES_MISSING: ${missing.length} fetched invoice(s) are not in wallet_legacy_invoices (first ${missing[0]}): run wallet-invoices --apply`,
    );
  if (changed.length > 0)
    out.push(
      `INVOICES_CHANGED: ${changed.length} invoice(s) in wallet_legacy_invoices differ from the fetched file (first ${changed[0]})`,
    );
  return out;
}

export async function verifyWalletInvoices(a: Args): Promise<void> {
  let want: Map<string, string> | null = null;
  try {
    want = new Map(readInvoices(a.dumpsDir, a.client).invoices.map((i) => [i.id, md5(i.html)]));
  } catch {
    want = null; // no file: the step was skipped
  }
  const rows = await withTenant(a.db, { orgId: a.orgId }, (tx) =>
    tx.execute(
      sql`SELECT invoice_id, md5(html) AS h FROM wallet_legacy_invoices WHERE org_id = ${a.orgId}`,
    ),
  );
  const have = new Map(
    (rows.rows as Array<{ invoice_id: string; h: string }>).map((r) => [r.invoice_id, r.h]),
  );
  for (const m of invoiceAlarms(a.client, want, have)) a.alarm(m);
}
