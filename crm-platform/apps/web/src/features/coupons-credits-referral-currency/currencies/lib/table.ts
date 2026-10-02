import { formatMoney, type CurrencyItem, type CurrencyOption } from '@crm/contracts';

/** The Rate column: the number only (the header says "1 USD →"), 4 decimals and thousands commas like Reference's number_format. */
export function rateCell(exchangeRate: string): string {
  return formatMoney(exchangeRate, { code: '', symbol: '', precision: 4, rate: '1' }).trim();
}

/** "CODE - name (symbol)": the label of an option in the default selector and the workspace currency select. */
export function optionLabel(o: CurrencyOption): string {
  return `${o.code} - ${o.name}${o.symbol ? ` (${o.symbol})` : ''}`;
}

/** The default currency can never be deleted; read-only operators get no write controls at all. */
export const canDeleteRow = (c: Pick<CurrencyItem, 'isDefault'>, canWrite: boolean): boolean =>
  canWrite && !c.isDefault;

/** The next value of the On/Off pill. */
export const toggleTarget = (c: Pick<CurrencyItem, 'isActive'>): boolean => !c.isActive;

/** Cursor pagination with Previous: the cursors of the pages visited, the first being `undefined`. */
export interface PageStack {
  cursors: ReadonlyArray<string | undefined>;
}
export const firstPage: PageStack = { cursors: [undefined] };
export const currentCursor = (s: PageStack): string | undefined => s.cursors[s.cursors.length - 1];
export const hasPrevious = (s: PageStack): boolean => s.cursors.length > 1;
export const goNext = (s: PageStack, nextCursor: string | null | undefined): PageStack =>
  nextCursor ? { cursors: [...s.cursors, nextCursor] } : s;
export const goPrevious = (s: PageStack): PageStack =>
  s.cursors.length > 1 ? { cursors: s.cursors.slice(0, -1) } : s;

/** "Showing a-b of N": 1-based, over the search's matches. Nothing to show gives 0-0. */
export function showingRange(
  stack: PageStack,
  pageSize: number,
  rows: number,
  total: number,
): { from: number; to: number; total: number } {
  if (rows === 0) return { from: 0, to: 0, total };
  const from = (stack.cursors.length - 1) * pageSize + 1;
  return { from, to: from + rows - 1, total };
}
