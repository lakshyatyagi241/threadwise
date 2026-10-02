import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BspAllocationStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface AllocationRow {
  org_id: number;
  id: number;
  uuid: string;
  waba_id: string;
  allocation_config_id: string | null;
  credit_source: string | null;
  currency: string;
  status: BspAllocationStatus;
  last_error: string | null;
  attached_at: Date | null;
  revoked_at: Date | null;
  created_by_operator_id: number | null;
  created_at: Date;
  updated_at: Date;
  row_version: number;
}

export interface ConnectedWaba {
  waba_id: string;
  phone_number: string | null;
  display_label: string | null;
}

export interface AllocationWrite {
  orgId: number;
  wabaId: string;
  allocationConfigId: string | null;
  creditSource: string;
  currency: string;
  status: Exclude<BspAllocationStatus, 'revoked'>;
  lastError: string | null;
  operatorId: number | null;
}

const COLUMNS = sql`org_id, id, uuid, waba_id, allocation_config_id, credit_source, currency, status, last_error,
  attached_at, revoked_at, created_by_operator_id, created_at, updated_at, row_version`;

/**
 * Tenant-scoped SQL of the reseller module. Every method runs inside the transaction its caller opened for ONE organization
 * (`DatabaseService.txAs`), and still names the org in the predicate: RLS is the guarantee, the predicate keeps the plan indexed.
 * The cross-tenant reads live in `reseller-platform.reader.ts`, behind the platform door.
 */
@Injectable()
export class ResellerRepository {
  async allocationByWaba(tx: Tx, orgId: number, wabaId: string): Promise<AllocationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM bsp_credit_allocations WHERE org_id = ${orgId} AND waba_id = ${wabaId}
    `);
    return (res.rows[0] as unknown as AllocationRow | undefined) ?? null;
  }

  async allocationById(tx: Tx, orgId: number, id: number): Promise<AllocationRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM bsp_credit_allocations WHERE org_id = ${orgId} AND id = ${id}
    `);
    return (res.rows[0] as unknown as AllocationRow | undefined) ?? null;
  }

  async allocationsForOrg(tx: Tx, orgId: number): Promise<AllocationRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM bsp_credit_allocations WHERE org_id = ${orgId} ORDER BY id
    `);
    return res.rows as unknown as AllocationRow[];
  }

  /**
   * One row per (org, WABA): a failed or revoked row is retried in place (WD-BSP-006 rule 4). The update is skipped when the row
   * is already `attached`, so a slow failed attempt cannot overwrite a concurrent success; the caller then re-reads.
   */
  async upsertAllocation(tx: Tx, v: AllocationWrite): Promise<AllocationRow | null> {
    const attached = v.status === 'attached';
    const res = await tx.execute(sql`
      INSERT INTO bsp_credit_allocations
        (org_id, waba_id, allocation_config_id, credit_source, currency, status, last_error, attached_at, created_by_operator_id)
      VALUES (${v.orgId}, ${v.wabaId}, ${v.allocationConfigId}, ${v.creditSource}, ${v.currency}, ${v.status}, ${v.lastError},
              ${attached ? sql`now()` : sql`NULL`}, ${v.operatorId})
      ON CONFLICT (org_id, waba_id) DO UPDATE SET
        allocation_config_id = EXCLUDED.allocation_config_id,
        credit_source = EXCLUDED.credit_source,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        last_error = EXCLUDED.last_error,
        attached_at = EXCLUDED.attached_at,
        revoked_at = NULL,
        created_by_operator_id = COALESCE(EXCLUDED.created_by_operator_id, bsp_credit_allocations.created_by_operator_id)
      WHERE bsp_credit_allocations.status <> 'attached'
      RETURNING ${COLUMNS}
    `);
    return (res.rows[0] as unknown as AllocationRow | undefined) ?? null;
  }

  /** Optimistic: `expectedVersion` (when the caller sent one) must still be the row's version. Null = nothing updated. */
  async markRevoked(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
  ): Promise<AllocationRow | null> {
    const res = await tx.execute(sql`
      UPDATE bsp_credit_allocations
      SET status = 'revoked', revoked_at = now(), last_error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'attached'
        ${expectedVersion === undefined ? sql`` : sql`AND row_version = ${expectedVersion}`}
      RETURNING ${COLUMNS}
    `);
    return (res.rows[0] as unknown as AllocationRow | undefined) ?? null;
  }

  async setLastError(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE bsp_credit_allocations SET last_error = ${error} WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  /** The workspace's connected Cloud API numbers that carry a WABA id (WD-BSP-007 rule 3: rows without one are skipped). */
  async connectedWabas(tx: Tx, orgId: number): Promise<ConnectedWaba[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT ON (meta_json->>'waba_id')
             meta_json->>'waba_id' AS waba_id, phone_number, display_label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'
        AND COALESCE(meta_json->>'waba_id', '') <> ''
      ORDER BY meta_json->>'waba_id', id
    `);
    return res.rows as unknown as ConnectedWaba[];
  }

  async wabaIsConnected(tx: Tx, orgId: number, wabaId: string): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected' AND meta_json->>'waba_id' = ${wabaId}
      LIMIT 1
    `);
    return res.rows.length > 0;
  }

  async billsToPlatform(tx: Tx, orgId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT bill_to_platform_credit FROM workspace_settings WHERE org_id = ${orgId}
    `);
    return (
      (res.rows[0] as { bill_to_platform_credit?: boolean } | undefined)
        ?.bill_to_platform_credit === true
    );
  }

  /** The org may not have a settings row yet (sign-up does not create one); every other column has a default. */
  async setBillsToPlatform(tx: Tx, orgId: number, value: boolean): Promise<void> {
    await tx.execute(sql`
      INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES (${orgId}, ${value})
      ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = EXCLUDED.bill_to_platform_credit
    `);
  }

  async workspaceCurrency(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT currency FROM workspace_settings WHERE org_id = ${orgId}`,
    );
    return (res.rows[0] as { currency?: string | null } | undefined)?.currency ?? null;
  }

  /** Active rows of the global rate table (one tenant reads it freely: policy `read_all`). */
  async activeRates(
    tx: Tx,
  ): Promise<
    Array<{
      country_code: string;
      category: string;
      credits: number;
      meta_cost_minor: string | null;
    }>
  > {
    const res = await tx.execute(sql`
      SELECT country_code, category, credits, meta_cost_minor::text AS meta_cost_minor
      FROM message_rates WHERE is_active
    `);
    return res.rows as unknown as Array<{
      country_code: string;
      category: string;
      credits: number;
      meta_cost_minor: string | null;
    }>;
  }
}
