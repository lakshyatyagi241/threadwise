import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MEMBER_AVAILABILITY_CHANGED, MEMBER_LEAVE_STARTED } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { AwayService } from './away.service';

/**
 * Worker side of the away rules: a person who switched themselves Offline (or was set Offline for inactivity) or who started a leave has
 * their unanswered chats returned to the queue, when the workspace chose so. All the rules are in `AwayService`.
 */
@Injectable()
export class AwayConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'chat-away-return';
  readonly eventTypes = [MEMBER_AVAILABILITY_CHANGED, MEMBER_LEAVE_STARTED] as const;

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly away: AwayService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Redelivery (ADR-0029, section 3): the outbox delivers at least once, so `handle` can run again for the same `event.id`. A second run
   * does nothing: the first one moved the chats off this person (a returned chat has no assignee), and a stale event is refused unless the
   * person is still away, offline or on an active leave (`AwayService.returnUnanswered`).
   */
  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    let userId: number | null = null;
    let reason: 'offline' | 'inactive' | 'leave' = 'offline';
    if (event.eventType === MEMBER_LEAVE_STARTED) {
      userId = typeof p.memberUserId === 'number' ? p.memberUserId : null;
      reason = 'leave';
    } else if (p.status === 'offline') {
      userId = typeof p.userId === 'number' ? p.userId : null;
      reason = p.reason === 'inactive' ? 'inactive' : 'offline';
    }
    if (userId === null) return;
    const id = userId;
    await RequestContextStore.run(
      {
        requestId: `away-${event.id}`,
        orgId: event.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.away.returnUnanswered(event.orgId, id, reason),
    );
  }
}

/** Sets inactive people Offline once a minute, for the workspaces that chose a limit. */
@Injectable()
export class AwaySweep {
  private readonly logger = new Logger(AwaySweep.name);
  private running = false;

  constructor(private readonly away: AwayService) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.away.sweepInactive();
      if (n > 0) this.logger.log({ offline: n }, 'inactive people set offline');
    } catch (err) {
      this.logger.error({ err }, 'inactivity sweep failed');
    } finally {
      this.running = false;
    }
  }
}
