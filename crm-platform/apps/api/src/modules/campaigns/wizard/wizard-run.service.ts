import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  retryWindowCloses,
  type WizardAudienceCount,
  type WizardDraft,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  SENDER_DIRECTORY,
  WALLET_GATE,
  type SenderDirectory,
  type WalletGate,
} from '../../broadcasts';
import { MODULE_KEY } from '../campaign-events';
import { CampaignsRepository } from '../campaigns.repository';
import { createdWebhook, toSnapshot } from '../campaign-webhook-events';
import { WizardAudienceService } from './wizard-audience.service';
import { templateCategory } from './wizard-read.service';
import { WizardReviewService } from './wizard-review.service';
import { WizardRepository, type TemplateListRow } from './wizard.repository';
import { blankCampaignFor } from './wizard-blank';

/** Recipient rows are written in one transaction with the campaign; past this the audience must be narrowed (the classic builder caps at the same size). */
export const WIZARD_MAX_RECIPIENTS = 100_000;
const WRITE_CHUNK = 5000;

const BUILT_IN_ENGINES = new Set(['baileys', 'waba', 'twilio']);

/** The engine a template is sent through: its number's, else its stored channel, else the workspace's default. */
export function engineOf(t: TemplateListRow, defaultEngine: string): string {
  if (t.configProvider && BUILT_IN_ENGINES.has(t.configProvider)) return t.configProvider;
  if (t.channel && BUILT_IN_ENGINES.has(t.channel)) return t.channel;
  if (t.twilioContentSid) return 'twilio';
  if (t.metaTemplateId) return 'waba';
  return defaultEngine;
}

export interface RunInput {
  /** The draft being launched, or the series' blueprint. */
  draft: WizardDraft;
  template: TemplateListRow;
  /** Turn this draft row into the run (a launch from the wizard); otherwise a new row is made (a series' occurrence). */
  existingId: number | null;
  name: string;
  status: 'running' | 'scheduled';
  scheduleType: 'now' | 'scheduled';
  sendDate: string | null;
  sendTime: string | null;
  timezone: string;
  runAt: Date | null;
  series: { id: number; occurrenceNo: number } | null;
  createdBy: number | null;
  launch: Record<string, unknown>;
}

export interface RunResult {
  id: number;
  uuid: string;
  recipients: number;
  optedOut: number;
  invalidNumber: number;
}

/**
 * Makes a run (a campaign row with its recipients) from a wizard draft: a launch "now" or "scheduled", and every occurrence of a
 * recurring series. One code path, so a series' runs and a one-off launch resolve the audience, check the wallet and write the
 * recipients identically. The row, its recipients and its `campaign.created` event commit together or not at all.
 */
