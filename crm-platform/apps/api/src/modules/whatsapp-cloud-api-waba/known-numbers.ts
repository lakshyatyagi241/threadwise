/**
 * The phone number ids and WABA ids of every WhatsApp connection this platform has, kept in memory and refreshed every few seconds.
 *
 * The public webhook is shared with other platforms on the same Meta app: on prod a handful of connections are ours and about 140
 * deliveries a second are for numbers that are not. Each of those cost a database lookup, a queue job and a worker pass before the worker
 * found "no workspace owns this number" and dropped it (waba_route_lookup, `webhook for an unknown number dropped`). A delivery whose
 * ids are all absent from this index would be dropped by that lookup too (it only reads these same two ids from `wa_provider_configs`),
 * so the receiver can answer it at once.
 *
 * It only ever errs towards "maybe known" (the answer a missing index gives): a number whose connection was added a moment ago is
 * treated as unknown for at most `ttlMs`, and a stale index after a failed refresh is still used rather than dropping everything.
 */
export interface KnownIds {
  phones: readonly string[];
  wabas: readonly string[];
}

export interface KnownSnapshot {
  /** Whether a connection owns a change that names these ids (the phone id routes it; without one, the WABA id does). */
  has(phoneNumberId: string | null | undefined, wabaId: string | null | undefined): boolean;
}

export class KnownNumbers {
  private current: { at: number; phones: Set<string>; wabas: Set<string> } | null = null;
  private failedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly load: () => Promise<KnownIds>,
    private readonly ttlMs = 5_000,
    /** After a failed load, how long to wait before trying again (a database that is down must not be asked once per delivery). */
    private readonly retryMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The index, or null when it has never loaded (the caller then treats every number as possibly known). `maxAgeMs` is how old it may
   * be: the receiver asks for a much younger one when a delivery names numbers the index does not know, so a connection added a moment
   * ago is found by its first delivery. A flood of foreign numbers then costs at most one small query per `maxAgeMs`, not one per delivery.
   */
  async snapshot(maxAgeMs = this.ttlMs): Promise<KnownSnapshot | null> {
    const t = this.now();
    const fresh = this.current !== null && t - this.current.at < maxAgeMs;
    const backingOff = this.failedAt !== 0 && t - this.failedAt < this.retryMs;
    if (!fresh && !backingOff) {
      this.loading ??= this.refresh().finally(() => {
        this.loading = null;
      });
      await this.loading;
    }
    return this.current ? this.view(this.current) : null;
  }

  private async refresh(): Promise<void> {
    try {
      const ids = await this.load();
      this.current = { at: this.now(), phones: new Set(ids.phones), wabas: new Set(ids.wabas) };
      this.failedAt = 0;
    } catch {
      this.failedAt = this.now();
    }
  }

  private view(s: { phones: Set<string>; wabas: Set<string> }): KnownSnapshot {
    // The same rule as waba_route_lookup: a change that names a number is routed by that number alone, one without by its WABA.
    return {
      has: (phone, waba) => (phone ? s.phones.has(phone) : waba ? s.wabas.has(waba) : false),
    };
  }
}
