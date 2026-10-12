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
import { MailChannelSync } from './mail-channel.sync';
import { mailboxUnavailable } from './mail-errors';
import { MailPlan } from './mail-plan';
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
  ) {}

  async list(): Promise<MailboxListResponse> {
    const { orgId } = RequestContextStore.require();
    // `providerReady` keeps its Gmail-era meaning for the existing hub: the first sign-in provider (Google) has its platform credentials.
    // `GET /v2/email/providers` is the full per-provider answer.
    const firstOAuth = this.drivers.list().find(isOAuthDriver);
    const [rows, limit, ready] = await Promise.all([
      this.db.tx((tx) => this.repo.list(tx, orgId)),
      this.plan.mailboxLimit(orgId),
      firstOAuth ? firstOAuth.readiness().then((r) => r.ready) : Promise.resolve(false),
    ]);
    // A disconnected mailbox is history, not a mailbox the workspace holds: it is listed (its conversations are still there) but not counted.
    return {
      data: rows.map((r) => toMailboxResponse(r, r)),
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
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Mailbox', uuid);
      return this.respond(tx, orgId, row);
    });
  }

  async rename(uuid: string, input: UpdateMailboxInput): Promise<MailboxResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.byUuid(tx, orgId, uuid);
      if (!before) throw AppError.notFound('Mailbox', uuid);
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
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Mailbox', uuid);
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
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, ctx.orgId, uuid));
    if (!row) throw AppError.notFound('Mailbox', uuid);
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
