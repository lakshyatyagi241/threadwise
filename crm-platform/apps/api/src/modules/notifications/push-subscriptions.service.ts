import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  PUSH_MAX_DEVICES_PER_USER,
  type PushDevice,
  type PushDeviceListResponse,
  type PushPublicKeyResponse,
  type PushSubscriptionInput,
  type PushTestResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { webPushConfig } from '../../config/domains/web-push.env';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { deviceLabel } from './device-label';
import { NotificationFanout } from './notification-fanout';
import { buildTestPayload } from './push-payload';
import { PushSubscriptionsRepository, type PushDeviceRow } from './push-subscriptions.repository';
import { WebPushSender } from './web-push.sender';

/** One test per person per this many seconds: it is a button, not a loop. */
const TEST_COOLDOWN_MS = 10_000;

const toDevice = (r: PushDeviceRow): PushDevice => ({
  id: r.uuid,
  label: r.label,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
});

/**
 * The caller's own browser notification devices (BL-097). Staff only and pinned to the caller, like the bell: there is no permission
 * key and nobody can see, add, test or remove anyone else's device.
 *
 * The endpoint and keys a browser hands over are secrets: they are stored for the sender and never returned, logged or audited. Adding
 * or removing a device is the person's own convenience setting (like marking a notification read), so it writes no audit row.
 *
 * With no VAPID keys configured the feature is off: the public key route says `enabled: false`, the list is empty, and adding a device
 * or testing is 404, so nothing in the product points at a feature that cannot work.
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PushSubscriptionsRepository,
    private readonly sender: WebPushSender,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly fanout: NotificationFanout,
    private readonly crypto: CryptoService,
  ) {}

  private caller(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.forbidden('notifications');
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  private requireEnabled(): void {
    if (!webPushConfig().enabled) throw AppError.notFound('Browser notifications');
  }

  publicKey(): PushPublicKeyResponse {
    const config = webPushConfig();
    return config.enabled
      ? { enabled: true, publicKey: config.publicKey }
      : { enabled: false, publicKey: null };
  }

  async list(): Promise<PushDeviceListResponse> {
    const { orgId, userId } = this.caller();
    if (!webPushConfig().enabled) return { items: [] };
    const rows = await this.db.tx((tx) => this.repo.listLive(tx, orgId, userId));
    return { items: rows.map(toDevice) };
  }

  /** Adds this browser, or refreshes it when it subscribed before (same device back, keys rotated). Keeps at most 10 devices. */
  async subscribe(
    input: PushSubscriptionInput,
    userAgent: string | undefined,
  ): Promise<PushDevice> {
    const { orgId, userId } = this.caller();
    this.requireEnabled();
    const ua = userAgent ? userAgent.slice(0, 300) : null;
    const endpointHash = createHash('sha256').update(input.endpoint).digest('hex');
    return this.db.tx(async (tx) => {
      const device = await this.repo.upsert(tx, orgId, userId, {
        endpoint: input.endpoint,
        endpointHash,
        p256dh: input.keys.p256dh,
        auth: this.crypto.encrypt(input.keys.auth),
        ua,
        label: deviceLabel(ua),
      });
      await this.repo.dropOthersOnEndpoint(tx, orgId, userId, endpointHash);
      await this.repo.trimToCap(tx, orgId, userId, device.id, PUSH_MAX_DEVICES_PER_USER);
      return toDevice(device);
    });
  }

  /** Removes one of my devices. Someone else's, or an unknown id, is 404 (the same answer, so ids cannot be probed). */
  async remove(uuid: string): Promise<void> {
    const { orgId, userId } = this.caller();
    const removed = await this.db.tx((tx) => this.repo.deleteOwn(tx, orgId, userId, uuid));
    if (!removed) throw AppError.notFound('Device', uuid);
  }

  /**
   * The "Send a test notification" button: one press goes through every way a person is told. It writes a real bell row of the harmless
   * `test` type for the caller (and nobody else), announces it live through the normal publisher (the bell number, the toast, the ping
   * and the tab title follow, as the person's preferences allow), and sends a Web Push to every one of their devices now, ignoring
   * whether a tab is open. The answer says which channels fired: `inApp` (a row was written) and `sent` / `failed` devices.
   *
   * It carries no throttle key (the burst throttle is for chats), but the person still gets one test per ten seconds.
   */
  async test(): Promise<PushTestResponse> {
    const { orgId, userId } = this.caller();
    this.requireEnabled();
    const claimed = await this.redis
      .set(`push:test:${orgId}:${userId}`, '1', 'PX', TEST_COOLDOWN_MS, 'NX')
      .catch(() => 'OK');
    if (claimed === null) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Wait a few seconds before sending another test.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // The bell row first, committed, then announced (a rolled-back row must never be announced).
    const pending = await this.db.tx((tx) =>
      this.fanout.write(tx, orgId, 'test', [userId], () => ({
        title: 'Test notification',
        body: 'If you can read this, live notifications are working.',
        link: '/account/notifications',
        data: null,
        dedupeKey: `test:${randomUUID()}`,
      })),
    );
    await this.fanout.publish(orgId, pending);

    const targets = await this.db.tx((tx) => this.repo.liveTargets(tx, orgId, userId));
    const report = await this.sender.send(targets, buildTestPayload());
    await this.sender.record(orgId, userId, report, targets);
    return {
      inApp: pending.length > 0,
      sent: report.sent.length,
      failed: report.gone.length + report.refused.length + report.retry.length,
    };
  }
}
