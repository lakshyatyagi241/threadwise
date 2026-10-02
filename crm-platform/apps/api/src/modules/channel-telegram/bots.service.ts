import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type BotListResponse,
  type BotResponse,
  type ConnectBotInput,
  type ConnectBotResponse,
  type SavePaymentSettingsInput,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TELEGRAM_API,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { TELEGRAM_PLAN_GATE, type TelegramPlanGate } from './_shims/tokens';
import { clipError, randomToken, webhookRefusedMessage, webhookUrl } from './bot-rules';
import { BotsRepository, type BotRow } from './bots.repository';

const MODULE_KEY = 'telegram_bots';

/**
 * Connecting and managing Telegram bots (WD-TG-001, 002, 007).
 *
 * Connect follows WaDesk's order: Telegram proves the token (getMe), the bot is saved (a re-pasted token updates the same row
 * and keeps its routing token), then the webhook is registered. A refused webhook does not lose the bot: it stays saved with
 * the reason on it ("needs attention") and the answer says how to fix it. The token, the header secret and the payment token
 * are encrypted at rest and never returned.
 */
@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BotsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApiFactory,
    @Inject(TELEGRAM_PLAN_GATE) private readonly plan: TelegramPlanGate,
  ) {}

  private url(row: BotRow): string {
    return webhookUrl(this.config.get('APP_URL', { infer: true }), row.webhookToken);
  }

  /** What the API shows of a bot: never a token, only whether a payment token is saved. */
  toResponse(row: BotRow): BotResponse {
    return {
      id: row.uuid,
      botId: row.botId,
      username: row.username,
      name: row.name,
      active: row.active,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastError: row.lastError,
      hasPaymentToken: row.paymentProviderToken !== null,
      paymentProvider: row.paymentProvider,
      webhookUrl: this.url(row),
      rowVersion: row.rowVersion,
    };
  }

  async list(): Promise<BotListResponse> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { data: rows.map((r) => this.toResponse(r)) };
  }

  async connect(input: ConnectBotInput): Promise<ConnectBotResponse> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);

    const token = input.botToken.trim();
    const me = await this.telegram.forToken(token).getMe();
    if (!me.ok || !me.result) {
      throw new AppError(
        ERROR_CODES.TG_TOKEN_REJECTED,
        `Telegram rejected that token: ${me.error ?? ''}`.trim(),
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const identity = me.result;

    const secret = randomToken();
    const saved = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByTelegramId(tx, ctx.orgId, String(identity.id));
      if (!existing) await this.plan.assertBotCap(ctx.orgId, await this.repo.count(tx, ctx.orgId));
      const values = {
        connectedBy: ctx.userId,
        botToken: this.crypto.encrypt(token),
        username: identity.username ?? '',
        name: identity.first_name ?? '',
        secretToken: this.crypto.encrypt(secret),
      };
      const row = existing
        ? await this.repo.reconnect(tx, ctx.orgId, existing.id, values)
        : await this.repo.insert(tx, ctx.orgId, {
            ...values,
            botId: String(identity.id),
            webhookToken: randomToken(),
          });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: existing ? 'update' : 'insert',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'telegram.bot.connected',
        payload: { uuid: row.uuid, username: row.username, reconnected: Boolean(existing) },
      });
      return row;
    });

    // Registered after the row exists: the URL carries the routing token.
    const hook = await this.telegram.forToken(token).setWebhook(this.url(saved), secret);
    const row = await this.db.tx((tx) =>
      this.repo.setError(tx, ctx.orgId, saved.id, hook.ok ? null : clipError(hook.error)),
    );
    this.logger.log(
      { orgId: ctx.orgId, bot: row.username, webhook: hook.ok },
      'telegram bot connected',
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : webhookRefusedMessage(hook.error ?? ''),
    };
  }

  /** "Fix inbound": registers the webhook again with the stored token and secret. */
  async retryWebhook(uuid: string): Promise<ConnectBotResponse> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const bot = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!bot) throw AppError.notFound('Telegram bot', uuid);

    const hook = await this.telegram
      .forToken(this.crypto.decrypt(bot.botToken))
      .setWebhook(this.url(bot), bot.secretToken ? this.crypto.decrypt(bot.secretToken) : '');
    const row = await this.db.tx((tx) =>
      hook.ok
        ? this.repo.setError(tx, ctx.orgId, bot.id, null, true)
        : this.repo.setError(tx, ctx.orgId, bot.id, clipError(hook.error)),
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : `Re-register failed: ${hook.error ?? ''}`.trim(),
    };
  }

  /** Pause or resume delivery. A paused bot still receives pushes but ignores them, and cannot start a broadcast. */
  async toggle(uuid: string): Promise<BotResponse> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    return this.db.tx(async (tx) => {
      const bot = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!bot) throw AppError.notFound('Telegram bot', uuid);
      const row = await this.repo.setActive(tx, ctx.orgId, bot.id, !bot.active);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: bot.id,
        action: 'update',
        delta: { active: { old: bot.active, new: row.active } },
      });
      return this.toResponse(row);
    });
  }

  /** Payment provider settings: a blank token keeps the saved one, a value replaces it, `clearPaymentToken` removes it. */
  async savePayments(uuid: string, input: SavePaymentSettingsInput): Promise<BotResponse> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    return this.db.tx(async (tx) => {
      const bot = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!bot) throw AppError.notFound('Telegram bot', uuid);
      const typed = input.paymentProviderToken?.trim();
      const token = typed ? this.crypto.encrypt(typed) : input.clearPaymentToken ? null : undefined;
      const row = await this.repo.setPayments(tx, ctx.orgId, bot.id, {
        provider: input.paymentProvider?.trim() || null,
        token,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: bot.id, action: 'update' });
      return this.toResponse(row);
    });
  }

  /** Disconnect: Telegram's webhook is deleted (errors ignored), then the bot goes. Its inbox threads stay. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    const bot = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!bot) throw AppError.notFound('Telegram bot', uuid);

    await this.telegram
      .forToken(this.crypto.decrypt(bot.botToken))
      .deleteWebhook()
      .catch(() => undefined);
    await this.db.tx(async (tx) => {
      await this.repo.remove(tx, ctx.orgId, bot.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: bot.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: bot.id,
        eventType: 'telegram.bot.disconnected',
        payload: { uuid: bot.uuid, username: bot.username },
      });
    });
  }
}
