import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type {
  PricingMode,
  UpdateSwitchesInput,
  UpdateWalletSettingsInput,
  WalletSettings,
} from '@crm/contracts';
import { walletMajorToMinor } from '@crm/contracts';
import { PlatformSettingsService } from '../auth';
import { SettingsService } from '../platform-settings-branding-storage';
import { WalletLogService } from './wallet-log.service';

/** Where each setting lives. `billing.pay_per_message` is shared with the reseller module, which reads it for the billing mode. */
export const SETTING_KEYS = {
  economics: 'wallet.economics',
  perCountry: 'wallet.per_country_enabled',
  payPerMessage: 'billing.pay_per_message',
  pricingMode: 'wallet.pricing_mode',
} as const;

interface Economics {
  flatPriceMinor?: number;
  referralSignupMinor?: number;
  lowBalanceThresholdMinor?: number;
  launchCoveragePercent?: number;
}

/** Defaults of a fresh install (TW-WALLET-032), in hundredths: 1.00 a message, 1.00 referral reward, alert at 0.20. */
export const WALLET_DEFAULTS = {
  flatPriceMinor: 100,
  referralSignupMinor: 100,
  lowBalanceThresholdMinor: 20,
  launchCoveragePercent: 100,
} as const;

export interface EffectiveSettings {
  currency: string;
  flatPriceMinor: number;
  referralSignupMinor: number;
  lowBalanceThresholdMinor: number;
  launchCoveragePercent: number;
  perCountryEnabled: boolean;
  payPerMessage: boolean;
  pricingMode: PricingMode;
}

/**
 * Typed access to the wallet's platform settings (TW-WALLET-003, -005, -032). The two master switches are saved apart from the
 * three economics numbers, so saving one cannot flip the other (Reference overwrote both switches on every rate save). Every write is
 * one transaction with its platform-log row, and carries the old and new values: Reference wrote no trace of a settings change.
 */
@Injectable()
export class WalletSettingsService {
  constructor(
    private readonly platform: PlatformSettingsService,
    private readonly general: SettingsService,
    private readonly log: WalletLogService,
  ) {}

  async currency(): Promise<string> {
    const g = await this.general.values('general');
    return (g.defaultCurrency || 'USD').toUpperCase();
  }

  async effective(): Promise<EffectiveSettings> {
    const [econ, perCountry, pay, mode, currency] = await Promise.all([
      this.platform.get<Economics>(SETTING_KEYS.economics),
      this.platform.get<boolean>(SETTING_KEYS.perCountry),
      this.platform.get<boolean>(SETTING_KEYS.payPerMessage),
      this.platform.get<string>(SETTING_KEYS.pricingMode),
      this.currency(),
    ]);
    return {
      currency,
      flatPriceMinor: positive(econ?.flatPriceMinor, WALLET_DEFAULTS.flatPriceMinor),
      referralSignupMinor: nonNegative(
        econ?.referralSignupMinor,
        WALLET_DEFAULTS.referralSignupMinor,
      ),
      lowBalanceThresholdMinor: nonNegative(
        econ?.lowBalanceThresholdMinor,
        WALLET_DEFAULTS.lowBalanceThresholdMinor,
      ),
      launchCoveragePercent: Math.min(
        100,
        nonNegative(econ?.launchCoveragePercent, WALLET_DEFAULTS.launchCoveragePercent),
      ),
      perCountryEnabled: perCountry === true,
      payPerMessage: pay === true,
      // Upgrades change nothing until an operator turns margin pricing on.
      pricingMode: mode === 'margin' ? 'margin' : 'fixed',
    };
  }

  async view(metaRatesLive: boolean): Promise<WalletSettings> {
    const s = await this.effective();
    const updated = await this.platform.inTx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT max(updated_at) AS at FROM platform_settings WHERE key IN (${SETTING_KEYS.economics}, ${SETTING_KEYS.perCountry}, ${SETTING_KEYS.payPerMessage}, ${SETTING_KEYS.pricingMode})`);
      return (res.rows[0] as { at: Date | null } | undefined)?.at ?? null;
    });
    return { ...s, metaRatesLive, updatedAt: updated ? new Date(updated).toISOString() : null };
  }

  async saveEconomics(
    input: UpdateWalletSettingsInput,
    operator: { id: number; label: string },
  ): Promise<void> {
    const before = await this.effective();
    const next: Required<Economics> = {
      flatPriceMinor: walletMajorToMinor(input.flatPrice) ?? WALLET_DEFAULTS.flatPriceMinor,
      referralSignupMinor: walletMajorToMinor(input.referralSignup) ?? 0,
      lowBalanceThresholdMinor: walletMajorToMinor(input.lowBalanceThreshold) ?? 0,
      launchCoveragePercent: input.launchCoveragePercent,
    };
    await this.platform.inTx(async (tx) => {
      await this.put(tx, SETTING_KEYS.economics, next, operator.id);
      await this.log.platform(tx, {
        event: 'platform.settings.saved',
        message: 'Wallet pricing settings saved',
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: {
          flatPriceMinor: { old: before.flatPriceMinor, new: next.flatPriceMinor },
          referralSignupMinor: { old: before.referralSignupMinor, new: next.referralSignupMinor },
          lowBalanceThresholdMinor: {
            old: before.lowBalanceThresholdMinor,
            new: next.lowBalanceThresholdMinor,
          },
          launchCoveragePercent: {
            old: before.launchCoveragePercent,
            new: next.launchCoveragePercent,
          },
        },
      });
    });
  }

  async saveSwitches(
    input: UpdateSwitchesInput,
    operator: { id: number; label: string },
  ): Promise<void> {
    const before = await this.effective();
    await this.platform.inTx(async (tx) => {
      const changed: Record<string, { old: boolean | string; new: boolean | string }> = {};
      if (input.perCountryEnabled !== undefined) {
        await this.put(tx, SETTING_KEYS.perCountry, input.perCountryEnabled, operator.id);
        changed.perCountryEnabled = { old: before.perCountryEnabled, new: input.perCountryEnabled };
      }
      if (input.payPerMessage !== undefined) {
        await this.put(tx, SETTING_KEYS.payPerMessage, input.payPerMessage, operator.id);
        changed.payPerMessage = { old: before.payPerMessage, new: input.payPerMessage };
      }
      if (input.pricingMode !== undefined) {
        await this.put(tx, SETTING_KEYS.pricingMode, input.pricingMode, operator.id);
        changed.pricingMode = { old: before.pricingMode, new: input.pricingMode };
      }
      await this.log.platform(tx, {
        event: 'platform.switches.changed',
        severity: 'warning',
        message: `Pricing switches changed: ${Object.keys(changed).join(', ')}`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: changed,
      });
    });
  }

  private async put(tx: Tx, key: string, value: unknown, operatorId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, false, ${operatorId}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, is_secret = false, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  }
}

function positive(v: number | undefined, d: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : d;
}
function nonNegative(v: number | undefined, d: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d;
}
