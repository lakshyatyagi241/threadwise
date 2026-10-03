import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  WHATSAPP_PROVIDER,
  type NormalisedDeliveryEvent,
  type WhatsAppProvider,
} from '../../infra/providers/whatsapp/whatsapp.port';
import { BroadcastReceiptsService } from '../broadcasts';
import { ContactsService } from '../crm';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { WABA_CALLS_SINK, type WabaCallsSink } from './waba-calls-sink';
import { WABA_INBOUND_SINK, type InboundContext, type WabaInboundSink } from './waba-inbound-sink';
import { usernameOf, usernameUpdatePatch } from './waba-extras-rules';
import { echoText, historyItems, syncedContacts, type EchoPayload } from './waba-coexistence-rules';
import { formSubmissionOf, paymentUpdatesOf } from './waba-handoff-rules';
import { isOrderMessage } from './waba-order-rules';
import { WabaOrdersService } from './waba-orders.service';
import { WabaGroupsService, isGroupField } from './waba-groups.service';
import { HANDLED_FIELDS, type WebhookChange } from './waba-rules';
import { WabaTemplateEvents } from './waba-template-events.service';

const INBOUND_DEDUPE_TTL_S = 24 * 3600;
const MODULE = 'wa_provider_configs';

interface Route {
  orgId: number;
  configId: number;
  status: string;
}

/**
 * Works through the changes of one authenticated webhook payload (TW-WABA-031..037, 041). Runs in the worker, after the HTTP
 * handler has already answered Meta, so a slow database or a crashing handler can never turn into a retry storm of duplicates.
 *
 * Idempotent end to end: Meta retries, so the same payload arrives again. A broadcast receipt is a forward-only state machine,
 * an inbound message is claimed in Redis by its wamid (released on failure so the retry can finish it), template and account
 * events are overwrites.
 */
