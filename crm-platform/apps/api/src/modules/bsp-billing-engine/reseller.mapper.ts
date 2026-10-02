import type { BspAllocation } from '@crm/contracts';
import type { PlatformAllocationRow } from './reseller-platform.reader';

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();

/**
 * The only place an allocation row becomes a response: snake_case to camelCase, the internal bigint ids dropped. `id` is the
 * allocation's uuid and `workspaceId` the organization's.
 */
export function toAllocation(row: PlatformAllocationRow): BspAllocation {
  return {
    id: row.uuid,
    workspaceId: row.org_uuid,
    workspaceName: row.org_name,
    workspaceBillingMode: row.bills_to_platform ? 'reseller' : 'meta_direct',
    wabaId: row.waba_id,
    allocationConfigId: row.allocation_config_id,
    creditSource: row.credit_source,
    currency: row.currency,
    status: row.status,
    lastError: row.last_error,
    attachedAt: iso(row.attached_at),
    revokedAt: iso(row.revoked_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    rowVersion: row.row_version,
  };
}
