import { sql, type SQL } from 'drizzle-orm';

/** A `text[]` from a list of bind parameters (a bare JS array would be expanded into a row, not an array). */
export const textArray = (items: readonly string[]): SQL =>
  items.length === 0
    ? sql.raw('ARRAY[]::text[]')
    : sql`ARRAY[${sql.join(
        items.map((i) => sql`${i}`),
        sql`, `,
      )}]::text[]`;

export const jsonb = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`;

export const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(v as string)).toISOString();

export const toDate = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

const UNIQUE_VIOLATION = '23505';
export const isUniqueViolation = (e: unknown): boolean => {
  const c = (e as { code?: string; cause?: { code?: string } } | null) ?? {};
  return c.code === UNIQUE_VIOLATION || c.cause?.code === UNIQUE_VIOLATION;
};
