import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type IgAccount,
  type IgAccountList,
  type IgAvailableList,
  type IgConnectStartResponse,
  type IgUnlinkResult,
  type LinkIgAccountInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  INSTAGRAM_BRIDGE,
  type BridgeAccount,
  type InstagramBridgeFactory,
} from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { EngineConnectionService } from '../addons-extension-registry';
import {
  availableAccounts,
  findAccount,
  manageUrl,
  resolveProfile,
  returnUrl,
} from './account-rules';
import { AccountsRepository, type AccountRow } from './accounts.repository';
import { INSTAGRAM_PLAN_GATE, type InstagramPlanGate } from './_shims/tokens';

export const MODULE_KEY = 'instagram_accounts';

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Instagram accounts linked to a workspace (TW-IG-001 to 006). The account lives on the engine (the Instaflow bridge); the
 * workspace keeps a mirror row with the engine's id and a cached profile.
 *
 * Difference from Reference that the port needs: only an account the engine lists to this workspace or to this person (matched by
 * the signed-in user's email) can be linked. Reference saved any engine account id that came with a username, which let one tenant
 * link another tenant's account and then read its messages through the pull.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AccountsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly engines: EngineConnectionService,
    private readonly config: ConfigService<Env, true>,
    @Inject(INSTAGRAM_BRIDGE) private readonly bridge: InstagramBridgeFactory,
    @Inject(INSTAGRAM_PLAN_GATE) private readonly plan: InstagramPlanGate,
  ) {}

  toResponse(row: AccountRow): IgAccount {
    return {
      id: row.uuid,
      instaflowAccountId: row.instaflowAccountId,
      username: row.username,
      name: row.name,
      avatar: row.avatar,
      status: row.status,
      followers: row.followers,
      syncedAt: row.syncedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      rowVersion: row.rowVersion,
    };
  }

  /** The hub: the linked accounts and the engine behind them. */
  async list(): Promise<IgAccountList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const [rows, conn] = await Promise.all([
      this.db.tx((tx) => this.repo.list(tx, orgId)),
      this.engines.connection('instagram'),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      bridge: {
        connected: conn.connected,
        brand: conn.brand,
        manageUrl: manageUrl(conn.url, conn.connected),
      },
    };
  }

  /**
   * The accounts this person owns on the engine and has not linked here. With no email on file there is nothing to match, so the
   * list is empty and "Connect new" is the way in: another tenant's accounts are never offered.
   */
  async available(): Promise<IgAvailableList> {
    const { orgId, userId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const conn = await this.engines.connection('instagram');
    if (!conn.connected || userId === null) return { data: [] };
    const { email, linked } = await this.db.tx(async (tx) => ({
      email: await this.repo.userEmail(tx, orgId, userId),
      linked: await this.repo.linkedIds(tx, orgId),
    }));
    if (!email) return { data: [] };
    const found = await this.bridge.with(conn).accounts({ ownerEmail: email });
    return { data: availableAccounts(found, linked) };
  }

  /** Links an account, or refreshes the profile of one already linked. */
  async link(input: LinkIgAccountInput): Promise<IgAccount> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const conn = await this.engines.connection('instagram');
    if (!conn.connected) throw refuse('IG_NOT_CONNECTED', `${conn.brand} is not connected.`);

    const api = this.bridge.with(conn);
    const email =
      ctx.userId === null
        ? null
        : await this.db.tx((tx) => this.repo.userEmail(tx, ctx.orgId, ctx.userId!));
    // The workspace's own list first (a freshly connected account is stamped by the time the popup returns), then the person's.
    const lists: BridgeAccount[][] = [await api.accounts({ workspace: ctx.orgId })];
    let found = findAccount(lists, input.instaflowAccountId);
    if (!found && email) {
      lists.push(await api.accounts({ ownerEmail: email }));
      found = findAccount(lists, input.instaflowAccountId);
    }
    if (!found) {
      throw new AppError(
        ERROR_CODES.IG_ACCOUNT_NOT_FOUND,
        `That Instagram account was not found on ${conn.brand}.`,
        HttpStatus.NOT_FOUND,
      );
    }
    const profile = resolveProfile(input, found);

    return this.db.tx(async (tx) => {
      const saved = await this.repo.upsert(
        tx,
        ctx.orgId,
        found.id,
        profile,
        input.followers ?? null,
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: saved.row.id,
        action: saved.created ? 'insert' : 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: saved.row.id,
        eventType: 'instagram.account.linked',
        payload: {
          uuid: saved.row.uuid,
          instaflowAccountId: saved.row.instaflowAccountId,
          username: saved.row.username,
          relinked: !saved.created,
        },
      });
      return this.toResponse(saved.row);
    });
  }

  /** The sign-in popup's address; a window with no opener comes back to the hub with the account id. */
  async connectStart(): Promise<IgConnectStartResponse> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const conn = await this.engines.connection('instagram');
    if (!conn.connected) throw refuse('IG_NOT_CONNECTED', `${conn.brand} is not connected.`);
    const res = await this.bridge
      .with(conn)
      .connectStart(orgId, returnUrl(this.config.get('WEB_APP_URL', { infer: true })));
    if (!res.ok) {
      throw refuse(
        'IG_CONNECT_FAILED',
        res.error ??
          (res.status
            ? `${conn.brand} returned HTTP ${res.status}`
            : 'Could not start Instagram connect.'),
        HttpStatus.BAD_GATEWAY,
      );
    }
    return res.data;
  }

  /**
   * Unlinks an account. The account stays connected on the engine. When it was the workspace's last one, every Instagram thread
   * and its messages go too, in the same transaction, so the channel leaves the inbox and the dashboards; with other accounts
   * left nothing is deleted (a thread cannot be told apart by account once the mirror is gone).
   */
  async unlink(uuid: string): Promise<IgUnlinkResult> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Instagram account', uuid);
      await this.repo.remove(tx, orgId, row.id);
      const purgedThreads =
        (await this.repo.count(tx, orgId)) === 0 ? await this.repo.purgeInbox(tx, orgId) : 0;
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'instagram.account.unlinked',
        payload: {
          uuid: row.uuid,
          instaflowAccountId: row.instaflowAccountId,
          username: row.username,
          purgedThreads,
        },
      });
      return { purgedThreads };
    });
  }
}
