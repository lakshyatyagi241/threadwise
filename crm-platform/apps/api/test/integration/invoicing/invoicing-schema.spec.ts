import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Invoices, the payment ledger and the numbering allocator against a real Postgres, as the restricted application role (a
 * superuser bypasses every policy and would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the
 * owner connection: owners skip RLS but never CHECK, UNIQUE, FK or triggers.
 */
describe('invoicing: schema, constraints, ledger invariants and numbering', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let contactA: number;
  let contactB: number;

  const conn = (user: string, password: string) =>
    new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user,
      password,
    });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ia','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ib','B','starter') RETURNING id`,
    );
    await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@i.test','A','x') RETURNING id`,
      [orgA],
    );
    contactA = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CA') RETURNING id`, [
      orgA,
    ]);
    contactB = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CB') RETURNING id`, [
      orgB,
    ]);
    app = conn('crm_app_user', 'test');
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  // --- helpers --------------------------------------------------------------------------------------------------------------

  async function asOrg<T>(orgId: number, fn: () => Promise<T>, client: Client = app): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      const out = await fn();
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  const rejects = (sql: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(sql, params)).rejects.toThrow(pattern);

  let seqCounter = 0;
  /** A draft: no number, no link. Totals default to 100.00 USD (subtotal 100.00, total 100.00). */
  async function draft(org: number, over: Record<string, unknown> = {}): Promise<number> {
    const v = {
      subtotal: 10000,
      discount: 0,
      tax: 0,
      taxAdded: 0,
      shipping: 0,
      total: 10000,
      currency: 'USD',
      ...over,
    };
    return Number(
      (
        await owner.query(
          `INSERT INTO invoices (org_id, source, doc_type, currency, currency_exponent, subtotal_minor, discount_minor, tax_minor, tax_added_minor, shipping_minor, total_minor, buyer_name, contact_id, due_date)
           VALUES ($1,'manual','tax_invoice',$2,2,$3,$4,$5,$6,$7,$8,'Buyer',$9,$10) RETURNING id`,
          [
            org,
            v.currency,
            v.subtotal,
            v.discount,
            v.tax,
            v.taxAdded,
            v.shipping,
            v.total,
            (over.contactId as number) ?? null,
            (over.dueDate as string) ?? null,
          ],
        )
      ).rows[0].id,
    );
  }
  /** Draft -> issued with a hand-made number (the allocator has its own tests below). */
  async function issue(org: number, id: number): Promise<void> {
    const n = ++seqCounter;
    await owner.query(
      `UPDATE invoices SET status = 'issued', series = 'T', seq = $3, invoice_number = $4, issued_at = now(), issue_date = current_date,
              public_token_hash = $5, due_date = coalesce(due_date, current_date)
        WHERE org_id = $1 AND id = $2`,
      [org, id, n, `T-${org}-${n}`, `hash-${org}-${id}-${n}`],
    );
  }
  async function pay(
    org: number,
    invoiceId: number | null,
    amount: number,
    over: Record<string, unknown> = {},
  ): Promise<number> {
    return Number(
      (
        await owner.query(
          `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, method, source, refund_of_id, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,'manual',$7, coalesce($8::timestamptz, now())) RETURNING id`,
          [
            org,
            invoiceId,
            over.kind ?? 'payment',
            amount,
            over.currency ?? 'USD',
            over.method ?? 'bank',
            over.refundOf ?? null,
            over.paidAt ?? null,
          ],
        )
      ).rows[0].id,
    );
  }
  const inv = async (id: number) =>
    (
      await owner.query(
        `SELECT status, payment_status, paid_minor::int, refunded_minor::int, paid_at, total_minor::int FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0];

  // --- tenancy --------------------------------------------------------------------------------------------------------------

  describe('row-level security (CONTRIBUTING rules 1 and 2)', () => {
    const TABLES = [
      'tax_rates',
      'invoices',
      'invoice_items',
      'invoice_tax_summary',
      'invoice_number_sequences',
      'invoice_settings',
      'payments',
      'invoice_gateway_connections',
      'invoice_payment_attempts',
      'invoice_gateway_events',
      'credit_notes',
      'credit_note_items',
      'recurring_invoices',
      'recurring_invoice_runs',
      'sales_orders',
      'sales_order_items',
    ];

    it('every new or reshaped table has RLS enabled AND forced, with a tenant policy carrying both USING and WITH CHECK', async () => {
      const res = await owner.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.qual, p.with_check
           FROM pg_class c JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = 'tenant_isolation'
          WHERE c.relname = ANY($1) AND c.relkind = 'r'`,
        [TABLES],
      );
      expect(res.rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
      for (const r of res.rows) {
        expect(r.relrowsecurity, r.relname).toBe(true);
        expect(r.relforcerowsecurity, r.relname).toBe(true);
        expect(r.qual, r.relname).toContain('current_org_id()');
        expect(r.with_check, r.relname).toContain('current_org_id()');
      }
    });

    it('a workspace sees only its own invoices, payments and tax rates, even when the other id is known exactly', async () => {
      const a = await draft(orgA);
      const b = await draft(orgB);
      await owner.query(
        `INSERT INTO tax_rates (org_id, name, rate_percent) VALUES ($1,'A-VAT',10), ($2,'B-VAT',20)`,
        [orgA, orgB],
      );
      const seen = await asOrg(orgA, async () => ({
        invoices: (await app.query(`SELECT id FROM invoices`)).rows.map((r) => Number(r.id)),
        rates: (await app.query(`SELECT name FROM tax_rates`)).rows.map((r) => r.name),
        byId: (await app.query(`SELECT 1 FROM invoices WHERE org_id = $1 AND id = $2`, [orgB, b]))
          .rows.length,
      }));
      expect(seen.invoices).toContain(a);
      expect(seen.invoices).not.toContain(b);
      expect(seen.rates).toEqual(['A-VAT']);
      expect(seen.byId).toBe(0);
    });

    it('with no tenant set nothing is visible, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM invoices`)).rows).toHaveLength(0);
        expect((await app.query(`SELECT 1 FROM payments`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO tax_rates (org_id, name, rate_percent) VALUES ($1,'smuggled',1)`, [
            orgB,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO invoices (org_id, source, currency) VALUES ($1,'manual','USD')`, [
            orgB,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('foreign keys are composite', () => {
    it('an invoice cannot link a contact, a company or a deal of another workspace, nor an owner who belongs elsewhere', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, contact_id) VALUES ($1,'manual','USD',$2)`,
        [orgA, contactB],
        /fk_invoices_contact_id/,
      );
      const userB = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@i.test','B','x') RETURNING id`,
            [orgB],
          )
        ).rows[0].id,
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, owner_id) VALUES ($1,'manual','USD',$2)`,
        [orgA, userB],
        /fk_invoices_owner_id/,
      );
    });

    it('a payment cannot name an invoice of another workspace', async () => {
      const b = await draft(orgB);
      await issue(orgB, b);
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,100,'USD')`,
        [orgA, b],
        /unknown invoice|fk_payments_invoice_id/,
      );
    });

    it('deleting a linked contact keeps the invoice and clears only the link', async () => {
      const c = Number(
        (
          await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'gone') RETURNING id`, [
            orgA,
          ])
        ).rows[0].id,
      );
      const id = await draft(orgA, { contactId: c });
      await owner.query(`DELETE FROM contacts WHERE id = $1`, [c]);
      const r = await owner.query(`SELECT contact_id FROM invoices WHERE id = $1`, [id]);
      expect(r.rows[0].contact_id).toBeNull();
    });
  });

  // --- constraints ----------------------------------------------------------------------------------------------------------

  describe('invoice constraints (D-01, D-04, D-06)', () => {
    it('WD-INV-007 D-06: the database refuses a row whose totals do not add up (WaDesk stored whatever the mapper computed)', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, subtotal_minor, total_minor) VALUES ($1,'manual','USD',10000,9999)`,
        [orgA],
        /chk_invoices_totals/,
      );
      // 100.00 - 10.00 + 9.00 tax + 5.00 shipping = 104.00
      const ok = await draft(orgA, {
        subtotal: 10000,
        discount: 1000,
        tax: 900,
        taxAdded: 900,
        shipping: 500,
        total: 10400,
      });
      expect(ok).toBeGreaterThan(0);
      // inclusive tax is inside the price: it is not added again
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, subtotal_minor, tax_minor, tax_added_minor, total_minor) VALUES ($1,'manual','USD',11800,1800,0,13600)`,
        [orgA],
        /chk_invoices_totals/,
      );
    });

    it('a discount cannot exceed the subtotal, and no amount is negative', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, subtotal_minor, discount_minor, total_minor) VALUES ($1,'manual','USD',100,200,-100)`,
        [orgA],
        /chk_invoices_totals|chk_invoices_credited|chk_invoices_amounts/,
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, shipping_minor, total_minor) VALUES ($1,'manual','USD',-5,-5)`,
        [orgA],
        /chk_invoices_totals|chk_invoices_credited|chk_invoices_amounts/,
      );
    });

    it('currency is three upper-case letters and its exponent is 0 to 3 (KWD has three, JPY none)', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency) VALUES ($1,'manual','usd')`,
        [orgA],
        /chk_invoices_currency/,
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, currency_exponent) VALUES ($1,'manual','KWD',4)`,
        [orgA],
        /chk_invoices_currency/,
      );
      await owner.query(
        `INSERT INTO invoices (org_id, source, currency, currency_exponent) VALUES ($1,'manual','KWD',3)`,
        [orgA],
      );
    });

    it('D-01: the stored status is draft / issued / void and the payment status one of three; anything else is refused', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, status) VALUES ($1,'manual','USD','overdue')`,
        [orgA],
        /chk_invoices_status|chk_invoices_stamps/,
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, payment_status) VALUES ($1,'manual','USD','late')`,
        [orgA],
        /chk_invoices_payment_status|chk_invoices_paid/,
      );
    });

    it('a draft has no number and no link; an issued invoice has both (stamps agree with the status)', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, status, invoice_number, series, seq) VALUES ($1,'manual','USD','draft','X-1','X',1)`,
        [orgA],
        /chk_invoices_stamps/,
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, status) VALUES ($1,'manual','USD','issued')`,
        [orgA],
        /chk_invoices_stamps/,
      );
    });

    it('the ledger cache must agree with the payment status (unpaid means 0 received, paid means at least the total)', async () => {
      const id = await draft(orgA);
      await rejects(
        `UPDATE invoices SET paid_minor = 500 WHERE id = $1`,
        [id],
        /chk_invoices_paid/,
      );
      await issue(orgA, id);
      await rejects(
        `UPDATE invoices SET payment_status = 'paid' WHERE id = $1`,
        [id],
        /chk_invoices_paid/,
      );
      await rejects(
        `UPDATE invoices SET payment_status = 'partially_paid', paid_minor = 10000 WHERE id = $1`,
        [id],
        /chk_invoices_paid/,
      );
    });

    it('a due date before the issue date is refused', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, issue_date, due_date) VALUES ($1,'manual','USD','2026-10-10','2026-10-01')`,
        [orgA],
        /chk_invoices_due/,
      );
    });

    it('reverse charge means no tax on the document', async () => {
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, reverse_charge, tax_minor, tax_added_minor, total_minor, subtotal_minor) VALUES ($1,'manual','USD',true,100,100,1100,1000)`,
        [orgA],
        /chk_invoices_reverse_charge/,
      );
    });

    it('WD-INV-007 D-05: an order or a quote becomes at most one invoice of each type', async () => {
      await owner
        .query(
          `INSERT INTO invoices (org_id, source, currency, wa_order_id, doc_type) VALUES ($1,'order','USD',null,'receipt')`,
          [orgA],
        )
        .catch(() => undefined);
      const q = Number(
        (
          await owner.query(
            `INSERT INTO sales_docs (org_id, doc_type, number, seq, currency) VALUES ($1,'estimate','EST-9',9,'USD') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO invoices (org_id, source, currency, quote_id) VALUES ($1,'quote','USD',$2)`,
        [orgA, q],
      );
      await rejects(
        `INSERT INTO invoices (org_id, source, currency, quote_id) VALUES ($1,'quote','USD',$2)`,
        [orgA, q],
        /uq_invoices_quote/,
      );
    });
  });

  describe('invoice lines and tax rates', () => {
    it('line amounts must add up: total = gross - discounts, plus the tax when it is exclusive', async () => {
      const id = await draft(orgA);
      const line = (over: Record<string, unknown>) =>
        owner.query(
          `INSERT INTO invoice_items (org_id, invoice_id, sort, description, qty, unit_price_minor, line_subtotal_minor, line_discount_minor, doc_discount_share_minor, tax_amount_minor, tax_inclusive, line_total_minor, currency)
           VALUES ($1,$2,$3,'x',1,10000,10000,$4,$5,$6,$7,$8,'USD')`,
          [
            orgA,
            id,
            over.sort ?? 0,
            over.disc ?? 0,
            over.share ?? 0,
            over.tax ?? 0,
            over.incl ?? false,
            over.total,
          ],
        );
      await line({ sort: 0, tax: 1800, total: 11800 });
      await line({ sort: 1, tax: 1800, incl: true, total: 10000 });
      await expect(line({ sort: 2, tax: 1800, total: 10000 })).rejects.toThrow(
        /chk_invoice_items_money/,
      );
      await expect(line({ sort: 3, disc: 20000, total: 0 })).rejects.toThrow(
        /chk_invoice_items_money/,
      );
      await expect(line({ sort: 0, total: 10000 })).rejects.toThrow(/uq_invoice_items_sort/);
    });

    it('quantity must be above zero, a tax rate is 0 to 100%, an HSN/SAC code is alphanumeric', async () => {
      const id = await draft(orgA);
      await rejects(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty) VALUES ($1,$2,'x',0)`,
        [orgA, id],
        /chk_invoice_items_qty/,
      );
      await rejects(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty, tax_rate_percent) VALUES ($1,$2,'x',1,100.01)`,
        [orgA, id],
        /chk_invoice_items_percent/,
      );
      await rejects(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty, hsn_sac) VALUES ($1,$2,'x',1,'99 99!')`,
        [orgA, id],
        /chk_invoice_items_hsn/,
      );
    });

    it('a tax rate name is unique per workspace ignoring case, only one rate is the default, and a default must be active', async () => {
      await owner.query(
        `INSERT INTO tax_rates (org_id, name, rate_percent, is_default) VALUES ($1,'VAT 20',20,true)`,
        [orgA],
      );
      await rejects(
        `INSERT INTO tax_rates (org_id, name, rate_percent) VALUES ($1,'vat 20',20)`,
        [orgA],
        /uq_tax_rates_name/,
      );
      await rejects(
        `INSERT INTO tax_rates (org_id, name, rate_percent, is_default) VALUES ($1,'VAT 5',5,true)`,
        [orgA],
        /uq_tax_rates_default/,
      );
      await rejects(
        `INSERT INTO tax_rates (org_id, name, rate_percent, is_default, is_active) VALUES ($1,'Off',5,true,false)`,
        [orgB],
        /chk_tax_rates_default_active/,
      );
      await rejects(
        `INSERT INTO tax_rates (org_id, name, rate_percent) VALUES ($1,'Too much',100.01)`,
        [orgA],
        /chk_tax_rates_percent/,
      );
      // another workspace has its own default
      await owner.query(
        `INSERT INTO tax_rates (org_id, name, rate_percent, is_default) VALUES ($1,'VAT 20',20,true)`,
        [orgB],
      );
    });

    it('deleting a tax rate keeps the invoice lines and their snapshot (name, rate) and clears only the reference', async () => {
      const rate = Number(
        (
          await owner.query(
            `INSERT INTO tax_rates (org_id, name, rate_percent) VALUES ($1,'Temp',7) RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const id = await draft(orgA, { subtotal: 10000, tax: 700, taxAdded: 700, total: 10700 });
      await owner.query(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty, unit_price_minor, line_subtotal_minor, tax_amount_minor, line_total_minor, tax_rate_id, tax_name, tax_rate_percent, currency)
         VALUES ($1,$2,'x',1,10000,10000,700,10700,$3,'Temp',7,'USD')`,
        [orgA, id, rate],
      );
      await owner.query(`DELETE FROM tax_rates WHERE id = $1`, [rate]);
      const r = await owner.query(
        `SELECT tax_rate_id, tax_name, tax_rate_bp FROM invoice_items WHERE invoice_id = $1`,
        [id],
      );
      expect(r.rows[0]).toMatchObject({ tax_rate_id: null, tax_name: 'Temp', tax_rate_bp: 700 });
    });
  });

  // --- freezing ---------------------------------------------------------------------------------------------------------------

  describe('an issued invoice is frozen by the database (WD-INV-031: WaDesk was immutable only by omission)', () => {
    it('amounts, currency, number and buyer name cannot change after issue; the due date, notes, owner and links can', async () => {
      const id = await draft(orgA);
      await owner.query(
        `UPDATE invoices SET total_minor = 5000, subtotal_minor = 5000 WHERE id = $1`,
        [id],
      ); // a draft is editable
      await issue(orgA, id);
      for (const set of [
        `total_minor = 1, subtotal_minor = 1`,
        `currency = 'EUR'`,
        `invoice_number = 'HACK-1'`,
        `buyer_name = 'Someone else'`,
        `shipping_minor = 5, total_minor = 5005`,
        `tax_regime = 'vat'`,
        `seq = 999`,
      ]) {
        await rejects(`UPDATE invoices SET ${set} WHERE id = $1`, [id], /issued invoice is frozen/);
      }
      await owner.query(
        `UPDATE invoices SET notes = 'n', terms = 't', due_date = current_date + 30, reference = 'PO' WHERE id = $1`,
        [id],
      );
      await owner.query(
        `UPDATE invoices SET view_count = view_count + 1, last_viewed_at = now(), sent_at = now() WHERE id = $1`,
        [id],
      );
    });

    it('the lines and the tax summary of an issued invoice cannot be inserted, changed or deleted', async () => {
      const id = await draft(orgA);
      await owner.query(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty, unit_price_minor, line_subtotal_minor, line_total_minor, currency) VALUES ($1,$2,'x',1,10000,10000,10000,'USD')`,
        [orgA, id],
      );
      await issue(orgA, id);
      await rejects(
        `INSERT INTO invoice_items (org_id, invoice_id, sort, description, qty) VALUES ($1,$2,5,'late',1)`,
        [orgA, id],
        /lines of an issued invoice are frozen/,
      );
      await rejects(
        `UPDATE invoice_items SET description = 'changed' WHERE invoice_id = $1`,
        [id],
        /frozen/,
      );
      await rejects(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id], /frozen/);
      await rejects(
        `INSERT INTO invoice_tax_summary (org_id, invoice_id, tax_label, rate_percent) VALUES ($1,$2,'VAT',10)`,
        [orgA, id],
        /frozen/,
      );
    });

    it('status only moves forward: an issued invoice cannot go back to draft, a void one cannot be reopened', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await rejects(
        `UPDATE invoices SET status = 'draft' WHERE id = $1`,
        [id],
        /cannot go back to draft|chk_invoices/,
      );
      await owner.query(
        `UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'dup' WHERE id = $1`,
        [id],
      );
      await rejects(
        `UPDATE invoices SET status = 'issued', voided_at = NULL, void_reason = NULL WHERE id = $1`,
        [id],
        /cannot be reopened/,
      );
    });

    it('deleting a draft removes its lines with it (cascade passes the freeze trigger); the organization cascade is not blocked either', async () => {
      const id = await draft(orgA);
      await owner.query(
        `INSERT INTO invoice_items (org_id, invoice_id, description, qty, line_total_minor, currency) VALUES ($1,$2,'x',1,0,'USD')`,
        [orgA, id],
      );
      await owner.query(`DELETE FROM invoices WHERE id = $1`, [id]);
      expect(
        (await owner.query(`SELECT 1 FROM invoice_items WHERE invoice_id = $1`, [id])).rows,
      ).toHaveLength(0);
      const tmpOrg = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ('tmp','T','starter') RETURNING id`,
          )
        ).rows[0].id,
      );
      const i = await draft(tmpOrg);
      await issue(tmpOrg, i);
      const p = await pay(tmpOrg, i, 100);
      expect(p).toBeGreaterThan(0);
      await owner.query(`DELETE FROM organizations WHERE id = $1`, [tmpOrg]);
      expect(
        (await owner.query(`SELECT 1 FROM invoices WHERE org_id = $1`, [tmpOrg])).rows,
      ).toHaveLength(0);
      expect(
        (await owner.query(`SELECT 1 FROM payments WHERE org_id = $1`, [tmpOrg])).rows,
      ).toHaveLength(0);
    });
  });

  // --- numbering ---------------------------------------------------------------------------------------------------------------

  describe('the numbering allocator (WD-INV-008, D-13)', () => {
    const alloc = (client: Client, org: number, series: string) =>
      asOrg(
        org,
        async () =>
          Number(
            (await client.query(`SELECT allocate_series_seq($1::bigint, $2) AS seq`, [org, series]))
              .rows[0].seq,
          ),
        client,
      );

    it('WD-INV-008 #1: concurrent issuers get consecutive unique numbers (40 transactions over 8 connections)', async () => {
      const clients = await Promise.all(
        Array.from({ length: 8 }, async () => {
          const c = conn('crm_app_user', 'test');
          await c.connect();
          return c;
        }),
      );
      try {
        const got = await Promise.all(
          Array.from({ length: 40 }, (_, i) => alloc(clients[i % 8]!, orgA, 'CONC-2026')),
        );
        expect([...got].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 60_000);

    it('a rolled-back transaction gives its number back (no gap; WaDesk allocated in a transaction of its own and burned numbers)', async () => {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
      const burned = Number(
        (await app.query(`SELECT allocate_series_seq($1::bigint, 'RB-2026') AS seq`, [orgA]))
          .rows[0].seq,
      );
      await app.query('ROLLBACK');
      const next = await alloc(app, orgA, 'RB-2026');
      expect(burned).toBe(1);
      expect(next).toBe(1);
    });

    it('WD-INV-008 #4: each organization and each series counts on its own', async () => {
      expect(await alloc(app, orgA, 'IND-2026')).toBe(1);
      expect(await alloc(app, orgA, 'IND-2026')).toBe(2);
      expect(await alloc(app, orgB, 'IND-2026')).toBe(1);
      expect(await alloc(app, orgA, 'IND-2027')).toBe(1);
    });

    it('a lost or restored counter row resumes AFTER the highest existing number, never inside the series', async () => {
      const series = 'FLOOR-2026';
      for (const seq of [1, 2, 7]) {
        const id = await draft(orgA);
        await owner.query(
          `UPDATE invoices SET status='issued', series=$2, seq=$3, invoice_number=$4, issued_at=now(), issue_date=current_date, public_token_hash=$5 WHERE id=$1`,
          [id, series, seq, `${series}-${seq}`, `fh-${seq}-${id}`],
        );
      }
      await owner.query(`DELETE FROM invoice_number_sequences WHERE org_id = $1 AND series = $2`, [
        orgA,
        series,
      ]);
      expect(await alloc(app, orgA, series)).toBe(8);
    });

    it('the unique keys backstop it: a number or a (series, seq) is never shared inside an organization', async () => {
      const a = await draft(orgA);
      const b = await draft(orgA);
      const mk = (id: number, seq: number, num: string, h: string) =>
        owner.query(
          `UPDATE invoices SET status='issued', series='U', seq=$2, invoice_number=$3, issued_at=now(), issue_date=current_date, public_token_hash=$4 WHERE id=$1`,
          [id, seq, num, h],
        );
      await mk(a, 1, 'U-1', 'uh1');
      await expect(mk(b, 2, 'U-1', 'uh2')).rejects.toThrow(/uq_invoices_invoice_number/);
      await expect(mk(b, 1, 'U-2', 'uh3')).rejects.toThrow(/uq_invoices_series_seq/);
      await expect(mk(b, 2, 'U-2', 'uh1')).rejects.toThrow(/uq_invoices_token_hash/);
    });

    it("an organization cannot allocate from another organization's counter", async () => {
      await expect(
        asOrg(orgA, () => app.query(`SELECT allocate_series_seq($1::bigint, 'EVIL')`, [orgB])),
      ).rejects.toThrow(/not the current tenant/);
    });
  });

  // --- the payment ledger ------------------------------------------------------------------------------------------------------

  describe('the payment ledger (WD-PAY-003, D-11)', () => {
    it('WD-INV-025 acceptance: payments of 40 and 60 against 100 make it partially_paid, then paid with paid_at set at the second', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await pay(orgA, id, 4000);
      expect(await inv(id)).toMatchObject({
        payment_status: 'partially_paid',
        paid_minor: 4000,
        paid_at: null,
      });
      await pay(orgA, id, 6000);
      const r = await inv(id);
      expect(r).toMatchObject({ payment_status: 'paid', paid_minor: 10000 });
      expect(r.paid_at).not.toBeNull();
    });

    it('over-payment is a policy of the API, not the database: the ledger records it and the invoice reads paid', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await pay(orgA, id, 12_500);
      expect(await inv(id)).toMatchObject({ payment_status: 'paid', paid_minor: 12_500 });
    });

    it('WD-PAY-002 D-11: a payment needs an issued invoice of the same currency (WaDesk summed EUR against USD)', async () => {
      const d = await draft(orgA);
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,100,'USD')`,
        [orgA, d],
        /only be recorded against an issued invoice/,
      );
      await issue(orgA, d);
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,100,'EUR')`,
        [orgA, d],
        /does not match the invoice currency/,
      );
      await owner.query(
        `UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = $1`,
        [d],
      );
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,100,'USD')`,
        [orgA, d],
        /only be recorded against an issued invoice/,
      );
    });

    it('WD-PAY-003 #4: an amount is positive for a payment and negative for a refund that names its payment (WaDesk clamped -5 to 0)', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,0,'USD')`,
        [orgA, id],
        /chk_payments_amount/,
      );
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency) VALUES ($1,$2,-5,'USD')`,
        [orgA, id],
        /chk_payments_amount/,
      );
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency) VALUES ($1,$2,'refund',-5,'USD')`,
        [orgA, id],
        /chk_payments_amount|must name the payment/,
      );
    });

    it('a refund reopens the invoice: paid -> partially_paid -> unpaid, and it can never return more than its payment', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      const p = await pay(orgA, id, 10_000);
      expect((await inv(id)).payment_status).toBe('paid');
      await pay(orgA, id, -2500, { kind: 'refund', refundOf: p });
      expect(await inv(id)).toMatchObject({
        payment_status: 'partially_paid',
        paid_minor: 7500,
        refunded_minor: 2500,
        paid_at: null,
      });
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, refund_of_id) VALUES ($1,$2,'refund',-7501,'USD',$3)`,
        [orgA, id, p],
        /refunds would exceed the payment/,
      );
      await pay(orgA, id, -7500, { kind: 'refund', refundOf: p });
      expect(await inv(id)).toMatchObject({
        payment_status: 'unpaid',
        paid_minor: 0,
        refunded_minor: 10_000,
      });
    });

    it('a refund must be on the same invoice and currency as its payment, and cannot refund a refund', async () => {
      const a = await draft(orgA);
      const b = await draft(orgA);
      await issue(orgA, a);
      await issue(orgA, b);
      const p = await pay(orgA, a, 5000);
      const r = await pay(orgA, a, -100, { kind: 'refund', refundOf: p });
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, refund_of_id) VALUES ($1,$2,'refund',-100,'USD',$3)`,
        [orgA, b, p],
        /same invoice and currency/,
      );
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, refund_of_id) VALUES ($1,$2,'refund',-1,'USD',$3)`,
        [orgA, a, r],
        /must name the payment/,
      );
    });

    it('the ledger is append-only: no delete, no change of an amount, a date or an invoice; a note can be amended', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      const p = await pay(orgA, id, 1000);
      await rejects(`DELETE FROM payments WHERE id = $1`, [p], /append-only/);
      await rejects(`UPDATE payments SET amount_minor = 999999 WHERE id = $1`, [p], /append-only/);
      await rejects(
        `UPDATE payments SET paid_at = paid_at - interval '30 days' WHERE id = $1`,
        [p],
        /append-only/,
      );
      await rejects(`UPDATE payments SET invoice_id = NULL WHERE id = $1`, [p], /append-only/);
      await owner.query(
        `UPDATE payments SET note = 'cheque 123 cleared', reference = 'TXN9' WHERE id = $1`,
        [p],
      );
    });

    it("a payment carries its invoice's contact so the ledger can be read per customer (WaDesk left it blank)", async () => {
      const id = await draft(orgA, { contactId: contactA });
      await issue(orgA, id);
      const p = await pay(orgA, id, 1000);
      expect(
        Number(
          (await owner.query(`SELECT contact_id FROM payments WHERE id = $1`, [p])).rows[0]
            .contact_id,
        ),
      ).toBe(contactA);
    });

    it('a gateway payment id is recorded once: the second insert of the same (source, id) is refused by the unique key', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      const ins = () =>
        owner.query(
          `INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method, source, gateway_payment_id) VALUES ($1,$2,500,'USD','gateway','gateway','pay_123')`,
          [orgA, id],
        );
      await ins();
      await expect(ins()).rejects.toThrow(/uq_payments_source_gateway_payment_id/);
    });

    it('two payments recorded at the same instant are both counted (the invoice row lock serialises the ledger)', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      const c1 = conn('crm_app_user', 'test');
      const c2 = conn('crm_app_user', 'test');
      await Promise.all([c1.connect(), c2.connect()]);
      try {
        await Promise.all(
          [c1, c2].map((c) =>
            asOrg(
              orgA,
              () =>
                c.query(
                  `INSERT INTO payments (org_id, invoice_id, amount_minor, currency, method) VALUES ($1,$2,5000,'USD','bank')`,
                  [orgA, id],
                ),
              c,
            ),
          ),
        );
        expect(await inv(id)).toMatchObject({ paid_minor: 10_000, payment_status: 'paid' });
      } finally {
        await Promise.all([c1.end(), c2.end()]);
      }
    });

    it('two refunds that together exceed the payment: exactly one wins', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      const p = await pay(orgA, id, 10_000);
      const c1 = conn('crm_app_user', 'test');
      const c2 = conn('crm_app_user', 'test');
      await Promise.all([c1.connect(), c2.connect()]);
      try {
        const results = await Promise.allSettled(
          [c1, c2].map((c) =>
            asOrg(
              orgA,
              () =>
                c.query(
                  `INSERT INTO payments (org_id, invoice_id, kind, amount_minor, currency, refund_of_id) VALUES ($1,$2,'refund',-6000,'USD',$3)`,
                  [orgA, id, p],
                ),
              c,
            ),
          ),
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(await inv(id)).toMatchObject({ paid_minor: 4000, refunded_minor: 6000 });
      } finally {
        await Promise.all([c1.end(), c2.end()]);
      }
    });

    it('voiding needs a zero net payment: the cache check refuses a void invoice that still holds money', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await pay(orgA, id, 100);
      await rejects(
        `UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = $1`,
        [id],
        /chk_invoices_paid/,
      );
    });

    it('a receipt number is unique per organization', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await owner.query(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency, receipt_number) VALUES ($1,$2,100,'USD','RCT-DUP-1')`,
        [orgA, id],
      );
      await rejects(
        `INSERT INTO payments (org_id, invoice_id, amount_minor, currency, receipt_number) VALUES ($1,$2,100,'USD','RCT-DUP-1')`,
        [orgA, id],
        /uq_payments_receipt/,
      );
    });
  });

  // --- the two cross-tenant lookups ----------------------------------------------------------------------------------------------

  describe('the public lookups (SECURITY DEFINER, ids only)', () => {
    it('WD-INV-016: a public token hash resolves to its org and invoice with no tenant context, for issued invoices only', async () => {
      const d = await draft(orgA);
      await owner.query(`UPDATE invoices SET public_token_hash = NULL WHERE id = $1`, [d]);
      const id = await draft(orgA);
      await issue(orgA, id);
      const hash = (
        await owner.query(`SELECT public_token_hash AS h FROM invoices WHERE id = $1`, [id])
      ).rows[0].h as string;
      await app.query('BEGIN');
      try {
        const r = await app.query(`SELECT org_id, invoice_id FROM invoice_by_public_token($1)`, [
          hash,
        ]);
        expect(r.rows).toHaveLength(1);
        expect(Number(r.rows[0].org_id)).toBe(orgA);
        expect(Number(r.rows[0].invoice_id)).toBe(id);
        expect(
          (await app.query(`SELECT * FROM invoice_by_public_token('nope')`)).rows,
        ).toHaveLength(0);
        // the privilege is scoped to the call: afterwards the connection is still an unprivileged, tenant-less one
        expect((await app.query(`SELECT app_is_privileged() AS p`)).rows[0].p).toBe(false);
        expect((await app.query(`SELECT 1 FROM invoices`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('the webhook endpoint resolves to its org, provider and cipher, and an unknown endpoint to nothing', async () => {
      const c = (
        await owner.query(
          `INSERT INTO invoice_gateway_connections (org_id, provider) VALUES ($1,'hmac_generic') RETURNING uuid`,
          [orgB],
        )
      ).rows[0].uuid as string;
      await app.query('BEGIN');
      try {
        const r = await app.query(
          `SELECT org_id, provider, secret_cipher, enabled FROM invoice_gateway_by_endpoint($1::uuid)`,
          [c],
        );
        expect(r.rows[0]).toMatchObject({
          provider: 'hmac_generic',
          secret_cipher: null,
          enabled: false,
        });
        expect(Number(r.rows[0].org_id)).toBe(orgB);
        expect(
          (
            await app.query(
              `SELECT * FROM invoice_gateway_by_endpoint('00000000-0000-4000-8000-000000000000'::uuid)`,
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('PUBLIC may not execute them; only the two runtime roles may', async () => {
      const r = await owner.query(
        `SELECT p.proname, has_function_privilege('public', p.oid, 'EXECUTE') AS pub, has_function_privilege('crm_app', p.oid, 'EXECUTE') AS app
           FROM pg_proc p WHERE p.proname IN ('invoice_by_public_token', 'invoice_gateway_by_endpoint')`,
      );
      expect(r.rows).toHaveLength(2);
      for (const row of r.rows) expect(row, row.proname).toMatchObject({ pub: false, app: true });
    });

    it('a connection with no secret can never be enabled (the webhook fails closed)', async () => {
      await rejects(
        `INSERT INTO invoice_gateway_connections (org_id, provider, enabled) VALUES ($1,'hmac_generic',true)`,
        [orgA],
        /chk_invoice_gateway_connections_secret/,
      );
    });

    it('a verified webhook event id is recorded once per connection', async () => {
      const conn1 = Number(
        (
          await owner.query(
            `INSERT INTO invoice_gateway_connections (org_id, provider) VALUES ($1,'hmac_generic') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const ev = () =>
        owner.query(
          `INSERT INTO invoice_gateway_events (org_id, connection_id, event_id, event_type, outcome) VALUES ($1,$2,'evt_1','payment.succeeded','applied')`,
          [orgA, conn1],
        );
      await ev();
      await expect(ev()).rejects.toThrow(/uq_invoice_gateway_events/);
    });
  });
  describe('credit notes, recurring schedules and sales orders (owner direction)', () => {
    let cnSeq = 0;
    const note = (
      org: number,
      invoiceId: number,
      total: number,
      over: Record<string, unknown> = {},
    ) => {
      const n = ++cnSeq;
      const status = (over.status as string) ?? 'issued';
      const issued = status !== 'draft';
      return owner.query(
        `INSERT INTO credit_notes (org_id, invoice_id, status, reason, currency, subtotal_minor, total_minor, series, credit_number, seq, issued_at, issue_date, refunded_minor)
         VALUES ($1,$2,$3,'return',$4,$5,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          org,
          invoiceId,
          status,
          over.currency ?? 'USD',
          total,
          issued ? 'C' : null,
          issued ? `C-${org}-${n}` : null,
          issued ? n : null,
          issued ? new Date() : null,
          issued ? new Date().toISOString().slice(0, 10) : null,
          over.refunded ?? 0,
        ],
      );
    };

    it('issued credit notes of an invoice can never add up to more than its total, and the invoice counts them (credited_minor, payment status)', async () => {
      const id = await draft(orgA);
      await issue(orgA, id);
      await note(orgA, id, 6000);
      await rejects(
        `INSERT INTO credit_notes (org_id, invoice_id, status, reason, currency, subtotal_minor, total_minor, series, credit_number, seq, issued_at, issue_date)
         VALUES ($1,$2,'issued','return','USD',5000,5000,'C','C-over',900,now(),current_date)`,
        [orgA, id],
        /would exceed/,
      );
      expect(
        (
          await owner.query(
            `SELECT credited_minor::int AS c, payment_status FROM invoices WHERE id = $1`,
            [id],
          )
        ).rows[0],
      ).toMatchObject({ c: 6000, payment_status: 'partially_paid' });
      await note(orgA, id, 4000);
      // paid + credited = total: the invoice is settled by credit alone
      expect(
        (await owner.query(`SELECT payment_status FROM invoices WHERE id = $1`, [id])).rows[0]
          .payment_status,
      ).toBe('paid');
      // the credit is the invoice's own, in its currency
      const eur = await draft(orgA, { currency: 'EUR' });
      await issue(orgA, eur);
      await expect(note(orgA, eur, 100, { currency: 'USD' })).rejects.toThrow(/currency/);
    });

    it('an issued credit note is frozen; a void one cannot change; one that returned cash cannot be voided; a draft invoice cannot be credited; an invoice with credit notes cannot be voided', async () => {
      const id = await draft(orgA);
      await expect(note(orgA, id, 100)).rejects.toThrow(/needs an issued invoice/);
      await issue(orgA, id);
      const nid = Number((await note(orgA, id, 3000)).rows[0].id);
      await expect(
        owner.query(`UPDATE credit_notes SET total_minor = 10, subtotal_minor = 10 WHERE id = $1`, [
          nid,
        ]),
      ).rejects.toThrow(/frozen/);
      await expect(
        owner.query(
          `UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/credit notes against it/);
      await owner.query(
        `UPDATE credit_notes SET status = 'void', voided_at = now(), void_reason = 'mistake' WHERE id = $1`,
        [nid],
      );
      expect(
        (await owner.query(`SELECT credited_minor::int AS c FROM invoices WHERE id = $1`, [id]))
          .rows[0].c,
      ).toBe(0);
      await expect(
        owner.query(`UPDATE credit_notes SET void_reason = 'again' WHERE id = $1`, [nid]),
      ).rejects.toThrow(/void credit note cannot change/);
      const cash = Number((await note(orgA, id, 2000, { refunded: 500 })).rows[0].id);
      await expect(
        owner.query(
          `UPDATE credit_notes SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = $1`,
          [cash],
        ),
      ).rejects.toThrow(/returned cash/);
    });

    it('a schedule has one run per period (the idempotency key), an ended schedule has no next date while a live one always has, and deleting it takes its history', async () => {
      const rid = Number(
        (
          await owner.query(
            `INSERT INTO recurring_invoices (org_id, name, frequency, start_date, template, next_run_date) VALUES ($1,'S','month',current_date,'{}'::jsonb,current_date) RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const run = () =>
        owner.query(
          `INSERT INTO recurring_invoice_runs (org_id, recurring_id, period_index, period_date, status) VALUES ($1,$2,0,current_date,'created')`,
          [orgA, rid],
        );
      await run();
      await expect(run()).rejects.toThrow(/uq_recurring_runs_period/);
      await rejects(
        `UPDATE recurring_invoices SET status = 'ended' WHERE id = $1`,
        [rid],
        /chk_recurring_invoices_next/,
      );
      await rejects(
        `UPDATE recurring_invoices SET next_run_date = NULL WHERE id = $1`,
        [rid],
        /chk_recurring_invoices_next/,
      );
      await rejects(
        `UPDATE recurring_invoices SET end_date = current_date - 1 WHERE id = $1`,
        [rid],
        /chk_recurring_invoices_window/,
      );
      await rejects(
        `UPDATE recurring_invoices SET frequency = 'fortnight' WHERE id = $1`,
        [rid],
        /chk_recurring_invoices_frequency/,
      );
      await owner.query(`DELETE FROM recurring_invoices WHERE id = $1`, [rid]);
      expect(
        Number(
          (
            await owner.query(
              `SELECT count(*)::int AS n FROM recurring_invoice_runs WHERE recurring_id = $1`,
              [rid],
            )
          ).rows[0].n,
        ),
      ).toBe(0);
    });

    it("order quantities: invoiced and fulfilled can never exceed ordered, and a confirmed order's prices and lines are frozen while its progress still moves", async () => {
      const oid = Number(
        (
          await owner.query(
            `INSERT INTO sales_orders (org_id, series, seq, number, currency, subtotal_minor, total_minor, buyer_name) VALUES ($1,'SO',1,'SO-T-1','USD',10000,10000,'B') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const item = Number(
        (
          await owner.query(
            `INSERT INTO sales_order_items (org_id, order_id, sort, description, qty, unit_price_minor, line_subtotal_minor, line_total_minor, currency)
           VALUES ($1,$2,0,'Chair',10,1000,10000,10000,'USD') RETURNING id`,
            [orgA, oid],
          )
        ).rows[0].id,
      );
      await rejects(
        `UPDATE sales_order_items SET qty_invoiced = 11 WHERE id = $1`,
        [item],
        /chk_sales_order_items_qty/,
      );
      await rejects(
        `UPDATE sales_order_items SET qty_fulfilled = 11 WHERE id = $1`,
        [item],
        /chk_sales_order_items_qty/,
      );
      await rejects(
        `UPDATE sales_orders SET total_minor = 5 WHERE id = $1`,
        [oid],
        /chk_sales_orders_totals/,
      );
      await owner.query(
        `UPDATE sales_orders SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [oid],
      );
      await owner.query(
        `UPDATE sales_order_items SET qty_invoiced = 4, qty_fulfilled = 2 WHERE id = $1`,
        [item],
      );
      await rejects(
        `UPDATE sales_order_items SET unit_price_minor = 1 WHERE id = $1`,
        [item],
        /frozen/,
      );
      await rejects(
        `INSERT INTO sales_order_items (org_id, order_id, sort, description, qty, currency) VALUES ($1,$2,1,'x',1,'USD')`,
        [orgA, oid],
        /cannot be added or removed/,
      );
      await rejects(
        `UPDATE sales_orders SET total_minor = 20000, subtotal_minor = 20000 WHERE id = $1`,
        [oid],
        /frozen/,
      );
      await owner.query(
        `UPDATE sales_orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'x' WHERE id = $1`,
        [oid],
      );
      await rejects(
        `UPDATE sales_orders SET status = 'confirmed' WHERE id = $1`,
        [oid],
        /reopened/,
      );
    });

    it('an accepted offer has at most one live sales order (cancelled ones do not count)', async () => {
      const doc = Number(
        (
          await owner.query(
            `INSERT INTO sales_docs (org_id, doc_type, number, seq, status, currency, decided_at) VALUES ($1,'estimate','EST-T-1',9001,'accepted','USD',now()) RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const so = (n: number, st: string) =>
        owner.query(
          `INSERT INTO sales_orders (org_id, series, seq, number, currency, quote_id, status, confirmed_at, cancelled_at) VALUES ($1,'SO',$2,$3,'USD',$4,$5,
             CASE WHEN $5 = 'confirmed' THEN now() END, CASE WHEN $5 = 'cancelled' THEN now() END)`,
          [orgA, n, `SO-Q-${n}`, doc, st],
        );
      await so(50, 'confirmed');
      await expect(so(51, 'confirmed')).rejects.toThrow(/uq_sales_orders_quote/);
      await owner.query(
        `UPDATE sales_orders SET status = 'cancelled', cancelled_at = now() WHERE number = 'SO-Q-50'`,
      );
      await so(52, 'confirmed');
    });
  });
});
