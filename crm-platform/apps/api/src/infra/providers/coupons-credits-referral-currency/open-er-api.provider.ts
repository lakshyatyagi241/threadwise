import { Injectable } from '@nestjs/common';
import { FxRateError, type FxRateProvider, type FxRates } from './fx-rate.port';

const TIMEOUT_MS = 12_000;

/** What a test points at instead of the real vendor. */
interface Transport {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * open.er-api.com: free, keyless, USD-based daily rates (the source Reference used). Twelve-second timeout, no retry: an operator who
 * sees a failure presses the button again. Rates are kept as the provider's own decimal text, rounded to six places.
 */
@Injectable()
export class OpenErApiProvider implements FxRateProvider {
  readonly name = 'open.er-api.com';

  /** Overridden in tests; the defaults are the real thing. */
  transport: Transport = {};

  async latest(): Promise<FxRates> {
    const url = `${this.transport.baseUrl ?? 'https://open.er-api.com'}/v6/latest/USD`;
    const fetchImpl = this.transport.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.transport.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (err) {
      throw new FxRateError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new FxRateError(`Rate provider returned HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new FxRateError('Rate provider returned no rates.');
    }
    const raw = (body as { rates?: unknown } | null)?.rates;
    if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
      throw new FxRateError('Rate provider returned no rates.');
    }
    const rates = new Map<string, string>();
    for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof value === 'number' ? value : Number(value);
      // A rate below the catalog's minimum (0.000001) cannot be stored; skip it rather than corrupt the row.
      if (Number.isFinite(n) && n >= 0.000001 && n < 1e10)
        rates.set(code.toUpperCase(), n.toFixed(6));
    }
    if (rates.size === 0) throw new FxRateError('Rate provider returned no rates.');
    return { provider: this.name, rates };
  }
}
