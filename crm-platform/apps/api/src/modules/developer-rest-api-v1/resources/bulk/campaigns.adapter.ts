import { V1_BULK_CODE } from './bulk-codes';
import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  createCampaignSchema,
  type CreateCampaignInput,
  type PageInfo,
  type V1CreateCampaign,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../../../common/pagination/cursor';
import { DatabaseService } from '../../../../infra/db/database.service';
import { isKnownTimeZone } from '../../../broadcasts';
import {
  CampaignsActionsService,
  CampaignsReadService,
  CampaignsRepository,
  CampaignsService,
} from '../../../campaigns';
import { contactDigits, normalizeTime, refusalAs, wallClockIn } from './bulk-input';
import { storedStatus, statisticsOf, type CampaignFacts } from './campaigns.mapper';
import { V1SenderKeys } from './sender-keys.service';
import type { V1CampaignStatistics } from '@crm/contracts';

/** The name WaDesk's inner form accepts; the outer request allows 255 (WD-API-087). */
const NAME_MAX = 191;
const STOPPABLE = ['running', 'scheduled', 'paused'];
/** `cancelled` is WaDesk's `stopped`: it can be deleted here, which WaDesk refused (its list of deletable states forgot it). */
const DELETABLE = ['scheduled', 'failed', 'completed', 'cancelled'];

const CREATE_REFUSALS = {
  [ERROR_CODES.CAMP_NO_RECIPIENTS]: V1_BULK_CODE.CREATE_FAILED,
  [ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED]: V1_BULK_CODE.CREATE_FAILED,
  [ERROR_CODES.CAMP_EXPIRY_BEFORE_SEND]: V1_BULK_CODE.CREATE_FAILED,
} as const;
const RENAME = {
  name: 'campaign_name',
  senderKey: 'device_id',
  type: 'campaign_type',
  scheduleType: 'schedule_type',
  templateId: 'template_id',
  templateIdA: 'template_id_a',
  templateIdB: 'template_id_b',
  flowId: 'flow_id',
};

const createFailed = (message: string, path: string) =>
  new AppError(V1_BULK_CODE.CREATE_FAILED, message, 422, [{ path, message }]);

/**
 * The customer API's campaigns (WD-API-085 to 090, 095): the dashboard's create, read and cancel services behind WaDesk's request and
 * answer shapes. Recipients and senders are translated here (see `bulk-input.ts`); every rule about plans, wallet, templates and pacing is
 * the service's.
 */
@Injectable()
export class V1CampaignsAdapter {
  constructor(
    private readonly db: DatabaseService,
    private readonly campaigns: CampaignsService,
    private readonly reads: CampaignsReadService,
    private readonly actions: CampaignsActionsService,
    private readonly repo: CampaignsRepository,
    private readonly senderKeys: V1SenderKeys,
  ) {}

