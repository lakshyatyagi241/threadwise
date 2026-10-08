import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { REALTIME_EVENT } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { RealtimeEmitter } from '../../realtime';

/**
 * Tells every open screen of a workspace that a WhatsApp call changed (TW-CALL-012), so the incoming-call toast appears the moment a call
 * rings and goes the moment somebody answers, instead of waiting for its poll. A signal with the call's uuid and nothing else: the
 * screen refetches `/calling/calls/pending`, where the permission and the workspace apply. Runs in a worker on the committed ledger
 * step, so a push is never sent for a rolled-back change; best effort, the poll stays as the fallback.
 */
@Injectable()
export class CallRealtimeConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'call-realtime';
  readonly eventTypes = ['call.changed'] as const;
  private readonly logger = new Logger(CallRealtimeConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const call = await this.db.txAs({ orgId: event.orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT uuid FROM wa_calls WHERE org_id = ${event.orgId} AND id = ${Number(event.aggregateId)}`,
      )) as unknown as { rows: Array<{ uuid: string }> };
      return res.rows[0];
    });
    if (!call) return;
    try {
      await this.emitter.emit(event.orgId, [{ kind: 'org' }], REALTIME_EVENT.callChanged, {
        callId: call.uuid,
      });
    } catch (err) {
      this.logger.warn({ err: String(err), orgId: event.orgId }, 'could not push the call change');
    }
  }
}
