import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type InvoiceGatewayResponse,
  type InvoiceProfile,
  type UpdateInvoiceGatewayInput,
  type UpdateInvoiceProfileInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { DEFAULT_NUMBERING, numberFormatProblem, type NumberingSettings } from './invoice-rules';
import {
  InvoiceSettingsRepository,
  type SettingsPatch,
  type SettingsRow,
} from './invoice-settings.repository';
import { InvoicesRepository } from './invoices.repository';

export const INVOICE_SETTINGS_MODULE = 'invoice-settings';

const DEFAULTS: Omit<SettingsRow, 'id' | 'rowVersion' | 'updatedAt'> = {
  sellerName: null,
  sellerAddress: null,
  sellerCountry: null,
  sellerState: null,
  sellerTaxId: null,
  sellerRegNo: null,
  sellerPhone: null,
  supportEmail: null,
  sellerExtra: [],
  logoPath: null,
  brandColor: null,
  bankDetails: null,
  paymentInstructions: null,
  numberingPrefix: DEFAULT_NUMBERING.numberingPrefix,
  proformaPrefix: DEFAULT_NUMBERING.proformaPrefix,
  receiptPrefix: DEFAULT_NUMBERING.receiptPrefix,
  creditNotePrefix: DEFAULT_NUMBERING.creditNotePrefix,
  salesOrderPrefix: DEFAULT_NUMBERING.salesOrderPrefix,
  numberFormat: DEFAULT_NUMBERING.numberFormat,
  numberPadding: DEFAULT_NUMBERING.numberPadding,
  fyReset: DEFAULT_NUMBERING.yearlyReset,
  fyStartMonth: DEFAULT_NUMBERING.fiscalYearStartMonth,
  dueDays: null,
  terms: null,
  footerNote: null,
  invoiceTitle: null,
  defaultTaxRegime: 'none',
  overdueReminders: true,
};

export interface LoadedProfile {
  row: Omit<SettingsRow, 'id' | 'rowVersion' | 'updatedAt'>;
  rowVersion: number | null;
  updatedAt: Date | null;
  currency: string;
  timezone: string | null;
  orgName: string;
}

export const numberingOf = (r: LoadedProfile['row']): NumberingSettings => ({
  numberingPrefix: r.numberingPrefix,
  proformaPrefix: r.proformaPrefix,
  receiptPrefix: r.receiptPrefix,
  creditNotePrefix: r.creditNotePrefix,
  salesOrderPrefix: r.salesOrderPrefix,
  numberFormat: r.numberFormat,
  numberPadding: r.numberPadding,
  yearlyReset: r.fyReset,
  fiscalYearStartMonth: r.fyStartMonth,
});

export function toProfileResponse(p: LoadedProfile): InvoiceProfile {
  const r = p.row;
  return {
    sellerName: r.sellerName,
    sellerAddress: r.sellerAddress,
    sellerCountry: r.sellerCountry,
    sellerState: r.sellerState,
    sellerTaxId: r.sellerTaxId,
    sellerRegistrationNo: r.sellerRegNo,
    sellerPhone: r.sellerPhone,
    supportEmail: r.supportEmail,
    extraFields: r.sellerExtra,
    logoUrl: r.logoPath,
    brandColor: r.brandColor,
    bankDetails: r.bankDetails,
    paymentInstructions: r.paymentInstructions,
    numberingPrefix: r.numberingPrefix,
    proformaPrefix: r.proformaPrefix,
    receiptPrefix: r.receiptPrefix,
    creditNotePrefix: r.creditNotePrefix,
    salesOrderPrefix: r.salesOrderPrefix,
    numberFormat: r.numberFormat,
    numberPadding: r.numberPadding,
    yearlyReset: r.fyReset,
    fiscalYearStartMonth: r.fyStartMonth,
    dueDays: r.dueDays,
    terms: r.terms,
    footerNote: r.footerNote,
    invoiceTitle: r.invoiceTitle,
    defaultTaxRegime: r.defaultTaxRegime,
    overdueReminders: r.overdueReminders,
    currency: p.currency,
    rowVersion: p.rowVersion,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
  };
}

/**
 * The invoicing profile and the online-payment connection (TW-INV-021/022, owner direction). A read never writes (Reference created the
 * settings row on a GET); a save changes only what it sends (Reference's checkboxes reset what they did not carry).
 */
