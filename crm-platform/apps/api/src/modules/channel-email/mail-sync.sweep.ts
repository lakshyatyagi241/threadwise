import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { MailPlan } from './mail-plan';
import { MailPushRepository } from './mail-push.repository';
import { ERROR_BACKOFF_MINUTES } from './mail-sync-rules';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MailboxesRepository } from './mailboxes.repository';

export const MAIL_SWEEP_INTERVAL_MS = 60_000;

/**
 * Every 60 seconds, one sync job for each connected mailbox (TW-MAIL-021). Polling (a provider's push, TW-MAIL-033, only makes it faster): a minute is the
 * delay a customer's mail can wait in a team inbox. The job id is the mailbox, so a sync still running or waiting is never queued twice.
 * Workspaces that no longer own the `email_channel` feature are left out (their mail and conversations stay, nothing new arrives), and so
 * is every mailbox whose provider the platform has not set up. Registered only in the worker process.
 */
@Injectable()
export class MailSyncSweep {
  private readonly logger = new Logger(MailSyncSweep.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly plan: MailPlan,
    private readonly drivers: MailDriverRegistry,
    private readonly publisher: MailSyncPublisher,
    private readonly pushRepo: MailPushRepository,
  ) {}

  @Interval(MAIL_SWEEP_INTERVAL_MS)
  async tick(): Promise<number> {
    try {
      return await this.run();
    } catch (err) {
      this.logger.error({ err }, 'mail sync sweep failed');
      return 0;
    }
  }

  async run(): Promise<number> {
    // A provider the platform has not set up (no Google client yet) is left alone; the others still sync.
    const ready = new Set<string>();
    for (const d of this.drivers.list()) {
      if ((await d.readiness().catch(() => ({ ready: false }))).ready) ready.add(d.provider);
    }
    if (ready.size === 0) return 0;
    const due = await this.db.privileged((tx) =>
      this.repo.dueEverywhere(tx, ERROR_BACKOFF_MINUTES),
    );
    // A mailbox with a live Gmail watch is told about new mail by Pub/Sub; polling only reconciles it every few minutes (TW-MAIL-033).
    const pushed = await this.db
      .privileged((tx) =>
        this.pushRepo.freshlySyncedWithPush(tx, channelEmailEnv().MAIL_PUSH_RECONCILE_MINUTES),
      )
      .catch(() => new Set<string>());
    const entitled = new Map<number, boolean>();
    let queued = 0;
    for (const { orgId, uuid, provider } of due) {
      if (!ready.has(provider)) continue;
      if (pushed.has(uuid)) continue;
      let ok = entitled.get(orgId);
      if (ok === undefined) {
        ok = await this.plan.isEnabled(orgId).catch(() => false);
        entitled.set(orgId, ok);
      }
      if (!ok) continue;
      if (await this.publisher.enqueue(orgId, uuid)) queued += 1;
    }
    return queued;
  }
}
