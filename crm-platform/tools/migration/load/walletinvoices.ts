import { readInvoices } from '../invoices/zoho';
import { connect, sql, withPrivileged, withTenant } from './db';

/**
 * wallet-invoices: loads dumps/<client>/zoho_invoices.json (written by `invoices-fetch`) into `wallet_legacy_invoices`, so a migrated
 * top-up's wallet row offers Download invoice. A ledger row finds its invoice by `meta.legacy.waboo.invoice` = the provider's id.
 *
 * Writes only that table, for this organization only, in one transaction. Idempotent: an invoice already loaded with the same content
 * is left alone; a changed one is updated. Dry run by default; --apply needs --confirm-org-slug.
 */
export interface WalletInvoicesOptions {
  dumpsDir: string;
  client: string;
  orgSlug: string;
  ownerUrl: string;
  apply: boolean;
  log: (line: string) => void;
}

export async function walletInvoices(o: WalletInvoicesOptions): Promise<void> {
  const { invoices, rejected } = readInvoices(o.dumpsDir, o.client);
  o.log(
    `  invoices  ${invoices.length} invoice(s) in the file${rejected ? `; ${rejected} not fit to store (bad id, empty, too big or a NUL)` : ''}`,
  );
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
        `WALLETINVOICES_NO_ORG: no organization "${o.orgSlug}" made by this tool for ${o.client}`,
      );
    const orgId = Number(org.id);
    await withTenant(owner.db, { orgId }, async (tx) => {
      const have = new Map(
        (
          (
            await tx.execute(
              sql`SELECT invoice_id, md5(html) AS h FROM wallet_legacy_invoices WHERE org_id = ${orgId}`,
            )
          ).rows as Array<{ invoice_id: string; h: string }>
        ).map((r) => [r.invoice_id, r.h]),
      );
      const wanted = (
        (
          await tx.execute(sql`
            SELECT DISTINCT meta #>> '{legacy,waboo,invoice}' AS invoice_id FROM wallet_transactions
            WHERE org_id = ${orgId} AND meta #>> '{legacy,waboo,invoice}' IS NOT NULL`)
        ).rows as Array<{ invoice_id: string }>
      ).map((r) => r.invoice_id);
      const inFile = new Set(invoices.map((i) => i.id));
      const unmatched = wanted.filter((id) => !inFile.has(id));
      const fresh = invoices.filter((i) => !have.has(i.id));
      o.log(
        `  invoices  ${wanted.length} top-up invoice(s) named by the wallet rows; ${wanted.length - unmatched.length} are in the file, ${unmatched.length} are not${
          unmatched.length > 0
            ? ` (${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? ', ...' : ''})`
            : ''
        }`,
      );
      o.log(
        `  invoices  stored now: ${have.size}; ${o.apply ? 'adding' : 'would add'} ${fresh.length}, ${o.apply ? 'checking' : 'would check'} ${invoices.length - fresh.length} for changes`,
      );
      if (!o.apply) {
        o.log('  invoices  DRY RUN: nothing was written (add --apply --confirm-org-slug <slug>)');
        return;
      }
      for (let i = 0; i < invoices.length; i += 50) {
        const batch = invoices.slice(i, i + 50).map((x) => ({
          invoice_id: x.id,
          invoice_number: x.number,
          invoice_date: x.date,
          currency: x.currency,
          total: x.total,
          status: x.status,
          html: x.html,
        }));
        await tx.execute(sql`
          INSERT INTO wallet_legacy_invoices (org_id, invoice_id, invoice_number, invoice_date, currency, total, status, html)
          SELECT ${orgId}, x.invoice_id, x.invoice_number, x.invoice_date, x.currency, x.total, x.status, x.html
          FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
               AS x(invoice_id text, invoice_number text, invoice_date date, currency text, total numeric, status text, html text)
          ON CONFLICT (org_id, invoice_id) DO UPDATE
            SET invoice_number = EXCLUDED.invoice_number, invoice_date = EXCLUDED.invoice_date, currency = EXCLUDED.currency,
                total = EXCLUDED.total, status = EXCLUDED.status, html = EXCLUDED.html
            WHERE md5(wallet_legacy_invoices.html) <> md5(EXCLUDED.html)
               OR wallet_legacy_invoices.invoice_number IS DISTINCT FROM EXCLUDED.invoice_number
               OR wallet_legacy_invoices.status IS DISTINCT FROM EXCLUDED.status`);
      }
      const n = (
        await tx.execute(
          sql`SELECT count(*)::int AS n FROM wallet_legacy_invoices WHERE org_id = ${orgId}`,
        )
      ).rows[0] as { n: number };
      o.log(`  invoices  done: ${n.n} invoice(s) stored for ${o.orgSlug}`);
    });
  } finally {
    await owner.close();
  }
}