@Injectable()
export class WabaIngestService {
  private readonly logger = new Logger(WabaIngestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WabaConnectionsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    // A type-only annotation: the decorator-metadata read of the class would hit the broadcasts <-> waba import cycle.
    @Inject(forwardRef(() => BroadcastReceiptsService))
    private readonly receipts: InstanceType<typeof BroadcastReceiptsService>,
    private readonly templates: WabaTemplateEvents,
    private readonly groups: WabaGroupsService,
    private readonly orders: WabaOrdersService,
    private readonly contacts: ContactsService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    @Inject(WABA_INBOUND_SINK) private readonly sink: WabaInboundSink,
    @Inject(WABA_CALLS_SINK) private readonly calls: WabaCallsSink,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async process(changes: WebhookChange[]): Promise<{ handled: number; dropped: number }> {
    let handled = 0;
    let dropped = 0;
    const routes = new Map<string, Route | null>();
    for (const change of changes) {
      if (!HANDLED_FIELDS.has(change.field)) {
        dropped++;
        continue;
      }
      const key = `${change.phoneNumberId ?? ''}|${change.wabaId}`;
      if (!routes.has(key)) routes.set(key, await this.route(change));
      const route = routes.get(key);
      if (!route) {
        // No workspace owns this number (removed, or an event for another platform sharing the Meta app). Acknowledged, not retried.
        this.logger.log(
          { wabaId: change.wabaId, phoneNumberId: change.phoneNumberId, field: change.field },
          'webhook for an unknown number dropped',
        );
        dropped++;
        continue;
      }
      await RequestContextStore.run(
        {
          requestId: `waba-${change.wabaId}-${change.time ?? Date.now()}`,
          orgId: route.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => this.dispatch(route, change),
      );
      handled++;
    }
    return { handled, dropped };
  }

  private async route(change: WebhookChange): Promise<Route | null> {
    const res = await this.db.primary.execute(
      sql`SELECT * FROM waba_route_lookup(${change.phoneNumberId}, ${change.wabaId})`,
    );
    const r = res.rows[0] as
      | { route_org_id: number | string; route_config_id: number | string; route_status: string }
      | undefined;
    return r
      ? {
          orgId: Number(r.route_org_id),
          configId: Number(r.route_config_id),
          status: r.route_status,
        }
      : null;
  }

  private async dispatch(route: Route, change: WebhookChange): Promise<void> {
    switch (change.field) {
      case 'messages':
        return this.messages(route, change);
      case 'message_template_status_update':
      case 'message_template_quality_update':
      case 'template_category_update':
      case 'message_template_components_update':
        await this.db.txAs({ orgId: route.orgId }, (tx) =>
          this.templates.apply(
            tx,
            route.orgId,
            route.configId,
            change.field,
            change.value,
            new Date(),
          ),
        );
        return;
      case 'group_lifecycle_update':
      case 'group_participants_update':
      case 'group_settings_update':
      case 'group_status_update':
        if (isGroupField(change.field)) {
          const field = change.field;
          await this.db.txAs({ orgId: route.orgId }, (tx) =>
            this.groups.apply(tx, route.orgId, route.configId, field, change.value, new Date()),
          );
        }
        return;
      case 'business_username_update':
        return this.username(route, change);
      case 'smb_message_echoes':
        return this.echoes(route, change);
      case 'history':
        return this.history(route, change);
      case 'smb_app_state_sync':
        return this.appStateSync(route, change);
      case 'phone_number_quality_update':
      case 'phone_number_name_update':
      case 'account_update':
      case 'account_review_update':
        return this.account(route, change);
      case 'calls': {
        // Calls belong to the calling domain; this only says who the number is.
        const config = await this.db.txAs({ orgId: route.orgId }, (tx) =>
          this.repo.findById(tx, route.orgId, route.configId),
        );
        return this.calls.onCalls(
          {
            orgId: route.orgId,
            configId: route.configId,
            configUuid: config?.uuid ?? '',
            wabaId: change.wabaId,
            phoneNumberId: change.phoneNumberId,
            contactName: firstProfileName(change.value),
          },
          change.value,
        );
      }
      case 'flows':
        // Flow statuses belong to the flow builder; the outbox carries them until it exists.
        await this.db.txAs({ orgId: route.orgId }, (tx) =>
          this.outbox.emit(tx, {
            aggregateModule: MODULE,
            aggregateId: route.configId,
            eventType: 'whatsapp.flow.status_changed',
            payload: { wabaId: change.wabaId, ...change.value },
          }),
        );
        return;
    }
  }

  // --- messages and delivery reports -------------------------------------------------------------------------------

  private async messages(route: Route, change: WebhookChange): Promise<void> {
    const parsed = this.provider.parseWebhook({
      entry: [{ changes: [{ value: change.value }] }],
    });
    const config = await this.db.txAs({ orgId: route.orgId }, (tx) =>
      this.repo.findById(tx, route.orgId, route.configId),
    );
    const ctx: InboundContext = {
      orgId: route.orgId,
      configId: route.configId,
      configUuid: config?.uuid ?? '',
      wabaId: change.wabaId,
      phoneNumberId: change.phoneNumberId,
      contactName: firstProfileName(change.value),
    };

    for (const event of parsed.deliveryEvents) await this.status(ctx, event);

    // Payment statuses run after the ordinary ones of the same change and are handed to the pay owner (TW-WABA-043).
    for (const p of paymentUpdatesOf(change.value)) {
      const key = `waba:payment:${route.orgId}:${p.providerMessageId}:${String(p.status.status ?? '')}`;
      const claimed = await this.redis.set(key, '1', 'EX', INBOUND_DEDUPE_TTL_S, 'NX');
      if (claimed !== 'OK') continue;
      try {
        await this.emitHandoff(route, 'whatsapp.payment.updated', p.providerMessageId, {
          status: p.status,
        });
      } catch (err) {
        await this.redis.del(key);
        throw err;
      }
    }

    for (const message of parsed.inboundMessages) {
      const key = `waba:inbound:${route.orgId}:${message.providerMessageId}`;
      // Claim first, release on failure: a crash must not lose the message, a retry must not double it.
      const claimed = await this.redis.set(key, '1', 'EX', INBOUND_DEDUPE_TTL_S, 'NX');
      if (claimed !== 'OK') continue;
      try {
        // A form submission is the forms domain's, not a chat bubble (TW-WABA-043).
        const form = formSubmissionOf(message.raw as Record<string, unknown>, ctx.contactName);
        if (form)
          await this.emitHandoff(route, 'whatsapp.form.submitted', form.providerMessageId, {
            ...form,
          });
        // A catalog cart is an order, not a chat bubble (TW-WABA-042).
        else if (isOrderMessage(message.raw as Record<string, unknown>)) {
          await this.db.txAs({ orgId: route.orgId }, (tx) =>
            this.orders.capture(
              tx,
              route.orgId,
              route.configId,
              message.raw as Record<string, unknown>,
              message.from,
              ctx.contactName,
            ),
          );
        } else if ((message.raw as { group_id?: string }).group_id) {
          // A message in a Cloud API group: storage only, on the group's own thread (TW-WABA-039).
          const groupId = String((message.raw as { group_id?: string }).group_id);
          const title = await this.groups.subjectOf(route.orgId, route.configId, groupId);
          await this.sink.onGroupMessage?.(ctx, message, { groupId, title });
        } else await this.sink.onMessage(ctx, message);
        await this.stampInboundWired(route);
      } catch (err) {
        await this.redis.del(key);
        throw err;
      }
    }
  }

  /** One outbox event for a hand-off, claimed by message id so a Meta retry does not hand it over twice. */
  private async emitHandoff(
    route: Route,
    eventType: string,
    providerMessageId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.txAs({ orgId: route.orgId }, (tx) =>
      this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: route.configId,
        eventType,
        payload: { ...payload, providerMessageId },
      }),
    );
  }

