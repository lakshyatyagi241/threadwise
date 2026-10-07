import { V1_BULK_CODE } from './bulk-codes';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type BroadcastDetail,
  type CreateBroadcastResponse,
  type ListBroadcastRecipientsResponse,
  type ListBroadcastsResponse,
  type V1CreateBroadcast,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import { DatabaseService } from '../../../../infra/db/database.service';
import { AuditService } from '../../../../kernel/audit/audit.service';
import {
  BroadcastProgressService,
  BroadcastsReadService,
  BroadcastsRepository,
  BroadcastsService,
} from '../../../broadcasts';
import { ContactGroupsService } from '../../../crm';
import { parseWallClock, refusalAs } from './bulk-input';
import { V1SenderKeys } from './sender-keys.service';

/** Only these can be stopped (TW-API-084). `paused` is added: a paused broadcast is in flight and would otherwise be stuck until resumed. */
const STOPPABLE = ['scheduled', 'processing', 'paused'];

/**
 * The customer API's broadcasts, a thin adapter over the dashboard's own services (TW-API-080 to 084): create runs the same plan gate,
 * audience, wallet, template and warmer checks as the "new broadcast" form; reads are the staff reads; stop is the one action the dashboard
 * does not have (it only deletes), so it lives here on the same repository and progress service the workers use.
 */
@Injectable()
export class V1BroadcastsAdapter {
  constructor(
    private readonly db: DatabaseService,
    private readonly broadcasts: BroadcastsService,
    private readonly reads: BroadcastsReadService,
    private readonly repo: BroadcastsRepository,
    private readonly progress: BroadcastProgressService,
    private readonly audit: AuditService,
    private readonly groups: ContactGroupsService,
    private readonly senderKeys: V1SenderKeys,
  ) {}

  async create(input: V1CreateBroadcast): Promise<CreateBroadcastResponse> {
    // The scoping Reference's adapter did before the web pipeline: the group must be the workspace's, the template too (below).
    if (input.group_id) {
      try {
        await this.groups.get(input.group_id);
      } catch (err) {
        if (err instanceof AppError && err.code === ERROR_CODES.NOT_FOUND) {
          throw new AppError(
            V1_BULK_CODE.INVALID_GROUP,
            'The group does not exist in this workspace.',
            422,
          );
        }
        throw err;
      }
    }

    let schedule: { sendDate: string; sendTime: string } | null = null;
    if (input.schedule_at) {
      // Only the wall-clock date and time are kept; an offset inside the text does not move them (Reference, QUIRK 2).
      const wall = parseWallClock(input.schedule_at);
      if (!wall) {
        throw AppError.validation('Request payload failed validation', [
          {
            path: 'schedule_at',
            message: 'schedule_at must be a date and time such as 2026-12-01 09:00',
          },
        ]);
      }
      schedule = { sendDate: wall.date, sendTime: wall.time };
    }

    // A device that does not resolve is ignored and the broadcast has no sender of its own (Reference, QUIRK 7).
    const senderKey = await this.senderKeys.resolve(input.device_id);

    try {
      return await this.broadcasts.create({
        name: input.name,
        templateId: input.template_id,
        contactIds: input.recipients ?? [],
        groupIds: input.group_id ? [input.group_id] : [],
        senderKeys: senderKey ? [senderKey] : [],
        scheduleType: schedule ? 'later' : 'now',
        ...(schedule ?? {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      });
    } catch (err) {
      throw refusalAs(
        err,
        {
          [ERROR_CODES.BCAST_NO_RECIPIENTS]: V1_BULK_CODE.NO_RECIPIENTS,
          [ERROR_CODES.BCAST_TEMPLATE_NOT_FOUND]: V1_BULK_CODE.INVALID_TEMPLATE,
        },
        { rename: { templateId: 'template_id', contactIds: 'recipients', groupIds: 'group_id' } },
      );
    }
  }

  list(query: {
    limit: number;
    cursor?: string;
    status?: string;
  }): Promise<ListBroadcastsResponse> {
    return this.reads.list({
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
      range: 'all',
      includeTotal: false,
    });
  }

  show(uuid: string): Promise<BroadcastDetail> {
    return this.reads.detail(uuid);
  }

  async recipients(
    uuid: string,
    query: { limit: number; cursor?: string },
  ): Promise<{
    page: ListBroadcastRecipientsResponse;
    stats: Awaited<ReturnType<BroadcastsReadService['statistics']>>;
  }> {
    const page = await this.reads.recipients(uuid, { limit: query.limit, cursor: query.cursor });
    return { page, stats: await this.reads.statistics(uuid) };
  }

  /**
   * Scheduled, running or paused becomes `cancelled` with its end time, through the progress service so the status event and outbound webhook
   * go out in the same transaction. The sender stops at its next pass (it only works broadcasts that are `processing` or `scheduled`).
   * Recipient rows stay `pending` and no credit is refunded (Reference).
   */
  async stop(uuid: string): Promise<BroadcastDetail> {
    const { orgId } = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.lock(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast', uuid);
      if (!STOPPABLE.includes(row.status)) {
        throw new AppError(
          V1_BULK_CODE.NOT_STOPPABLE,
          'Only scheduled or in-flight broadcasts can be stopped.',
          422,
        );
      }
      await this.progress.setStatus(tx, orgId, row.id, 'cancelled');
      // `setStatus` stamps an end time for the finished states only; a stopped broadcast has ended too (TW-API-084 rule 1).
      await tx.execute(
        sql`UPDATE broadcasts SET completed_at = coalesce(completed_at, now()) WHERE org_id = ${orgId} AND id = ${row.id}`,
      );
      await this.audit.record(tx, {
        module: 'broadcasts',
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: 'cancelled' } },
      });
    });
    return this.reads.detail(uuid);
  }
}
