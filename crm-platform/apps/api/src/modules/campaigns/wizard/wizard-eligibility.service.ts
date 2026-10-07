import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  wizardAudienceHasSource,
  type WizardAudience,
  type WizardDraft,
  type WizardEligibility,
  type WizardEligibilityGroup,
  type WizardEligibilityRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { SENDER_DIRECTORY, type SenderDirectory } from '../../broadcasts';
import { WizardAudienceService } from './wizard-audience.service';
import {
  billingGroup,
  contactsGroup,
  eligibilityOf,
  templateGroup,
  type SenderFacts,
} from './wizard-eligibility-rules';
import { WizardReviewService } from './wizard-review.service';
import { templateSlots } from './wizard-rules';
import { WizardRepository, type TemplateListRow } from './wizard.repository';

const BUILT_IN_ENGINES = new Set(['baileys', 'waba', 'twilio']);

/** The engine a template is sent through: its number's, else its stored channel, else the workspace's default. */
export function engineOf(t: TemplateListRow, defaultEngine: string): string {
  if (t.configProvider && BUILT_IN_ENGINES.has(t.configProvider)) return t.configProvider;
  if (t.channel && BUILT_IN_ENGINES.has(t.channel)) return t.channel;
  if (t.twilioContentSid) return 'twilio';
  if (t.metaTemplateId) return 'waba';
  return defaultEngine;
}

export type SenderLookup =
  | { ok: true; provider: string; deviceId: number | null; label: string }
  | { ok: false; why: 'picked' | 'template' | 'none' };

/**
 * Step 3's "can this broadcast really go out?": three groups (the contacts, the template with its sender and the variable mapping,
 * the billing) each with a state, a reason code and counts. Every fact is read through the code the launch itself uses (the audience
 * resolver, the sender directory, the wallet gate), and the launch asks this service again, so a stale or tampered client cannot
 * launch what the card would have refused. Nothing here writes or sends.
 */
