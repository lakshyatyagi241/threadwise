import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ListMessageHistoryQuery,
  type MessageHistoryDetail,
  type MessageHistoryFilters,
  type MessageHistoryInsights,
  type MessageHistoryPage,
  type MessageHistorySummary,
  type MessageHistorySummaryQuery,
  type MessageLogExport,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore, type RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  MessageFeedService,
  deepEqual,
  isolated,
  orgTimezone,
  serve,
  sourceOf,
} from '../analytics';
import {
  ENTITY_OF_PREFIX,
  MESSAGE_LOG_FACADE,
  MessageHistoryRepository,
  decodeCursor,
  previousWindow,
  recipientTimeline,
  resolveWindow,
  safeZone,
  toHistoryRow,
  type HistoryContext,
  type FeedRollup,
  type HistorySelection,
  type HistoryWindow,
  type MessageLogFacade,
} from '../chat-conversations';
import { InboxAccess } from './inbox-access.service';
import {
  HISTORY_METRIC_KEY,
  feedRollup,
  hiddenChannelIds,
  rollupApplies,
} from './message-history-rollup';
import { visibleToJoinedSql } from './visibility-sql';

export const PERM_HISTORY_READ = 'msg.history.read';
const PERM_CONTACTS_READ = 'record.contacts.read';
const PERM_WALLET_STATEMENT = 'wallet.statement.read';
const DAY_MS = 86_400_000;
const isEmpty = (o: object): boolean => Object.keys(o).length === 0;

/** Structural equality of two summaries, leaving out one key. */
function deepEqualExcept(a: object, b: object, key: string): boolean {
  const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
  return deepEqual(strip(a), strip(b));
}

const WINDOW_TEXT = {
  order: 'The start date must not be after the end date.',
  future: 'The end date cannot be in the future.',
  too_old: 'The history reaches back one year. Choose dates within the last 365 days.',
} as const;

/**
 * Message History (Reference `/message-history`, TW-CHAT-039 to -042): the workspace's messages in one feed, with counts, charts, the
 * drawer of one message and the export.
 *
 * Who sees what is decided here, once, and handed to the SQL as data (`HistoryContext`):
 *  - a row of a conversation is visible exactly when the conversation is for this caller (their scope for `inbox.conversation.read`,
 *    the inbox's own rule), so a member who reads only their conversations sees no one else's messages;
 *  - a broadcast, campaign or scheduled recipient row belongs to no conversation and is visible only to a caller who reads ALL;
 *  - a recipient's number is shown whole only for a contact the caller may read (`record.contacts.read` and its scope); else its last 4 digits;
 *  - charges are joined only for a caller who may read the wallet statement.
 */
