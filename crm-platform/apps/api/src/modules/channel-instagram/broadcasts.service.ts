import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
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
}

/**
 * Reply-only sends (WD-IG-013, 014): the data the pickers need, and the send itself for the broadcasts page and the inbox composer.
 * Instagram only lets an account message someone who has already written to it, so the recipients are existing threads; the engine
 * enforces the 24 hour window at send time and its refusal is counted as a failure. Nothing is kept as a broadcast record (WaDesk
 * kept none): each message that went is mirrored into its thread, and the answer carries the counts.
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

    for (const group of chunk(ids, CONCURRENCY)) {
      await Promise.all(
        group.map(async (id) => {
          const thread = found.get(id);
          // A thread that is not this organization's, or not an Instagram one, counts as a failure; nothing is sent to it.
          if (!thread || thread.channel !== 'instagram') return fail(null);
          const engineId = engineThreadId(thread.rawJid);
          if (engineId === '') return fail(null);

          const text = p.text(thread.title);
          try {
            const res = await api.reply(engineId, shapeReply({ text, buttons: p.buttons }));
            if (!res.ok) return fail(sendFailure(conn.brand, res.status, res.error));
            sent += 1;
            // The message went: show it in the thread at once. A mirror that fails is logged, never undoes the send.
            try {
              await this.db.tx((tx) =>
                this.inbox.recordOutbound(tx, ctx.orgId, thread.id, {
                  body: text,
                  providerMessageId: res.data.messageId,
                  userId: ctx.userId,
                }),
              );
            } catch (err) {
              this.logger.warn({ err, thread: thread.uuid }, 'instagram send was not mirrored');
            }
          } catch (err) {
            fail((err as Error).message);
          }
        }),
      );
    }
    this.logger.log({ orgId: ctx.orgId, sent, failed }, 'instagram reply-only send done');
    return { sent, failed, errors };
  }
}
