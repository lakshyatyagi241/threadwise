import type { DealResponse } from '@crm/contracts';

/** Open deals first, then the rest in the order the API gave them (newest first): WaDesk's order on the company page. */
export const openFirst = (deals: readonly DealResponse[]): DealResponse[] =>
  [...deals].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