@Injectable()
export class MessageHistoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: InboxAccess,
    private readonly rbac: RbacService,
    private readonly repo: MessageHistoryRepository,
    private readonly feed: MessageFeedService,
    @Inject(MESSAGE_LOG_FACADE) private readonly logs: MessageLogFacade,
  ) {}

  // --- the feed ---------------------------------------------------------------------------------------------------------------

  async list(query: ListMessageHistoryQuery, now: Date = new Date()): Promise<MessageHistoryPage> {
    const ctx = RequestContextStore.require();
    const window = this.windowOf(query, now);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && cursor === null) throw AppError.validation('The cursor is not valid.');
    const sel = selectionOf(query, window);
    const { rows, next } = await this.db.tx(async (tx) => {
      const hc = await this.context(tx, ctx);
      return this.repo.page(tx, hc, sel, cursor, query.limit);
    });
    return {
      data: rows.map(toHistoryRow),
      page: { nextCursor: next, hasMore: next !== null, limit: query.limit },
      window: windowText(window),
    };
  }

  async summary(
    query: MessageHistorySummaryQuery,
    now: Date = new Date(),
  ): Promise<MessageHistorySummary> {
    const ctx = RequestContextStore.require();
    const window = this.windowOf(query, now);
    const sel = selectionOf(query, window);
    const prev: HistorySelection = { ...sel, window: previousWindow(window) };
    const out = await this.db.tx(async (tx) => {
      const hc = await this.context(tx, ctx);
      const rollup = await this.rollupFor(tx, hc, sel);
      if (!rollup) return this.repo.summary(tx, hc, sel, prev);
      return serve(
        HISTORY_METRIC_KEY,
        () => this.repo.summary(tx, hc, sel, prev),
        () => isolated(tx, (t) => this.repo.summary(t, hc, sel, prev, rollup)),
        // the average first reply means something else on the rollup (decision D9: replies made in the window), so it is not compared
        { equal: (a, b) => deepEqualExcept(a, b, 'avgFirstResponseSeconds') },
      );
    });
    return { window: windowText(window), ...out };
  }

  async insights(
    query: MessageHistorySummaryQuery,
    now: Date = new Date(),
  ): Promise<MessageHistoryInsights> {
    const ctx = RequestContextStore.require();
    const window = this.windowOf(query, now);
    const sel = selectionOf(query, window);
    const tz = safeZone(query.tz);
    // Reference's hourly view is the last 24 hours, whatever the range.
    const seriesFrom =
      query.bucket === 'hourly'
        ? new Date(Math.max(window.from.getTime(), window.to.getTime() - DAY_MS))
        : window.from;
    const out = await this.db.tx(async (tx) => {
      const hc = await this.context(tx, ctx);
      const o = { bucket: query.bucket, tz, seriesFrom };
      const rollup = await this.rollupFor(tx, hc, sel, tz);
      if (!rollup || !isEmpty(sel.narrow)) return this.repo.insights(tx, hc, sel, o);
      return serve(
        HISTORY_METRIC_KEY,
        () => this.repo.insights(tx, hc, sel, o),
        () => isolated(tx, (t) => this.repo.insights(t, hc, sel, o, rollup)),
      );
    });
    return { bucket: query.bucket, tz, ...out };
  }

  // --- the drawer -------------------------------------------------------------------------------------------------------------

  async detail(id: string): Promise<MessageHistoryDetail> {
    const ctx = RequestContextStore.require();
    const prefix = id[0] as keyof typeof ENTITY_OF_PREFIX;
    const kind = ENTITY_OF_PREFIX[prefix];
    const uuid = id.slice(2);
    const empty: HistorySelection = {
      window: { from: new Date(0), to: new Date(0) },
      scoping: {},
      narrow: {},
    };
    const raw = await this.db.tx(async (tx) => {
      const hc = await this.context(tx, ctx);
      return this.repo.detail(tx, hc, empty, kind, uuid);
    });
    if (!raw) {
      throw new AppError(ERROR_CODES.MESSAGE_NOT_FOUND, 'Message not found', HttpStatus.NOT_FOUND);
    }
    const row = toHistoryRow(raw);
    let timeline = recipientTimeline(raw);
    let fromArchive = false;
    let logExpired = false;
    if (kind === 'message') {
      const log = await this.logs.messageLog(uuid);
      timeline = log.events;
      fromArchive = log.fromArchive;
      logExpired = log.expired;
    }
    return {
      ...row,
      body: typeof raw.body === 'string' && raw.body !== '' ? raw.body : null,
      providerMessageId: typeof raw.provider_id === 'string' ? raw.provider_id : null,
      sender:
        typeof raw.sender_kind === 'string'
          ? {
              kind: raw.sender_kind,
              name: typeof raw.sender_name === 'string' ? raw.sender_name : null,
            }
          : null,
      language: typeof raw.language === 'string' ? raw.language : null,
      timeline,
      fromArchive,
      logExpired,
    };
  }

  // --- the export -------------------------------------------------------------------------------------------------------------

  /**
   * Queues the export of the feed with the screen's filters. The file holds every row and full numbers, so it is for a caller who may
   * export the delivery log AND reads every conversation: anyone narrower would be handing out what they cannot see.
   */
  async requestExport(
    filters: MessageHistoryFilters,
    now: Date = new Date(),
  ): Promise<MessageLogExport> {
    const ctx = RequestContextStore.require();
    if (!this.rbac.can(ctx.grants ?? new Map(), PERM_HISTORY_READ).allowed) {
      throw AppError.forbidden(PERM_HISTORY_READ);
    }
    const scope = await this.db.tx((tx) => this.access.viewer(tx, ctx));
    if (scope.scope !== 'all') throw AppError.forbidden('inbox.conversation.read');
    const window = this.windowOf(filters, now);
    const stored: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (k !== 'range' && k !== 'from' && k !== 'to') stored[k] = v;
    }
    return this.logs.requestHistoryExport({
      from: window.from.toISOString().slice(0, 10),
      to: new Date(window.to.getTime() - 1).toISOString().slice(0, 10),
      filters: { ...stored, window: windowText(window) },
    });
  }

  // --- who is asking ----------------------------------------------------------------------------------------------------------

  private async context(tx: Tx, ctx: RequestContext): Promise<HistoryContext> {
    const grants = ctx.grants ?? new Map();
    const viewer = await this.access.viewer(tx, ctx);
    // The route let them in with `msg.history.read`; without a read scope there is nothing they may see.
    if (viewer.scope === null) throw AppError.forbidden('inbox.conversation.read');
    const contacts = this.rbac.can(grants, PERM_CONTACTS_READ);
    const visible = visibleToJoinedSql(viewer, 'c');
    const hidden =
      viewer.scope === 'all' ? await hiddenChannelIds(tx, ctx.orgId, viewer) : undefined;
    return {
      orgId: ctx.orgId,
      conversationJoins: visible.joins,
      conversationVisible: visible.where,
      bulk: viewer.scope === 'all',
      contacts: {
        scope: contacts.allowed ? contacts.scope : null,
        userId: ctx.userId!,
      },
      cost: this.rbac.can(grants, PERM_WALLET_STATEMENT).allowed,
      ...(hidden ? { hiddenChannelIds: hidden } : {}),
    };
  }

  /** The rollup that answers this request, or null when only a scan of `messages` can (`rollupApplies`) or the metric is still `legacy`. */
  private async rollupFor(
    tx: Tx,
    hc: HistoryContext,
    sel: HistorySelection,
    requestedZone?: string,
  ): Promise<FeedRollup | null> {
    if (sourceOf(HISTORY_METRIC_KEY) === 'legacy') return null;
    const workspace = await orgTimezone(tx, hc.orgId);
    if (!rollupApplies(hc, sel, { requested: requestedZone, workspace })) return null;
    return feedRollup(tx, this.feed, hc, sel, workspace);
  }

  private windowOf(
    f: Pick<MessageHistoryFilters, 'range' | 'from' | 'to'>,
    now: Date,
  ): HistoryWindow {
    const w = resolveWindow(f, now);
    if ('problem' in w) {
      throw AppError.validation(WINDOW_TEXT[w.problem], [
        { path: w.problem === 'order' ? 'from' : 'to', message: WINDOW_TEXT[w.problem] },
      ]);
    }
    return w;
  }
}

const windowText = (w: HistoryWindow) => ({
  from: w.from.toISOString(),
  to: w.to.toISOString(),
});

/** The filters of a request as the SQL takes them: what scopes the counts, and what narrows the table. */
function selectionOf(f: MessageHistoryFilters, window: HistoryWindow): HistorySelection {
  return {
    window,
    scoping: {
      ...(f.channelId ? { channelId: f.channelId } : {}),
      ...(f.templateId ? { templateId: f.templateId } : {}),
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
      ...(f.broadcastId ? { broadcastId: f.broadcastId } : {}),
      ...(f.scheduledId ? { scheduledId: f.scheduledId } : {}),
    },
    narrow: {
      ...(f.dir && f.dir !== 'all' ? { dir: f.dir } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.source && f.source.length > 0 ? { source: f.source } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.q ? { q: f.q } : {}),
    },
  };
}
