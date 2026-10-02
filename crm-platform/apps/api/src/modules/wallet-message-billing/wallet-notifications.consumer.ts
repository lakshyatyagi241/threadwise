import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationsRepository } from '../notifications';
import { formatMinor } from './wallet-rules';
import { WalletRealtimePublisher } from './wallet-realtime.publisher';
import { WalletSettingsService } from './wallet-settings.service';

const EVENTS = ['wallet.low_balance', 'wallet.topped_up'] as const;

/**
 * Tells the workspace's owners about their wallet (TW-WALLET-015): the low-balance alert, and a credit an operator added by hand.
 * One in-app notification per owner, deduplicated on the outbox event id so the drain's at-least-once delivery cannot notify twice.
 * Reference notified the wallet's single owner and consulted that owner's CURRENT workspace for the mute preference; the wallet is
 * the workspace's here, so the people who hold the top (Owner) role of THIS workspace are told. Email and Slack copies belong to
 * the notification preferences domain, which reads the same event.
 */
@Injectable()
export class WalletNotificationsConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'wallet-notifications';
  readonly eventTypes = EVENTS;
  private readonly logger = new Logger(WalletNotificationsConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly settings: WalletSettingsService,
    private readonly realtime: WalletRealtimePublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    if (event.eventType === 'wallet.topped_up') {
      // Every credit moves the balance on open screens; only a manual one is also a notification.
      await this.realtime.balanceChanged(
        event.orgId,
        Number(p.balanceAfterMinor ?? 0),
        p.type === 'admin_adjust' ? 'adjustment' : 'topup',
      );
      if (p.type !== 'admin_adjust') return;
    }
    const currency = await this.settings.currency();
    const balance = formatMinor(Number(p.balanceMinor ?? p.balanceAfterMinor ?? 0));
    const copy =
      event.eventType === 'wallet.low_balance'
        ? {
            type: 'wallet_low_balance',
            title: 'Low WhatsApp balance',
            body: `Your message balance is down to ${currency} ${balance}. Top up to keep your campaigns and replies sending.`,
          }
        : {
            type: 'wallet_credited',
            title: 'Wallet credited by platform support',
            body: `${currency} ${formatMinor(Number(p.amountMinor ?? 0))} was added to your wallet. New balance: ${currency} ${balance}.`,
          };
    await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const owners = await tx.execute(sql`
        SELECT DISTINCT u.id FROM users u
        JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
        JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
        WHERE u.org_id = ${event.orgId} AND u.status = 'active' AND r.system_key = 'admin'`);
      for (const o of owners.rows as Array<{ id: string | number }>) {
        await this.notifications.insertOnce(tx, event.orgId, {
          userId: Number(o.id),
          type: copy.type,
          title: copy.title,
          body: copy.body,
          link: '/billing/wallet',
          data: { eventType: event.eventType, ...p },
          dedupeKey: `${event.eventType}:${event.id}`,
        });
      }
      if (owners.rows.length === 0)
        this.logger.warn({ orgId: event.orgId }, 'wallet notification has no owner to tell');
    });
  }
}
