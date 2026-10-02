import {
  createCurrencyRequestSchema,
  updateCurrencyRequestSchema,
  CURRENCY_LIMITS,
  type CurrencyItem,
} from '@crm/contracts';
import type { z } from 'zod';
import { ApiError } from '@/lib/api/errors';

/** What the add and edit forms hold: text for every field, as typed. */
export interface CurrencyDraft {
  name: string;
  code: string;
  symbol: string;
  precision: string;
  exchangeRate: string;
  isActive: boolean;
}

export const CURRENCY_FIELDS = ['name', 'code', 'symbol', 'precision', 'exchangeRate'] as const;
export type CurrencyField = (typeof CURRENCY_FIELDS)[number];
/** The fields to flag; `codeTaken` says the flagged code is a duplicate rather than malformed. */
export type CurrencyProblems = Partial<Record<CurrencyField, true>> & { codeTaken?: true };

/** Reference's add form: decimals 2, rate 1 and "Active immediately" checked. */
export const emptyCurrencyDraft = (): CurrencyDraft => ({
  name: '',
  code: '',
  symbol: '',
  precision: '2',
  exchangeRate: '1',
  isActive: true,
});

export const toEditDraft = (c: CurrencyItem): CurrencyDraft => ({
  name: c.name,
  code: c.code,
  symbol: c.symbol ?? '',
  precision: String(c.precision),
  exchangeRate: c.exchangeRate,
  isActive: c.isActive,
});

/** The code field shows capitals as the person types (Reference styles it uppercase; the saved value is uppercase too). */
export const normaliseCode = (raw: string): string =>
  raw.toUpperCase().slice(0, CURRENCY_LIMITS.codeMax);

/** A whole number from the text, or NaN (which the contract refuses). Blank is not zero. */
function wholeNumber(text: string): number {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** The text of a rate as the contract wants it: no exponent, no thousands separators. */
const rateText = (text: string): string => text.trim();

export type CreateBody = z.input<typeof createCurrencyRequestSchema>;
export type UpdateBody = z.input<typeof updateCurrencyRequestSchema>;

export type CreateCheck =
  { ok: true; body: CreateBody } | { ok: false; problems: CurrencyProblems };

function problemsOf(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }>,
): CurrencyProblems {
  const problems: CurrencyProblems = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((CURRENCY_FIELDS as readonly unknown[]).includes(field)) {
      problems[field as CurrencyField] = true;
    }
  }
  return problems;
}

/** Validates the add form with the API's own schema and builds the request body (code upper-cased, empty symbol left out). */
export function checkCreate(draft: CurrencyDraft): CreateCheck {
  const body: CreateBody = {
    name: draft.name,
    code: draft.code,
    precision: wholeNumber(draft.precision),
    exchangeRate: rateText(draft.exchangeRate),
    isActive: draft.isActive,
    ...(draft.symbol.trim() ? { symbol: draft.symbol.trim() } : {}),
  };
  const parsed = createCurrencyRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  return { ok: true, body: { ...body, code: parsed.data.code, name: parsed.data.name } };
}

export type EditCheck = { ok: true; body: UpdateBody } | { ok: false; problems: CurrencyProblems };

/** The inline edit: everything but the code, with the row version the person saw. */
export function checkEdit(draft: CurrencyDraft, rowVersion: number): EditCheck {
  const body: UpdateBody = {
    name: draft.name,
    symbol: draft.symbol.trim() === '' ? null : draft.symbol.trim(),
    precision: wholeNumber(draft.precision),
    exchangeRate: rateText(draft.exchangeRate),
    isActive: draft.isActive,
    rowVersion,
  };
  const parsed = updateCurrencyRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  return { ok: true, body };
}

export type SubmitError =
  { kind: 'stale' } | { kind: 'fields'; problems: CurrencyProblems } | { kind: 'other' };

/** What a refused save means for the form: a stale version, fields the server named, or something the banner explains. */
export function submitError(err: unknown): SubmitError {
  if (!(err instanceof ApiError)) return { kind: 'other' };
  if (err.isRowVersionConflict) return { kind: 'stale' };
  if (err.code === 'CPN_CURRENCY_CODE_TAKEN')
    return { kind: 'fields', problems: { code: true, codeTaken: true } };
  if (err.fieldErrors.length > 0) {
    const problems = problemsOf(err.fieldErrors.map((e) => ({ path: e.path.split('.') })));
    if (Object.keys(problems).length > 0) return { kind: 'fields', problems };
  }
  return { kind: 'other' };
}
