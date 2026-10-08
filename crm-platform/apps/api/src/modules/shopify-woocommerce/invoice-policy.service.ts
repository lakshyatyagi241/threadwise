import { Inject, Injectable } from '@nestjs/common';
import type { EcomInvoicePolicy, UpdateEcomInvoicePolicyInput } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { InvoiceSettingsService } from '../crm';
import { ECOM_PLAN_GATE, type EcomPlanGate } from './_shims/tokens';
import { parseEcomTrigger } from './invoice-order-rules';
import type { StoreKind } from './mirror-rules';
import { StoresRepository } from './stores.repository';

/**
 * A store's invoicing policy (WD-ECOM-035), read and changed from its Invoices tab. The values live in the workspace's invoice
 * settings, one pair per source; the store is only the address (another workspace's store is a 404).
 */
@Injectable()
export class InvoicePolicyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly settings: InvoiceSettingsService,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
  ) {}

  async get(kind: StoreKind, uuid: string): Promise<EcomInvoicePolicy> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    return this.db.tx(async (tx) => {
      await this.assertStore(tx, orgId, kind, uuid);
      return toView(await this.settings.ecomPolicy(tx, orgId, kind));
    });
  }

  async update(
    kind: StoreKind,
    uuid: string,
    input: UpdateEcomInvoicePolicyInput,
  ): Promise<EcomInvoicePolicy> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    await this.db.tx((tx) => this.assertStore(tx, orgId, kind, uuid));
    return toView(
      await this.settings.updateEcomPolicy(kind, {
        autoSend: input.autoInvoice,
        trigger: input.trigger,
      }),
    );
  }

  private async assertStore(
    tx: Parameters<StoresRepository['shopifyByUuid']>[0],
    orgId: number,
    kind: StoreKind,
    uuid: string,
  ): Promise<void> {
    const row =
      kind === 'shopify'
        ? await this.stores.shopifyByUuid(tx, orgId, uuid)
        : await this.stores.wooByUuid(tx, orgId, uuid);
    if (!row)
      throw AppError.notFound(kind === 'shopify' ? 'Shopify store' : 'WooCommerce store', uuid);
  }
}

const toView = (p: { autoSend: boolean; trigger: string }): EcomInvoicePolicy => ({
  autoInvoice: p.autoSend,
  trigger: parseEcomTrigger(p.trigger),
});
