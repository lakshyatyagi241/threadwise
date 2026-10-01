import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { EngineSenderRegistry } from './engine-senders';
import { assemblePhone } from './recipient-phone';
import {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  type SenderDirectory,
  type TemplateDirectory,
} from './_shims/tokens';

/** Recipients are read and sent in small slices so a long broadcast never holds a transaction or a big array. */
const BATCH = 200;
/** The counters on the broadcast row are refreshed this often while a run is going, so the list page moves. */
const COUNTER_EVERY = 25;
/** A recipient claimed for sending but not settled this long ago belongs to a worker that died. */
const STALE_MINUTES = 10;

export type DispatchResult = 'skipped' | 'failed' | 'paused' | 'finished';

interface BroadcastRow {
  status: string;
  provider: string | null;
  device_id: number | string | null;
  template_id: number | string | null;
}

interface RecipientRow {
  bc_id: number | string;
  contact_id: number | string;
  phone: string | null;
  country_code: string | null;
}

/**
 * Sends one broadcast (WD-BCAST-016, and the per-recipient loop of 022 in its simplest form).
 *
 * Runs inside a BullMQ job in the worker: the job carries the broadcast id, this re-reads everything. Safe to run twice:
 * each recipient is claimed (`pending` to `processing`) before the provider is called, so a retry after a crash never
 * sends the same person twice; a claim older than STALE_MINUTES is failed as interrupted rather than re-sent.
 *
 * Failure states follow WaDesk: no sender, an unsupported engine or unreadable credentials mark the broadcast `failed`
 * and leave the recipients `pending`; a recipient without a usable number is failed on its own.
 */
@Injectable()
export class BroadcastDispatchService {
  private readonly logger = new Logger(BroadcastDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly progress: BroadcastProgressService,
    private readonly engines: EngineSenderRegistry,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  /** Must run inside a request context for `orgId` (the processor sets it from the job). */
  async run(orgId: number, broadcastId: number): Promise<DispatchResult> {
    const prep = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT status, provider, device_id, template_id FROM broadcasts
        WHERE org_id = ${orgId} AND id = ${broadcastId} FOR UPDATE`);
      const b = res.rows[0] as unknown as BroadcastRow | undefined;
      if (!b || !['processing', 'scheduled'].includes(b.status)) return { skip: true as const };

      await this.progress.setStatus(tx, orgId, broadcastId, 'processing');

      const fail = async (reason: string) => {
        this.logger.warn({ orgId, broadcastId, reason }, '[BCAST] dispatch failed');
        await this.progress.setStatus(tx, orgId, broadcastId, 'failed');
        return { skip: false as const, failed: true as const };
      };

      const template =
        b.template_id === null
          ? undefined
          : await this.templates.findById(tx, orgId, Number(b.template_id));
      if (!template) return fail('template not found');

      const sender = await this.senders.resolveForDispatch(tx, orgId, {
        provider: b.provider,
        deviceId: b.device_id === null ? null : Number(b.device_id),
      });
      if (!sender) return fail('no sender');
      if (!sender.phoneDigits) return fail('sender has no number');

      const adapter = this.engines.get(sender.engine);
      if (!adapter) return fail(`no sender adapter for engine ${sender.engine}`);

      await tx.execute(sql`
        UPDATE broadcast_contacts SET status = 'failed', error_message = 'Send was interrupted before it finished'
        WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND status = 'processing'
          AND updated_at < now() - ${`${STALE_MINUTES} minutes`}::interval`);

      return { skip: false as const, failed: false as const, template, sender, adapter };
    });

    if (prep.skip) return 'skipped';
    if (prep.failed) return 'failed';
    const { template, sender, adapter } = prep;

    let opened;
    try {
      opened = await adapter.open(orgId, sender);
    } catch (err) {
      this.logger.warn(
        { orgId, broadcastId, err: String(err) },
        '[BCAST] sender could not be opened',
      );
      await this.db.tx((tx) => this.progress.setStatus(tx, orgId, broadcastId, 'failed'));
      return 'failed';
    }

    let lastId = 0;
    let sinceCounters = 0;
    for (;;) {
      const batch = await this.db.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT bc.id AS bc_id, bc.contact_id, c.phone, c.country_code
          FROM broadcast_contacts bc
          JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
          WHERE bc.org_id = ${orgId} AND bc.broadcast_id = ${broadcastId} AND bc.status = 'pending' AND bc.id > ${lastId}
          ORDER BY bc.id LIMIT ${BATCH}`);
        return res.rows as unknown as RecipientRow[];
      });
      if (batch.length === 0) break;

      for (const r of batch) {
        lastId = Number(r.bc_id);
        const contactId = Number(r.contact_id);
        const to = assemblePhone(r.phone, r.country_code);

        const claimed = await this.db.tx(async (tx) => {
          if (!to) {
            await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
              status: 'failed',
              error: 'No usable phone number',
            });
            return false;
          }
          const res = await tx.execute(sql`
            UPDATE broadcast_contacts SET status = 'processing'
            WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND contact_id = ${contactId} AND status = 'pending'
            RETURNING id`);
          return res.rows.length > 0;
        });
        if (!claimed) continue;

        try {
          const sent = await opened.send({
            to,
            templateName: template.templateName,
            language: template.language,
            clientReference: `bcast-${broadcastId}-${contactId}`,
          });
          await this.db.tx((tx) =>
            this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
              status: 'sent',
              providerMessageId: sent.providerMessageId,
            }),
          );
        } catch (err) {
          if (err instanceof AppError && err.code === ERROR_CODES.AUTH_SEND_HALTED) {
            // The emergency halt is on: put this recipient back and stop. Nothing is lost; the run resumes when it is lifted.
            await this.db.tx(async (tx) => {
              await this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
                status: 'pending',
              });
              await this.progress.recompute(tx, orgId, broadcastId);
              await this.progress.setStatus(tx, orgId, broadcastId, 'paused');
            });
            this.logger.warn({ orgId, broadcastId }, '[BCAST] paused by the emergency halt');
            return 'paused';
          }
          await this.db.tx((tx) =>
            this.progress.applyRecipient(tx, orgId, broadcastId, contactId, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }

        if (++sinceCounters >= COUNTER_EVERY) {
          sinceCounters = 0;
          await this.db.tx((tx) => this.progress.recompute(tx, orgId, broadcastId));
        }
      }
    }

    const final = await this.db.tx((tx) => this.progress.finish(tx, orgId, broadcastId));
    this.logger.log({ orgId, broadcastId, final }, '[BCAST] dispatch finished');
    return 'finished';
  }
}
