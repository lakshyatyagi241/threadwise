import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { DeviceGroupThreadTitleService } from './device-group-thread-title.service';

/** `WA_DEVICE_GROUP_EVENTS.created` and `.updated` (contracts); spelled out here because this module does not import the devices domain. */
export const DEVICE_GROUP_RETITLE_EVENTS = [
  'whatsapp.device_group.created',
  'whatsapp.device_group.updated',
] as const;

/**
 * Keeps a personal-number group thread's title in step with the group's subject. `created` covers a first message that arrived before
 * the directory knew the subject; `updated` covers a rename. Runs in the worker; at-least-once delivery is safe (the title is set, not
 * toggled). The event's aggregate id is the `wa_device_groups` row; the subject is read from it, not from the payload.
 */
@Injectable()
export class DeviceGroupRetitleConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'chat-device-group-retitle';
  readonly eventTypes = DEVICE_GROUP_RETITLE_EVENTS;

  constructor(
    private readonly titles: DeviceGroupThreadTitleService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    await this.titles.retitle(event.orgId, event.aggregateId);
  }
}
