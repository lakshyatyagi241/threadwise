import { DEFAULT_FILTERS, PAGE_SIZES, type PageSize } from '../api/contacts';

/** localStorage key of the remembered rows-per-page choice. */
export const PAGE_SIZE_KEY = 'cat:contacts:pageSize';

/** The stored text as a page size; anything unknown (a removed option, junk, nothing) is `null`. */
export function parsePageSize(raw: string | null | undefined): PageSize | null {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : null;
}

/** The size to use when the URL does not say: the remembered one, else the app default. */
export const defaultPageSize = (raw: string | null | undefined): PageSize =>
  parsePageSize(raw) ?? DEFAULT_FILTERS.limit;
