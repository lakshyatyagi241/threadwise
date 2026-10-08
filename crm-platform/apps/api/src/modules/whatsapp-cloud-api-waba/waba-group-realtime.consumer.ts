import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { REALTIME_EVENT } from '@crm/contracts';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory, RealtimeEmitter } from '../../realtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { GROUP_EVENTS } from './waba-group-events';

/** The permission of the Groups screen itself (`waba.groups.read`); the hint goes to everyone who can open it. */
export const PERM_GROUPS_READ = 'waba.groups.read';

const KIND_OF: Record<string, 'created' | 'updated' | 'deleted' | 'join_request' | 'suspended'> = {
  [GROUP_EVENTS.created]: 'created',
  [GROUP_EVENTS.updated]: 'updated',
  [GROUP_EVENTS.deleted]: 'deleted',
  [GROUP_EVENTS.joinRequest]: 'join_request',
  [GROUP_EVENTS.suspended]: 'suspended',
};

const uuidLike = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Pushes the `whatsapp.group.*` outbox events to the Groups screen (BL-099, docs/specs/waba-groups-management.md 11 and 14), so its list,
 * counters, join-request queue and invite link refresh without a reload, also when the change came from Meta's webhook or from a
 * colleague.
 *
 * The push is a hint (`whatsapp.group.changed`: the group's uuid, the number's uuid and the kind of change), never a subject, a member's
 * number or the invite link; the screen refetches over REST, where the permission and the plan gate run again. It goes to the `user`
 * room of every active member who holds `waba.groups.read`, and only when the workspace's plan has `waba_groups` (the screen is locked
 * without it). Delivery is best effort and at least once: a repeat only makes the screen refetch. Runs in the worker.
 */
@Injectable()
export class WabaGroupRealtimeConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'waba-group-realtime';
  readonly eventTypes = Object.keys(KIND_OF);
  private readonly logger = new Logger(WabaGroupRealtimeConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const kind = KIND_OF[event.eventType];
    const groupId = event.payload.groupUuid;
    const connectionId = event.payload.connectionId;
    if (!kind || !uuidLike(groupId) || !uuidLike(connectionId)) return;
    if (!(await this.entitlements.featureEnabled(event.orgId, 'waba_groups'))) return;

    const viewers = await this.directory.viewers(event.orgId, PERM_GROUPS_READ);
    const userIds = viewers.filter((v) => v.scope !== null).map((v) => v.userId);
    if (userIds.length === 0) return;
    try {
      await this.emitter.emitToUsers(event.orgId, userIds, REALTIME_EVENT.wabaGroupChanged, {
        groupId,
        connectionId,
        kind,
      });
    } catch (err) {
      this.logger.warn({ err, orgId: event.orgId, eventId: event.id }, 'group push failed');
    }
  }
}
