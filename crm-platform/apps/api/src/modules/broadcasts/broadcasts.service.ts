import { SegmentsService } from '../crm';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  createBroadcastSchema,
  type CreateBroadcastInput,
  type CreateBroadcastResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { SendPolicyService } from '../auth';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { splitAudience } from './audience-split';
import { sanitizeOverrides } from './payload/template-overrides';
import { toBroadcastResponse } from './broadcasts.mapper';
import { BroadcastsRepository } from './broadcasts.repository';
import { isKnownTimeZone, wallTimeToUtc } from './schedule';
import { templateRefusals } from './template-guards';
import {
  BROADCAST_PLAN_GATE,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
  type BroadcastPlanGate,
  type ResolvedSender,
  type SenderDirectory,
  type TemplateDirectory,
  type WalletGate,
  type WarmerGate,
} from './_shims/tokens';

const MODULE_KEY = 'broadcasts';

const refuse = (code: keyof typeof ERROR_CODES, message: string) =>
  new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Creating a broadcast (TW-BCAST-009, 010, 011, 012, 013, 014, 015).
 *
 * The checks run in Reference's order and stop at the first refusal: plan feature, plan cap, validation, senders, audience,
 * send policy and wallet, template, schedule, warmer. Everything after that is one transaction, so a fan-out across
 * several senders is created whole or not at all. Dispatch is not done here: each created broadcast emits
 * `broadcast.created` through the outbox and the runner (TW-BCAST-016) picks it up.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly sendPolicy: SendPolicyService,
    private readonly outbox: OutboxService,
    private readonly progress: BroadcastProgressService,
    private readonly audit: AuditService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    @Inject(WARMER_GATE) private readonly warmer: WarmerGate,
    @Inject(BROADCAST_PLAN_GATE) private readonly planGate: BroadcastPlanGate,
    private readonly planUsage: PlanUsageService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    private readonly segments: SegmentsService,
  ) {}

  /** `body` is validated here, after the plan checks, because Reference answered a plan refusal before a validation error. */
  async create(body: unknown): Promise<CreateBroadcastResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;

    await this.planGate.assertEnabled(orgId);
    const used = await this.db.tx((tx) => this.repo.count(tx, orgId));
    await this.entitlements.assertWithinLimit(orgId, 'broadcasts', used);

    const parsed = createBroadcastSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation(
        'Request payload failed validation',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const input = parsed.data;
    if (!isKnownTimeZone(input.timezone)) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'timezone', message: 'unknown time zone' },
      ]);
    }

    // A sender that names the unofficial engine is a refusal, not a silently dropped key (owner decision 2026-10-05).
    if (input.senderKeys.some((k) => k.trim().startsWith(`${UNOFFICIAL_ENGINE}:`))) {
      await this.unofficial.assertEnabledFor(orgId);
    }

    return this.db.tx(async (tx) => {
      const resolved = await this.senders.resolve(tx, orgId, input.senderKeys);

      const contactIds = await this.resolveAudience(tx, orgId, input);
      if (contactIds.length === 0) {
        throw refuse(
          'BCAST_NO_RECIPIENTS',
          'Select at least one contact or group (opted-out contacts are skipped automatically).',
        );
      }

      // The plan's `broadcast_recipients` cap: the size of this one audience (before it is split across senders), 422 when over.
      await this.planUsage.assertAudienceWithin(orgId, contactIds.length);

      // Emergency halt and content screening once for the batch (the same hook every send path shares), then the wallet.
      await this.sendPolicy.screenBulk(orgId, '', { source: 'broadcast' });
      try {
        await this.wallet.precheck(orgId, contactIds.length);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw refuse(
          'BCAST_SEND_BLOCKED',
          err instanceof Error ? err.message : 'The wallet cannot cover this send.',
        );
      }

      const template = await this.templates.find(tx, orgId, input.templateId);
      if (!template) {
        throw refuse(
          'BCAST_TEMPLATE_NOT_FOUND',
          'Selected template was not found in your workspace.',
        );
      }
      const mediaUrl = template.attachmentFile
        ? this.templates.mediaUrl(template.attachmentFile)
        : null;
      const refusals = templateRefusals(
        { ...template, mediaUrl },
        { wabaTemplatesV2: await this.templates.wabaTemplatesV2Enabled(tx) },
      );
      if (refusals.length) throw refuse('BCAST_TEMPLATE_NOT_ALLOWED', refusals[0]!);

      const isNow = input.scheduleType === 'now';
      const scheduledAt = isNow
        ? new Date()
        : wallTimeToUtc(input.sendDate!, input.sendTime!, input.timezone);

      // One slice per sender; none picked is a single sender-less broadcast on the workspace default engine.
      const slices: Array<ResolvedSender | null> = resolved.length ? resolved : [null];
      const weights = slices.map((s) => (s ? (input.senderShare[s.key] ?? 1) : 1));
      const buckets = splitAudience(contactIds, weights);

      const holds = await this.warmer.hold(
        tx,
        slices.flatMap((s, i) =>
          s && buckets[i]!.length ? [{ sender: s, recipients: buckets[i]!.length }] : [],
        ),
        { isNow, sendDate: isNow ? null : input.sendDate! },
      );
      if (holds.length) {
        throw refuse(
          'BCAST_WARMER_HOLD',
          `Held by WhatsApp Warmer: ${holds.join(' ')} You can adjust these limits at /warmer.`,
        );
      }

      const defaultEngine = await this.senders.defaultEngine(tx, orgId);
      const overrides = sanitizeOverrides(input.templateOverrides);
      const created: CreateBroadcastResponse['broadcasts'] = [];

      for (const [i, sender] of slices.entries()) {
        const slice = buckets[i]!;
        // Fewer contacts than senders leaves some slices empty; those create nothing.
        if (slice.length === 0 && sender !== null && slices.length > 1) continue;

        const suffix =
          slices.length > 1 && sender ? ` · ${sender.label.trim() || `Device #${sender.id}`}` : '';
        const row = await this.repo.insert(tx, orgId, {
          userId: ctx.userId,
          provider: sender ? sender.engine : defaultEngine,
          deviceId: sender ? sender.id : null,
          templateId: template.id,
          templateOverrides: overrides,
          name: `${input.name}${suffix}`,
          timezone: input.timezone,
          status: isNow ? 'processing' : 'scheduled',
          scheduledAt,
          totalRecipients: slice.length,
        });
        await this.repo.insertRecipients(tx, orgId, row.id, slice);

        await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: row.id,
          eventType: 'broadcast.created',
          payload: {
            uuid: row.uuid,
            status: row.status,
            isNow,
            totalRecipients: slice.length,
            ...(await this.progress.createdPayload(tx, orgId, row.id)),
          },
        });
        created.push(toBroadcastResponse(row, sender ? sender.key : null));
      }

      this.logger.log(
        { count: created.length, audience: contactIds.length, senders: slices.length },
        'broadcast created',
      );
      return { broadcasts: created, devicesCount: slices.length };
    });
  }

  /** Direct contacts, then group, tag and segment members; first occurrence wins; opted-out and archived dropped. */
  private async resolveAudience(
    tx: Parameters<BroadcastsRepository['count']>[0],
    orgId: number,
    input: CreateBroadcastInput,
  ): Promise<number[]> {
    const merged = [
      ...(await this.repo.contactIdsByUuid(tx, orgId, input.contactIds)),
      ...(await this.repo.groupMemberIds(tx, orgId, input.groupIds)),
      ...(await this.repo.tagMemberIds(tx, orgId, input.tagIds)),
      ...(await this.segments.memberIdsIn(tx, orgId, input.segmentIds ?? [])),
    ];
    const unique = [...new Set(merged)];
    if (unique.length === 0) return [];
    const sendable = await this.repo.sendableIds(tx, orgId, unique);
    return unique.filter((id) => sendable.has(id));
  }
}
