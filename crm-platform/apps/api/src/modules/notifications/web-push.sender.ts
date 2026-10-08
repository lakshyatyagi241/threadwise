import { Inject, Injectable } from '@nestjs/common';
import type { PushPayload } from '@crm/contracts';
import { webPushConfig } from '../../config/domains/web-push.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WEB_PUSH_PROVIDER,
  type WebPushProvider,
  type WebPushResult,
  type WebPushSendOptions,
} from '../../infra/providers/web-push/web-push.port';
import { pushTopic } from './push-payload';
import {
  PUSH_MAX_FAILURES,
  PushSubscriptionsRepository,
  type PushTarget,
} from './push-subscriptions.repository';

/** How a push to a set of devices came out, by subscription id (never by endpoint: those are secrets). */
export interface PushSendReport {
  sent: number[];
  /** The push service said the subscription is gone (404 / 410): revoked. */
  gone: number[];
  /** Refused for a reason retrying will not fix; 401 / 403 mean our keys no longer match the subscription (revoked). */
  refused: number[];
  /** 429, 5xx or a network error: worth another try. */
  retry: number[];
  /** Subset of `refused` that is revoked right away. */
  unusable: number[];
}

const HIGH_URGENCY_TYPES = new Set([
  'new_chat',
  'new_message',
  'chat_waiting',
  'mention',
  'conversation_assigned',
  'teamchat_mention',
  'teamchat_message',
]);

/**
 * Sends one payload to a person's devices through the Web Push port and records what happened to each device (last used, failures,
 * revoked). Used by the queue processor and by the "send a test notification" route, so both behave the same way.
 *
 * It never logs an endpoint, a key or a push-service response body: a failure is reported by subscription id and HTTP status only.
 */
@Injectable()
export class WebPushSender {
  constructor(
    @Inject(WEB_PUSH_PROVIDER) private readonly provider: WebPushProvider,
    private readonly db: DatabaseService,
    private readonly repo: PushSubscriptionsRepository,
  ) {}

  isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  async send(
    targets: readonly PushTarget[],
    payload: PushPayload,
    type?: string,
  ): Promise<PushSendReport> {
    const report: PushSendReport = { sent: [], gone: [], refused: [], retry: [], unusable: [] };
    if (targets.length === 0) return report;
    const body = JSON.stringify(payload);
    const options: WebPushSendOptions = {
      ttlSeconds: webPushConfig().ttlSeconds,
      topic: payload.test ? undefined : pushTopic(payload.tag),
      urgency: type && HIGH_URGENCY_TYPES.has(type) ? 'high' : 'normal',
    };
    const failed: WebPushResult = { ok: false, gone: false, retryable: true, status: null };
    const results = await Promise.all(
      targets.map(async (t) => ({
        id: t.id,
        result: await this.provider
          .send({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, body, options)
          // The adapter does not throw for a push-service answer; a bug in it must not lose the other devices' results.
          .catch((): WebPushResult => failed),
      })),
    );
    for (const { id, result } of results) {
      if (result.ok) report.sent.push(id);
      else if (result.gone) report.gone.push(id);
      else if (result.retryable) report.retry.push(id);
      else {
        report.refused.push(id);
        if (result.status === 401 || result.status === 403) report.unusable.push(id);
      }
    }
    return report;
  }

  /** Writes the outcome of a send: accepted devices get a fresh last-used time; failed ones count up; gone / unusable ones are revoked. */
  async record(
    orgId: number,
    userId: number,
    report: PushSendReport,
    targets: readonly PushTarget[],
  ): Promise<void> {
    const failures = new Map(targets.map((t) => [t.id, t.failureCount]));
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await this.repo.recordSuccess(tx, orgId, report.sent);
      for (const id of report.gone) await this.repo.recordFailure(tx, orgId, id, true);
      for (const id of [...report.refused, ...report.retry]) {
        const revoke =
          report.unusable.includes(id) || (failures.get(id) ?? 0) + 1 >= PUSH_MAX_FAILURES;
        await this.repo.recordFailure(tx, orgId, id, revoke);
      }
    });
  }
}
