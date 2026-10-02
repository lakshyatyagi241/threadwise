import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  ERROR_CODES,
  RESENDABLE_STATUSES,
  type BulkDeleteCampaignsInput,
  type BulkDeleteCampaignsResponse,
  type CampaignActionResponse,
  type CampaignStatus,
  type ResendCampaignInput,
  type ResendCampaignResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CampaignEvents } from './campaign-events';
import { CampaignJobs } from './campaign-jobs';
import { csvSafe } from './campaign-rules';
import { CampaignsRepository } from './campaigns.repository';
import { MODULE_KEY } from './campaigns.service';

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

const EXPORT_PAGE = 1_000;
export const EXPORT_HEADER = [
  'Recipient',
  'Phone',
  'Variant',
  'Status',
  'Clicked',
  'Queued',
  'Sent',
  'Delivered',
  'Read',
  'Responded',
  'Last event',
  'Error',
] as const;

/** One CSV cell: quoted when it holds a comma, a quote or a line break. */
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvLine = (cells: readonly string[]) => `${cells.map(cell).join(',')}\r\n`;

/** What an operator does to a campaign that exists: cancel, resume, send now, resend, delete, export (TW-CAMP-016 to 020). */
@Injectable()
export class CampaignsActionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly events: CampaignEvents,
    private readonly jobs: CampaignJobs,
  ) {}

  /** Sets the status and tells the world. `previous` is what it was. */
  private async move(
    tx: Parameters<CampaignsRepository['count']>[0],
    orgId: number,
    c: { id: number; uuid: string; status: string },
    next: CampaignStatus,
    o: Parameters<CampaignsRepository['setStatus']>[4] = {},
  ): Promise<void> {
    await this.repo.setStatus(tx, orgId, c.id, next, o);
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: c.id,
      action: 'update',
      delta: { status: { old: c.status, new: next } },
    });
    await this.events.statusChanged(tx, orgId, c.id, c.status);
  }

  private async found(uuid: string) {
    const { orgId } = RequestContextStore.require();
    return { orgId, uuid };
  }

  async cancel(uuid: string): Promise<CampaignActionResponse> {
    const { orgId } = await this.found(uuid);
    return this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      await this.repo.lock(tx, orgId, uuid);
      if (c.status !== 'cancelled') await this.move(tx, orgId, c, 'cancelled');
      return { id: uuid, status: 'cancelled', message: 'Campaign cancelled.' };
    });
  }

  /** Back to `running`; a worker picks the unsent recipients up where the run stopped. */
  async resume(uuid: string): Promise<CampaignActionResponse> {
    const { orgId } = await this.found(uuid);
    const row = await this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      await this.repo.lock(tx, orgId, uuid);
      if (c.status !== 'running') await this.move(tx, orgId, c, 'running', { reopen: true });
      return c;
    });
    await this.jobs.enqueue(orgId, row.id, row.uuid);
    return { id: uuid, status: 'running', message: 'Campaign resumed.' };
  }

  /** Send date and time become now (in the campaign's zone) and the run starts. */
  async sendNow(uuid: string): Promise<CampaignActionResponse> {
    const { orgId } = await this.found(uuid);
    const row = await this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      await this.repo.lock(tx, orgId, uuid);
      const zone = c.timezone ?? 'UTC';
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
      await this.repo.setSchedule(tx, orgId, c.id, {
        sendDate: `${get('year')}-${get('month')}-${get('day')}`,
        sendTime: `${get('hour')}:${get('minute')}`,
      });
      if (c.status !== 'running')
        await this.move(tx, orgId, c, 'running', { reopen: true, lastRun: true });
      return c;
    });
    await this.jobs.enqueue(orgId, row.id, row.uuid);
    return { id: uuid, status: 'running', message: 'Campaign is sending now.' };
  }

  /**
   * Sends a finished campaign again, to the recipients that failed (the default), all of them, or the ones picked. Only the
   * targeted rows are reset; the rest keep their history, so nobody is messaged twice by accident.
   */
  async resend(uuid: string, input: ResendCampaignInput): Promise<ResendCampaignResponse> {
    const { orgId } = await this.found(uuid);
    const { row, targets, status } = await this.db.tx(async (tx) => {
      const c = await this.repo.findByUuid(tx, orgId, uuid);
      if (!c) throw AppError.notFound('Campaign', uuid);
      await this.repo.lock(tx, orgId, uuid);
      if (!(RESENDABLE_STATUSES as readonly string[]).includes(c.status)) {
        throw refuse(
          'CAMP_NOT_RESENDABLE',
          'Only completed, failed or cancelled campaigns can be resent.',
        );
      }

      const picked =
        input.scope === 'selected'
          ? await this.repo.contactIdsByUuid(tx, orgId, input.contactIds)
          : [];
      const n = await this.repo.resetForResend(tx, orgId, c.id, input.scope, picked);
      if (n === 0) {
        throw refuse(
          'CAMP_NOTHING_TO_RESEND',
          input.scope === 'failed'
            ? 'Nothing to resend — no failed recipients in this campaign.'
            : 'Nothing to resend — no matching recipients.',
        );
      }
      await this.repo.recount(tx, orgId, c.id);
      // `now` campaigns run at once for the reset rows; the others go back to the schedule.
      const next: CampaignStatus = c.scheduleType === 'now' ? 'running' : 'scheduled';
      await this.move(tx, orgId, c, next, { reopen: true, lastRun: next === 'running' });
      return { row: c, targets: n, status: next };
    });
    if (status === 'running') await this.jobs.enqueue(orgId, row.id, row.uuid);
    const message =
      input.scope === 'all'
        ? `Resending to all ${targets} recipient${targets === 1 ? '' : 's'}.`
        : `Resending to ${targets} ${input.scope === 'failed' ? 'failed' : 'selected'} recipient${targets === 1 ? '' : 's'}.`;
    return { id: uuid, status, message, scope: input.scope, recipients: targets };
  }

  /** The campaign and its recipient rows go together, in any status. */
  async remove(uuid: string): Promise<void> {
    await this.removeMany([uuid]);
  }

  async bulkDelete(input: BulkDeleteCampaignsInput): Promise<BulkDeleteCampaignsResponse> {
    const ids = await this.removeMany(input.ids);
    return {
      ids,
      message: `Deleted ${ids.length} campaign${ids.length === 1 ? '' : 's'}.`,
    };
  }

  /** Only campaigns of this workspace: a forged uuid is simply not found. Returns the uuids deleted. */
  private async removeMany(uuids: readonly string[]): Promise<string[]> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const owned = await this.repo.idsByUuid(tx, orgId, uuids);
      if (uuids.length === 1 && owned.size === 0) throw AppError.notFound('Campaign', uuids[0]!);
      for (const [uuid, id] of owned) {
        await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'delete' });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType: 'campaign.deleted',
          payload: { uuid },
        });
      }
      await this.repo.remove(tx, orgId, [...owned.values()]);
      return [...owned.keys()];
    });
  }

  /** The recipients as CSV, newest first, streamed in pages (TW-CAMP-020). */
  async export(uuid: string): Promise<{ stream: Readable; fileName: string }> {
    const { orgId } = RequestContextStore.require();
    const c = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!c) throw AppError.notFound('Campaign', uuid);
    const zone = c.timezone ?? 'UTC';
    const fmt = (d: Date | null) =>
      d
        ? new Intl.DateTimeFormat('sv-SE', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(d)
        : '';

    const db = this.db;
    const repo = this.repo;
    async function* lines(): AsyncGenerator<string> {
      yield csvLine(EXPORT_HEADER);
      let before: number | null = null;
      for (;;) {
        const page = await db.txAs({ orgId }, (tx) =>
          repo.recipientsAfter(tx, orgId, c!.id, before, EXPORT_PAGE),
        );
        if (page.length === 0) return;
        for (const r of page) {
          const last = r.respondedAt
            ? 'Reply'
            : r.clickedAt
              ? 'Button tap'
              : r.readAt
                ? 'Read'
                : r.deliveredAt
                  ? 'Delivered'
                  : r.sentAt
                    ? 'Sent'
                    : 'Queued';
          yield csvLine([
            csvSafe(r.name || (r.contactId ? `Contact #${r.contactId}` : '')),
            csvSafe(r.phone ?? ''),
            csvSafe(r.variant ?? ''),
            r.status.charAt(0).toUpperCase() + r.status.slice(1),
            r.clicked ? 'Yes' : 'No',
            fmt(r.createdAt),
            fmt(r.sentAt),
            fmt(r.deliveredAt),
            fmt(r.readAt),
            fmt(r.respondedAt),
            last,
            csvSafe(r.error ?? ''),
          ]);
        }
        before = page[page.length - 1]!.id;
        if (page.length < EXPORT_PAGE) return;
      }
    }

    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 15)
      .replace(/^(\d{8})(\d{6})$/, '$1-$2');
    return {
      stream: Readable.from(lines()),
      fileName: `campaign-${c.uuid}-recipients-${stamp}.csv`,
    };
  }
}
