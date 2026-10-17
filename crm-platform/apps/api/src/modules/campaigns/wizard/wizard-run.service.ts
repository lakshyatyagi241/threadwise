import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  retryWindowCloses,
  splitAudience,
  wizardSenderPicks,
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
import { SenderSharesService, type RunSender } from '../sender-shares.service';

export type { RunSender };
import { CampaignsRepository } from '../campaigns.repository';
import { createdWebhook, toSnapshot } from '../campaign-webhook-events';
import { WizardAudienceService } from './wizard-audience.service';
import { templateCategory } from './wizard-read.service';
import { WizardReviewService } from './wizard-review.service';
import { WizardRepository, type TemplateListRow } from './wizard.repository';
import { blankCampaignFor, campaignColumnsOf } from './wizard-blank';
import { assignVariants } from '../campaign-rules';

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
    private readonly shares: SenderSharesService,
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
   * Every number a draft sends from, in the order picked (the first is the primary: the campaign's own number). One pick, or none (an
   * old draft that falls back to its template's number), is exactly {@link sender}. Several picks (TW-BCAST-006) must each be a
   * connected number of an engine that can share a send; a pick that is not is refused (422) naming it, so nothing is sent from a number the person
   * did not choose.
   */
  async senderList(
    tx: Tx,
    orgId: number,
    template: TemplateListRow,
    draft: WizardDraft,
  ): Promise<RunSender[]> {
    const picks = wizardSenderPicks(draft);
    if (picks.length <= 1) {
      const one = await this.sender(tx, orgId, template, picks[0] ?? null);
      return [
        {
          key: picks[0] ?? '',
          provider: one.provider,
          deviceId: one.deviceId,
          label: '',
          weight: 1,
        },
      ];
    }
    return this.shares.resolvePicks(tx, orgId, picks, draft.senderShare);
  }

  /**
   * A split send needs the template to be sendable from every picked number. A template tied to one WhatsApp connection (its Meta
   * account) goes out only from numbers of that same account; a template tied to none goes from any. Refuses (422) with the first
   * number that cannot send it. A send from one number is not checked here: it behaves as it always did.
   */
  async assertUsableOnEvery(
    tx: Tx,
    orgId: number,
    template: Pick<TemplateListRow, 'name' | 'providerConfigId'>,
    senders: readonly RunSender[],
  ): Promise<void> {
    await this.shares.assertTemplateOnEvery(
      tx,
      orgId,
      { name: template.name, providerConfigId: template.providerConfigId },
      senders,
    );
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
    senders: RunSender[];
    count: WizardAudienceCount;
  }> {
    const senders = await this.senderList(tx, orgId, template, draft);
    await this.assertUsableOnEvery(tx, orgId, template, senders);
    const sender = senders[0]!;
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
    return { sender, senders, count };
  }

  /**
   * Resolves the audience, checks the wallet, writes the campaign and its recipients. Throws 422 CAMP_NO_RECIPIENTS when nobody is
   * left and WALLET_EMPTY when the wallet cannot cover it; the caller's transaction rolls back on either.
   */
  async createRun(tx: Tx, orgId: number, i: RunInput): Promise<RunResult> {
    const { sender, senders, count } = await this.preflight(tx, orgId, i.draft, i.template);

    // A/B: variant B's template, checked here too so every run of a series (not only the launch) refuses a template that is gone.
    let templateB: TemplateListRow | undefined;
    if (i.draft.abTesting) {
      templateB = i.draft.templateIdB
        ? await this.repo.templateByUuid(tx, orgId, i.draft.templateIdB)
        : undefined;
      if (!templateB) {
        throw new AppError(
          ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
          'The variant B template of this A/B test is not available.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const options = campaignColumnsOf(i.draft, templateB?.id ?? null);

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
          extra: options,
        }),
      ));

    // CSV numbers that are not contacts yet become contacts now, so the recipient list below (the same function the count used) has them.
    const csv = await this.audience.materializeCsv(tx, orgId, i.draft.audience);

    // The whole audience first, so an A/B split is exact over everyone (as the classic create does) rather than per page.
    const everyone: number[] = [];
    let after = 0;
    for (;;) {
      const ids = await this.audience.recipientIds(tx, orgId, i.draft.audience, after, WRITE_CHUNK);
      if (ids.length === 0) break;
      everyone.push(...ids);
      after = ids[ids.length - 1]!;
    }
    // A split send (TW-BCAST-014): the audience is cut in slices by weight, in contact order, and each contact is messaged from its
    // slice's number. A send from one number writes no per-recipient number and behaves as before.
    const slices =
      senders.length > 1
        ? splitAudience(
            everyone,
            senders.map((x) => x.weight),
          )
        : [];
    const senderOf = this.shares.assign(everyone, senders);
    const variants = options.abTesting
      ? assignVariants(everyone, i.draft.abSplit, Math.random)
      : new Map<number, 'A' | 'B'>();
    for (let from = 0; from < everyone.length; from += WRITE_CHUNK) {
      await this.campaigns.insertRecipients(
        tx,
        orgId,
        id,
        everyone.slice(from, from + WRITE_CHUNK).map((contactId) => ({
          contactId,
          variant: variants.get(contactId) ?? null,
          sender: senderOf.get(contactId) ?? null,
        })),
      );
    }
    const written = everyone.length;

    const zone = i.timezone;
    await this.repo.setLaunch(tx, orgId, id, {
      wizard: {
        draft: i.draft,
        launch: {
          ...i.launch,
          optedOut: count.optedOut,
          invalidNumber: count.invalidNumber,
          recipients: written,
          ...(slices.length > 0
            ? {
                split: senders.map((x, n) => ({
                  key: x.key,
                  weight: x.weight,
                  count: slices[n]!.length,
                })),
              }
            : {}),
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
      options,
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
