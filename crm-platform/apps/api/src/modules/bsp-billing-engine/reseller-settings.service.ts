import { Injectable } from '@nestjs/common';
import {
  BSP_CREDIT_CURRENCIES,
  BSP_DEFAULT_BASE_CURRENCY,
  BSP_DEFAULT_GRAPH_VERSION,
  normalizeCurrencyInput,
  normalizeGraphVersion,
  type BspSettingsResponse,
  type UpdateBspSettingsInput,
} from '@crm/contracts';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import type { CreditSourceConnection } from '../../infra/providers/bsp-billing-engine/credit-source.port';

/** One JSON document of non-secret settings; the system-user token is its own encrypted entry. */
const DOC_KEY = 'bsp.reseller';
const MEMBER = 'connection';
const TOKEN_KEY = 'bsp.system_user_token';

interface Stored {
  businessId?: string;
  extendedCreditId?: string;
  graphVersion?: string;
  ratesEndpoint?: string;
  autoAttach?: boolean;
  autoAttachCurrency?: string;
  baseCurrency?: string;
}

/** What the credit service needs, token included. Server side only: it never goes into a response. */
export interface ResellerConnection extends CreditSourceConnection {
  autoAttach: boolean;
  autoAttachCurrency: string;
  baseCurrency: string;
  ratesEndpoint: string;
}

/**
 * The platform's Meta reseller connection (WD-BSP-004): business id, system-user token, credit line, Graph version, rates
 * endpoint, auto-attach and the currencies. Stored as platform settings (the operator's, not a workspace's); the token is encrypted
 * by PlatformSettingsService and only `tokenSet` ever reaches the browser.
 *
 * Differences from WaDesk, each deliberate: the token can be cleared (WaDesk could only replace it), the rates endpoint must be
 * https (the token is sent to it), the Graph version is checked on the server (WaDesk checked in the browser only) and the
 * auto-attach currency must be one Meta accepts (WaDesk stored anything and every attach then failed).
 */
@Injectable()
export class ResellerSettingsService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  private async stored(): Promise<Stored> {
    const doc = await this.settings.get<{ connection?: Stored }>(DOC_KEY);
    return doc?.[MEMBER] ?? {};
  }

  async connection(): Promise<ResellerConnection> {
    const s = await this.stored();
    return {
      businessId: s.businessId ?? '',
      extendedCreditId: s.extendedCreditId ?? '',
      token: (await this.settings.getSecret(TOKEN_KEY)) ?? '',
      graphVersion: s.graphVersion || BSP_DEFAULT_GRAPH_VERSION,
      ratesEndpoint: s.ratesEndpoint ?? '',
      autoAttach: s.autoAttach === true,
      autoAttachCurrency: s.autoAttachCurrency ?? '',
      baseCurrency: s.baseCurrency || BSP_DEFAULT_BASE_CURRENCY,
    };
  }

  async view(): Promise<BspSettingsResponse> {
    const s = await this.stored();
    const tokenSet = await this.settings.hasSecret(TOKEN_KEY);
    const businessId = s.businessId ?? '';
    return {
      businessId,
      extendedCreditId: s.extendedCreditId ?? '',
      tokenSet,
      graphVersion: s.graphVersion || BSP_DEFAULT_GRAPH_VERSION,
      ratesEndpoint: s.ratesEndpoint ?? '',
      autoAttach: s.autoAttach === true,
      autoAttachCurrency: s.autoAttachCurrency ?? '',
      baseCurrency: s.baseCurrency || BSP_DEFAULT_BASE_CURRENCY,
      configured: tokenSet && businessId !== '',
      creditCurrencies: [...BSP_CREDIT_CURRENCIES],
    };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.view()).configured;
  }

  /** Remembers the credit line found by lookup so the next attach skips it (WD-BSP-005 rule 3). */
  async cacheCreditLine(id: string): Promise<void> {
    await this.settings.mergeMember(DOC_KEY, MEMBER, { extendedCreditId: id }, null);
  }

  async save(input: UpdateBspSettingsInput, operatorId: number): Promise<BspSettingsResponse> {
    const before = await this.stored();
    const next: Stored = {
      businessId: input.businessId,
      extendedCreditId: input.extendedCreditId,
      graphVersion: normalizeGraphVersion(input.graphVersion) ?? BSP_DEFAULT_GRAPH_VERSION,
      ratesEndpoint: input.ratesEndpoint,
      autoAttach: input.autoAttach,
      autoAttachCurrency: normalizeCurrencyInput(input.autoAttachCurrency),
      // Absent keeps what is stored: a form that does not show the field must not reset it (WaDesk's admin-edit trap, WD-BSP-013).
      baseCurrency:
        input.baseCurrency === undefined
          ? (before.baseCurrency ?? BSP_DEFAULT_BASE_CURRENCY)
          : normalizeCurrencyInput(input.baseCurrency),
    };
    await this.settings.mergeMember(DOC_KEY, MEMBER, { ...next }, operatorId);

    let token: 'kept' | 'replaced' | 'cleared' = 'kept';
    if (input.systemUserToken) {
      await this.settings.setSecret(TOKEN_KEY, input.systemUserToken, operatorId);
      token = 'replaced';
    } else if (input.clearToken) {
      await this.settings.clearSecret(TOKEN_KEY);
      token = 'cleared';
    }

    // ponytail: the audit row is its own transaction (PlatformSettingsService owns the write); a crash between the two loses the
    // row, not the setting. Move both into one PlatformStore transaction if the audit must be gap free.
    await this.audit.recordStandalone({
      event: 'platform.bsp.settings_saved',
      status: 'success',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: {
        changed: (Object.keys(next) as Array<keyof Stored>).filter((k) => before[k] !== next[k]),
        // Not named "token": the audit writer redacts any key that looks like a secret, and this value is only a verb.
        systemUser: token,
      },
    });
    return this.view();
  }
}
