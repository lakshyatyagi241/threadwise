import { Injectable, Logger } from '@nestjs/common';
import {
  imapSummarySchema,
  type MailProviderListResponse,
  type MailboxListResponse,
  type MailboxResponse,
  type UpdateMailboxInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { isOAuthDriver } from './drivers/mail-driver';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { MailAccess } from './mail-access.service';
import { MailChannelSync } from './mail-channel.sync';
import { mailboxUnavailable } from './mail-errors';
import { MailPlan } from './mail-plan';
import {
  mayAct,
  viewOf,
  type MailActor,
  type MailboxAction,
  type MailboxView,
} from './mail-personal-policy';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MAIL_AUDIT_MODULE, MailTokens } from './mail-tokens.service';
import { MailboxesRepository, type MailboxListRow, type MailboxRow } from './mailboxes.repository';

/** The mailbox as the hub sees it. Tokens, passwords, scopes and the sync cursor never leave the server. */
export function toMailboxResponse(
  row: MailboxRow,
  extra: Partial<Pick<MailboxListRow, 'ownerUuid' | 'ownerName' | 'hasSignature'>> & {
    conversationCount: number;
  },
): MailboxResponse {
  const imap = imapSummarySchema.safeParse(row.connectionPublic);
  return {
    id: row.uuid,
    provider: row.provider,
    address: row.address,
    displayName: row.displayName,
    status: row.status,
    scope: row.scope,
    ownerUserId: extra.ownerUuid ?? null,
    ownerName: extra.ownerName ?? null,
    hasSignature: extra.hasSignature ?? false,
    pushActive: row.pushState !== null,
    sendLimitPerHour: row.sendLimitPerHour,
    imap: row.provider === 'imap' && imap.success ? imap.data : null,
    channelId: row.channelUuid,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    conversationCount: extra.conversationCount,
    rowVersion: row.rowVersion,
  };
}

/**
 * What an admin sees of another person's personal mailbox when the policy does not let admins read it: that it exists, whose it is, its
 * provider, status and that it counts toward the plan, and nothing about its mail (no conversation count, no error text, no server settings, no inbox filter).
 */
export function toMailboxSummary(response: MailboxResponse): MailboxResponse {
  return {
    ...response,
    hasSignature: false,
    pushActive: false,
    imap: null,
    channelId: null,
    lastError: null,
    lastSyncedAt: null,
    conversationCount: 0,
    contentHidden: true,
  };
}

/** The workspace's mailboxes: list, rename, sync now, disconnect (TW-MAIL-019, 023, 028). Connecting is `MailConnectService`. */
@Injectable()
export class MailboxesService {
  private readonly logger = new Logger(MailboxesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly drivers: MailDriverRegistry,
    private readonly tokens: MailTokens,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly plan: MailPlan,
    private readonly channel: MailChannelSync,
    private readonly sync: MailSyncPublisher,
    private readonly access: MailAccess,
  ) {}

  async list(): Promise<MailboxListResponse> {
    const { orgId } = RequestContextStore.require();
    // `providerReady` keeps its Gmail-era meaning for the existing hub: the first sign-in provider (Google) has its platform credentials.
    // `GET /v2/email/providers` is the full per-provider answer.
    const firstOAuth = this.drivers.list().find(isOAuthDriver);
    const actor = this.access.actor();
    const [{ rows, policy }, limit, ready] = await Promise.all([
      this.db.tx(async (tx) => ({
        rows: await this.repo.list(tx, orgId),
        policy: await this.access.policy(tx, orgId),
      })),
      this.plan.mailboxLimit(orgId),
      firstOAuth ? firstOAuth.readiness().then((r) => r.ready) : Promise.resolve(false),
    ]);
    // An agent sees the shared mailboxes and their own personal ones; an admin also sees the others as summary rows (or in full when the policy lets
    // admins read personal mail). `used` counts every held mailbox, seen or not: it is the plan's number, not a list length.
    const data = rows.flatMap((r) => {
      const view = viewOf(actor, r, policy);
      if (view === 'none') return [];
      const response = toMailboxResponse(r, r);
      return [view === 'summary' ? toMailboxSummary(response) : response];
    });
    // A disconnected mailbox is history, not a mailbox the workspace holds: it is listed (its conversations are still there) but not counted.
    return {
      data,
      limit,
      used: rows.filter((r) => r.status !== 'disconnected').length,
      providerReady: ready,
    };
  }

  /** The providers the hub can offer, with whether the platform has set each up. */
  async providers(): Promise<MailProviderListResponse> {
    const data = await Promise.all(
      this.drivers.list().map(async (d) => {
        const r = await d.readiness();
        return {
          provider: d.provider,
          label: d.label,
          kind: d.authKind,
          ready: r.ready,
          notReadyReason: r.ready ? null : r.notReadyReason,
        };
      }),
    );
    return { data };
  }

