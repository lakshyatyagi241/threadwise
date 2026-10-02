import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** The invoice_settings row of one workspace (absent until the first save). */
export interface SettingsRow {
  id: number;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerCountry: string | null;
  sellerState: string | null;
  sellerTaxId: string | null;
  sellerRegNo: string | null;
  sellerPhone: string | null;
  supportEmail: string | null;
  sellerExtra: Array<{ label: string; value: string }>;
  logoPath: string | null;
  brandColor: string | null;
  bankDetails: Record<string, string> | null;
  paymentInstructions: string | null;
  numberingPrefix: string;
  proformaPrefix: string;
  receiptPrefix: string;
  creditNotePrefix: string;
  salesOrderPrefix: string;
  numberFormat: string;
  numberPadding: number;
  fyReset: boolean;
  fyStartMonth: number;
  dueDays: number | null;
  terms: string | null;
  footerNote: string | null;
  invoiceTitle: string | null;
  defaultTaxRegime: string;
  overdueReminders: boolean;
  rowVersion: number;
  updatedAt: Date;
}

export type SettingsPatch = Partial<Omit<SettingsRow, 'id' | 'rowVersion' | 'updatedAt'>>;

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

/** property -> column. One table drives the read and the write, so they cannot disagree about a name. */
const COLUMNS: Record<keyof SettingsPatch, string> = {
  sellerName: 'seller_name',
  sellerAddress: 'seller_address',
  sellerCountry: 'seller_country',
  sellerState: 'seller_state',
  sellerTaxId: 'seller_tax_id',
  sellerRegNo: 'seller_reg_no',
  sellerPhone: 'seller_phone',
  supportEmail: 'support_email',
  sellerExtra: 'seller_extra_json',
  logoPath: 'logo_path',
  brandColor: 'brand_color',
  bankDetails: 'bank_details',
  paymentInstructions: 'payment_instructions',
  numberingPrefix: 'numbering_prefix',
  proformaPrefix: 'proforma_prefix',
  receiptPrefix: 'receipt_prefix',
  creditNotePrefix: 'credit_note_prefix',
  salesOrderPrefix: 'sales_order_prefix',
  numberFormat: 'number_format',
  numberPadding: 'number_padding',
  fyReset: 'fy_reset',
  fyStartMonth: 'fy_start_month',
  dueDays: 'due_days',
  terms: 'terms',
  footerNote: 'footer_note',
  invoiceTitle: 'invoice_title',
  defaultTaxRegime: 'default_tax_regime',
  overdueReminders: 'overdue_reminders',
};
const JSON_COLUMNS = new Set<string>(['sellerExtra', 'bankDetails']);

