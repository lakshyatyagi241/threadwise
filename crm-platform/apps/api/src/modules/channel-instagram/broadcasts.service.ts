import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type IgCompose,
  type IgSendResult,
  type SendIgBroadcastInput,
  type SendIgComposerInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  SendWindowService,
  scheduleWake,
  splitByQuietHours,
  type WakeQueue,
} from '../compliance-center';
import { ConsentGate } from '../contact-consent';
import {
  INSTAGRAM_BRIDGE,
  type InstagramBridgeFactory,
} from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { EngineConnectionService } from '../addons-extension-registry';
import { AccountsRepository } from './accounts.repository';
import { isLive, handleOf } from './account-rules';
import {
  CONCURRENCY,
  ERRORS_SHOWN,
  THREADS_PER_ACCOUNT,
  chunk,
  clipError,
  composerBody,
  personalize,
  windowOpen,
} from './broadcast-rules';
import { engineThreadId, sendFailure, shapeReply } from './reply-rules';
import {
  INSTAGRAM_INBOX_INGEST,
  INSTAGRAM_PLAN_GATE,
  INSTAGRAM_TEMPLATES,
  type InstagramInboxIngest,
  type InstagramPlanGate,
  type InstagramTemplates,
} from './_shims/tokens';

interface Plan {
  threadIds: string[];
  /** The text for one person, from their thread title. */
  text: (title: string) => string;
  buttons?: readonly unknown[];
  /** The broadcasts page sends marketing (held for the quiet hours); a reply typed in the inbox composer is service and is not (BL-191). */
  marketing?: boolean;
}

/** The queue job name of the run that takes up the people the quiet hours held back. Travels on the `ig-pull` queue. */
export const IG_HELD_JOB = 'held-broadcast';

export interface IgHeldJob {
  orgId: number;
  userId: number | null;
  /** Thread public ids, each with the text already made for that person. */
  items: Array<{ threadId: string; text: string }>;
  buttons?: readonly unknown[];
}

