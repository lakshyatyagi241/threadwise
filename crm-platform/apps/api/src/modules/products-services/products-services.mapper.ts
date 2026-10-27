import type { SalesItem } from '@crm/contracts';
import type { SalesItemRow } from './products-services.repository';

export function toSalesItem(row: SalesItemRow): SalesItem {
  return {
    id: row.uuid,
    kind: row.kind,
    name: row.name,
    sku: row.sku,
    description: row.description,
    unit: row.unit,
    unitPriceMinor: row.unitPriceMinor,
    currency: row.currency,
    taxRatePercent: row.taxRatePercent,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}