@Injectable()
export class InvoiceSettingsRepository {
  async get(tx: Tx, orgId: number, forUpdate = false): Promise<SettingsRow | undefined> {
    const res = await tx.execute(sql`
      SELECT id, seller_name, seller_address, seller_country, seller_state, seller_tax_id, seller_reg_no, seller_phone, support_email,
             seller_extra_json, logo_path, brand_color, bank_details, payment_instructions, numbering_prefix, proforma_prefix,
             receipt_prefix, credit_note_prefix, sales_order_prefix, number_format, number_padding, fy_reset, fy_start_month, due_days, terms, footer_note, invoice_title,
             default_tax_regime, overdue_reminders, row_version, updated_at
      FROM invoice_settings WHERE org_id = ${orgId} ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    return {
      id: Number(r.id),
      sellerName: s(r.seller_name),
      sellerAddress: s(r.seller_address),
      sellerCountry: s(r.seller_country),
      sellerState: s(r.seller_state),
      sellerTaxId: s(r.seller_tax_id),
      sellerRegNo: s(r.seller_reg_no),
      sellerPhone: s(r.seller_phone),
      supportEmail: s(r.support_email),
      sellerExtra: (r.seller_extra_json as SettingsRow['sellerExtra'] | null) ?? [],
      logoPath: s(r.logo_path),
      brandColor: s(r.brand_color),
      bankDetails: (r.bank_details as Record<string, string> | null) ?? null,
      paymentInstructions: s(r.payment_instructions),
      numberingPrefix: r.numbering_prefix as string,
      proformaPrefix: r.proforma_prefix as string,
      receiptPrefix: r.receipt_prefix as string,
      creditNotePrefix: r.credit_note_prefix as string,
      salesOrderPrefix: r.sales_order_prefix as string,
      numberFormat: r.number_format as string,
      numberPadding: Number(r.number_padding),
      fyReset: r.fy_reset as boolean,
      fyStartMonth: Number(r.fy_start_month),
      dueDays: r.due_days === null || r.due_days === undefined ? null : Number(r.due_days),
      terms: s(r.terms),
      footerNote: s(r.footer_note),
      invoiceTitle: s(r.invoice_title),
      defaultTaxRegime: r.default_tax_regime as string,
      overdueReminders: r.overdue_reminders as boolean,
      rowVersion: Number(r.row_version),
      updatedAt: new Date(r.updated_at as string),
    };
  }

  /** Creates the row on the first save (never on a read) and applies the patch to it, under a row lock. */
  async upsert(tx: Tx, orgId: number, patch: SettingsPatch): Promise<void> {
    await tx.execute(
      sql`INSERT INTO invoice_settings (org_id) VALUES (${orgId}) ON CONFLICT (org_id) DO NOTHING`,
    );
    const sets: SQL[] = [];
    for (const key of Object.keys(patch) as Array<keyof SettingsPatch>) {
      const value = patch[key];
      if (value === undefined) continue;
      const col = sql.raw(COLUMNS[key]);
      sets.push(
        JSON_COLUMNS.has(key)
          ? sql`${col} = ${value === null ? null : JSON.stringify(value)}::jsonb`
          : sql`${col} = ${value}`,
      );
    }
    if (sets.length === 0) return;
    await tx.execute(sql`
      UPDATE invoice_settings SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId}
    `);
  }

  // --- the online payment connection -------------------------------------------------------------------------------------------

  async connection(
    tx: Tx,
    orgId: number,
    provider: string,
    forUpdate = false,
  ): Promise<
    | { id: number; uuid: string; enabled: boolean; mode: 'test' | 'live'; secretCipher: string | null; rowVersion: number; updatedAt: Date }
    | undefined
  > {
    const res = await tx.execute(sql`
      SELECT id, uuid, enabled, mode, webhook_secret_cipher, row_version, updated_at
      FROM invoice_gateway_connections WHERE org_id = ${orgId} AND provider = ${provider} ${forUpdate ? sql`FOR UPDATE` : sql``}
    `);
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid as string,
          enabled: r.enabled as boolean,
          mode: r.mode as 'test' | 'live',
          secretCipher: s(r.webhook_secret_cipher),
          rowVersion: Number(r.row_version),
          updatedAt: new Date(r.updated_at as string),
        }
      : undefined;
  }

  async upsertConnection(
    tx: Tx,
    orgId: number,
    createdBy: number | null,
    provider: string,
    v: { enabled?: boolean; mode?: 'test' | 'live'; secretCipher?: string },
  ): Promise<number> {
    await tx.execute(sql`
      INSERT INTO invoice_gateway_connections (org_id, provider, created_by) VALUES (${orgId}, ${provider}, ${createdBy})
      ON CONFLICT (org_id, provider) DO NOTHING
    `);
    const sets: SQL[] = [];
    if (v.mode !== undefined) sets.push(sql`mode = ${v.mode}`);
    if (v.secretCipher !== undefined) sets.push(sql`webhook_secret_cipher = ${v.secretCipher}`);
    if (v.enabled !== undefined) sets.push(sql`enabled = ${v.enabled}`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE invoice_gateway_connections SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND provider = ${provider} RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }
}