/**
 * Reply-only sends (TW-IG-013, 014): the data the pickers need, and the send itself for the broadcasts page and the inbox composer.
 * Instagram only lets an account message someone who has already written to it, so the recipients are existing threads; the engine
 * enforces the 24 hour window at send time and its refusal is counted as a failure. Nothing is kept as a broadcast record (Reference
 * kept none): each message that went is mirrored into its thread, and the answer carries the counts.
 *
 * Quiet hours (BL-191): the broadcasts page sends marketing, so a thread whose contact's local time is inside the workspace's quiet hours
 * is HELD, not denied. The answer counts it as `held` with the first instant it goes, and a delayed job (queue `ig-pull`, job
 * `held-broadcast`) sends it at the opening, reading the hours and the consent again; the engine's 24 hour rule still decides at that
 * moment. The inbox composer is a person answering a person and is never held.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: AccountsRepository,
    private readonly engines: EngineConnectionService,
    @Inject(INSTAGRAM_BRIDGE) private readonly bridge: InstagramBridgeFactory,
    @Inject(INSTAGRAM_INBOX_INGEST) private readonly inbox: InstagramInboxIngest,
    @Inject(INSTAGRAM_TEMPLATES) private readonly templates: InstagramTemplates,
    @Inject(INSTAGRAM_PLAN_GATE) private readonly plan: InstagramPlanGate,
    private readonly sendWindow: SendWindowService,
    private readonly gate: ConsentGate,
    @InjectQueue(QUEUES.IG_PULL) private readonly queue: Queue,
  ) {}

  /** The linked accounts that are connected, each with its threads, and the Instagram templates. Empty accounts while the engine is off. */
  async compose(): Promise<IgCompose> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const conn = await this.engines.connection('instagram');
    return this.db.tx(async (tx) => {
      const templates = (await this.templates.list(tx, orgId)).map((t) => ({
        id: t.uuid,
        name: t.name,
        body: t.body,
        buttons: t.buttons,
      }));
      if (!conn.connected) return { accounts: [], threads: {}, templates };

      const rows = (await this.accounts.list(tx, orgId)).filter((r) => isLive(r.status));
      const now = new Date();
      const threads: IgCompose['threads'] = {};
      for (const r of rows) {
        threads[r.instaflowAccountId] = (
          await this.inbox.threadsOfAccount(tx, orgId, r.instaflowAccountId, THREADS_PER_ACCOUNT)
        ).map((t) => ({
          id: t.uuid,
          title: t.title || 'Instagram user',
          windowOpen: windowOpen(t.lastInboundAt, now),
        }));
      }
      return {
        accounts: rows.map((r) => ({
          id: r.uuid,
          instaflowAccountId: r.instaflowAccountId,
          handle: `@${handleOf(r.username, r.name)}`,
        })),
        threads,
        templates,
      };
    });
  }

  /** The broadcasts page: one message to the picked threads, `{name}` becoming each person's name. */
  sendBroadcast(input: SendIgBroadcastInput): Promise<IgSendResult> {
    return this.send({
      threadIds: input.threadIds,
      text: (title) => personalize(input.message, title),
      marketing: true,
    });
  }

  /** The inbox composer: the typed text, or the template's body and buttons when one is picked (an unknown template is ignored). */
  async sendFromComposer(input: SendIgComposerInput): Promise<IgSendResult> {
    const { orgId } = RequestContextStore.require();
    const template = input.templateId
      ? await this.db.tx((tx) => this.templates.find(tx, orgId, input.templateId!))
      : undefined;
    const body = composerBody(input.body, template);
    return this.send({ threadIds: input.threadIds, text: () => body, buttons: template?.buttons });
  }

  private async send(p: Plan): Promise<IgSendResult> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcast(ctx.orgId);
    const conn = await this.engines.connection('instagram');
    if (conn.url === '' || conn.secret === '') {
      throw new AppError(
        ERROR_CODES.IG_NOT_CONNECTED,
        'Instagram is not connected.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ids = [...new Set(p.threadIds)];
    const found = new Map(
      (await this.db.tx((tx) => this.inbox.findThreads(tx, ctx.orgId, ids))).map((t) => [
        t.uuid,
        t,
      ]),
    );
    const api = this.bridge.with(conn);

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const fail = (why: string | null) => {
      failed += 1;
      if (why !== null && errors.length < ERRORS_SHOWN) errors.push(clipError(why));
    };

    // Quiet hours: one statement for the whole audience; only the broadcasts page is asked.
    const holds = new Map<string, { until: string }>();
    if (p.marketing === true) {
      const rows = ids.flatMap((id) => {
        const t = found.get(id);
        return t && t.channel === 'instagram' ? [{ id, contactId: t.contactId }] : [];
      });
      const split = await splitByQuietHours(this.sendWindow, ctx.orgId, rows);
      for (const h of split.held) holds.set(h.row.id, h.hold);
    }
    const heldItems: IgHeldJob['items'] = [];
    let heldAt: Date | null = null;

    for (const group of chunk(ids, CONCURRENCY)) {
      await Promise.all(
        group.map(async (id) => {
          const thread = found.get(id);
          // A thread that is not this organization's, or not an Instagram one, counts as a failure; nothing is sent to it.
          if (!thread || thread.channel !== 'instagram') return fail(null);
          const engineId = engineThreadId(thread.rawJid);
          if (engineId === '') return fail(null);

          const text = p.text(thread.title);
          // Held, not denied: kept for the delayed run; the rest of the audience carries on.
          const hold = holds.get(id);
          if (hold) {
            heldItems.push({ threadId: id, text });
            const at = new Date(hold.until);
            if (heldAt === null || at.getTime() < heldAt.getTime()) heldAt = at;
            return;
          }
          const out = await this.deliver(
            ctx.orgId,
            ctx.userId,
            api,
            conn.brand,
            thread,
            text,
            p.buttons,
          );
          if (out.ok) sent += 1;
          else fail(out.why);
        }),
      );
    }

    let held = heldItems.length;
    let heldUntil: string | null = heldAt ? (heldAt as Date).toISOString() : null;
    if (heldItems.length > 0 && heldAt) {
      const queued = await this.queueHeld(
        { orgId: ctx.orgId, userId: ctx.userId, items: heldItems, buttons: p.buttons },
        heldAt,
      );
      if (!queued) {
        // Nothing would ever send them: they count as failed, with the reason, so the person can send again later.
        for (let i = 0; i < heldItems.length; i++)
          fail('Could not be queued for after the quiet hours. Send it again later.');
        held = 0;
        heldUntil = null;
      }
    }
    this.logger.log({ orgId: ctx.orgId, sent, failed, held }, 'instagram reply-only send done');
    return { sent, failed, errors, held, heldUntil };
  }

  /** One message into one thread, and its copy into the thread. A mirror that fails is logged, never undoes the send. */
  private async deliver(
    orgId: number,
    userId: number | null,
    api: ReturnType<InstagramBridgeFactory['with']>,
    brand: Parameters<typeof sendFailure>[0],
    thread: { id: number; uuid: string; rawJid: string | null },
    text: string,
    buttons: readonly unknown[] | undefined,
  ): Promise<{ ok: true } | { ok: false; why: string | null }> {
    const engineId = engineThreadId(thread.rawJid);
    try {
      const res = await api.reply(engineId, shapeReply({ text, buttons }));
      if (!res.ok) return { ok: false, why: sendFailure(brand, res.status, res.error) };
      // The message went: show it in the thread at once.
      try {
        await this.db.tx((tx) =>
          this.inbox.recordOutbound(tx, orgId, thread.id, {
            body: text,
            providerMessageId: res.data.messageId,
            userId,
          }),
        );
      } catch (err) {
        this.logger.warn({ err, thread: thread.uuid }, 'instagram send was not mirrored');
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, why: (err as Error).message };
    }
  }

  /** Queues the run that takes up the held people at the first opening. False when the queue is down. */
  private async queueHeld(job: IgHeldJob, at: Date): Promise<boolean> {
    let queued = true;
    await scheduleWake(
      this.queue as unknown as WakeQueue<IgHeldJob>,
      IG_HELD_JOB,
      job,
      `ig-${job.orgId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at,
      (err) => {
        queued = false;
        this.logger.error(
          { orgId: job.orgId, err },
          'could not queue the wake-up of an Instagram send held for the quiet hours',
        );
      },
      this.sendWindow.now(),
    );
    return queued;
  }

  /**
   * The delayed run for the people the quiet hours held back (worker). The hours are read again for each (a person whose clock is
   * still inside them waits for their own opening), the ConsentGate is asked again, and the engine's 24 hour rule decides at send time.
   */
  async releaseHeld(job: IgHeldJob): Promise<{ sent: number; failed: number; held: number }> {
    const { orgId, userId } = job;
    try {
      await this.plan.assertBroadcast(orgId);
    } catch {
      this.logger.warn({ orgId }, 'held Instagram send dropped: the plan no longer has broadcasts');
      return { sent: 0, failed: job.items.length, held: 0 };
    }
    const conn = await this.engines.connection('instagram');
    if (conn.url === '' || conn.secret === '') {
      this.logger.warn({ orgId }, 'held Instagram send dropped: Instagram is not connected');
      return { sent: 0, failed: job.items.length, held: 0 };
    }
    const api = this.bridge.with(conn);
    const found = new Map(
      (
        await this.db.tx((tx) =>
          this.inbox.findThreads(
            tx,
            orgId,
            job.items.map((i) => i.threadId),
          ),
        )
      ).map((t) => [t.uuid, t]),
    );
    const rows = job.items.flatMap((i) => {
      const t = found.get(i.threadId);
      return t && t.channel === 'instagram' ? [{ ...i, contactId: t.contactId }] : [];
    });
    const split = await splitByQuietHours(this.sendWindow, orgId, rows);
    const recheck = await this.gate.checkMany(
      orgId,
      split.go.flatMap((r) => (r.contactId === null ? [] : [r.contactId])),
      'instagram',
      'marketing_messaging',
    );

    let sent = 0;
    let failed = 0;
    for (const r of split.go) {
      const verdict = r.contactId === null ? undefined : recheck.decisions.get(r.contactId);
      const thread = found.get(r.threadId);
      if (!thread || verdict?.decision === 'deny') {
        failed += 1;
        continue;
      }
      const out = await this.deliver(orgId, userId, api, conn.brand, thread, r.text, job.buttons);
      if (out.ok) sent += 1;
      else failed += 1;
    }
    // Still inside their own hours: wait again for the first of those openings.
    if (split.held.length > 0) {
      const earliest = split.held
        .map((h) => new Date(h.hold.until))
        .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
      await this.queueHeld(
        {
          ...job,
          items: split.held.map((h) => ({ threadId: h.row.threadId, text: h.row.text })),
        },
        earliest,
      );
    }
    this.logger.log(
      { orgId, sent, failed, held: split.held.length },
      'instagram held send released',
    );
    return { sent, failed, held: split.held.length };
  }
}
