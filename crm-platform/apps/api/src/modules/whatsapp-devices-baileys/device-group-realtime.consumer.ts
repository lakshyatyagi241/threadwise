import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  REALTIME_EVENT,
  WA_DEVICE_GROUP_EVENTS,
  type WaDeviceGroupChangeKind,
} from '@crm/contracts';
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

/** The permission of the Groups tab itself (`wa.groups.read`); the hint goes to everyone who can open it. */
export const PERM_DEVICE_GROUPS_READ = 'wa.groups.read';

const KIND_OF: Record<string, WaDeviceGroupChangeKind> = {
  [WA_DEVICE_GROUP_EVENTS.created]: 'created',
  [WA_DEVICE_GROUP_EVENTS.updated]: 'updated',
  [WA_DEVICE_GROUP_EVENTS.left]: 'left',
  [WA_DEVICE_GROUP_EVENTS.joinRequest]: 'join_request',
  [WA_DEVICE_GROUP_EVENTS.participantsChanged]: 'participants_changed',
};

const uuidLike = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Pushes the `whatsapp.device_group.*` outbox events to the Groups tab of `/devices`, so its list, counters, member list and join-request
 * queue refresh without a reload, also when the change came from WhatsApp itself or from a colleague (mirrors the official
 * `WabaGroupRealtimeConsumer`).
 *
 * The push is a hint (`whatsapp.device_group.changed`: the group's uuid, the number's uuid and the kind of change), never a subject, a
 * member's number or the invite code; the tab refetches over REST, where the permission and the unofficial gate run again. It goes to the
 * `user` room of every active member who holds `wa.groups.read`, and only while the workspace is on the unofficial allow-list. Delivery is
 * best effort and at least once: a repeat only makes the tab refetch. Runs in the worker.
 */
@Injectable()
export class DeviceGroupRealtimeConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'device-group-realtime';
  readonly eventTypes = Object.keys(KIND_OF);
  private readonly logger = new Logger(DeviceGroupRealtimeConsumer.name);

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
    const kind = KIND_OF[event.eventType];
    const groupId = event.payload.groupUuid;
    const deviceId = event.payload.deviceId;
    if (!kind || !uuidLike(groupId) || !uuidLike(deviceId)) return;
    // A bulk import (the first read of a big directory) is one hint, carried by its first event.
    if (event.payload.bulk === true && event.payload.lead !== true) return;
    if (!(await this.gate.isEnabledFor(event.orgId))) return;

    const viewers = await this.directory.viewers(event.orgId, PERM_DEVICE_GROUPS_READ);
    const userIds = viewers.filter((v) => v.scope !== null).map((v) => v.userId);
    if (userIds.length === 0) return;
    try {
      await this.emitter.emitToUsers(event.orgId, userIds, REALTIME_EVENT.deviceGroupChanged, {
        groupId,
        deviceId,
        kind,
      });
    } catch (err) {
      this.logger.warn({ err, orgId: event.orgId, eventId: event.id }, 'device group push failed');
    }
  }
}
