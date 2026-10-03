import type { CatalogSummary } from '@crm/contracts';
import { readAutomation } from './catalog-automation';
import type { CatalogRow } from './catalogs.repository';

/** The catalog on the wire: ids become uuids and the access token is not part of the shape, whatever the row holds. */
export function toCatalogSummary(c: CatalogRow): CatalogSummary {
  return {
    id: c.uuid,
    provider: c.provider,
    catalogId: c.catalogId,
    catalogName: c.catalogName,
    wabaId: c.wabaId,
    phoneNumberId: c.phoneNumberId,
    isCartEnabled: c.isCartEnabled,
    isCatalogVisible: c.isCatalogVisible,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
    automation: readAutomation(c.metaJson),
    rowVersion: c.rowVersion,
    createdAt: c.createdAt.toISOString(),
  };
}
