import { bigint, customType, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Column primitives shared by every table. The SQL migrations are the source
 * of truth for the schema; this layer exists so queries are typed.
 */

/** Case-insensitive text. Used for every email column. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** Full-text search vector. Trigger-maintained, never written by the app. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * Internal id.
 *
 * mode:'number' rather than 'bigint': ids are consumed as JS numbers
 * throughout, and 2^53 rows in one tenant is not a problem this system will
 * have. If a stream table ever approaches it, switch that table to
 * mode:'bigint' — the change is local to its schema file.
 */
export const idColumn = (name: string) => bigint(name, { mode: 'number' });

export const orgIdColumn = () => bigint('org_id', { mode: 'number' }).notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Optimistic lock counter. Incremented by the touch_row() trigger, never by the app. */
export const rowVersion = () => integer('row_version').notNull().default(1);

/** Tier-2 custom-field storage. Keys are defined per org in `fields` metadata. */
export const dataJsonb = () => jsonb('data').$type<Record<string, unknown>>().notNull().default({});
