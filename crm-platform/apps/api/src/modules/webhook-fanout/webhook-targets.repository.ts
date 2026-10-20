import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlatformStore } from '../auth';
import type { DeliveryTarget } from './deliver';
import { setCapped } from '../../common/cache/capped-map';

export interface TargetRow {
  id: number;
  uuid: string;
  name: string;
  url: string;
  auth_header_name: string | null;
  auth_header_value: string | null;
  auth_header_last4: string | null;
  is_active: boolean;
  field_filter: string[] | null;
  timeout_ms: number;
  max_attempts: number;
  success_count: number | string;
  failure_count: number | string;
  last_status: number | null;
  last_error: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  row_version: number;
  updated_at: string;
}

export const TARGET_COLUMNS = sql.raw(
  'id, uuid, name, url, auth_header_name, auth_header_value, auth_header_last4, is_active, field_filter, timeout_ms, ' +
    'max_attempts, success_count, failure_count, last_status, last_error, last_success_at, last_failure_at, row_version, updated_at',
);

/** At most this many targets are remembered per process; the oldest goes first. */
export const WEBHOOK_TARGET_CACHE_MAX = 500;

/** Target config as the delivery path needs it, cached briefly so a burst of webhooks is not a burst of queries. */
@Injectable()
export class WebhookTargetsRepository {
  private readonly cache = new Map<number, { at: number; target: DeliveryTarget | null }>();

  constructor(
    private readonly store: PlatformStore,
    private readonly crypto: CryptoService,
  ) {}

  /** `null` when the target was deleted or switched off since the job was queued. */
  async deliveryTarget(id: number, ttlMs = 10_000): Promise<DeliveryTarget | null> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < ttlMs) return hit.target;
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${TARGET_COLUMNS} FROM webhook_forward_targets WHERE id = ${id}`,
      );
      return res.rows[0] as unknown as TargetRow | undefined;
    });
    const target = row && row.is_active ? this.toDelivery(row) : null;
    setCapped(this.cache, id, { at: Date.now(), target }, WEBHOOK_TARGET_CACHE_MAX);
    return target;
  }

  toDelivery(row: TargetRow): DeliveryTarget {
    return {
      url: row.url,
      timeoutMs: row.timeout_ms,
      authHeaderName: row.auth_header_name,
      authHeaderValue: row.auth_header_value ? this.crypto.decrypt(row.auth_header_value) : null,
    };
  }

  forget(id?: number): void {
    if (id === undefined) this.cache.clear();
    else this.cache.delete(id);
  }
}
