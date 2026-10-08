import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { VisibilityPresence } from '../../realtime';
import { buildPushPayload } from './push-payload';
import { PushSubscriptionsRepository } from './push-subscriptions.repository';
import { NotificationsRepository } from './notifications.repository';
import { WebPushSender } from './web-push.sender';

/** What the queue carries: ids only. The text, the keys and the endpoints are read when the job runs. */
export interface WebPushJob {
  orgId: number;
  userId: number;
  /** The bell row's uuid. */
  notificationUuid: string;
  /** A retry: only the devices that failed the last time. */
  only?: number[];
}

export type WebPushOutcome =
  | { status: 'skipped'; reason: 'disabled' | 'visible' | 'gone' | 'read' | 'no_devices' }
  | { status: 'done'; sent: number; failed: number; retry: number[] };

/**
 * The delivery rules of a browser push for one bell row (docs/specs/realtime-notifications.md section 18), in the order they apply:
 *
 *  1. the deployment has VAPID keys (else nothing happens, invisibly);
 *  2. the person has NO tab in front of them (`VisibilityPresence`): the bell, badge and toast cover them;
 *  3. the bell row still exists and is still unread (read on another device since: nothing to say);
 *  4. the person has at least one live device;
 * then the payload is built from the row (title = contact name, body = the kind of event and never the message text, one tag per conversation) and sent to
 * each device. The preference (`push` per type) and the workspace toggle were applied when the row was written: the producer only
 * enqueues a job for a row whose person has push on, and a row exists only if the bell is on.
 *
 * Idempotent per row for the devices that already got it: a retry carries only the ids that failed.
 */
@Injectable()
export class WebPushDeliveryService {
  private readonly logger = new Logger(WebPushDeliveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsRepository,
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly sender: WebPushSender,
    private readonly presence: VisibilityPresence,
  ) {}

  async deliver(job: WebPushJob): Promise<WebPushOutcome> {
    if (!this.sender.isEnabled()) return { status: 'skipped', reason: 'disabled' };
    // A retry already passed this check on its first run: the first send decided.
    if (!job.only && (await this.presence.isVisible(job.orgId, job.userId))) {
      return { status: 'skipped', reason: 'visible' };
    }
    const { row, targets } = await this.db.txAs(
      { orgId: job.orgId, userId: job.userId },
      async (tx) => ({
        row: await this.notifications.findForPush(tx, job.orgId, job.userId, job.notificationUuid),
        targets: await this.subscriptions.liveTargets(tx, job.orgId, job.userId, job.only),
      }),
    );
    if (!row) return { status: 'skipped', reason: 'gone' };
    if (row.readAt) return { status: 'skipped', reason: 'read' };
    if (targets.length === 0) return { status: 'skipped', reason: 'no_devices' };

    const report = await this.sender.send(targets, buildPushPayload(row), row.type);
    await this.sender.record(job.orgId, job.userId, report, targets);
    if (report.gone.length > 0 || report.unusable.length > 0) {
      // Counts only: an endpoint or a key must never reach a log.
      this.logger.log(
        { orgId: job.orgId, revoked: report.gone.length + report.unusable.length },
        'push devices revoked',
      );
    }
    return {
      status: 'done',
      sent: report.sent.length,
      failed: report.gone.length + report.refused.length + report.retry.length,
      retry: report.retry,
    };
  }
}
