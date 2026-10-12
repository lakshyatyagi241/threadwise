import { Injectable, Logger } from '@nestjs/common';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { MailPlan } from './mail-plan';
import { historyNotNewer } from './mail-push-rules';
import { MailPushRepository, type PushMailbox } from './mail-push.repository';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MailTokens } from './mail-tokens.service';
import { MailboxesRepository } from './mailboxes.repository';

export type PushSweepResult = { started: number; renewed: number; stopped: number; failed: number };

const expiresAtOf = (state: Record<string, unknown> | null): number => {
  const t = typeof state?.expiresAt === 'string' ? Date.parse(state.expiresAt) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Gmail push (TW-MAIL-033): what a Pub/Sub notification does, and keeping the Gmail watches alive.
 *
 *  - `notify`: a verified notification names an address and a history id. Every CONNECTED google mailbox with that address whose stored
 *    cursor is behind the history id gets a sync job (fixed job id: bursts and replays collapse into one). A stale or replayed id, an
 *    unknown address or a mailbox of a workspace without the add-on is ignored, silently.
 *  - `sweep`: starts a watch for each connected mailbox that has none (a new connection, or push just configured), renews the ones near
 *    expiry (a watch lasts 7 days), and stops and forgets the ones that lapsed: the mailbox needs reconnecting or is disconnected, push
 *    was switched off at the platform, or the renewal kept failing until the watch ran out. A mailbox without a watch is simply polled.
 */
@Injectable()
export class MailPushService {
  private readonly logger = new Logger(MailPushService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailPushRepository,
    private readonly mailboxes: MailboxesRepository,
    private readonly drivers: MailDriverRegistry,
    private readonly tokens: MailTokens,
    private readonly plan: MailPlan,
    private readonly publisher: MailSyncPublisher,
  ) {}

  /** Returns how many sync jobs were queued. */
  async notify(emailAddress: string, historyId: string): Promise<number> {
    const found = await this.db.privileged((tx) => this.repo.connectedByAddress(tx, emailAddress));
    let queued = 0;
    for (const m of found) {
      if (historyNotNewer(historyId, m.syncCursor?.historyId)) continue;
      if (!(await this.plan.isEnabled(m.orgId).catch(() => false))) continue;
      if (await this.publisher.enqueue(m.orgId, m.uuid)) queued += 1;
    }
    return queued;
  }

  /** The sweep, over every workspace. Safe to run any number of times. */
  async sweep(now = Date.now()): Promise<PushSweepResult> {
    const out: PushSweepResult = { started: 0, renewed: 0, stopped: 0, failed: 0 };
    const driver = this.drivers.find('google');
    if (!driver?.push) return out;
    const available = await driver.push.available().catch(() => false);
    const renewBeforeMs = channelEmailEnv().MAIL_PUSH_RENEW_BEFORE_HOURS * 3_600_000;
    const candidates = await this.db.privileged((tx) => this.repo.pushCandidates(tx));
    const entitled = new Map<number, boolean>();
    for (const m of candidates) {
      try {
        let ok = entitled.get(m.orgId);
        if (ok === undefined) {
          ok = await this.plan.isEnabled(m.orgId).catch(() => false);
          entitled.set(m.orgId, ok);
        }
        const hasWatch = m.pushState !== null;
        if (!available || !ok || m.status !== 'connected') {
          if (hasWatch) {
            await this.lapse(m, m.status === 'connected' && ok);
            out.stopped += 1;
          }
          continue;
        }
        const left = expiresAtOf(m.pushState) - now;
        if (hasWatch && left > renewBeforeMs) continue;
        const state = await this.start(m);
        if (state) {
          if (hasWatch) out.renewed += 1;
          else out.started += 1;
        } else if (hasWatch && left <= 0) {
          await this.lapse(m, false);
          out.stopped += 1;
        }
      } catch (err) {
        out.failed += 1;
        this.logger.warn(
          { orgId: m.orgId, mailbox: m.uuid, err: (err as Error).message },
          'gmail watch could not be started or renewed',
        );
        // A watch that already ran out cannot be left claiming to be live.
        if (m.pushState && expiresAtOf(m.pushState) <= now) {
          await this.lapse(m, false).catch(() => undefined);
          out.stopped += 1;
        }
      }
    }
    return out;
  }

  private start(m: PushMailbox) {
    return this.inSystemContext(m, () =>
      this.tokens.withAccess(m.orgId, m.uuid, async (access, mailbox) => {
        const driver = this.drivers.get(mailbox.provider);
        const state = await driver.push!.start({ orgId: m.orgId, mailbox, access });
        await this.db.txAs({ orgId: m.orgId, userId: null }, (tx) =>
          this.mailboxes.savePushState(tx, m.orgId, mailbox.id, state),
        );
        return state;
      }),
    );
  }

  /** Withdraws the watch when the mailbox can still be reached (best effort), then forgets it here. */
  private async lapse(m: PushMailbox, tryStop: boolean): Promise<void> {
    if (tryStop) {
      await this.inSystemContext(m, () =>
        this.tokens.withAccess(m.orgId, m.uuid, async (access, mailbox) =>
          this.drivers.get(mailbox.provider).push?.stop({ orgId: m.orgId, mailbox, access }),
        ),
      ).catch((err: Error) =>
        this.logger.warn({ mailbox: m.uuid, err: err.message }, 'gmail watch not withdrawn'),
      );
    }
    await this.db.txAs({ orgId: m.orgId, userId: null }, async (tx) => {
      const row = await this.mailboxes.byUuid(tx, m.orgId, m.uuid);
      if (row) await this.mailboxes.savePushState(tx, m.orgId, row.id, null);
    });
  }

  private inSystemContext<T>(m: PushMailbox, fn: () => Promise<T>): Promise<T> {
    return RequestContextStore.run(
      {
        requestId: `mail-push-${m.uuid}`,
        orgId: m.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
