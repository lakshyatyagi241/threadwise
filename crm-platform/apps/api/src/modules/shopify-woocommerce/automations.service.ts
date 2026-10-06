import { Inject, Injectable } from '@nestjs/common';
import { type AutomationsView, type SaveAutomationsInput } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  ECOM_PLAN_GATE,
  ECOM_TEMPLATES,
  type EcomPlanGate,
  type EcomTemplates,
} from './_shims/tokens';
import { SHOPIFY_AUTOMATIONS, WOO_AUTOMATIONS } from './event-rules';
import { EventsRepository, type EventConfig } from './events.repository';
import type { StoreKind } from './mirror-rules';
import { StoresRepository } from './stores.repository';

const MODULE_KEY: Record<StoreKind, string> = {
  shopify: 'shopify_integrations',
  woocommerce: 'woocommerce_integrations',
};

/**
 * A store's automations (TW-ECOM-009, 033): which template each event sends, to whom, with which order fields, after what delay.
 * Reading lists every event the store supports (never set up means off); saving writes all of them in one transaction.
 */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async get(kind: StoreKind, uuid: string): Promise<AutomationsView> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    return this.db.tx(async (tx) => {
      const store = await this.byUuid(tx, orgId, kind, uuid);
      const [rows, fired] = await Promise.all([
        this.events.list(tx, orgId, kind, store.id),
        this.events.fired(tx, orgId, kind, store.id),
      ]);
      const saved = new Map(rows.map((r) => [r.eventType, r]));
      const types = kind === 'shopify' ? SHOPIFY_AUTOMATIONS : WOO_AUTOMATIONS;
      return {
        automations: types.map((eventType) => {
          const r = saved.get(eventType);
          return {
            eventType,
            isActive: r?.isActive ?? false,
            templateUuid: r?.templateUuid ?? null,
            templateName: r?.templateName ?? null,
            varMap: r?.varMap ?? [],
            sendTo: r?.sendTo ?? 'customer',
            adminNumber: r?.adminNumber ?? null,
            delaySeconds: r?.delaySeconds ?? 0,
            fired: fired.get(eventType) ?? 0,
          };
        }),
        senderKey: kind === 'woocommerce' ? senderOf(store.metadata) : null,
      };
    });
  }

  async save(kind: StoreKind, uuid: string, input: SaveAutomationsInput): Promise<AutomationsView> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    const supported = new Set<string>(kind === 'shopify' ? SHOPIFY_AUTOMATIONS : WOO_AUTOMATIONS);
    await this.db.tx(async (tx) => {
      const store = await this.byUuid(tx, orgId, kind, uuid);
      let changed = 0;
      for (const a of input.automations) {
        if (!supported.has(a.eventType)) continue;
        let templateId: number | null = null;
        if (a.templateUuid) {
          const id = await this.templates.idOf(tx, orgId, a.templateUuid);
          if (id === undefined)
            throw AppError.validation('That template does not exist.', [
              { path: `automations.${a.eventType}.templateUuid`, message: 'Unknown template.' },
            ]);
          templateId = id;
        }
        if (a.isActive && templateId === null)
          throw AppError.validation('Choose a template for every automation you turn on.', [
            { path: `automations.${a.eventType}.templateUuid`, message: 'Required when on.' },
          ]);
        const cfg: Omit<EventConfig, 'id'> = {
          eventType: a.eventType,
          isActive: a.isActive,
          templateId,
          varMap: a.varMap.length > 0 ? a.varMap : null,
          sendTo: a.sendTo,
          adminNumber: a.adminNumber ? a.adminNumber : null,
          delaySeconds: a.delaySeconds,
        };
        await this.events.upsert(tx, orgId, kind, store.id, cfg);
        changed += 1;
      }
      if (kind === 'woocommerce' && input.senderKey !== undefined) {
        if (input.senderKey !== null) await this.assertSender(tx, orgId, input.senderKey);
        await this.stores.mergeMetadata(tx, orgId, kind, store.id, { senderKey: input.senderKey });
      }
      await this.audit.record(tx, {
        module: MODULE_KEY[kind],
        recordId: store.id,
        action: 'update',
        delta: { automations: { old: null, new: changed } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY[kind],
        aggregateId: store.id,
        eventType: `${kind}.automations.saved`,
        payload: { uuid: store.uuid, automations: changed },
      });
    });
    return this.get(kind, uuid);
  }

  private async byUuid(
    tx: Parameters<StoresRepository['shopifyByUuid']>[0],
    orgId: number,
    kind: StoreKind,
    uuid: string,
  ) {
    const row =
      kind === 'shopify'
        ? await this.stores.shopifyByUuid(tx, orgId, uuid)
        : await this.stores.wooByUuid(tx, orgId, uuid);
    if (!row)
      throw AppError.notFound(kind === 'shopify' ? 'Shopify store' : 'WooCommerce store', uuid);
    return row;
  }

  /** The chosen number must belong to this workspace and be connected. */
  private async assertSender(
    tx: Parameters<StoresRepository['shopifyByUuid']>[0],
    orgId: number,
    key: string,
  ): Promise<void> {
    const [engine, uuid] = key.split(':');
    // Choosing a personal number as the "send from" is refused while the platform switch is off (owner decision 2026-10-05).
    if (engine === UNOFFICIAL_ENGINE) await this.unofficial.assertEnabled();
    const res =
      engine === 'baileys'
        ? await tx.execute(
            sql`SELECT 1 FROM devices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'connected' AND active`,
          )
        : await tx.execute(
            sql`SELECT 1 FROM wa_provider_configs WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND provider = ${engine} AND status = 'connected'`,
          );
    if (res.rows.length === 0)
      throw AppError.validation('That sender is not connected to this workspace.', [
        { path: 'senderKey', message: 'Unknown or disconnected sender.' },
      ]);
  }
}

const senderOf = (metadata: unknown): string | null => {
  const k = (metadata as { senderKey?: unknown } | null)?.senderKey;
  return typeof k === 'string' ? k : null;
};
