import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { REALTIME_EVENT } from '@crm/contracts';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory, RealtimeEmitter } from '../../realtime';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';

/** Who may see imported chats (the inbox list) and who may see the number's card. */
export const HISTORY_HINT_PERMISSIONS = ['inbox.conversation.read', 'wa.devices.read'] as const;

const FINAL_STATES = new Set(['done', 'failed', 'limit_reached']);
const uuidLike = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Tells the open inbox and the number's page that an import ended, so imported chats appear without a reload. ONE hint per run (the
 * outbox events of a run are `requested`, then one `finished` or `cancelled`), never one per message: the thousands of stored messages are
 * deliberately silent. A cancel that stored nothing, or a run that was replaced by a new request, sends nothing. The hint carries the
 * number's uuid and the final state only; the screens refetch over REST, where scope and the unofficial gate run again. Delivery is at-least-once and best effort: a redelivered event is harmless, a repeat only makes the screens refetch. Runs in the worker.
 */
@Injectable()
export class HistoryImportRealtimeConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'history-import-realtime';
  readonly eventTypes = ['device.history_import_finished', 'device.history_import_cancelled'];
  private readonly logger = new Logger(HistoryImportRealtimeConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly emitter: RealtimeEmitter,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const deviceId = p.deviceId;
    if (!uuidLike(deviceId)) return;
    let state: 'done' | 'failed' | 'cancelled' | 'limit_reached';
    if (event.eventType === 'device.history_import_finished') {
      if (typeof p.state !== 'string' || !FINAL_STATES.has(p.state)) return;
      state = p.state as typeof state;
    } else {
      if (p.by !== 'user' || !(Number(p.messages) > 0)) return;
      state = 'cancelled';
    }
    if (!(await this.gate.isEnabledFor(event.orgId))) return;

    const ids = new Set<number>();
    for (const permission of HISTORY_HINT_PERMISSIONS) {
      for (const v of await this.directory.viewers(event.orgId, permission)) {
        if (v.scope !== null) ids.add(v.userId);
      }
    }
    if (ids.size === 0) return;
    try {
      await this.emitter.emitToUsers(event.orgId, [...ids], REALTIME_EVENT.historyImported, {
        deviceId,
        state,
      });
    } catch (err) {
      this.logger.warn(
        { err, orgId: event.orgId, eventId: event.id },
        'history import push failed',
      );
    }
  }
}
