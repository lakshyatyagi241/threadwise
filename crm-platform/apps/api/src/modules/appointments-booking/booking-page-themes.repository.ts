import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  BookingPageAssetRef,
  BookingPageAssetSlot,
  BookingPageBackground,
  BookingPageCorner,
  BookingPageFont,
  BookingPageMode,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const b = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));

/** The appearance columns of a row, in the order every statement below lists them. */
export interface ThemeValues {
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  backgroundStyle: BookingPageBackground | null;
  pageTitle: string | null;
  welcomeText: string | null;
  buttonLabel: string | null;
  font: BookingPageFont | null;
  cornerStyle: BookingPageCorner | null;
  colorMode: BookingPageMode | null;
  showPoweredBy: boolean | null;
  showLanguageSwitch: boolean | null;
  useWorkspaceBrand: boolean;
}

export interface ThemeRow extends ThemeValues {
  id: number;
  uuid: string;
  /** Null: the workspace default. */
  bookingTypeId: number | null;
  rowVersion: number;
  updatedAt: string;
  logo: BookingPageAssetRef | null;
  cover: BookingPageAssetRef | null;
}

const toValues = (r: Raw): ThemeValues => ({
  primaryColor: s(r.primary_color),
  accentColor: s(r.accent_color),
  backgroundColor: s(r.background_color),
  backgroundStyle: s(r.background_style) as BookingPageBackground | null,
  pageTitle: s(r.page_title),
  welcomeText: s(r.welcome_text),
  buttonLabel: s(r.button_label),
  font: s(r.font) as BookingPageFont | null,
  cornerStyle: s(r.corner_style) as BookingPageCorner | null,
  colorMode: s(r.color_mode) as BookingPageMode | null,
  showPoweredBy: b(r.show_powered_by),
  showLanguageSwitch: b(r.show_language_switch),
  useWorkspaceBrand: r.use_workspace_brand !== false,
});

const COLUMNS = sql`id, uuid, booking_type_id, primary_color, accent_color, background_color, background_style, page_title,
  welcome_text, button_label, font, corner_style, color_mode, show_powered_by, show_language_switch, use_workspace_brand,
  row_version, updated_at`;

