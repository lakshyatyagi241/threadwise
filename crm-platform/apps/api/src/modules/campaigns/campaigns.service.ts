import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  EDITABLE_STATUSES,
  ERROR_CODES,
  type Campaign,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SendPolicyService } from '../auth';
import {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  isKnownTimeZone,
  templateRefusals,
  type SenderDirectory,
  type TemplateDirectory,
} from '../broadcasts';
import { CAMPAIGN_PLAN_GATE, type CampaignPlanGate } from './_shims/tokens';
import { CampaignAudienceService, hasAudience } from './audience.service';
import { CampaignJobs } from './campaign-jobs';
import {
  assignVariants,
  expiresBeforeSend,
  localDateTimeToUtc,
  mediaColumnFor,
  normalizeCustomMessage,
} from './campaign-rules';
import { toCampaign } from './campaigns.mapper';
import { CampaignsRepository, type NewCampaign } from './campaigns.repository';

export const MODULE_KEY = 'campaigns';

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);
const field = (path: string, message: string) =>
  AppError.validation('Request payload failed validation', [{ path, message }]);

const CREATED_MESSAGE = {
  now: 'Campaign launched.',
  recurring: 'Recurring campaign saved.',
  scheduled: 'Campaign scheduled.',
} as const;

type Form = CreateCampaignInput | UpdateCampaignInput;

