import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type FbConnectResult,
  type FacebookConnectConfig,
  type FacebookPage,
  type FacebookPageActionResult,
  type FacebookPageList,
  type StartConnectResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  FB_SCOPES,
  type FacebookGraphFactory,
  type GraphPage,
  type TokenDebug,
} from '../../infra/providers/channel-facebook/facebook.port';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { FACEBOOK_PLAN_GATE, type FacebookPlanGate } from './_shims/tokens';
import {
  TOKEN_INVALID_MESSAGE,
  clipError,
  connectSummary,
  isTokenError,
  loginUrl,
  readState,
  webhookAddress,
} from './page-rules';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import { PagesRepository, type PageRow } from './pages.repository';

export const MODULE_KEY = 'facebook_pages';

export interface BackfillJob {
  orgId: number;
  pageRowId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

const NO_PAGES =
  'No Facebook Pages were found on this account. Make sure you granted access to at least one Page you manage.';

/** What the login round trip leaves behind for the browser to show. */
export interface LoginOutcome {
  ok: boolean;
  message: string;
}

/**
 * Connecting and managing Facebook Pages (TW-FB-001 to 005). The account is connected once, by the login dialog, the popup or a
 * pasted Page token, and every Page it manages is stored with its own token (encrypted, never returned).
 *
 * Differences from Reference that the port needs: there is no PHP session, so the login's `state` is a sealed, short-lived value
 * that names the organization and the user (the same login-CSRF guard); and the history backfill is a queue job, not a hook that
 * runs after the response.
 */
@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PagesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(FACEBOOK_PLAN_GATE) private readonly plan: FacebookPlanGate,
    @InjectQueue(QUEUES.FB_BACKFILL) private readonly backfill: Queue<BackfillJob>,
    private readonly inbox: ChatInboxIngest,
  ) {}

  /** Keeps the Page's inbox channel (connected or not) in step. Best effort: the Page itself is already saved. */
  private async syncChannel(orgId: number, page: PageRow, connected: boolean): Promise<void> {
    try {
      await this.inbox.syncPage(orgId, {
        pageId: page.pageId,
        name: page.name ?? page.pageId,
        connected,
      });
    } catch (err) {
      this.logger.warn({ err, orgId, page: page.pageId }, 'facebook inbox channel not synced');
    }
  }

  /** What the API shows of a Page: never a token. */
  toResponse(row: PageRow): FacebookPage {
    return {
      id: row.uuid,
      pageId: row.pageId,
      name: row.name,
      category: row.category,
      username: row.username,
      pictureUrl: row.pictureUrl,
      fanCount: row.fanCount,
      status: row.status as FacebookPage['status'],
      connectMethod: row.connectMethod as FacebookPage['connectMethod'],
      lastError: row.lastError,
      dataAccessExpiresAt: row.dataAccessExpiresAt?.toISOString() ?? null,
      tasks: row.tasks,
      createdAt: row.createdAt.toISOString(),
      rowVersion: row.rowVersion,
    };
  }

  private appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  private redirectUri(): string {
    return `${this.appUrl().replace(/\/+$/, '')}/v2/facebook/callback`;
  }

  connectConfig(): FacebookConnectConfig {
    const s = this.graph.settings;
    return {
      configured: Boolean(s.appId && s.appSecret),
      appId: s.appId,
      configId: s.configId,
      graphVersion: s.graphVersion,
      webhookUrl: webhookAddress(this.appUrl()),
    };
  }

  async list(): Promise<FacebookPageList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { data: rows.map((r) => this.toResponse(r)) };
  }

  /** The login dialog address. The sealed state names who started it and when, and must come back unchanged. */
  async startLogin(): Promise<StartConnectResponse> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const s = this.graph.settings;
    if (!s.appId || !s.appSecret) {
      throw refuse(
        'FB_NOT_CONFIGURED',
        'Facebook is not configured — an administrator has to add the Meta app.',
      );
    }
    const state = this.crypto.encrypt(
      JSON.stringify({
        orgId: ctx.orgId,
        userId: ctx.userId,
        at: Date.now(),
        nonce: randomBytes(12).toString('hex'),
      }),
    );
    return {
      url: loginUrl({
        graphVersion: s.graphVersion,
        appId: s.appId,
        redirectUri: this.redirectUri(),
        state,
        scopes: FB_SCOPES,
        configId: s.configId,
      }),
    };
  }

  /**
   * Where Meta sends the browser back. There is no session: the sealed `state` is the proof of who started the connection, and a
   * value that does not open, is stale or was forged connects nothing (login-CSRF). Never throws: the browser is shown the message.
   */
  async completeLogin(q: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<LoginOutcome> {
    if (q.error) return { ok: false, message: q.errorDescription || q.error };
    const state = this.openState(q.state);
    if (!state) {
      return {
        ok: false,
        message: 'Facebook connect could not be verified. Please start the connection again.',
      };
    }
    const code = (q.code ?? '').trim();
    if (code === '') return { ok: false, message: 'Missing code or workspace.' };

    return RequestContextStore.run(
      {
        requestId: `fb-connect-${state.nonce}`,
        orgId: state.orgId,
        actorType: 'user',
        actorId: state.userId,
        userId: state.userId,
      },
      async () => {
        try {
          await this.plan.assertChannel(state.orgId);
          const user = await this.userToken(code, this.redirectUri());
          const done = await this.storePages(user, 'oauth');
          return { ok: true, message: done.message };
        } catch (err) {
          if (err instanceof AppError) return { ok: false, message: err.message };
          this.logger.error({ err }, 'facebook login callback failed');
          return { ok: false, message: 'Facebook connect failed. Please try again.' };
        }
      },
    );
  }

  private openState(sealed: string | undefined) {
    if (!sealed) return null;
    try {
      return readState(this.crypto.decrypt(sealed), Date.now());
    } catch {
      return null;
    }
  }

  /** The popup's code: exchanged without a redirect address. */
  async connectEmbedded(code: string): Promise<FbConnectResult> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const s = this.graph.settings;
    if (!s.appId || !s.appSecret) {
      throw refuse('FB_NOT_CONFIGURED', 'Facebook Meta app credentials are not configured.');
    }
    return this.storePages(await this.userToken(code, ''), 'embedded');
  }

  /** A pasted Page token: it must resolve through `/me` to a Page. */
  async connectManual(pageAccessToken: string): Promise<FbConnectResult> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const token = pageAccessToken.trim();
    const page = await this.graph.app().pageFromToken(token);
    if (!page?.id) {
      throw refuse(
        'FB_TOKEN_NOT_A_PAGE',
        'That token did not resolve to a Facebook Page. Paste a valid Page access token.',
      );
    }
    const grant = await this.graph.app().debugToken(token);
    const row = await this.upsertPage({ ...page, access_token: token }, grant, 'manual');
    return { pages: [this.toResponse(row)], message: connectSummary([page.name || page.id]) };
  }

  /** Code to a long-lived user token. A failed upgrade falls back to the short token (Reference), with a warning. */
  private async userToken(code: string, redirectUri: string): Promise<string> {
    const app = this.graph.app();
    const short = await app.exchangeCode(code, redirectUri);
    if (!short.ok || !short.data) {
      throw refuse('FB_CODE_REJECTED', `Token exchange failed: ${short.error ?? 'unknown'}`);
    }
    const long = await app.extendUserToken(short.data.accessToken);
    if (long.ok && long.data) return long.data.accessToken;
    this.logger.warn(
      { error: long.error },
      'facebook long-lived exchange failed, using the short token',
    );
    return short.data.accessToken;
  }

  /** Every Page the account manages, each stored with its own token (TW-FB-003). */
  private async storePages(
    userToken: string,
    method: 'oauth' | 'embedded',
  ): Promise<FbConnectResult> {
    const app = this.graph.app();
    const pages = await app.listPages(userToken);
    if (pages.length === 0) throw refuse('FB_NO_PAGES', NO_PAGES);
    // One check on the user token gives the scopes actually granted and the data-access expiry every derived Page shares.
    const grant = await app.debugToken(userToken);

    const rows: PageRow[] = [];
    for (const p of pages) {
      if (!p.id || !p.access_token) continue;
      rows.push(await this.upsertPage(p, grant, method));
    }
    if (rows.length === 0) {
      throw refuse(
        'FB_NO_PAGES',
        'Could not store any Page — Meta returned no usable Page tokens.',
      );
    }
    return {
      pages: rows.map((r) => this.toResponse(r)),
      message: connectSummary(rows.map((r) => r.name || r.pageId)),
    };
  }

  /** Stores one Page, then subscribes it (best effort) and queues the history import. */
  private async upsertPage(
    p: GraphPage,
    grant: TokenDebug | null,
    method: 'oauth' | 'embedded' | 'manual',
  ): Promise<PageRow> {
    const ctx = RequestContextStore.require();
    const token = p.access_token ?? '';
    const scopes = (grant?.scopes ?? []).map(String).filter(Boolean);
    const dataExp = grant?.data_access_expires_at
      ? new Date(grant.data_access_expires_at * 1000)
      : null;

    const { row } = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByPageId(tx, ctx.orgId, p.id);
      if (!existing)
        await this.plan.assertPageCap(ctx.orgId, await this.repo.connectedCount(tx, ctx.orgId));
      const saved = await this.repo.upsert(tx, ctx.orgId, {
        userId: ctx.userId,
        pageId: p.id,
        name: p.name || null,
        category: p.category || null,
        username: p.username || null,
        pictureUrl: p.picture?.data?.url || null,
        accessToken: this.crypto.encrypt(token),
        dataAccessExpiresAt: dataExp,
        // What Meta actually granted, falling back to what was asked for.
        scopes: scopes.length > 0 ? scopes : [...FB_SCOPES],
        tasks: p.tasks ?? [],
        connectMethod: method,
        fanCount: typeof p.fan_count === 'number' ? p.fan_count : null,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: saved.row.id,
        action: saved.created ? 'insert' : 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: saved.row.id,
        eventType: 'facebook.page.connected',
        payload: {
          uuid: saved.row.uuid,
          pageId: saved.row.pageId,
          name: saved.row.name,
          reconnected: !saved.created,
        },
      });
      return saved;
    });

    await this.syncChannel(ctx.orgId, row, true);

    // Without this subscription Meta never delivers this Page's messages or comments; a failure leaves the Page connected and
    // "Fix inbound" repeats it.
    const sub = await this.graph.forPage(token, p.id).subscribeWebhooks();
    if (!sub.ok)
      this.logger.warn(
        { orgId: ctx.orgId, page: p.id, error: sub.error },
        'facebook subscribe failed',
      );

    // Past conversations arrive without delaying the answer; the job stores only and never auto-replies.
    await this.backfill
      .add('backfill', { orgId: ctx.orgId, pageRowId: row.id })
      .catch((err: unknown) =>
        this.logger.warn({ err, page: p.id }, 'facebook backfill not queued'),
      );
    return row;
  }

  private async load(uuid: string, lock = false): Promise<{ orgId: number; page: PageRow }> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const page = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid, lock));
    if (!page) throw AppError.notFound('Facebook Page', uuid);
    return { orgId, page };
  }

  /** Re-reads the public profile (name, picture, followers). */
  async refresh(uuid: string): Promise<FacebookPage> {
    const { orgId, page } = await this.load(uuid);
    const res = await this.graph
      .forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId)
      .getProfile();
    const p = res.data;
    if (!res.ok || !p?.id) {
      if (isTokenError(res.code)) {
        await this.db.tx((tx) =>
          this.repo.markExpired(tx, orgId, page.id, clipError(res.error) ?? TOKEN_INVALID_MESSAGE),
        );
        await this.syncChannel(orgId, page, false);
      }
      throw refuse('FB_REFRESH_FAILED', 'Could not refresh (the Page token may need re-auth).');
    }
    const row = await this.db.tx((tx) =>
      this.repo.setProfile(tx, orgId, page.id, {
        name: p.name ?? null,
        category: p.category ?? null,
        username: p.username ?? null,
        pictureUrl: p.picture?.data?.url ?? null,
        fanCount: p.fan_count ?? p.followers_count ?? null,
      }),
    );
    return this.toResponse(row);
  }

  /** "Fix inbound": subscribes the Page to the webhook again. A refusal comes back as `error`, not an HTTP error. */
  async resubscribe(uuid: string): Promise<FacebookPageActionResult> {
    const { orgId, page } = await this.load(uuid);
    const res = await this.graph
      .forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId)
      .subscribeWebhooks();
    if (!res.ok && isTokenError(res.code)) {
      await this.db.tx((tx) =>
        this.repo.markExpired(tx, orgId, page.id, clipError(res.error) ?? TOKEN_INVALID_MESSAGE),
      );
      await this.syncChannel(orgId, page, false);
    }
    const row = (await this.db.tx((tx) => this.repo.findById(tx, orgId, page.id))) ?? page;
    return {
      ...this.toResponse(row),
      error: res.ok ? null : `Re-subscribe failed: ${res.error ?? 'unknown'}`,
    };
  }

  /** Disconnect: Meta's subscription is removed (errors ignored), then the Page goes. Its inbox threads stay. */
  async remove(uuid: string): Promise<void> {
    const { orgId, page } = await this.load(uuid);
    await this.graph
      .forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId)
      .unsubscribeWebhooks()
      .catch(() => undefined);
    await this.db.tx(async (tx) => {
      await this.repo.remove(tx, orgId, page.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: page.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: page.id,
        eventType: 'facebook.page.disconnected',
        payload: { uuid: page.uuid, pageId: page.pageId, name: page.name },
      });
    });
    await this.syncChannel(orgId, page, false);
  }

  /**
   * Health of one organization's Pages (TW-FB-005). Page tokens do not expire but can be revoked and the 90 day data-access window
   * can lapse. A valid token revives an expired Page; an invalid one flags it for reconnecting. A check that could not run (no
   * app credentials, Meta unreachable) leaves the Page as it is.
   */
  async checkHealth(orgId: number): Promise<number> {
    const pages = await this.db.txAs({ orgId }, (tx) => this.repo.toCheck(tx, orgId));
    let changed = 0;
    for (const page of pages) {
      const d = await this.graph.app().debugToken(this.crypto.decrypt(page.accessToken ?? ''));
      if (!d) continue;
      const exp = d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000) : null;
      const next = d.is_valid
        ? {
            status: page.status === 'connected' ? page.status : 'connected',
            lastError: page.status === 'connected' ? page.lastError : null,
          }
        : { status: 'expired', lastError: TOKEN_INVALID_MESSAGE };
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.setHealth(tx, orgId, page.id, { ...next, dataAccessExpiresAt: exp }),
      );
      if (next.status !== page.status)
        await this.syncChannel(orgId, page, next.status === 'connected');
      changed += 1;
    }
    return changed;
  }
}
