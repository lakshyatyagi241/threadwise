import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type BspBillingMode,
  type BspBillingModeResponse,
  type SetBillingModeResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlatformSettingsService } from '../auth';
import { ResellerCreditService } from './reseller-credit.service';
import { isPayPerMessage } from './reseller-rules';
import { ResellerRepository } from './reseller.repository';
import { ResellerSettingsService } from './reseller-settings.service';

/**
 * The platform-wide "pay per message" switch. WALLET owns the pricing page that flips it and will write this key; it defaults to
 * off. Read here because the mode function (WD-BSP-012 rule 1) needs it next to the workspace flag.
 */
export const PAY_PER_MESSAGE_KEY = 'billing.pay_per_message';

/**
 * Who bills a workspace for its WhatsApp messages (WD-BSP-011, -012).
 *
 *  - `meta_direct`: the customer's own payment method is on Meta; the plan's allowance applies; no wallet charge.
 *  - `reseller`:    the platform's credit line is on the customer's WABA, Meta bills the platform, and every delivered message is
 *                   charged from the customer's wallet (WALLET's engine).
 *
 * This service is both the customer's choice and the contract WALLET's engine reads (`isPayPerMessage`).
 */
@Injectable()
export class BillingModeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ResellerRepository,
    private readonly credit: ResellerCreditService,
    private readonly settings: ResellerSettingsService,
    private readonly platform: PlatformSettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- the contract WALLET consumes ---------------------------------------------------------------------------------------------

  /**
   * Whether a workspace's delivered messages are charged from its wallet: a reseller workspace always, any other only while the
   * platform switch is on (the docs say a direct workspace is never charged; WaDesk's code let the switch override it and so
   * does this: WD-BSP-012 rule 1).
   */
  async isPayPerMessage(tx: Tx, orgId: number): Promise<boolean> {
    const flag = await this.repo.billsToPlatform(tx, orgId);
    const platformSwitch = (await this.platform.get<boolean>(PAY_PER_MESSAGE_KEY)) === true;
    return isPayPerMessage(flag, platformSwitch);
  }

  /** `wallet` or `plan`, the word mobile and the extension payloads carry (WD-BSP-012 "Exposes to MOB and EXT"). */
  async billingKind(tx: Tx, orgId: number): Promise<'wallet' | 'plan'> {
    return (await this.isPayPerMessage(tx, orgId)) ? 'wallet' : 'plan';
  }

  // --- the customer's screen ------------------------------------------------------------------------------------------------------

  async get(): Promise<BspBillingModeResponse> {
    const ctx = RequestContextStore.require();
    const resellerAvailable = await this.settings.isConfigured();
    return this.db.tx((tx) => this.snapshot(tx, ctx.orgId, resellerAvailable));
  }

  async set(mode: BspBillingMode): Promise<SetBillingModeResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const available = await this.settings.isConfigured();
    if (mode === 'reseller' && !available) {
      throw new AppError(
        ERROR_CODES.BSP_RESELLER_UNAVAILABLE,
        "Reseller billing is not available yet, the platform's Meta credit line is not set up.",
        HttpStatus.CONFLICT,
      );
    }

    // The flag flips first and on its own: an explicit choice is not blocked by Meta (WD-BSP-011 rule 2). The attach below reports
    // its outcome per number, which WaDesk hid from the customer.
    await this.db.tx(async (tx) => {
      const before = await this.repo.billsToPlatform(tx, orgId);
      const after = mode === 'reseller';
      if (before === after) return;
      await this.repo.setBillsToPlatform(tx, orgId, after);
      await this.audit.record(tx, {
        module: 'bsp',
        recordId: orgId,
        action: 'update',
        delta: { billingMode: { old: before ? 'reseller' : 'meta_direct', new: mode } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'bsp.billing_mode.changed',
        payload: { mode },
      });
    });

    let attach: SetBillingModeResponse['attach'];
    if (mode === 'reseller') {
      // Every connected number, not only new ones: a failed or revoked row is retried by choosing again (WD-BSP-011 rule 3).
      const wabas = await this.db.tx((tx) => this.repo.connectedWabas(tx, orgId));
      const workspaceCurrency = await this.db.tx((tx) => this.repo.workspaceCurrency(tx, orgId));
      let attached = 0;
      let failed = 0;
      let skipped = 0;
      for (const w of wabas) {
        // The workspace's own currency first: the credit line's currency is locked once attached (WD-BSP-011 rule 6).
        const out = await this.credit.attach({
          orgId,
          wabaId: w.waba_id,
          currencyCandidates: [workspaceCurrency],
          origin: 'customer',
        });
        if (!out.called) skipped += 1;
        else if (out.allocation.status === 'attached') attached += 1;
        else failed += 1;
      }
      attach = { attached, failed, skipped, remaining: 0 };
    }
    return { ...(await this.get()), attach };
  }

  private async snapshot(
    tx: Tx,
    orgId: number,
    resellerAvailable: boolean,
  ): Promise<BspBillingModeResponse> {
    const [flag, wabas, allocations] = await Promise.all([
      this.repo.billsToPlatform(tx, orgId),
      this.repo.connectedWabas(tx, orgId),
      this.repo.allocationsForOrg(tx, orgId),
    ]);
    const byWaba = new Map(allocations.map((a) => [a.waba_id, a]));
    return {
      mode: flag ? 'reseller' : 'meta_direct',
      resellerAvailable,
      accounts: wabas.map((w) => {
        const a = byWaba.get(w.waba_id);
        return {
          wabaId: w.waba_id,
          phone: w.phone_number,
          displayLabel: w.display_label,
          allocationStatus: a?.status ?? null,
          currency: a?.currency ?? null,
          lastError: a?.last_error ?? null,
        };
      }),
    };
  }
}
