/**
 * Booking page appearance: mirrors migrations/20270125090000_booking_page_themes.sql (the SQL is the source of truth;
 * `pnpm db:verify-schema` fails if this file and the database disagree).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';
import { bookingTypes } from './tables';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** One row per scope: `bookingTypeId` null is the workspace default, a value is that service's override. NULL columns inherit. */
export const bookingPageThemes = pgTable(
  'booking_page_themes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bookingTypeId: idColumn('booking_type_id'),
    primaryColor: text('primary_color'),
    accentColor: text('accent_color'),
    backgroundColor: text('background_color'),
    backgroundStyle: text('background_style'),
    pageTitle: text('page_title'),
    welcomeText: text('welcome_text'),
    buttonLabel: text('button_label'),
    font: text('font'),
    cornerStyle: text('corner_style'),
    colorMode: text('color_mode'),
    showPoweredBy: boolean('show_powered_by'),
    showLanguageSwitch: boolean('show_language_switch'),
    useWorkspaceBrand: boolean('use_workspace_brand').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('booking_page_themes_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'booking_page_themes_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_booking_page_themes_booking_type_id',
      columns: [t.orgId, t.bookingTypeId],
      foreignColumns: [bookingTypes.orgId, bookingTypes.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_booking_page_themes_workspace')
      .on(t.orgId)
      .where(sql`${t.bookingTypeId} is null`),
    uniqueIndex('uq_booking_page_themes_type')
      .on(t.orgId, t.bookingTypeId)
      .where(sql`${t.bookingTypeId} is not null`),
    check(
      'chk_booking_page_themes_primary',
      sql`${t.primaryColor} is null or ${t.primaryColor} ~ '^#[0-9a-f]{6}$'`,
    ),
  ],
);
export type BookingPageThemesRow = typeof bookingPageThemes.$inferSelect;

export const bookingPageAssets = pgTable(
  'booking_page_assets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    themeId: idColumn('theme_id').notNull(),
    slot: text('slot').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    etag: text('etag').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('booking_page_assets_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_booking_page_assets_theme_slot').on(t.orgId, t.themeId, t.slot),
    foreignKey({
      name: 'booking_page_assets_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_booking_page_assets_theme_id',
      columns: [t.orgId, t.themeId],
      foreignColumns: [bookingPageThemes.orgId, bookingPageThemes.id],
    }).onDelete('cascade'),
  ],
);
export type BookingPageAssetsRow = typeof bookingPageAssets.$inferSelect;
