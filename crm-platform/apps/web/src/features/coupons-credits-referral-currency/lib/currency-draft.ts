import {
  createCurrencyRequestSchema,
  type CreateCurrencyPayload,
  type CurrencyItem,
} from '@crm/contracts';

/** The add / edit currency form's state. */
export interface CurrencyDraft {
  name: string;
  code: string;
  symbol: string;
  precision: string;
  exchangeRate: string;
  isActive: boolean;
}

export const newCurrencyDraft = (): CurrencyDraft => ({
  name: '',
  code: '',
  symbol: '',
  precision: '2',
  exchangeRate: '1',
  isActive: true,
});

export const currencyToDraft = (c: CurrencyItem): CurrencyDraft => ({
  name: c.name,
  code: c.code,
  symbol: c.symbol ?? '',
  precision: String(c.precision),
  exchangeRate: c.exchangeRate,
  isActive: c.isActive,
});

export type CurrencyField = 'name' | 'code' | 'symbol' | 'precision' | 'exchangeRate';
const FIELDS: readonly CurrencyField[] = ['name', 'code', 'symbol', 'precision', 'exchangeRate'];

export type CurrencyBuildResult =
  { ok: true; body: CreateCurrencyPayload } | { ok: false; problems: CurrencyField[] };

/** Validates with the same schema the API uses; returns the request body or the fields to flag, in form order. */
export function buildCurrencyRequest(d: CurrencyDraft): CurrencyBuildResult {
  const parsed = createCurrencyRequestSchema.safeParse({
    name: d.name,
    code: d.code,
    symbol: d.symbol,
    precision: /^\d+$/.test(d.precision.trim()) ? Number(d.precision.trim()) : Number.NaN,
    exchangeRate: d.exchangeRate,
    isActive: d.isActive,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const bad = new Set<CurrencyField>();
  for (const issue of parsed.error.issues) {
    const root = String(issue.path[0]) as CurrencyField;
    if (FIELDS.includes(root)) bad.add(root);
  }
  return { ok: false, problems: FIELDS.filter((f) => bad.has(f)) };
}