@Injectable()
export class InvoiceSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InvoiceSettingsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** For the other services: the profile as a transaction sees it (defaults when nothing was saved). */
  async load(tx: Tx, orgId: number, forUpdate = false): Promise<LoadedProfile> {
    const row = await this.repo.get(tx, orgId, forUpdate);
    const org = await this.invoices.orgSettings(tx, orgId);
    const currency = /^[A-Z]{3}$/.test(org.currency ?? '') ? (org.currency as string) : 'USD';
    return {
      row: row ? { ...row } : { ...DEFAULTS },
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row?.updatedAt ?? null,
      currency,
      timezone: org.timezone,
      orgName: org.name,
    };
  }

  async get(): Promise<InvoiceProfile> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => toProfileResponse(await this.load(tx, ctx.orgId)));
  }

  async update(input: UpdateInvoiceProfileInput): Promise<InvoiceProfile> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.load(tx, ctx.orgId, true);
      if (
        input.rowVersion !== undefined &&
        before.rowVersion !== null &&
        input.rowVersion !== before.rowVersion
      ) {
        throw AppError.rowVersionConflict('Invoice settings');
      }

      const patch: SettingsPatch = {};
      const map: Array<[keyof UpdateInvoiceProfileInput, keyof SettingsPatch]> = [
        ['sellerName', 'sellerName'],
        ['sellerAddress', 'sellerAddress'],
        ['sellerCountry', 'sellerCountry'],
        ['sellerState', 'sellerState'],
        ['sellerTaxId', 'sellerTaxId'],
        ['sellerRegistrationNo', 'sellerRegNo'],
        ['sellerPhone', 'sellerPhone'],
        ['supportEmail', 'supportEmail'],
        ['logoUrl', 'logoPath'],
        ['brandColor', 'brandColor'],
        ['bankDetails', 'bankDetails'],
        ['paymentInstructions', 'paymentInstructions'],
        ['numberingPrefix', 'numberingPrefix'],
        ['proformaPrefix', 'proformaPrefix'],
        ['receiptPrefix', 'receiptPrefix'],
        ['creditNotePrefix', 'creditNotePrefix'],
        ['salesOrderPrefix', 'salesOrderPrefix'],
        ['numberFormat', 'numberFormat'],
        ['numberPadding', 'numberPadding'],
        ['yearlyReset', 'fyReset'],
        ['fiscalYearStartMonth', 'fyStartMonth'],
        ['dueDays', 'dueDays'],
        ['terms', 'terms'],
        ['footerNote', 'footerNote'],
        ['invoiceTitle', 'invoiceTitle'],
        ['defaultTaxRegime', 'defaultTaxRegime'],
        ['overdueReminders', 'overdueReminders'],
      ];
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const target = patch as Record<string, unknown>;
      const current = before.row as Record<string, unknown>;
      for (const [from, to] of map) {
        const v = input[from];
        if (v === undefined) continue;
        const next = v === null ? null : v;
        if (JSON.stringify(current[to] ?? null) !== JSON.stringify(next)) {
          target[to] = next;
          // Bank details and the statutory ids are on every invoice: the trail records THAT they changed, not the account numbers.
          delta[from] =
            from === 'bankDetails' || from === 'sellerTaxId'
              ? { old: current[to] != null, new: next !== null }
              : { old: current[to] ?? null, new: next };
        }
      }
      if (input.extraFields !== undefined) {
        patch.sellerExtra = input.extraFields;
        delta.extraFields = { old: before.row.sellerExtra.length, new: input.extraFields.length };
      }

      // The format and the reset rule are validated TOGETHER, against what will be stored.
      const format = (patch.numberFormat ?? before.row.numberFormat) as string;
      const yearly = (patch.fyReset ?? before.row.fyReset) as boolean;
      const problem = numberFormatProblem(format, yearly);
      if (problem) {
        throw AppError.validation(problem, [
          {
            path: patch.numberFormat !== undefined ? 'numberFormat' : 'yearlyReset',
            message: problem,
          },
        ]);
      }

      if (Object.keys(patch).length > 0) {
        await this.repo.upsert(tx, ctx.orgId, patch);
        const after = await this.repo.get(tx, ctx.orgId);
        await this.audit.record(tx, {
          module: INVOICE_SETTINGS_MODULE,
          recordId: after!.id,
          action: before.rowVersion === null ? 'insert' : 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: INVOICE_SETTINGS_MODULE,
          aggregateId: after!.id,
          eventType: 'invoice_settings.updated',
          payload: { changed: Object.keys(delta) },
        });
      }
      return toProfileResponse(await this.load(tx, ctx.orgId));
    });
  }

  // --- the online-payment connection ---------------------------------------------------------------------------------------------

  async gateway(): Promise<InvoiceGatewayResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.gatewayIn(tx, ctx.orgId));
  }

  async updateGateway(input: UpdateInvoiceGatewayInput): Promise<InvoiceGatewayResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.connection(tx, ctx.orgId, 'hmac_generic', true);
      const willHaveSecret = input.webhookSecret !== undefined || !!existing?.secretCipher;
      // A connection with no secret can never be enabled: the webhook fails closed.
      if (input.enabled === true && !willHaveSecret) {
        throw new AppError(
          ERROR_CODES.PAY_GATEWAY_NOT_CONFIGURED,
          'Set a webhook signing secret before enabling online payment',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'webhookSecret', message: 'required to enable' }],
        );
      }
      const id = await this.repo.upsertConnection(tx, ctx.orgId, ctx.userId, 'hmac_generic', {
        enabled: input.enabled,
        mode: input.mode,
        secretCipher:
          input.webhookSecret !== undefined ? this.crypto.encrypt(input.webhookSecret) : undefined,
      });
      await this.audit.record(tx, {
        module: INVOICE_SETTINGS_MODULE,
        recordId: id,
        action: existing ? 'update' : 'insert',
        // Never the secret, in any form.
        delta: {
          ...(input.enabled !== undefined
            ? { enabled: { old: existing?.enabled ?? false, new: input.enabled } }
            : {}),
          ...(input.mode !== undefined
            ? { mode: { old: existing?.mode ?? 'test', new: input.mode } }
            : {}),
          ...(input.webhookSecret !== undefined
            ? { webhookSecret: { old: !!existing?.secretCipher, new: true } }
            : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_SETTINGS_MODULE,
        aggregateId: id,
        eventType: 'invoice_gateway.updated',
        payload: { provider: 'hmac_generic', enabled: input.enabled ?? existing?.enabled ?? false },
      });
      return this.gatewayIn(tx, ctx.orgId);
    });
  }

  private async gatewayIn(tx: Tx, orgId: number): Promise<InvoiceGatewayResponse> {
    const c = await this.repo.connection(tx, orgId, 'hmac_generic');
    return {
      provider: 'hmac_generic',
      configured: !!c,
      enabled: c?.enabled ?? false,
      mode: c?.mode ?? 'test',
      webhookPath: c ? `/v2/public/webhooks/invoice-payments/${c.uuid}` : null,
      hasSecret: !!c?.secretCipher,
      updatedAt: c ? c.updatedAt.toISOString() : null,
    };
  }
}