  private async status(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void> {
    // `clicked` is a template-button report from another source; the broadcast state machine knows four states.
    if (event.event === 'clicked') return;
    // One send to a group has a status per participant: fold them into the bubble's tally (TW-WABA-039).
    if ((event.raw as { recipient_type?: string }).recipient_type === 'group') {
      await this.groups.recordDelivery(ctx.orgId, event.raw as Record<string, unknown>);
      return;
    }
    const raw = event.raw as {
      errors?: Array<{
        code?: number;
        title?: string;
        message?: string;
        error_data?: { details?: string };
      }>;
    };
    const first = raw.errors?.[0];
    const claimed = await this.receipts.handle({
      providerMessageId: event.providerMessageId,
      status: event.event,
      occurredAt: event.occurredAt,
      errorCode: event.errorCode ?? null,
      errorMessage: first?.error_data?.details ?? first?.message ?? first?.title ?? null,
    });
    if (!claimed) await this.sink.onStatus(ctx, event);
  }

  /** The first real inbound message proves Meta delivers here (TW-WABA-013); a delivery report alone does not. */
  private async stampInboundWired(route: Route): Promise<void> {
    await this.db.txAs({ orgId: route.orgId }, async (tx) => {
      const row = await this.repo.findById(tx, route.orgId, route.configId);
      if (!row || row.meta_json?.inbound_wired === true) return;
      await this.repo.update(tx, route.orgId, route.configId, {
        metaPatch: { inbound_wired: true, inbound_checked_at: new Date().toISOString() },
      });
    });
  }

  /**
   * Messages typed on the WhatsApp Business app are mirrored as outbound bubbles (TW-WABA-044). Claimed by message id like an
   * inbound one, so a redelivery is one bubble; a missing customer number is skipped, as Reference did.
   */
  private async echoes(route: Route, change: WebhookChange): Promise<void> {
    const echoes = (change.value.message_echoes ?? []) as Array<EchoPayload>;
    const config = await this.db.txAs({ orgId: route.orgId }, (tx) =>
      this.repo.findById(tx, route.orgId, route.configId),
    );
    const ctx: InboundContext = {
      orgId: route.orgId,
      configId: route.configId,
      configUuid: config?.uuid ?? '',
      wabaId: change.wabaId,
      phoneNumberId: change.phoneNumberId,
      contactName: null,
    };
    for (const e of echoes) {
      const to = String(e.to ?? e.recipient_id ?? e.context?.from ?? '').replace(/\D+/g, '');
      if (!e.id || !to) {
        this.logger.warn(
          { number: ctx.configUuid },
          'a business-app echo without a customer number was skipped',
        );
        continue;
      }
      const key = `waba:echo:${route.orgId}:${e.id}`;
      const claimed = await this.redis.set(key, '1', 'EX', INBOUND_DEDUPE_TTL_S, 'NX');
      if (claimed !== 'OK') continue;
      try {
        await this.sink.onEcho?.(ctx, {
          providerMessageId: e.id,
          to,
          text: echoText(e),
          occurredAt: new Date(Number(e.timestamp) * 1000 || Date.now()),
        });
      } catch (err) {
        await this.redis.del(key);
        throw err;
      }
    }
  }

  /**
   * The one-time chat history Meta pushes after coexistence onboarding (TW-WABA-046): stored quietly and backdated, capped at
   * `HISTORY_CAP` per delivery, deduplicated by message id in the inbox ledger. Own numbers decide which side wrote a message.
   */
  private async history(route: Route, change: WebhookChange): Promise<void> {
    const own = await this.db.txAs({ orgId: route.orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT phone_number FROM wa_provider_configs WHERE org_id = ${route.orgId}`,
      );
      return new Set(
        (res.rows as Array<{ phone_number: string | null }>)
          .map((r) => (r.phone_number ?? '').replace(/\D+/g, ''))
          .filter(Boolean),
      );
    });
    const { items, capped } = historyItems(change.value, own);
    if (capped) {
      this.logger.warn(
        { orgId: route.orgId },
        'history cap hit: the rest of this delivery was skipped',
      );
    }
    if (items.length === 0) return;
    const config = await this.db.txAs({ orgId: route.orgId }, (tx) =>
      this.repo.findById(tx, route.orgId, route.configId),
    );
    await this.sink.onHistory?.(
      {
        orgId: route.orgId,
        configId: route.configId,
        configUuid: config?.uuid ?? '',
        wabaId: change.wabaId,
        phoneNumberId: change.phoneNumberId,
        contactName: null,
      },
      items,
    );
  }

  /** The business's phone address book mirrored into the contacts, without events (TW-WABA-045). */
  private async appStateSync(route: Route, change: WebhookChange): Promise<void> {
    const { contacts, removed } = syncedContacts(change.value);
    if (removed > 0) this.logger.log({ orgId: route.orgId, removed }, 'app-state remove ignored');
    if (contacts.length === 0) return;
    await this.db.txAs({ orgId: route.orgId }, async (tx) => {
      for (const c of contacts) {
        await this.contacts.resolveOrCreateByIdentity(tx, route.orgId, {
          kind: 'phone',
          value: c.phone,
          name: c.name,
          source: 'whatsapp_business_app',
          quiet: true,
        });
      }
    });
  }

  /** The handle and its badge follow Meta (TW-WABA-026); an error here is logged and swallowed, as Reference did. */
  private async username(route: Route, change: WebhookChange): Promise<void> {
    try {
      await this.db.txAs({ orgId: route.orgId }, async (tx) => {
        const row = await this.repo.findById(tx, route.orgId, route.configId);
        if (!row) return;
        const patch = usernameUpdatePatch(
          change.value,
          usernameOf(row.meta_json),
          new Date().toISOString(),
        );
        if (patch) await this.repo.update(tx, route.orgId, route.configId, { metaPatch: patch });
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'business_username_update could not be applied');
    }
  }

  // --- account and number events -----------------------------------------------------------------------------------

  private async account(route: Route, change: WebhookChange): Promise<void> {
    const v = change.value;
    const now = new Date().toISOString();
    let patch: Record<string, unknown> | null = null;
    let event: string | null = null;

    switch (change.field) {
      case 'phone_number_quality_update': {
        const tier = typeof v.current_limit === 'string' ? v.current_limit : null;
        patch = {
          ...(tier ? { messaging_limit_tier: tier } : {}),
          last_quality_event: { event: v.event ?? null, at: now },
        };
        event = 'whatsapp.number.quality_changed';
        break;
      }
      case 'phone_number_name_update': {
        const decision = typeof v.decision === 'string' ? v.decision.toUpperCase() : null;
        patch = {
          ...(decision ? { name_status: decision } : {}),
          ...(decision === 'APPROVED' && typeof v.requested_verified_name === 'string'
            ? { verified_name: v.requested_verified_name }
            : {}),
        };
        break;
      }
      case 'account_update':
        patch = {
          account_alert: {
            event: v.event ?? null,
            at: now,
            details: v.restriction_info ?? v.ban_info ?? v.violation_info ?? null,
          },
        };
        event = 'whatsapp.account.alert';
        break;
      case 'account_review_update':
        patch = { account_review: { decision: v.decision ?? null, at: now } };
        break;
    }
    if (!patch || Object.keys(patch).length === 0) return;
    await this.db.txAs({ orgId: route.orgId }, async (tx) => {
      const next = await this.repo.update(tx, route.orgId, route.configId, { metaPatch: patch! });
      if (!next) return;
      await this.audit.record(tx, {
        module: MODULE,
        recordId: route.configId,
        action: 'update',
        delta: { webhook: { old: null, new: change.field } },
      });
      if (event) {
        await this.outbox.emit(tx, {
          aggregateModule: MODULE,
          aggregateId: route.configId,
          eventType: event,
          payload: { connectionId: next.uuid, field: change.field, ...v },
        });
      }
    });
  }
}

function firstProfileName(value: Record<string, unknown>): string | null {
  const contacts = value.contacts as Array<{ profile?: { name?: string } }> | undefined;
  return contacts?.[0]?.profile?.name ?? null;
}