/**
 * Creating and editing a campaign (WD-CAMP-003 to 010).
 *
 * The checks run in WaDesk's order and stop at the first refusal: plan feature, plan cap, validation, the end-date guard,
 * the send guardrails, the audience, the template gate, variant B ownership, then the write (one transaction: the campaign and
 * every recipient row, or nothing). A "send now" campaign is queued after the commit; a scheduled or recurring one waits for the
 * sweeper.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly audience: CampaignAudienceService,
    private readonly crypto: CryptoService,
    private readonly sendPolicy: SendPolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jobs: CampaignJobs,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(CAMPAIGN_PLAN_GATE) private readonly plan: CampaignPlanGate,
  ) {}

  async create(input: CreateCampaignInput): Promise<{ campaign: Campaign; message: string }> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;

    await this.plan.assertEnabled(orgId);
    await this.plan.assertWithinCap(orgId, await this.db.tx((tx) => this.repo.count(tx, orgId)));

    const form = await this.prepare(input);
    const status = input.status ?? (input.scheduleType === 'now' ? 'running' : 'scheduled');

    const created = await this.db.tx(async (tx) => {
      const contactIds = await this.audience.resolve(tx, orgId, ctx.userId, input);
      if (contactIds.length === 0 && status !== 'draft') {
        throw refuse(
          'CAMP_NO_RECIPIENTS',
          'Pick at least one contact, group, tag or number to send to.',
        );
      }
      const resolved = await this.resolve(tx, orgId, input);
      const id = await this.repo.insert(tx, orgId, {
        ...form,
        ...resolved,
        status,
        totalRecipients: contactIds.length,
        createdBy: ctx.userId,
      });

      const variants = input.abTesting
        ? assignVariants(contactIds, input.abSplit, Math.random)
        : new Map<number, 'A' | 'B'>();
      await this.repo.insertRecipients(
        tx,
        orgId,
        id,
        contactIds.map((contactId) => ({ contactId, variant: variants.get(contactId) ?? null })),
      );

      const row = await this.repo.findById(tx, orgId, id);
      if (!row) throw AppError.notFound('Campaign', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
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
          totalRecipients: contactIds.length,
        },
      });
      return row;
    });

    if (created.status === 'running') {
      await this.jobs.enqueue(orgId, created.id, created.uuid);
    }
    this.logger.log(
      { orgId, campaign: created.uuid, recipients: created.totalRecipients },
      'campaign created',
    );
    return {
      campaign: toCampaign(created),
      message: CREATED_MESSAGE[input.scheduleType],
    };
  }

  async update(
    uuid: string,
    input: UpdateCampaignInput,
  ): Promise<{ campaign: Campaign; message: string }> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const form = await this.prepare(input);

    const row = await this.db.tx(async (tx) => {
      const locked = await this.repo.lock(tx, orgId, uuid);
      if (!locked) throw AppError.notFound('Campaign', uuid);
      if (!(EDITABLE_STATUSES as readonly string[]).includes(locked.status)) {
        throw refuse('CAMP_NOT_EDITABLE', 'This campaign can no longer be edited.');
      }
      const resolved = await this.resolve(tx, orgId, input);
      const media = this.media(input);
      await this.repo.update(tx, orgId, locked.id, {
        ...form,
        ...resolved,
        status: input.status ?? null,
        media: input.mediaUrl === undefined ? null : media,
        overrides: input.templateOverrides !== undefined,
        overridesB: input.templateOverridesB !== undefined,
      });

      // Recipients are rebuilt only when the form carried an audience and it is not empty (WaDesk).
      if (hasAudience(input)) {
        const contactIds = await this.audience.resolve(tx, orgId, ctx.userId, input);
        if (contactIds.length > 0) {
          await this.repo.deleteRecipients(tx, orgId, locked.id);
          const variants = input.abTesting
            ? assignVariants(contactIds, input.abSplit, Math.random)
            : new Map<number, 'A' | 'B'>();
          await this.repo.insertRecipients(
            tx,
            orgId,
            locked.id,
            contactIds.map((contactId) => ({
              contactId,
              variant: variants.get(contactId) ?? null,
            })),
          );
          await this.repo.setTotal(tx, orgId, locked.id, contactIds.length);
        }
      }
      await this.audit.record(tx, { module: MODULE_KEY, recordId: locked.id, action: 'update' });
      const fresh = await this.repo.findById(tx, orgId, locked.id);
      if (!fresh) throw AppError.notFound('Campaign', uuid);
      return fresh;
    });
    return { campaign: toCampaign(row), message: 'Campaign updated.' };
  }

  // ------------------------------------------------------------------ shared

  /** Everything that can be decided without a database: time zone, end date, body, guardrails. */
  private async prepare(
    input: Form,
  ): Promise<
    Omit<
      NewCampaign,
      | 'status'
      | 'totalRecipients'
      | 'createdBy'
      | 'provider'
      | 'deviceId'
      | 'templateId'
      | 'templateIdA'
      | 'templateIdB'
      | 'flowId'
      | 'flowIdB'
      | 'customImage'
      | 'customVideo'
      | 'customDocument'
    >
  > {
    const orgId = RequestContextStore.require().orgId;
    const timezone = input.timezone ?? 'UTC';
    if (!isKnownTimeZone(timezone)) throw field('timezone', 'unknown time zone');

    if (
      expiresBeforeSend({
        scheduleType: input.scheduleType,
        sendDate: input.sendDate,
        sendTime: input.sendTime,
        expiresAtLocal: input.expiresAt,
        timezone,
      })
    ) {
      throw refuse(
        'CAMP_EXPIRY_BEFORE_SEND',
        'The auto-end date must be after the send date, otherwise the campaign would expire before it ever sends.',
      );
    }

    const norm = normalizeCustomMessage(input.customMessage ?? '', input.variableMap);
    // The body is the same for every recipient, so it is screened once. A template campaign carries no free text here.
    await this.sendPolicy.screenBulk(orgId, norm.body, { source: 'campaign' });

    const recurring = input.scheduleType === 'recurring';
    const enc = (v: string | null | undefined) => (v ? this.crypto.encrypt(v) : null);
    return {
      name: input.name,
      type: input.type,
      abTesting: input.abTesting ?? false,
      abSplit: input.abSplit ?? 50,
      customMessage: enc(norm.body),
      customMessageB: enc(input.customMessageB),
      customHeader: enc(input.customHeader),
      customFooter: enc(input.customFooter),
      customButtons: input.customButtons ?? null,
      customQuickReplies: input.customQuickReplies ?? null,
      variableMap: norm.map,
      templateOverrides: input.templateOverrides ?? null,
      templateOverridesB: input.templateOverridesB ?? null,
      useAttributes: input.useAttributes ?? false,
      trackingEnabled: input.trackingEnabled ?? true,
      scheduleType: input.scheduleType,
      sendDate: input.sendDate ?? null,
      sendTime: input.sendTime ?? null,
      timezone,
      repeatInterval: recurring ? (input.repeatInterval ?? 'weekly') : null,
      repeatUntil: recurring ? (input.repeatUntil ?? null) : null,
      expiresAt: localDateTimeToUtc(input.expiresAt, timezone),
      throttleMinSec: input.throttleMinSec ?? null,
      throttleMaxSec: input.throttleMaxSec ?? null,
      batchSize: input.batchSize ?? null,
      batchPauseMin: input.batchPauseMin ?? null,
      dailyLimit: input.dailyLimit ?? null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
    };
  }

  /** The one media of the message, as the column it belongs in. Refuses a kind WhatsApp cannot take. */
  private media(input: Form): {
    image: string | null;
    video: string | null;
    document: string | null;
  } {
    const none = { image: null, video: null, document: null };
    if (!input.mediaUrl) return none;
    const col = mediaColumnFor(input.mediaUrl);
    if (!col) {
      throw field(
        'mediaUrl',
        'Use an image (jpg, jpeg, png), a video (mp4) or a document (pdf, doc, docx).',
      );
    }
    return {
      ...none,
      [col === 'custom_image' ? 'image' : col === 'custom_video' ? 'video' : 'document']:
        input.mediaUrl,
    };
  }

  /** The sender, templates, flows and media, looked up inside the write's transaction. */
  private async resolve(
    tx: Tx,
    orgId: number,
    input: Form,
  ): Promise<
    Pick<
      NewCampaign,
      | 'provider'
      | 'deviceId'
      | 'templateId'
      | 'templateIdA'
      | 'templateIdB'
      | 'flowId'
      | 'flowIdB'
      | 'customImage'
      | 'customVideo'
      | 'customDocument'
      | 'customButtons'
      | 'customQuickReplies'
    >
  > {
    // The sender picked (engine and id together), else the workspace's default engine with no number.
    let provider: string;
    let deviceId: number | null = null;
    if (input.senderKey) {
      const [picked] = await this.senders.resolve(tx, orgId, [input.senderKey]);
      if (!picked) throw field('senderKey', 'That number is not connected.');
      provider = picked.engine;
      deviceId = picked.id;
    } else {
      provider = await this.senders.defaultEngine(tx, orgId);
    }

    const templateId = await this.template(tx, orgId, input.type, input.templateId, provider);
    const templateIdA = await this.owned(tx, orgId, input.templateIdA, 'templateIdA');
    const templateIdB = await this.owned(tx, orgId, input.templateIdB, 'templateIdB');
    const flowId = input.flowId ? await this.repo.flowId(tx, orgId, input.flowId) : null;
    const flowIdB = input.flowIdB ? await this.repo.flowId(tx, orgId, input.flowIdB) : null;
    if (input.flowId && flowId === null) throw field('flowId', 'Flow not found in this workspace.');
    if (input.flowIdB && flowIdB === null) {
      throw field('flowIdB', 'Variant B flow not found in this workspace.');
    }

    const m = this.media(input);
    // Cloud API and Twilio cannot carry inline buttons on a custom send, so they are dropped rather than stored and shipped.
    const noButtons = provider === 'twilio' || provider === 'waba';
    return {
      provider,
      deviceId,
      templateId,
      templateIdA,
      templateIdB,
      flowId,
      flowIdB,
      customImage: m.image,
      customVideo: m.video,
      customDocument: m.document,
      customButtons: noButtons ? [] : (input.customButtons ?? null),
      customQuickReplies: noButtons ? [] : (input.customQuickReplies ?? null),
    };
  }

  /** A variant template must belong to this organization: a forged id is refused, as WaDesk's ownership check does. */
  private async owned(
    tx: Tx,
    orgId: number,
    uuid: string | null | undefined,
    path: string,
  ): Promise<number | null> {
    if (!uuid) return null;
    const t = await this.templates.find(tx, orgId, uuid);
    if (!t) throw field(path, 'Template not found in this workspace.');
    return t.id;
  }

  /** WD-CAMP-005: the template gate. Only a template campaign has one. */
  private async template(
    tx: Tx,
    orgId: number,
    type: string,
    uuid: string | null | undefined,
    engine: string,
  ): Promise<number | null> {
    if (!uuid) return null;
    const tpl = await this.templates.find(tx, orgId, uuid);
    if (!tpl) throw field('templateId', 'Template not found.');
    if (type !== 'template') return tpl.id;

    // On the Cloud API only an approved template may be sent; the other engines take any.
    if (engine === 'waba') {
      const status = await this.repo.templateStatus(tx, orgId, tpl.id);
      if (!['approved', 'public'].includes(status ?? '')) {
        throw refuse(
          'CAMP_TEMPLATE_NOT_ALLOWED',
          `WABA engine requires a Meta-approved template. This template is "${status ?? ''}".`,
        );
      }
    }
    if (tpl.templateType === 'auth') {
      throw refuse(
        'CAMP_TEMPLATE_NOT_ALLOWED',
        'Authentication (OTP) templates cannot be sent via campaign — each recipient needs a unique verifiable code. Send them 1:1 from your backend using the transactional template send endpoint instead.',
      );
    }
    const mediaUrl = tpl.attachmentFile ? this.templates.mediaUrl(tpl.attachmentFile) : null;
    const refusals = templateRefusals(
      { ...tpl, mediaUrl },
      { wabaTemplatesV2: await this.templates.wabaTemplatesV2Enabled(tx) },
    );
    if (refusals.length > 0) {
      throw refuse(
        'CAMP_TEMPLATE_NOT_ALLOWED',
        refusals[0]!.replace('Cannot broadcast this template', 'Cannot use this template'),
      );
    }
    return tpl.id;
  }
}
