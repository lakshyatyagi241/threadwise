import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { ERROR_CODES, META_LEADGEN_JOB, type MetaLeadgenJob } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../infra/providers/channel-facebook/facebook.port';
import {
  INBOUND_HOOKS,
  INBOX_INGEST,
  type InboundContext,
  type InboundHooks,
  type InboundInput,
  type InboxIngest,
} from './_shims/tokens';
import { PLACEHOLDER_NAME } from './_shims/chat-inbox-ingest';
import {
  readComment,
  readEntries,
  readLeadgen,
  readMessaging,
  type DmInput,
  type PageEntry,
} from './event-rules';
import {
  commentThreadKey,
  dmThreadKey,
  senderName,
  signatureMatches,
  verifyHandshake,
} from './page-rules';
import { PagesRepository, type PageRow } from './pages.repository';

export type ReceiveResult = 'ok' | 'forbidden';

/**
 * The public Facebook webhook (TW-FB-006 to 009). Meta delivers at least once, in any order and in batches, so every entry and every
 * event is read, each is stored once by its Meta id, and a failure in one never stops the rest from being tried (the delivery then answers 503 so Meta redelivers it, see receive). The tenant is found through a
 * narrow SECURITY DEFINER lookup; from there on everything runs under that organization's context.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
    @Inject(INBOUND_HOOKS) private readonly hooks: InboundHooks,
    @InjectQueue(QUEUES.META_LEADGEN) private readonly leadgen: Queue<MetaLeadgenJob>,
  ) {}

  verify(mode: string, token: string): boolean {
    return verifyHandshake(mode, token, this.graph.settings.verifyToken);
  }

  /**
   * A bad signature is refused only when a secret is configured; with none the event is accepted, so Meta's "Verify and Save" works
   * before the app secret is entered (Reference's behaviour, kept).
   */
  async receive(rawBody: Buffer, signature: string, payload: unknown): Promise<ReceiveResult> {
    const secrets = this.graph.settings.signingSecrets;
    if (secrets.length > 0 && !signatureMatches(rawBody, signature, secrets)) {
      this.logger.warn('facebook webhook signature verification failed');
      return 'forbidden';
    }
    // Every entry and event is tried even if an earlier one failed. A 2xx tells Meta the delivery is ours and it is never sent again,
    // so a failed store answers 503 after the loop: every write is idempotent per Meta id, so Meta redelivering the batch is safe.
    const failed = { count: 0 };
    for (const entry of readEntries(payload)) {
      try {
        await this.fanOut(entry, failed);
      } catch (err) {
        if (!(err instanceof AppError)) failed.count += 1;
        this.logger.error({ err, page: entry.pageId }, 'facebook entry failed');
      }
    }
    if (failed.count > 0) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'Could not store the delivery, please retry',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return 'ok';
  }

  /** One webhook per Page, delivered to every organization that connected it. */
  private async fanOut(entry: PageEntry, failed: { count: number }): Promise<void> {
    const found = await this.db.primary.execute(sql`SELECT * FROM fb_page_lookup(${entry.pageId})`);
    const hits = found.rows as Array<{
      page_org_id: number | string;
      page_row_id: number | string;
    }>;
    for (const hit of hits) {
      const orgId = Number(hit.page_org_id);
      const page = await this.db.txAs({ orgId }, (tx) =>
        this.pages.findById(tx, orgId, Number(hit.page_row_id)),
      );
      if (!page || page.status !== 'connected') continue;
      for (const ev of entry.messaging) {
        await this.guard(failed, orgId, page, 'messaging', () => this.messaging(orgId, page, ev));
      }
      for (const value of entry.feed) {
        await this.guard(failed, orgId, page, 'feed', () => this.comment(orgId, page, value));
      }
      for (const value of entry.leadgen) {
        await this.guard(failed, orgId, page, 'leadgen', () => this.queueLead(orgId, page, value));
      }
    }
  }

  private async guard(
    failed: { count: number },
    orgId: number,
    page: PageRow,
    what: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      // A rule the data broke (an AppError) fails the same way on every redelivery, so it is logged and not retried.
      if (!(err instanceof AppError)) failed.count += 1;
      this.logger.warn({ err, orgId, page: page.id }, `facebook ${what} ingest failed`);
    }
  }

  /**
   * A new lead on a lead form. The webhook carries ids only, so nothing is fetched here: the event is queued (one job per workspace and
   * lead, so Meta's redelivery of the same event is one job) and the lead ads worker reads the lead from Meta and hands it to the lead
   * pipeline. Whether this Page has lead sync on, and the form was picked, is the worker's to decide.
   */
  private async queueLead(
    orgId: number,
    page: PageRow,
    value: Record<string, unknown>,
  ): Promise<void> {
    const lead = readLeadgen(value);
    if (!lead) return;
    const job: MetaLeadgenJob = {
      orgId,
      pageId: page.pageId,
      leadgenId: lead.leadgenId,
      formId: lead.formId,
      adId: lead.adId,
    };
    await this.leadgen.add(META_LEADGEN_JOB, job, { jobId: `leadgen-${orgId}-${lead.leadgenId}` });
  }

  private async messaging(
    orgId: number,
    page: PageRow,
    ev: Record<string, unknown>,
  ): Promise<void> {
    const m = readMessaging(ev);
    if (m.kind === 'ignore') return;
    if (m.kind === 'postback') {
      // A tap has no message: it goes to the flow runtime FIRST (resume a parked flow, or start a keyword flow) and is never stored.
      await this.hooks
        .handoffToFlow({
          orgId,
          pageRowId: page.id,
          pageId: page.pageId,
          conversationId: null,
          psid: m.postback.psid,
          text: m.postback.payload,
          newThread: false,
          postback: true,
        })
        .catch((err: unknown) => this.logger.warn({ err }, 'facebook postback hand-off failed'));
      return;
    }
    await this.storeDm(orgId, page, m.dm);
  }

  private async storeDm(orgId: number, page: PageRow, dm: DmInput): Promise<void> {
    const input: InboundInput = {
      kind: 'dm',
      pageId: page.pageId,
      pageName: page.name ?? page.pageId,
      rawJid: dmThreadKey(page.pageId, dm.psid),
      title: PLACEHOLDER_NAME,
      senderId: dm.psid,
      body: dm.text,
      mediaType: dm.mediaType,
      mediaUrl: dm.mediaUrl,
      dedup: dm.mid,
      at: dm.timestamp === null ? null : new Date(dm.timestamp),
      meta: { psid: dm.psid, kind: 'dm' },
    };
    const rec = await this.inbox.recordInbound(orgId, input);
    if (!rec.stored) return;

    // The sender's real name and picture, once, when the thread is created. Best effort: the placeholder stays if Meta says nothing.
    if (rec.newThread)
      await this.learnProfile(orgId, page, dm.psid, rec.conversationId, rec.contactId);

    const ctx: InboundContext = {
      orgId,
      pageRowId: page.id,
      pageId: page.pageId,
      conversationId: rec.conversationId,
      psid: dm.psid,
      text: dm.text,
      newThread: rec.newThread,
    };
    // Flow first; only when no flow consumed the message do routing, the AI agent or a keyword reply run.
    try {
      if (!(await this.hooks.handoffToFlow({ ...ctx, postback: false })))
        await this.hooks.automate(ctx);
    } catch (err) {
      this.logger.warn({ err, orgId, page: page.id }, 'facebook automation failed');
    }
  }

  private async learnProfile(
    orgId: number,
    page: PageRow,
    psid: string,
    conversationId: number,
    contactId: number | null,
  ): Promise<void> {
    try {
      const profile = await this.graph
        .forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId)
        .getSenderProfile(psid);
      const name = senderName(profile);
      if (name === '') return;
      await this.db.txAs({ orgId }, (tx) =>
        this.inbox.applyProfile(tx, orgId, conversationId, contactId, {
          name,
          avatarUrl: profile?.profile_pic || null,
        }),
      );
    } catch (err) {
      this.logger.debug({ err, orgId, page: page.id }, 'facebook sender profile not stored');
    }
  }

  /** A new comment on one of the Page's posts: a thread per post and commenter, never a contact, never automation. */
  private async comment(
    orgId: number,
    page: PageRow,
    value: Record<string, unknown>,
  ): Promise<void> {
    const c = readComment(page.pageId, value);
    if (!c) return;
    // Checked BEFORE any Graph call: a redelivery of a comment without text must not trigger a second lookup.
    if (await this.db.txAs({ orgId }, (tx) => this.inbox.alreadyStored(tx, orgId, c.commentId)))
      return;

    let body = c.message;
    if (body === '') {
      // The webhook is a notification: the text is fetched when Meta left it out.
      const fetched = await this.graph
        .forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId)
        .getComment(c.commentId);
      body = fetched?.message ?? '';
    }
    const meta: Record<string, unknown> = {
      comment_id: c.commentId,
      post_id: c.postId,
      kind: 'comment',
      ...(c.parentId !== '' ? { parent_id: c.parentId } : {}),
      ...(c.fromId !== '' ? { from_id: c.fromId } : {}),
      ...(c.fromName !== '' ? { from_name: c.fromName } : {}),
    };
    await this.inbox.recordInbound(orgId, {
      kind: 'comment',
      pageId: page.pageId,
      pageName: page.name ?? page.pageId,
      rawJid: commentThreadKey(page.pageId, c.postId, c.fromId),
      title: c.fromName !== '' ? c.fromName : 'Facebook commenter',
      senderId: c.fromId,
      body: body !== '' ? body : '[comment]',
      mediaType: null,
      mediaUrl: null,
      dedup: c.commentId,
      at: null,
      meta,
    });
  }
}