/** The theme rows and their pictures. Every statement is scoped by `org_id` on top of the transaction's row level security. */
@Injectable()
export class BookingPageThemesRepository {
  /** Every theme row of the workspace (the default and the services' overrides) with its pictures. */
  async all(tx: Tx, orgId: number): Promise<ThemeRow[]> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM booking_page_themes WHERE org_id = ${orgId} ORDER BY id`,
    );
    const rows = res.rows as Raw[];
    const pics = await this.pictures(tx, orgId);
    return rows.map((r) => this.row(r, pics.get(Number(r.id))));
  }

  async find(
    tx: Tx,
    orgId: number,
    bookingTypeId: number | null,
    lock = false,
  ): Promise<ThemeRow | undefined> {
    const where =
      bookingTypeId === null
        ? sql`booking_type_id IS NULL`
        : sql`booking_type_id = ${bookingTypeId}`;
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM booking_page_themes WHERE org_id = ${orgId} AND ${where} ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    const r = (res.rows as Raw[])[0];
    if (!r) return undefined;
    const pics = await this.pictures(tx, orgId, [Number(r.id)]);
    return this.row(r, pics.get(Number(r.id)));
  }

  /**
   * Writes the values of a scope. `expected` is the row version the editor read: null means "nothing was saved", so the row is
   * created, and a row that appeared meanwhile is a conflict. Returns undefined on a conflict.
   */
  async save(
    tx: Tx,
    orgId: number,
    bookingTypeId: number | null,
    v: ThemeValues,
    expected: number | null,
  ): Promise<number | undefined> {
    if (expected === null) {
      const conflict =
        bookingTypeId === null
          ? sql`ON CONFLICT (org_id) WHERE booking_type_id IS NULL DO NOTHING`
          : sql`ON CONFLICT (org_id, booking_type_id) WHERE booking_type_id IS NOT NULL DO NOTHING`;
      const res = await tx.execute(sql`
        INSERT INTO booking_page_themes (org_id, booking_type_id, primary_color, accent_color, background_color, background_style,
          page_title, welcome_text, button_label, font, corner_style, color_mode, show_powered_by, show_language_switch, use_workspace_brand)
        VALUES (${orgId}, ${bookingTypeId}, ${v.primaryColor}, ${v.accentColor}, ${v.backgroundColor}, ${v.backgroundStyle},
          ${v.pageTitle}, ${v.welcomeText}, ${v.buttonLabel}, ${v.font}, ${v.cornerStyle}, ${v.colorMode}, ${v.showPoweredBy},
          ${v.showLanguageSwitch}, ${v.useWorkspaceBrand})
        ${conflict}
        RETURNING id`);
      const r = (res.rows as Raw[])[0];
      return r ? Number(r.id) : undefined;
    }
    const where =
      bookingTypeId === null
        ? sql`booking_type_id IS NULL`
        : sql`booking_type_id = ${bookingTypeId}`;
    const res = await tx.execute(sql`
      UPDATE booking_page_themes SET primary_color = ${v.primaryColor}, accent_color = ${v.accentColor},
        background_color = ${v.backgroundColor}, background_style = ${v.backgroundStyle}, page_title = ${v.pageTitle},
        welcome_text = ${v.welcomeText}, button_label = ${v.buttonLabel}, font = ${v.font}, corner_style = ${v.cornerStyle},
        color_mode = ${v.colorMode}, show_powered_by = ${v.showPoweredBy}, show_language_switch = ${v.showLanguageSwitch},
        use_workspace_brand = ${v.useWorkspaceBrand}
      WHERE org_id = ${orgId} AND ${where} AND row_version = ${expected}
      RETURNING id`);
    const r = (res.rows as Raw[])[0];
    return r ? Number(r.id) : undefined;
  }

  /** The row for a scope, created empty when there is none (a picture can be uploaded before anything else is saved). */
  async ensure(tx: Tx, orgId: number, bookingTypeId: number | null): Promise<number> {
    const conflict =
      bookingTypeId === null
        ? sql`ON CONFLICT (org_id) WHERE booking_type_id IS NULL DO NOTHING`
        : sql`ON CONFLICT (org_id, booking_type_id) WHERE booking_type_id IS NOT NULL DO NOTHING`;
    await tx.execute(
      sql`INSERT INTO booking_page_themes (org_id, booking_type_id) VALUES (${orgId}, ${bookingTypeId}) ${conflict}`,
    );
    const row = await this.find(tx, orgId, bookingTypeId, true);
    return row!.id;
  }

  /** Moves the row's version, so an editor that read before a picture changed is told when it saves. */
  async touch(tx: Tx, orgId: number, themeId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE booking_page_themes SET updated_at = now() WHERE org_id = ${orgId} AND id = ${themeId}`,
    );
  }

  async remove(tx: Tx, orgId: number, bookingTypeId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM booking_page_themes WHERE org_id = ${orgId} AND booking_type_id = ${bookingTypeId} RETURNING id`,
    );
    return (res.rows as Raw[]).length > 0;
  }

  // --- pictures -------------------------------------------------------------------------------------------------------------

  private async pictures(
    tx: Tx,
    orgId: number,
    themeIds?: number[],
  ): Promise<Map<number, Partial<Record<BookingPageAssetSlot, BookingPageAssetRef>>>> {
    const filter = themeIds ? sql`AND theme_id = ANY(${themeIds}::bigint[])` : sql``;
    const res = await tx.execute(
      sql`SELECT theme_id, slot, uuid, etag FROM booking_page_assets WHERE org_id = ${orgId} ${filter}`,
    );
    const out = new Map<number, Partial<Record<BookingPageAssetSlot, BookingPageAssetRef>>>();
    for (const r of res.rows as Raw[]) {
      const id = Number(r.theme_id);
      const cur = out.get(id) ?? {};
      cur[r.slot as BookingPageAssetSlot] = { id: r.uuid as string, v: r.etag as string };
      out.set(id, cur);
    }
    return out;
  }

  async putPicture(
    tx: Tx,
    orgId: number,
    themeId: number,
    slot: BookingPageAssetSlot,
    mime: string,
    bytes: Buffer,
    etag: string,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO booking_page_assets (org_id, theme_id, slot, mime, bytes, etag)
      VALUES (${orgId}, ${themeId}, ${slot}, ${mime}, ${bytes}, ${etag})
      ON CONFLICT (org_id, theme_id, slot) DO UPDATE
        SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, etag = EXCLUDED.etag`);
  }

  async removePicture(
    tx: Tx,
    orgId: number,
    themeId: number,
    slot: BookingPageAssetSlot,
  ): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM booking_page_assets WHERE org_id = ${orgId} AND theme_id = ${themeId} AND slot = ${slot} RETURNING id`,
    );
    return (res.rows as Raw[]).length > 0;
  }

  /** A picture by its public id (the address a visitor's browser asks for). */
  async readPicture(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ mime: string; bytes: Buffer; etag: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT mime, bytes, etag FROM booking_page_assets WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    return (res.rows as unknown as Array<{ mime: string; bytes: Buffer; etag: string }>)[0];
  }

  // --- the workspace brand kit (Settings, Branding) --------------------------------------------------------------------------

  /** The brand kit's colours as saved on the workspace. They are validated again before use (`brandColor`). */
  async brandSettings(tx: Tx, orgId: number): Promise<Raw> {
    const res = await tx.execute(
      sql`SELECT settings -> 'branding' AS branding FROM organizations WHERE id = ${orgId}`,
    );
    const v = (res.rows as Raw[])[0]?.branding;
    return v && typeof v === 'object' ? (v as Raw) : {};
  }

  async brandLogoEtag(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT etag FROM workspace_brand_assets WHERE org_id = ${orgId} AND slot = 'logo'`,
    );
    return s((res.rows as Raw[])[0]?.etag);
  }

  async readBrandLogo(
    tx: Tx,
    orgId: number,
  ): Promise<{ mime: string; bytes: Buffer; etag: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT mime, bytes, etag FROM workspace_brand_assets WHERE org_id = ${orgId} AND slot = 'logo'`,
    );
    return (res.rows as unknown as Array<{ mime: string; bytes: Buffer; etag: string }>)[0];
  }

  private row(r: Raw, pics?: Partial<Record<BookingPageAssetSlot, BookingPageAssetRef>>): ThemeRow {
    return {
      ...toValues(r),
      id: Number(r.id),
      uuid: r.uuid as string,
      bookingTypeId: r.booking_type_id === null ? null : Number(r.booking_type_id),
      rowVersion: Number(r.row_version),
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
      logo: pics?.logo ?? null,
      cover: pics?.cover ?? null,
    };
  }
}
