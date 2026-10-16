import type { CompanyDealRollup, CompanyResponse, CompanyRollup } from '@crm/contracts';
import { addTo, moneyList, type CurrencySums } from '../deals/deal-money';
import type { CompanyCounts, CompanyRow } from './companies.repository';

/** The deal figures of one company, per currency. Never one number over mixed currencies (Reference added raw minor units together). */
export function dealRollup(deals: CompanyCounts['deals']): CompanyDealRollup {
  const open: CurrencySums = new Map();
  const won: CurrencySums = new Map();
  const out = { total: 0, open: 0, won: 0 };
  for (const d of deals) {
    out.total += d.n;
    if (d.status === 'open') {
      out.open += d.n;
      addTo(open, d.currency, d.total);
    } else if (d.status === 'won') {
      out.won += d.n;
      addTo(won, d.currency, d.total);
    }
  }
  return { ...out, openValue: moneyList(open), wonValue: moneyList(won) };
}

/** What the caller may see: a kind of record they cannot read has no figure (`null`), not a zero. */
export function companyRollup(
  counts: CompanyCounts | undefined,
  can: { contacts: boolean; deals: boolean },
): CompanyRollup {
  return {
    contacts: can.contacts ? (counts?.contacts ?? 0) : null,
    deals: can.deals ? dealRollup(counts?.deals ?? []) : null,
  };
}

/** The mapper is the only place an internal id becomes a uuid. */
export function toCompanyResponse(row: CompanyRow, rollup: CompanyRollup): CompanyResponse {
  return {
    id: row.uuid,
    displayId: row.displayId,
    name: row.name,
    website: row.website,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    sizeRange: row.sizeRange,
    address: row.address,
    notes: row.notes,
    customFields: row.data,
    owner: row.ownerUuid ? { id: row.ownerUuid, name: row.ownerName ?? '' } : null,
    createdBy: row.createdByUuid ? { id: row.createdByUuid, name: row.createdByName ?? '' } : null,
    rollup,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The few fields an outbox event carries: identifiers and what a consumer decides on, not the whole row. */
export function companyEventPayload(row: CompanyRow): Record<string, unknown> {
  return {
    uuid: row.uuid,
    displayId: row.displayId,
    name: row.name,
    industry: row.industry,
    ownerId: row.ownerUuid,
    createdById: row.createdByUuid,
  };
}
