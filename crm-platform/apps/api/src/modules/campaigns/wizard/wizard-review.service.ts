import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type WizardAudience,
  type WizardAudienceCount,
  type WizardCreditCheck,
  type WizardCreditCheckRequest,
  type WizardVariablePreview,
  type WizardVariablePreviewRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { MergeTagService } from '../../crm';
import { WALLET_GATE, type WalletGate } from '../../broadcasts';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import {
  BillingCurrencyService,
  RateCardService,
  WalletQueryService,
} from '../../wallet-message-billing';
import { WizardAudienceService, ELIGIBLE } from './wizard-audience.service';
import { templateCategory } from './wizard-read.service';
import {
  chargeableMessages,
  estimateCost,
  fillText,
  resolveMapping,
  templateSlots,
  type CostLine,
} from './wizard-rules';
import { WizardRepository, type TemplateListRow } from './wizard.repository';

/** Real numbers handed to the wallet's launch rule, so its per-country estimate follows the audience (the same sample at the check and at the launch). */
const GATE_PHONES = 2000;

/** Step 3 of the wizard: the credit check and the resolved sample messages. Both read; nothing here sends or charges. */
@Injectable()
export class WizardReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly audience: WizardAudienceService,
    private readonly merge: MergeTagService,
    private readonly wallet: WalletQueryService,
    private readonly rates: RateCardService,
    private readonly currency: BillingCurrencyService,
    private readonly plans: PlanEntitlementService,
    @Inject(WALLET_GATE) private readonly gate: WalletGate,
  ) {}

  /** Numbers of the audience for the wallet's launch rule. */
  async gatePhones(tx: Tx, orgId: number, audience: WizardAudience): Promise<string[]> {
    const { where } = await this.audience.where(tx, orgId, audience);
    const res = await tx.execute(sql`
      SELECT coalesce(contacts.normalized_phone, contacts.phone) AS phone FROM contacts
      WHERE ${where} AND ${ELIGIBLE} ORDER BY contacts.id LIMIT ${GATE_PHONES}`);
    const phones = (res.rows as Array<{ phone: string | null }>).flatMap((r) =>
      r.phone ? [r.phone] : [],
    );
    // CSV numbers that are not contacts yet are part of the audience too: they price the send like any other.
    if (phones.length < GATE_PHONES) {
      phones.push(
        ...(await this.audience.newCsvPhones(tx, orgId, audience, GATE_PHONES - phones.length)),
      );
    }
    return phones;
  }

  /**
   * The wallet's own launch rule decides whether this send may start (`sufficient`); the figures are for the person to read: the
   * balance, the price per country in this template's category, and what the send is expected to cost after the plan's allowance.
   */
  async creditCheck(req: WizardCreditCheckRequest): Promise<WizardCreditCheck> {
    const { orgId } = RequestContextStore.require();
    const prepared = await this.db.tx(async (tx) => {
      const template = await this.repo.templateByUuid(tx, orgId, req.templateId);
      if (!template)
        throw AppError.validation('Request payload failed validation', [
          { path: 'templateId', message: 'Template not found in this workspace.' },
        ]);
      const count = await this.audience.count(tx, orgId, req.audience);
      const phones = await this.gatePhones(tx, orgId, req.audience);
      return { template, count, phones };
    });
    const category = templateCategory(prepared.template.metaCategory, prepared.template.category);
    const summary = await this.wallet.summary();
    const platformOwned = (await this.plans.forOrg(orgId))?.platformOwned ?? false;

    const lines = await this.db.tx((tx) =>
      this.priceLines(tx, orgId, prepared.count, category, summary.currency),
    );
    const chargeable = chargeableMessages({
      mode: summary.billingMode,
      recipients: prepared.count.recipients,
      monthlyLimit: summary.plan.monthlyMessagesLimit,
      usedThisMonth: summary.plan.usedThisMonth,
      planActive: summary.plan.active,
    });
    const cost = estimateCost(lines, chargeable);
    // The full price of every message, for display only: the wallet's rules above still decide what is charged and whether it may start.
    const full = estimateCost(
      lines,
      lines.reduce((n, l) => n + l.messages, 0),
    );

    let sufficient = true;
    try {
      await this.gate.precheck(orgId, prepared.count.recipients, {
        source: 'campaign',
        phones: prepared.phones,
        category,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY) sufficient = false;
      else throw err;
    }
    return {
      currency: summary.currency,
      balanceMinor: summary.balanceMinor,
      billingMode: summary.billingMode,
      category,
      recipients: prepared.count.recipients,
      chargeableMessages: chargeable,
      estimatedCostMinor: cost.totalMinor,
      fullCostMinor: full.totalMinor,
      platformOwned,
      lines: lines.map((l, i) => ({
        ...l,
        subtotalMinor: cost.subtotals[i]!,
        fullSubtotalMinor: full.subtotals[i]!,
      })),
      sufficient,
      shortfallMinor: sufficient ? 0 : Math.max(0, cost.totalMinor - summary.balanceMinor),
      topupUrl: summary.topupUrl,
    };
  }

  private async priceLines(
    tx: Tx,
    orgId: number,
    count: WizardAudienceCount,
    category: string,
    unit: string,
  ): Promise<CostLine[]> {
    const lines: CostLine[] = [];
    for (const c of count.countries) {
      const priced = await this.rates.priceFor(tx, orgId, c.country, category, unit);
      lines.push({ country: c.country, messages: c.count, unitPriceMinor: priced.priceMinor });
    }
    return lines;
  }

  /** The template's message as a few real contacts would read it, and the placeholders still without a source. */
  async variablePreview(req: WizardVariablePreviewRequest): Promise<WizardVariablePreview> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const template = await this.repo.templateByUuid(tx, orgId, req.templateId);
      if (!template)
        throw AppError.validation('Request payload failed validation', [
          { path: 'templateId', message: 'Template not found in this workspace.' },
        ]);
      const slots = templateSlots(this.like(template));
      const unmapped = slots.filter((s) => !req.variables[s.slot]).map((s) => s.slot);

      const contacts = await this.audience.sample(tx, orgId, req.audience, req.limit);
      const base = await this.merge.baseContext(tx, orgId);
      const samples = [];
      for (const c of contacts) {
        const contact = await this.merge.contactFor(tx, orgId, c.id);
        const resolved = resolveMapping(slots, req.variables, { ...base, contact });
        samples.push({
          contact: { id: c.uuid, name: c.name, phone: c.phone },
          header: fillText(template.header, 'header', slots, resolved.values),
          body: fillText(template.body, 'body', slots, resolved.values) ?? '',
          footer: template.footer,
          values: resolved.values,
          empty: resolved.empty as WizardVariablePreview['samples'][number]['empty'],
        });
      }
      return { slots, unmapped: unmapped as WizardVariablePreview['unmapped'], samples };
    });
  }

  like(t: TemplateListRow) {
    return {
      templateBody: t.body,
      header: t.header,
      variableMap: t.variableMap,
      buttons: t.buttons,
    };
  }
}
