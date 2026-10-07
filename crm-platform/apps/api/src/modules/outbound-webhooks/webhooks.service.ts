import { Injectable } from '@nestjs/common';
import {
  WEBHOOK_EVENTS,
  type CreateWebhookInput,
  type ListWebhookDeliveriesQuery,
  type ListWebhookDeliveriesResponse,
  type ListWebhooksResponse,
  type TestWebhookResponse,
  type UpdateWebhookInput,
  type WebhookEnvelope,
  type WebhookResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { assertPublicTarget } from '../webhook-fanout';
import { send } from './send';
import { toDeliveryResponse, toWebhookResponse } from './webhooks.mapper';
import { WebhooksRepository } from './webhooks.repository';

const MODULE_KEY = 'webhooks';
/** The whole payload kept per delivery in the log (a few kilobytes at most per event). */
const NO_SECRET = null;

/**
 * A workspace's outbound webhooks. The URL and the signing secret are stored encrypted and the secret is never read back. A URL
 * must be https and resolve only to public addresses, at save time and again at every delivery. Every write records an audit row and
 * an outbox event in the same transaction; creating one needs the plan's `outbound_webhooks` feature and room under its `webhooks` cap
 * (Reference's API path skipped both, a gap closed here).
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WebhooksRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async list(): Promise<ListWebhooksResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId);
      return {
        data: rows.map((r) => toWebhookResponse(r, this.crypto)),
        availableEvents: [...WEBHOOK_EVENTS],
      };
    });
  }

  async create(input: CreateWebhookInput): Promise<WebhookResponse> {
    const ctx = RequestContextStore.require();
    await this.assertUrl(input.url);
    const events = normaliseEvents(input.events);
    return this.db.tx(async (tx) => {
      await this.repo.lockForCreate(tx, ctx.orgId);
      await this.entitlements.assertWithinLimit(
        ctx.orgId,
        'webhooks',
        await this.repo.countAll(tx, ctx.orgId),
      );
      const row = await this.repo.insert(tx, ctx.orgId, {
        userId: ctx.userId,
        name: input.name?.trim() || null,
        urlEnc: this.crypto.encrypt(input.url),
        secretEnc: input.secret ? this.crypto.encrypt(input.secret) : NO_SECRET,
        events,
        active: input.active,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'webhook.created',
        payload: { uuid: row.uuid, name: row.name, events },
      });
      return toWebhookResponse(row, this.crypto);
    });
  }

  async update(uuid: string, input: UpdateWebhookInput): Promise<WebhookResponse> {
    const ctx = RequestContextStore.require();
    if (input.url !== undefined) await this.assertUrl(input.url);
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Webhook', uuid);
      const patch: Parameters<WebhooksRepository['update']>[3] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.name !== undefined) {
        patch.name = input.name?.trim() || null;
        delta.name = { old: existing.name, new: patch.name };
      }
      if (input.url !== undefined) {
        patch.webhookUrl = this.crypto.encrypt(input.url);
        delta.url = { old: null, new: 'changed' };
      }
      if (input.events !== undefined) {
        patch.events = normaliseEvents(input.events);
        delta.events = { old: existing.events, new: patch.events };
      }
      if (input.secret) {
        patch.secret = this.crypto.encrypt(input.secret);
        delta.secret = { old: null, new: 'changed' };
      } else if (input.clearSecret) {
        patch.secret = null;
        delta.secret = { old: 'set', new: null };
      }
      if (input.active !== undefined) {
        patch.status = input.active;
        delta.active = { old: existing.status, new: input.active };
        // Switching back on gives a fresh start: the earlier failure is not the endpoint's state any more.
        if (input.active) patch.isFailing = false;
      }
      if (Object.keys(patch).length === 0) return toWebhookResponse(existing, this.crypto);

      const row = await this.repo.update(tx, ctx.orgId, existing.id, patch);
      if (!row) throw AppError.notFound('Webhook', uuid);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'webhook.updated',
        payload: { uuid: row.uuid, changed: Object.keys(delta) },
      });
      return toWebhookResponse(row, this.crypto);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Webhook', uuid);
      await this.repo.remove(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'webhook.deleted',
        payload: { uuid: existing.uuid, name: existing.name },
      });
    });
  }

  async deliveries(
    uuid: string,
    query: ListWebhookDeliveriesQuery,
  ): Promise<ListWebhookDeliveriesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Webhook', uuid);
      const rows = await this.repo.deliveries(tx, ctx.orgId, existing.id, query.limit);
      return { data: rows.map(toDeliveryResponse) };
    });
  }

  /** Sends a `test_fire` envelope now and answers with the outcome (it is logged like any delivery, and counts on the endpoint). */
  async test(uuid: string): Promise<TestWebhookResponse> {
    const ctx = RequestContextStore.require();
    const target = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Webhook', uuid);
      return row;
    });
    const envelope: WebhookEnvelope = {
      id: crypto.randomUUID(),
      event: 'test_fire',
      createdAt: new Date().toISOString(),
      data: { message: 'This is a test delivery from your workspace.' },
    };
    const secret = target.secret ? this.crypto.decrypt(target.secret) : null;
    const out = await send(this.crypto.decrypt(target.webhookUrl), secret, envelope);
    const row = await this.db.tx(async (tx) => {
      const logged = await this.repo.logDelivery(tx, ctx.orgId, {
        webhookId: target.id,
        event: 'test_fire',
        statusCode: out.statusCode,
        latencyMs: out.latencyMs,
        attempts: 1,
        isRetry: false,
        payload: envelope,
        responseBody: out.responseSnippet,
        error: out.error,
      });
      await this.repo.recordResult(tx, ctx.orgId, target.id, {
        ok: out.ok,
        final: true,
        statusCode: out.statusCode,
        latencyMs: out.latencyMs,
        error: out.error,
      });
      return logged;
    });
    return { delivery: toDeliveryResponse(row) };
  }

  private async assertUrl(url: string): Promise<void> {
    const problem = await assertPublicTarget(url);
    if (problem) throw AppError.validation(problem, [{ path: 'url', message: problem }]);
  }
}

/** Empty means everything; `*` anywhere means everything; duplicates are dropped. */
export function normaliseEvents(events: readonly string[]): string[] {
  if (events.length === 0 || events.includes('*')) return ['*'];
  return [...new Set(events)];
}
