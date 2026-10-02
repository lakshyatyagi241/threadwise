import type { PaygwGatewayItem, UpdatePaygwGatewayRequest } from '@crm/contracts';

/** What the operator has typed into one card. Secrets exist here only while typing; they are never read back from the API. */
export interface GatewayDraft {
  mode: 'sandbox' | 'live';
  sortOrder: string;
  currencies: string[];
  /** key -> typed value. */
  values: Record<string, string>;
  /** keys the operator asked to remove. */
  cleared: string[];
}

export const draftFrom = (g: PaygwGatewayItem): GatewayDraft => ({
  mode: g.mode,
  sortOrder: String(g.sortOrder),
  currencies: [...g.supportedCurrencies],
  values: {},
  cleared: [],
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function isDirty(g: PaygwGatewayItem, d: GatewayDraft): boolean {
  return (
    d.mode !== g.mode ||
    d.sortOrder.trim() !== String(g.sortOrder) ||
    !sameSet(d.currencies, g.supportedCurrencies) ||
    d.cleared.length > 0 ||
    Object.values(d.values).some((v) => v.trim() !== '')
  );
}

/** The PATCH body. Blank inputs are left out so a stored secret survives; a field typed AND cleared counts as typed. */
export function buildUpdate(g: PaygwGatewayItem, d: GatewayDraft): UpdatePaygwGatewayRequest {
  const credentials = Object.fromEntries(
    Object.entries(d.values).filter(([, v]) => v.trim() !== ''),
  );
  const sort = Number.parseInt(d.sortOrder, 10);
  return {
    mode: d.mode,
    sortOrder: Number.isFinite(sort) && sort >= 0 ? sort : g.sortOrder,
    supportedCurrencies: d.currencies,
    credentials,
    clearCredentials: d.cleared.filter((k) => !(k in credentials)),
    rowVersion: g.rowVersion,
  };
}
