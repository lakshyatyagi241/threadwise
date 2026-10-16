import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { GRAPH_SUBSCRIPTION_KIND, actionOf, type GraphNotification } from './graph-push-rules';
import { MicrosoftMailConfig } from './microsoft-mail-config.service';
import { MailPlan } from './mail-plan';
import { MailPushRepository } from './mail-push.repository';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MailboxesRepository } from './mailboxes.repository';

export interface GraphPushResult {
  /** Sync jobs queued (bursts for one mailbox collapse into one). */
  queued: number;
  /** Notifications dropped: a forged or unknown `clientState`, a subscription we do not hold, a lapsed add-on. */
  ignored: number;
}

/**
 * What a Microsoft Graph notification does (E-17). The route has already answered 202; this runs after it.
 *
 * A notification is trusted only when its `clientState` verifies (an HMAC that names the workspace and mailbox, so a POST from anyone
 * else is dropped) AND its `subscriptionId` is the one stored on that mailbox (a notification of a subscription we replaced or
 * deleted is dropped). Then:
 *  - a change or a `missed` event: a sync job for the mailbox (fixed job id, so a burst is one job). The sync reads the Inbox through
 *    the delta cursor, which is where messages are fetched by their immutable id;
 *  - `reauthorizationRequired`: the subscription is flagged `renewNow` (the push sweep renews it within two minutes) and the mailbox is synced;
 *  - `subscriptionRemoved`: the stored subscription is forgotten (the sweep makes a new one) and the mailbox is synced.
 * Nothing here calls Microsoft; the worker's sweep does.
 */
@Injectable()
export class MailGraphPushService {
  private readonly logger = new Logger(MailGraphPushService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: MicrosoftMailConfig,
    private readonly repo: MailPushRepository,
    private readonly mailboxes: MailboxesRepository,
    private readonly plan: MailPlan,
    private readonly publisher: MailSyncPublisher,
  ) {}

  async handle(items: readonly GraphNotification[]): Promise<GraphPushResult> {
    const out: GraphPushResult = { queued: 0, ignored: 0 };
    const cfg = await this.config.push();
    if (!cfg) return { queued: 0, ignored: items.length };
    for (const item of items) {
      const who = cfg.verify(item.clientState);
      if (!who) {
        out.ignored += 1;
        continue;
      }
      try {
        const mailbox = await this.db.privileged((tx) =>
          this.repo.microsoftByUuid(tx, who.orgId, who.mailboxUuid),
        );
        const held = mailbox?.pushState;
        if (
          !mailbox ||
          mailbox.status !== 'connected' ||
          held?.kind !== GRAPH_SUBSCRIPTION_KIND ||
          held.id !== item.subscriptionId ||
          !(await this.plan.isEnabled(mailbox.orgId).catch(() => false))
        ) {
          out.ignored += 1;
          continue;
        }
        const action = actionOf(item);
        if (action !== 'sync') await this.mark(mailbox.orgId, mailbox.uuid, action, held);
        if (await this.publisher.enqueue(mailbox.orgId, mailbox.uuid)) out.queued += 1;
      } catch (err) {
        // Not acknowledging would only make Microsoft retry; the polling sweep catches up either way.
        this.logger.warn(
          { orgId: who.orgId, mailbox: who.mailboxUuid, err: (err as Error).message },
          'a Graph notification could not be handled',
        );
      }
    }
    return out;
  }

  private async mark(
    orgId: number,
    mailboxUuid: string,
    action: 'renew' | 'forget',
    held: Record<string, unknown>,
  ): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.mailboxes.byUuid(tx, orgId, mailboxUuid);
      if (!row) return;
      await this.mailboxes.savePushState(
        tx,
        orgId,
        row.id,
        action === 'forget' ? null : { ...held, renewNow: true },
      );
    });
  }
}