@Injectable()
export class WizardEligibilityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly audience: WizardAudienceService,
    private readonly review: WizardReviewService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** The number a template sends from, without throwing: the launch maps a failure to its 422, the check to a row. */
  async lookupSender(
    tx: Tx,
    orgId: number,
    template: TemplateListRow,
    senderKey: string | null,
  ): Promise<SenderLookup> {
    // The number the person picked in step 1 wins; a draft without one (an old one) falls back to the template's own number.
    if (senderKey) {
      const [picked] = await this.senders.resolve(tx, orgId, [senderKey]);
      return picked
        ? { ok: true, provider: picked.engine, deviceId: picked.id, label: picked.label }
        : { ok: false, why: 'picked' };
    }
    const def = await this.senders.defaultEngine(tx, orgId);
    const engine = engineOf(template, def);
    if (template.configUuid) {
      const [picked] = await this.senders.resolve(tx, orgId, [`${engine}:${template.configUuid}`]);
      return picked
        ? { ok: true, provider: picked.engine, deviceId: picked.id, label: picked.label }
        : { ok: false, why: 'template' };
    }
    const found = await this.senders.resolveForDispatch(tx, orgId, {
      provider: engine,
      deviceId: null,
    });
    return found
      ? { ok: true, provider: found.engine, deviceId: null, label: found.label }
      : { ok: false, why: 'none' };
  }

  /** The template, its number and the variable mapping. Also the part of the check the launch enforces. */
  async templateAndSender(
    tx: Tx,
    orgId: number,
    template: TemplateListRow,
    senderKey: string | null,
    variables: WizardDraft['variables'],
    now: Date,
  ): Promise<WizardEligibilityGroup> {
    const sender = await this.lookupSender(tx, orgId, template, senderKey);
    const health =
      sender.ok && sender.provider === 'waba' && sender.deviceId !== null
        ? await this.repo.senderHealth(tx, orgId, sender.deviceId)
        : { qualityRating: null, phoneStatus: null, wabaId: null };
    const own =
      template.providerConfigId !== null && template.configProvider === 'waba'
        ? await this.repo.senderHealth(tx, orgId, template.providerConfigId)
        : null;
    const facts: SenderFacts = {
      connected: sender.ok,
      label: sender.ok ? sender.label : null,
      ...health,
    };
    const slots = templateSlots({
      templateBody: template.body,
      header: template.header,
      variableMap: template.variableMap,
      buttons: template.buttons,
    });
    return templateGroup({
      template: {
        templateType: template.templateType,
        status: template.status,
        metaTemplateId: template.metaTemplateId,
        metaStatus: template.metaStatus,
        pausedUntil: template.pausedUntil,
        qualityScore: template.qualityScore,
        ownWabaId: own?.wabaId ?? null,
      },
      sender: facts,
      unmappedSlots: slots.filter((s) => !variables[s.slot]).length,
      now,
    });
  }

  async check(req: WizardEligibilityRequest): Promise<WizardEligibility> {
    const { orgId } = RequestContextStore.require();
    const now = new Date();
    const prepared = await this.db.tx(async (tx) => {
      const template = await this.repo.templateByUuid(tx, orgId, req.templateId);
      if (!template)
        throw AppError.validation('Request payload failed validation', [
          { path: 'templateId', message: 'Template not found in this workspace.' },
        ]);
      const count = await this.audience.count(tx, orgId, req.audience);
      const merged = await this.audience.overlap(tx, orgId, req.audience);
      const tpl = await this.templateAndSender(
        tx,
        orgId,
        template,
        req.senderKey,
        req.variables,
        now,
      );
      return { count, merged, tpl };
    });

    const contacts = contactsGroup({
      hasSource: wizardAudienceHasSource(req.audience),
      count: prepared.count,
      duplicates: (prepared.merged ?? 0) + (req.audience.csv?.duplicate ?? 0),
    });
    return eligibilityOf({
      contacts,
      template: prepared.tpl,
      billing: await this.billing(req.templateId, req.audience),
    });
  }

  private async billing(
    templateId: string,
    audience: WizardAudience,
  ): Promise<WizardEligibilityGroup> {
    const { orgId } = RequestContextStore.require();
    try {
      const { check, summary, refusal } = await this.review.creditFacts({ templateId, audience });
      const walletExists = await this.db.tx((tx) =>
        this.repo.walletExists(tx, orgId, summary.currency),
      );
      return billingGroup({
        unavailable: false,
        billingMode: check.billingMode,
        planActive: summary.plan.active,
        monthlyLimit: summary.plan.monthlyMessagesLimit,
        usedThisMonth: summary.plan.usedThisMonth,
        recipients: check.recipients,
        chargeableMessages: check.chargeableMessages,
        estimatedCostMinor: check.estimatedCostMinor,
        balanceMinor: check.balanceMinor,
        currency: check.currency,
        walletExists,
        refusal,
      });
    } catch {
      return billingGroup({
        unavailable: true,
        billingMode: 'wallet',
        planActive: true,
        monthlyLimit: 0,
        usedThisMonth: 0,
        recipients: 0,
        chargeableMessages: 0,
        estimatedCostMinor: 0,
        balanceMinor: 0,
        currency: '',
        walletExists: false,
        refusal: null,
      });
    }
  }

  /**
   * Launch: refuses (422) a draft whose template or number fails its group, naming the group and the code in `errors[]`
   * (`eligibility.template` / `<code>`). The contacts and the billing are refused by the same count and the same wallet rule in
   * the run's preflight, with their own codes (CAMP_NO_RECIPIENTS, WALLET_EMPTY).
   */
  async assertLaunchable(
    tx: Tx,
    orgId: number,
    draft: WizardDraft,
    template: TemplateListRow,
    now: Date,
  ): Promise<void> {
    const group = await this.templateAndSender(
      tx,
      orgId,
      template,
      draft.senderKey,
      draft.variables,
      now,
    );
    const failed = group.checks.filter((c) => c.state === 'fail');
    if (failed.length === 0) return;
    throw new AppError(
      ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
      'This broadcast cannot go out: the template or the number it is sent from is not eligible.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      failed.map((c) => ({ path: 'eligibility.template', message: c.code })),
    );
  }
}
