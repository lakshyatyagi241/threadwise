import { V1_BULK_CODE } from './bulk-codes';
import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateScheduleInput,
  type PageInfo,
  type ScheduleDetail,
  type ScheduleSummary,
  type V1CreateScheduled,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import { DatabaseService } from '../../../../infra/db/database.service';
import { TEMPLATE_DIRECTORY, isKnownTimeZone, type TemplateDirectory } from '../../../broadcasts';
import {
  ScheduleActionsService,
  ScheduleCreateService,
  ScheduleReadService,
} from '../../../scheduled-queue-warmer';
import { refusalAs, scheduledDigits, scheduledRunParts } from './bulk-input';
import { decodeOffset, encodeOffset } from './scheduled.mapper';
import { ScheduledExtrasRepository, type ScheduledExtras } from './scheduled-extras.repository';
import { V1SenderKeys } from './sender-keys.service';

/** The staff form asks for a lead of this many minutes (Reference's API asked for one). */
const MIN_LEAD_MINUTES = 2;

const scheduleFailed = (message: string, path: string) =>
  new AppError(V1_BULK_CODE.SCHEDULE_FAILED, message, 422, [{ path, message }]);

const RENAME = {
  sendDate: 'run_at',
  sendTime: 'run_at',
  schedule: 'run_at',
  senders: 'device_id',
  numbers: 'recipients',
  recipientType: 'recipients',
  templateId: 'template_id',
};

export interface ScheduledFacts<T = ScheduleSummary | ScheduleDetail> {
  schedule: T;
  extras: ScheduledExtras | undefined;
}

/**
 * The customer API's scheduled messages (TW-API-091 to 094), over the dashboard's create, read and cancel services. The plan feature, the
 * limit, the send gate (halt, content, wallet), the warmer's budget and the two-minute lead are the service's, stricter than Reference's API,
 * which checked none of them at scheduling time.
 */
@Injectable()
export class V1ScheduledAdapter {
  constructor(
    private readonly db: DatabaseService,
    private readonly create_: ScheduleCreateService,
    private readonly reads: ScheduleReadService,
    private readonly actions: ScheduleActionsService,
    private readonly extras: ScheduledExtrasRepository,
    private readonly senderKeys: V1SenderKeys,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  async create(input: V1CreateScheduled): Promise<ScheduledFacts<ScheduleDetail>> {
    const { orgId } = RequestContextStore.require();
    const timezone = input.timezone ?? 'UTC';
    if (!isKnownTimeZone(timezone)) throw scheduleFailed('Choose a valid timezone.', 'timezone');

    // A template that is not the workspace's is a missing record here (404), not a refusal (Reference: `template_not_found`).
    if (input.template_id) {
      const tpl = await this.db.tx((tx) => this.templates.find(tx, orgId, input.template_id!));
      if (!tpl) throw new AppError(V1_BULK_CODE.TEMPLATE_NOT_FOUND, 'Template not found.', 404);
    }

    const when = scheduledRunParts(input.run_at, timezone);
    if (!when) {
      throw scheduleFailed('run_at must be a date and time such as 2026-12-01 09:00.', 'run_at');
    }

    const sender = await this.sender(input.device_id);
    const body: CreateScheduleInput = {
      name: input.name,
      scheduleType: 'once',
      sendDate: when.date,
      sendTime: when.time,
      timezone,
      senders: [sender],
      messageType: input.template_id ? 'template' : 'plain',
      ...(input.template_id
        ? { templateId: input.template_id }
        : { message: input.message ?? undefined }),
      recipientType: 'number',
      numbers: scheduledDigits(input.recipients),
    };

    try {
      const made = await this.create_.create(body);
      return this.show(made.ids[0]!);
    } catch (err) {
      throw refusalAs(err, {}, { rename: RENAME, validationAs: V1_BULK_CODE.SCHEDULE_FAILED });
    }
  }

  /**
   * The sender named, which must be a connected one of this workspace; else the most recent connected device (a QR device before a Cloud API
   * or Twilio number). Reference saved the message with no sender when there was none and it never sent; here that is a refusal.
   */
  private async sender(deviceId: string | null | undefined): Promise<string> {
    if (deviceId) {
      const key = await this.senderKeys.resolve(deviceId);
      if (!key)
        throw scheduleFailed('That sender is not connected in this workspace.', 'device_id');
      return key;
    }
    const { senders } = await this.reads.options(MIN_LEAD_MINUTES);
    const device = [...senders].reverse().find((s) => s.engine === 'baileys') ?? senders.at(-1);
    if (!device) throw scheduleFailed('There is no connected sender to send from.', 'device_id');
    return device.key;
  }

  async list(query: { limit: number; cursor?: string }): Promise<{
    items: Array<ScheduledFacts<ScheduleSummary>>;
    page: PageInfo;
  }> {
    const offset = decodeOffset(query.cursor);
    if (offset === null) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'cursor', message: 'Invalid pagination cursor' },
      ]);
    }
    const res = await this.reads.list({ tab: 'all', limit: query.limit, offset });
    const extras = await this.extras.byUuid(res.items.map((s) => s.id));
    const next = offset + res.items.length;
    const hasMore = res.items.length === query.limit && next < res.total;
    return {
      items: res.items.map((schedule) => ({ schedule, extras: extras.get(schedule.id) })),
      page: { limit: query.limit, hasMore, nextCursor: hasMore ? encodeOffset(next) : null },
    };
  }

  async show(uuid: string): Promise<ScheduledFacts<ScheduleDetail>> {
    const schedule = await this.reads.detail(uuid);
    return { schedule, extras: (await this.extras.byUuid([uuid])).get(uuid) };
  }

  /** The row is kept with status `cancelled` (Reference: the verb says delete, the row stays). */
  async cancel(uuid: string): Promise<ScheduledFacts<ScheduleDetail>> {
    try {
      await this.actions.cancel(uuid);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.CONFLICT) {
        throw new AppError(V1_BULK_CODE.NOT_CANCELLABLE, 'This schedule is already finished.', 422);
      }
      throw err;
    }
    return this.show(uuid);
  }
}
