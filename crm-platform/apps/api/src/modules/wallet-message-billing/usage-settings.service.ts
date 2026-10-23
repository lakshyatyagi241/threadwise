import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  WALLET_COST_PLUS_KINDS,
  WALLET_UNIT_NAMES,
  WALLET_UNIT_PRICED_KINDS,
  walletMajorToMinor,
  type UpdateWalletUsageSettingsInput,
  type WalletUsageSettings,
} from '@crm/contracts';
import { PlatformSettingsService } from '../auth';
import { WalletLogService } from './wallet-log.service';
import { SETTING_KEYS, WalletSettingsService } from './wallet-settings.service';
import { mergeUsageRates, type UsageRates } from './usage-rules';

const CACHE_MS = 15_000;

/**
 * Typed access to what SMS, email, calls, AI, translation and the other usages cost (the `wallet.usage_rates` platform setting).
 * Every write is one transaction with its platform-log row carrying the old and new values, like the rest of the wallet settings.
 * Read on every settlement, so the merged rates are held for a few seconds per process; a save drops this process's copy at once.
 */
@Injectable()
export class UsageSettingsService {
  private cache: { at: number; rates: UsageRates } | null = null;

  constructor(
    private readonly platform: PlatformSettingsService,
    private readonly settings: WalletSettingsService,
    private readonly log: WalletLogService,
  ) {}

  /** Drops this process's copy of the rates (a write elsewhere, or a test that edits the setting directly). */
  invalidate(): void {
    this.cache = null;
  }

  async rates(): Promise<UsageRates> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rates;
    const stored = await this.platform.get<unknown>(SETTING_KEYS.usageRates);
    const rates = mergeUsageRates(stored);
    this.cache = { at: Date.now(), rates };
    return rates;
  }

  async view(): Promise<WalletUsageSettings> {
    const [rates, currency] = await Promise.all([this.rates(), this.settings.currency()]);
    const updated = await this.platform.inTx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT updated_at AS at FROM platform_settings WHERE key = ${SETTING_KEYS.usageRates}`,
      );
      return (res.rows[0] as { at: Date | null } | undefined)?.at ?? null;
    });
    return {
      currency,
      prices: WALLET_UNIT_PRICED_KINDS.map((kind) => ({
        kind,
        enabled: rates.prices[kind].enabled,
        priceMinor: rates.prices[kind].priceMinor,
        unit: WALLET_UNIT_NAMES[kind],
      })),
      costPlus: WALLET_COST_PLUS_KINDS.map((kind) => ({
        kind,
        enabled: rates.costPlus[kind].enabled,
      })),
      markupBps: rates.markupBps,
      updatedAt: updated ? new Date(updated).toISOString() : null,
    };
  }

  async save(
    input: UpdateWalletUsageSettingsInput,
    operator: { id: number; label: string },
  ): Promise<void> {
    const before = await this.rates();
    const next: UsageRates = {
      prices: { ...before.prices },
      costPlus: { ...before.costPlus },
      markupBps: before.markupBps,
    };
    for (const p of input.prices ?? []) {
      const current = next.prices[p.kind];
      next.prices[p.kind] = {
        enabled: p.enabled ?? current.enabled,
        priceMinor:
          p.price !== undefined
            ? (walletMajorToMinor(p.price) ?? current.priceMinor)
            : current.priceMinor,
      };
    }
    for (const c of input.costPlus ?? []) next.costPlus[c.kind] = { enabled: c.enabled };
    if (input.markupBps !== undefined) next.markupBps = input.markupBps;

    const changed: Record<string, { old: unknown; new: unknown }> = {};
    for (const kind of WALLET_UNIT_PRICED_KINDS) {
      if (JSON.stringify(before.prices[kind]) !== JSON.stringify(next.prices[kind])) {
        changed[kind] = { old: before.prices[kind], new: next.prices[kind] };
      }
    }
    for (const kind of WALLET_COST_PLUS_KINDS) {
      if (before.costPlus[kind].enabled !== next.costPlus[kind].enabled) {
        changed[kind] = { old: before.costPlus[kind], new: next.costPlus[kind] };
      }
    }
    if (before.markupBps !== next.markupBps) {
      changed.markupBps = { old: before.markupBps, new: next.markupBps };
    }

    await this.platform.inTx(async (tx) => {
      await this.put(tx, next, operator.id);
      await this.log.platform(tx, {
        event: 'platform.usage_rates.saved',
        message: `Usage prices saved: ${Object.keys(changed).join(', ') || 'no change'}`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: changed,
      });
    });
    this.cache = null;
  }

  private async put(tx: Tx, value: UsageRates, operatorId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
      VALUES (${SETTING_KEYS.usageRates}, ${JSON.stringify(value)}::jsonb, false, ${operatorId}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, is_secret = false, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  }
}
