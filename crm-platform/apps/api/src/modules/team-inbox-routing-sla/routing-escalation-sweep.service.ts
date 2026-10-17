import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { RoutingEngine } from './routing-engine.service';
import { RoutingRulesRepository } from './routing-rules.repository';

/**
 * Applies the deferred actions that are due (Reference's `inbox:escalate`, which it ran every 30 seconds per workspace): a conversation
 * the rules scheduled for reassignment or a priority, still open and still without a reply from us, gets it now. One pass handles up to
 * 100 conversations; overlapping ticks are skipped, and a conversation another tick already applied is a no-op (the engine checks again).
 */
@Injectable()
export class RoutingEscalationSweep {
  private readonly logger = new Logger(RoutingEscalationSweep.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RoutingRulesRepository,
    private readonly engine: RoutingEngine,
  ) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.db.privileged((tx) => this.repo.dueEscalations(tx, 100));
      for (const d of due) {
        try {
          // A background job has no request: the context is the system's, as the routing listener's is (the audit rows need it).
          await RequestContextStore.run(
            {
              requestId: `escalate-${d.uuid}`,
              orgId: d.orgId,
              actorType: 'system',
              actorId: null,
              userId: null,
            },
            () => this.engine.runDueEscalation(d.orgId, d.uuid),
          );
        } catch (err) {
          this.logger.error({ err, orgId: d.orgId }, 'escalation failed for a conversation');
        }
      }
      if (due.length > 0) this.logger.log({ checked: due.length }, 'escalations checked');
    } catch (err) {
      this.logger.error({ err }, 'escalation sweep failed');
    } finally {
      this.running = false;
    }
  }
}
