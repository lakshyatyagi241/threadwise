import { Injectable } from '@nestjs/common';
import { cpnConfig } from '../../../config/domains/coupons-credits-referral-currency.env';
import { FxRatesError, type FxRatesPort } from './fx-rates.port';

/** open.er-api.com: free, no key, USD-based, `{ rates: { EUR: 0.92, ... } }`. */
@Injectable()
export class OpenErApiFxRates implements FxRatesPort {
  get name(): string {
    return new URL(cpnConfig().CPN_FX_RATES_URL).hostname;
  }

  async fetchUsdRates(): Promise<Record<string, number>> {
    const cfg = cpnConfig();
    let res: Response;
    try {
      res = await fetch(cfg.CPN_FX_RATES_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(cfg.CPN_FX_TIMEOUT_MS),
      });
    } catch (e) {
      throw new FxRatesError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new FxRatesError(`Rate provider returned HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { rates?: unknown } | null;
    const raw = body && typeof body.rates === 'object' && body.rates !== null ? body.rates : null;
    const rates: Record<string, number> = {};
    for (const [code, v] of Object.entries(raw ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) rates[code.toUpperCase()] = v;
    }
    if (Object.keys(rates).length === 0) throw new FxRatesError('Rate provider returned no rates.');
    return rates;
  }
}