  /** The create answer: the stored row, which WaDesk answered with before any recipient was counted (the mapper zeroes the counts). */
  async create(input: V1CreateCampaign): Promise<CampaignFacts> {
    if (input.campaign_name.length > NAME_MAX) {
      throw createFailed(
        `The campaign name may not be longer than ${NAME_MAX} characters.`,
        'campaign_name',
      );
    }
    const senderKey = await this.senderKeys.resolve(input.device_id);
    if (!senderKey)
      throw createFailed('That sender is not connected in this workspace.', 'device_id');

    const parsed = createCampaignSchema.safeParse(this.toInput(input, senderKey));
    if (!parsed.success) {
      throw new AppError(
        V1_BULK_CODE.CREATE_FAILED,
        parsed.error.issues[0]?.message ?? 'The campaign could not be created.',
        422,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    try {
      const created = await this.campaigns.create(parsed.data);
      return this.load(created.campaign.id);
    } catch (err) {
      throw refusalAs(err, CREATE_REFUSALS, {
        rename: RENAME,
        validationAs: V1_BULK_CODE.CREATE_FAILED,
      });
    }
  }

  /** The request as the staff form: numbers through the audience resolver (WD-API-095), `later` is `scheduled`, recurring is weekly with no end. */
  private toInput(input: V1CreateCampaign, senderKey: string): unknown {
    const timezone = input.timezone ?? null;
    let sendDate = input.send_date ?? null;
    let sendTime = input.send_time ? normalizeTime(input.send_time) : null;
    if (input.send_time && !sendTime) {
      throw createFailed('send_time must be a time such as 14:30 or 2:30 PM.', 'send_time');
    }
    if (input.schedule_type === 'recurring' && (!sendDate || !sendTime)) {
      // WaDesk did not ask for a start on a recurring campaign; it first fires on the next sweep.
      const now = wallClockIn(new Date(), timezone && isKnownTimeZone(timezone) ? timezone : 'UTC');
      sendDate ??= now.date;
      sendTime ??= now.time;
    }
    return {
      name: input.campaign_name,
      senderKey,
      type: input.campaign_type,
      abTesting: input.ab_testing ?? false,
      abSplit: input.ab_split ?? 50,
      customMessage: input.campaign_type === 'custom' ? input.custom_message : null,
      templateId: input.template_id ?? input.template_id_a ?? null,
      templateIdA: input.template_id_a ?? null,
      templateIdB: input.template_id_b ?? null,
      flowId: input.flow_id ?? null,
      scheduleType: input.schedule_type === 'later' ? 'scheduled' : input.schedule_type,
      sendDate,
      sendTime,
      timezone,
      manualNumbers: contactDigits(input.contacts).join('\n'),
    } satisfies Partial<CreateCampaignInput>;
  }

  async list(
    query: { limit: number; cursor?: string },
    filter: { status?: string; campaign_type?: string; search?: string },
  ): Promise<{ items: CampaignFacts[]; page: PageInfo }> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const needle = filter.search?.toLowerCase();
      const below = query.cursor ? decodeCursor(query.cursor).id : null;
      const rows = (await this.repo.listAll(tx, orgId)).filter(
        (r) =>
          (below === null || r.id < below) &&
          (!filter.status || r.status === storedStatus(filter.status)) &&
          (!filter.campaign_type || r.type === filter.campaign_type) &&
          (!needle || r.name.toLowerCase().includes(needle)),
      );
      const { items, page } = buildPage(rows.slice(0, query.limit + 1), query.limit);
      const out: CampaignFacts[] = [];
      for (const row of items) {
        out.push({
          row,
          senderKey: (await this.repo.senderLabel(tx, orgId, row.provider, row.deviceId)).key,
        });
      }
      return { items: out, page };
    });
  }

  async statistics(): Promise<V1CampaignStatistics> {
    const { orgId } = RequestContextStore.require();
    return statisticsOf(await this.db.tx((tx) => this.repo.listAll(tx, orgId)));
  }

  /** The campaign with its numbers brought in line with the recipient rows, as the dashboard's detail does on every open. */
  async show(uuid: string): Promise<CampaignFacts> {
    await this.reads.detail(uuid);
    return this.load(uuid);
  }

  /** Only a running, scheduled or paused campaign. `running` is allowed (WaDesk refused a campaign it had just launched). */
  async stop(uuid: string): Promise<CampaignFacts> {
    const { orgId } = RequestContextStore.require();
    const found = await this.load(uuid);
    if (!STOPPABLE.includes(found.row.status)) {
      throw new AppError(
        V1_BULK_CODE.NOT_STOPPABLE,
        'Only running, scheduled, or paused campaigns can be stopped.',
        422,
      );
    }
    await this.actions.cancel(uuid);
    // `cancel` leaves the end time empty; a stopped campaign has ended (WD-API-089 data).
    await this.db.tx((tx) =>
      this.repo.setStatus(tx, orgId, found.row.id, 'cancelled', { completed: true }),
    );
    return this.load(uuid);
  }

  async remove(uuid: string): Promise<void> {
    const found = await this.load(uuid);
    if (!DELETABLE.includes(found.row.status)) {
      throw new AppError(
        V1_BULK_CODE.DELETE_FAILED,
        'Only scheduled, failed, or completed campaigns can be deleted.',
        422,
      );
    }
    await this.actions.remove(uuid);
  }

  private async load(uuid: string): Promise<CampaignFacts> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Campaign', uuid);
      return {
        row,
        senderKey: (await this.repo.senderLabel(tx, orgId, row.provider, row.deviceId)).key,
      };
    });
  }
}