@Injectable()
export class WizardRunService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly audience: WizardAudienceService,
    private readonly review: WizardReviewService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
  ) {}

  /** The number a template sends from. Refuses (422) when none is connected. */
  async sender(
    tx: Tx,
    orgId: number,
    template: TemplateListRow,
    senderKey: string | null,
  ): Promise<{ provider: string; deviceId: number | null }> {
    // The number the person picked in step 1 wins; a draft without one (an old one) falls back to the template's own number.
    if (senderKey) {
      const [picked] = await this.senders.resolve(tx, orgId, [senderKey]);
      if (!picked) {
        throw new AppError(
          ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
          'The WhatsApp number you picked is not connected.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return { provider: picked.engine, deviceId: picked.id };
    }
    const def = await this.senders.defaultEngine(tx, orgId);
    const engine = engineOf(template, def);
    if (template.configUuid) {
      const [picked] = await this.senders.resolve(tx, orgId, [`${engine}:${template.configUuid}`]);
      if (!picked) {
        throw new AppError(
          ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
          'The WhatsApp number this template is tied to is not connected.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return { provider: picked.engine, deviceId: picked.id };
    }
    const found = await this.senders.resolveForDispatch(tx, orgId, {
      provider: engine,
      deviceId: null,
    });
    if (!found) {
      throw new AppError(
        ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
        'No WhatsApp number is connected to send this template.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { provider: found.engine, deviceId: null };
  }

  /**
   * Everything that can refuse a send before a row exists: a connected number, somebody to message, an audience of a size one
   * transaction can write, and a wallet that covers it (422 WALLET_EMPTY). Nothing is written, so the caller's transaction stays clean.
   */
  async preflight(
    tx: Tx,
    orgId: number,
    draft: WizardDraft,
    template: TemplateListRow,
  ): Promise<{
    sender: { provider: string; deviceId: number | null };
    count: WizardAudienceCount;
  }> {
    const sender = await this.sender(tx, orgId, template, draft.senderKey);
    const count = await this.audience.count(tx, orgId, draft.audience);
    if (count.recipients === 0) {
      throw new AppError(
        ERROR_CODES.CAMP_NO_RECIPIENTS,
        'Nobody on this audience can be messaged (everyone matching opted out or has no valid number).',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (count.recipients > WIZARD_MAX_RECIPIENTS) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `This audience has ${count.recipients} recipients; a broadcast takes at most ${WIZARD_MAX_RECIPIENTS}. Narrow it with a condition.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'audience', message: 'audience_too_large' }],
      );
    }
    await this.wallet.precheck(orgId, count.recipients, {
      source: 'campaign',
      phones: await this.review.gatePhones(tx, orgId, draft.audience),
      category: templateCategory(template.metaCategory, template.category),
    });
    return { sender, count };
  }

  /**
   * Resolves the audience, checks the wallet, writes the campaign and its recipients. Throws 422 CAMP_NO_RECIPIENTS when nobody is
   * left and WALLET_EMPTY when the wallet cannot cover it; the caller's transaction rolls back on either.
   */
  async createRun(tx: Tx, orgId: number, i: RunInput): Promise<RunResult> {
    const { sender, count } = await this.preflight(tx, orgId, i.draft, i.template);

    const id =
      i.existingId ??
      (await this.campaigns.insert(
        tx,
        orgId,
        blankCampaignFor({
          name: i.name,
          provider: sender.provider,
          deviceId: sender.deviceId,
          templateId: i.template.id,
          createdBy: i.createdBy,
        }),
      ));

    // CSV numbers that are not contacts yet become contacts now, so the recipient list below (the same function the count used) has them.
    const csv = await this.audience.materializeCsv(tx, orgId, i.draft.audience);

    let after = 0;
    let written = 0;
    for (;;) {
      const ids = await this.audience.recipientIds(tx, orgId, i.draft.audience, after, WRITE_CHUNK);
      if (ids.length === 0) break;
      await this.campaigns.insertRecipients(
        tx,
        orgId,
        id,
        ids.map((contactId) => ({ contactId, variant: null })),
      );
      written += ids.length;
      after = ids[ids.length - 1]!;
    }

    const zone = i.timezone;
    await this.repo.setLaunch(tx, orgId, id, {
      wizard: {
        draft: i.draft,
        launch: {
          ...i.launch,
          optedOut: count.optedOut,
          invalidNumber: count.invalidNumber,
          recipients: written,
          csvContactsCreated: csv.created,
          csvSkipped: csv.skipped,
        },
      },
      provider: sender.provider,
      deviceId: sender.deviceId,
      scheduleType: i.scheduleType,
      sendDate: i.sendDate,
      sendTime: i.sendTime,
      timezone: zone,
      status: i.status,
      total: written,
      runAt: i.runAt,
      seriesId: i.series?.id ?? null,
      occurrenceNo: i.series?.occurrenceNo ?? null,
      retryEnabled: i.draft.retries.enabled,
      retryUntil: i.draft.retries.enabled ? retryWindowCloses(i.draft.retries, zone) : null,
    });
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: id,
      action: i.existingId ? 'update' : 'insert',
    });
    const row = await this.campaigns.findById(tx, orgId, id);
    if (!row) throw AppError.notFound('Campaign');
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: id,
      eventType: 'campaign.created',
      payload: {
        uuid: row.uuid,
        name: row.name,
        type: row.type,
        status: row.status,
        scheduleType: row.scheduleType,
        totalRecipients: written,
        webhook: createdWebhook(toSnapshot(row), new Date()),
      },
    });
    return {
      id,
      uuid: row.uuid,
      recipients: written,
      optedOut: count.optedOut,
      invalidNumber: count.invalidNumber,
    };
  }
}