  /** One mailbox as the hub shows it. */
  async get(uuid: string): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    const actor = this.access.actor();
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Mailbox', uuid);
      const view = viewOf(actor, row, await this.access.policy(tx, orgId));
      // Someone else's personal mailbox is not confirmed to exist.
      if (view === 'none') throw AppError.notFound('Mailbox', uuid);
      const response = await this.respond(tx, orgId, row);
      return view === 'summary' ? toMailboxSummary(response) : response;
    });
  }

  /**
   * The mailbox, if the caller may do `action` to it. A mailbox the caller may not even see is a 404 (it is not confirmed to exist); one they
   * see but may not act on is a 403 (`mail.mailboxes.manage` for a shared one, ownership for a personal one).
   */
  private async guarded(
    tx: Parameters<MailboxesRepository['countActive']>[0],
    orgId: number,
    uuid: string,
    action: MailboxAction,
    actor: MailActor,
  ): Promise<MailboxRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Mailbox', uuid);
    const view: MailboxView = viewOf(actor, row, await this.access.policy(tx, orgId));
    if (view === 'none') throw AppError.notFound('Mailbox', uuid);
    if (!mayAct(actor, row, action)) {
      throw AppError.forbidden(
        row.scope === 'shared' ? 'mail.mailboxes.manage' : 'mail.mailboxes.manage_personal',
      );
    }
    return row;
  }

  async rename(uuid: string, input: UpdateMailboxInput): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    const actor = this.access.actor();
    return this.db.tx(async (tx) => {
      const before = await this.guarded(tx, orgId, uuid, 'rename', actor);
      const after = await this.repo.rename(
        tx,
        orgId,
        before.id,
        input.rowVersion,
        input.displayName,
        input.sendLimitPerHour,
      );
      if (!after) throw AppError.rowVersionConflict('Mailbox');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (before.displayName !== after.displayName) {
        delta.displayName = { old: before.displayName, new: after.displayName };
      }
      if (before.sendLimitPerHour !== after.sendLimitPerHour) {
        delta.sendLimitPerHour = { old: before.sendLimitPerHour, new: after.sendLimitPerHour };
      }
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: MAIL_AUDIT_MODULE,
          recordId: after.id,
          action: 'update',
          delta,
        });
      }
      return this.respond(tx, orgId, after);
    });
  }

  /** Asks for a sync now (the sweep runs every minute anyway). The job runs in the worker; the answer is the mailbox as it stands. */
  async syncNow(uuid: string): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    const actor = this.access.actor();
    const row = await this.db.tx((tx) => this.guarded(tx, orgId, uuid, 'sync', actor));
    if (row.status === 'disconnected' || row.status === 'needs_reauth') {
      throw mailboxUnavailable(
        row.status === 'needs_reauth'
          ? 'This mailbox needs reconnecting before it can sync.'
          : 'This mailbox is disconnected.',
      );
    }
    await this.sync.enqueue(orgId, row.uuid);
    return this.db.tx((tx) => this.respond(tx, orgId, row));
  }

  /**
   * Withdraws the grant at the provider (and its push registration), then forgets it here. A provider that cannot be reached does not trap
   * the admin: the local copy goes anyway. The mailbox row and its conversations stay (read-only), so reconnecting the same address picks them up again. Idempotent.
   */
  async disconnect(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const actor = this.access.actor();
    const row = await this.db.tx((tx) => this.guarded(tx, ctx.orgId, uuid, 'disconnect', actor));
    if (row.status === 'disconnected') return;
    const driver = this.drivers.find(row.provider);
    if (driver?.push && row.pushState) {
      try {
        await this.tokens.withAccess(ctx.orgId, uuid, (access, mailbox) =>
          driver.push!.stop({ orgId: ctx.orgId, mailbox, access }),
        );
      } catch (err) {
        this.logger.warn(
          { orgId: ctx.orgId, mailbox: uuid, err: (err as Error).message },
          'the provider push was not withdrawn; disconnecting here regardless',
        );
      }
    }
    if (driver && isOAuthDriver(driver) && row.refreshTokenEnc) {
      try {
        await driver.revoke(this.crypto.decrypt(row.refreshTokenEnc));
      } catch (err) {
        this.logger.warn(
          { orgId: ctx.orgId, mailbox: uuid, err: (err as Error).message },
          'the provider did not confirm the revoke; disconnecting here regardless',
        );
      }
    }
    const changed = await this.db.tx(async (tx) => {
      const live = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!live || live.status === 'disconnected') return null;
      await this.repo.disconnect(tx, ctx.orgId, live.id);
      await this.audit.record(tx, {
        module: MAIL_AUDIT_MODULE,
        recordId: live.id,
        action: 'update',
        delta: { status: { old: live.status, new: 'disconnected' } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: MAIL_AUDIT_MODULE,
        aggregateId: live.id,
        eventType: 'mail.mailbox.disconnected',
        payload: { uuid: live.uuid, provider: live.provider, address: live.address },
      });
      return live;
    });
    if (changed) await this.channel.sync(ctx.orgId, { ...changed, status: 'disconnected' });
  }

  /** The mailbox as the hub shows it: its row with its owner, signature flag and conversation count. */
  private async respond(
    tx: Parameters<MailboxesRepository['countActive']>[0],
    orgId: number,
    row: MailboxRow,
  ): Promise<MailboxResponse> {
    const all = await this.repo.list(tx, orgId);
    const listed = all.find((r) => r.id === row.id);
    return toMailboxResponse(row, {
      conversationCount: listed?.conversationCount ?? 0,
      ownerUuid: listed?.ownerUuid ?? null,
      ownerName: listed?.ownerName ?? null,
      hasSignature: listed?.hasSignature ?? false,
    });
  }
}
