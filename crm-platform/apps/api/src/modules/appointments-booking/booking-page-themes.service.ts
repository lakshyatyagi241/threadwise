import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BOOKING_PAGE_IMAGE_MIMES,
  BOOKING_PAGE_LIMITS,
  ERROR_CODES,
  type BookingPageAssetSlot,
  type BookingPageSettingsResponse,
  type BookingPageTheme,
  type PublicBookingTheme,
  type UpdateBookingPageThemeInput,
  type UpdateBookingTypePageThemeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { UploadPolicyService } from '../auth';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { BookingTypesRepository, type BookingTypeRow } from './booking-types.repository';
import {
  EMPTY_BRAND,
  EMPTY_LAYER,
  brandColor,
  layerOf,
  resolveTheme,
  themeDelta,
  type BrandKit,
  type ThemeLayer,
} from './booking-page-theme.rules';
import { BookingPageThemesCache } from './booking-page-themes.cache';
import {
  BookingPageThemesRepository,
  type ThemeRow,
  type ThemeValues,
} from './booking-page-themes.repository';

const MODULE = 'booking_page_themes';

/** What the public pages resolve from: every theme row of a workspace plus the brand kit and the plan flag. JSON, so it can be cached. */
interface Bundle {
  rows: Array<ThemeRow & { layer: ThemeLayer }>;
  brand: BrandKit;
  canRemovePoweredBy: boolean;
}

const MAX_BYTES: Record<BookingPageAssetSlot, number> = {
  logo: BOOKING_PAGE_LIMITS.logoBytes,
  cover: BOOKING_PAGE_LIMITS.coverBytes,
};

export interface UploadedPicture {
  originalname: string;
  buffer: Buffer;
}

/**
 * Booking page appearance (BL-355..BL-358). The workspace's theme and each service's override are rows of `booking_page_themes`; what a
 * visitor sees is `resolveTheme` over them (see `booking-page-theme.rules.ts`), cached per workspace and dropped on every save.
 *
 * Staff reads and writes go to the database directly (read your own write); only the public pages use the cache. Every save is one
 * transaction: the row (optimistic lock on the row version the editor read), the audit row and the outbox event.
 */
@Injectable()
export class BookingPageThemesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BookingPageThemesRepository,
    private readonly cache: BookingPageThemesCache,
    private readonly types: BookingTypesRepository,
    private readonly plan: PlanEntitlementService,
    private readonly uploads: UploadPolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- the public pages ---------------------------------------------------------------------------------------------------

  /** The look of the workspace's service chooser. */
  async forWorkspace(tx: Tx, orgId: number): Promise<PublicBookingTheme> {
    const bundle = await this.bundleCached(tx, orgId);
    return this.resolveFrom(bundle, null);
  }

  /** The look of one service's page (and of a manage page for a booking of that service). */
  async forType(tx: Tx, orgId: number, typeId: number | null): Promise<PublicBookingTheme> {
    const bundle = await this.bundleCached(tx, orgId);
    return this.resolveFrom(bundle, typeId);
  }

  /** A picture for a visitor: the workspace brand kit's logo (`brand-logo`) or an uploaded one, by its public id. */
  async picture(
    tx: Tx,
    orgId: number,
    id: string,
  ): Promise<{ mime: string; bytes: Buffer; etag: string } | undefined> {
    if (id === 'brand-logo') return this.repo.readBrandLogo(tx, orgId);
    return this.repo.readPicture(tx, orgId, id);
  }

  private resolveFrom(bundle: Bundle, typeId: number | null): PublicBookingTheme {
    const workspace = bundle.rows.find((r) => r.bookingTypeId === null)?.layer ?? null;
    const type =
      typeId === null ? null : (bundle.rows.find((r) => r.bookingTypeId === typeId)?.layer ?? null);
    return resolveTheme({
      type,
      workspace,
      brand: bundle.brand,
      canRemovePoweredBy: bundle.canRemovePoweredBy,
    });
  }

  private async bundleCached(tx: Tx, orgId: number): Promise<Bundle> {
    const hit = await this.cache.get<Bundle>(orgId);
    if (hit) return hit;
    const fresh = await this.bundle(tx, orgId);
    await this.cache.set(orgId, fresh);
    return fresh;
  }

  private async bundle(tx: Tx, orgId: number): Promise<Bundle> {
    const [rows, brand, canRemovePoweredBy] = await Promise.all([
      this.repo.all(tx, orgId),
      this.brand(tx, orgId),
      this.plan.featureEnabled(orgId, 'remove_branding'),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, layer: layerOf(r, { logo: r.logo, cover: r.cover }) })),
      brand,
      canRemovePoweredBy,
    };
  }

  private async brand(tx: Tx, orgId: number): Promise<BrandKit> {
    const [saved, etag] = await Promise.all([
      this.repo.brandSettings(tx, orgId),
      this.repo.brandLogoEtag(tx, orgId),
    ]);
    if (!saved && !etag) return EMPTY_BRAND;
    return {
      primary: brandColor(saved.primary),
      accent: brandColor(saved.accent),
      background: brandColor(saved.background),
      logo: etag && /^[0-9a-f]{8,64}$/.test(etag) ? { id: 'brand-logo', v: etag } : null,
    };
  }

  // --- staff: the workspace theme -----------------------------------------------------------------------------------------

  async getWorkspace(): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.view(tx, ctx.orgId, null));
  }

  async saveWorkspace(input: UpdateBookingPageThemeInput): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const canRemove = await this.plan.featureEnabled(ctx.orgId, 'remove_branding');
      // A plan without white-label branding cannot switch the "Powered by" line off; saying so beats saving a value that is ignored.
      if (input.showPoweredBy === false && !canRemove) {
        throw AppError.validation('Your plan does not include removing the "Powered by" line.', [
          { path: 'showPoweredBy', message: 'plan' },
        ]);
      }
      return this.write(tx, ctx.orgId, null, input, input.rowVersion);
    });
    await this.cache.drop(ctx.orgId);
    return out;
  }

  // --- staff: one service's override ----------------------------------------------------------------------------------------

  async getType(typeUuid: string): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      this.view(tx, ctx.orgId, await this.typeOf(tx, ctx.orgId, typeUuid)),
    );
  }

  async saveType(
    typeUuid: string,
    input: UpdateBookingTypePageThemeInput,
  ): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const type = await this.typeOf(tx, ctx.orgId, typeUuid);
      return this.write(tx, ctx.orgId, type, input, input.rowVersion);
    });
    await this.cache.drop(ctx.orgId);
    return out;
  }

  /** Back to the workspace look: the override and its pictures are deleted. */
  async resetType(typeUuid: string): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const type = await this.typeOf(tx, ctx.orgId, typeUuid);
      const was = await this.repo.find(tx, ctx.orgId, type.id, true);
      if (was) {
        await this.repo.remove(tx, ctx.orgId, type.id);
        await this.record(tx, ctx.orgId, was.id, 'delete', {}, type);
      }
      return this.view(tx, ctx.orgId, type);
    });
    await this.cache.drop(ctx.orgId);
    return out;
  }

  // --- staff: pictures --------------------------------------------------------------------------------------------------------

  async putPicture(
    typeUuid: string | null,
    slot: BookingPageAssetSlot,
    file: UploadedPicture,
  ): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    // Type and size are checked from the bytes (the file name is only a hint); SVG is refused because the file is served to the public.
    const ok = this.uploads.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image'],
      maxBytes: MAX_BYTES[slot],
    });
    if (!(BOOKING_PAGE_IMAGE_MIMES as readonly string[]).includes(ok.mime)) {
      throw new AppError(
        ERROR_CODES.AUTH_UPLOAD_REJECTED,
        'Use a PNG, JPG, WebP or GIF image.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'file', message: 'type_not_allowed' }],
      );
    }
    const etag = createHash('sha256').update(file.buffer).digest('hex').slice(0, 24);
    const out = await this.db.tx(async (tx) => {
      const type = typeUuid ? await this.typeOf(tx, ctx.orgId, typeUuid) : null;
      const themeId = await this.repo.ensure(tx, ctx.orgId, type?.id ?? null);
      await this.repo.putPicture(tx, ctx.orgId, themeId, slot, ok.mime, file.buffer, etag);
      await this.repo.touch(tx, ctx.orgId, themeId);
      await this.record(
        tx,
        ctx.orgId,
        themeId,
        'update',
        { [slot]: { old: null, new: 'uploaded' } },
        type,
      );
      return this.view(tx, ctx.orgId, type);
    });
    await this.cache.drop(ctx.orgId);
    return out;
  }

  async removePicture(
    typeUuid: string | null,
    slot: BookingPageAssetSlot,
  ): Promise<BookingPageSettingsResponse> {
    const ctx = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const type = typeUuid ? await this.typeOf(tx, ctx.orgId, typeUuid) : null;
      const row = await this.repo.find(tx, ctx.orgId, type?.id ?? null, true);
      if (row && (await this.repo.removePicture(tx, ctx.orgId, row.id, slot))) {
        await this.repo.touch(tx, ctx.orgId, row.id);
        await this.record(
          tx,
          ctx.orgId,
          row.id,
          'update',
          { [slot]: { old: 'uploaded', new: null } },
          type,
        );
      }
      return this.view(tx, ctx.orgId, type);
    });
    await this.cache.drop(ctx.orgId);
    return out;
  }

  // --- internals -----------------------------------------------------------------------------------------------------------------

  private async typeOf(tx: Tx, orgId: number, uuid: string): Promise<BookingTypeRow> {
    const type = await this.types.findByUuid(tx, orgId, uuid);
    if (!type) throw AppError.notFound('Booking type', uuid);
    return type;
  }

  private async write(
    tx: Tx,
    orgId: number,
    type: BookingTypeRow | null,
    input: UpdateBookingPageThemeInput | UpdateBookingTypePageThemeInput,
    expected: number | null,
  ): Promise<BookingPageSettingsResponse> {
    const before = await this.repo.find(tx, orgId, type?.id ?? null, true);
    if ((before?.rowVersion ?? null) !== expected)
      throw AppError.rowVersionConflict('Booking page theme');
    const values = this.valuesOf(input, before);
    const id = await this.repo.save(tx, orgId, type?.id ?? null, values, expected);
    if (id === undefined) throw AppError.rowVersionConflict('Booking page theme');
    await this.record(
      tx,
      orgId,
      id,
      before ? 'update' : 'insert',
      themeDelta(before ?? null, values),
      type,
    );
    return this.view(tx, orgId, type);
  }

  /**
   * A service override carries only part of the fields: the rest of its row stays empty (it inherits), so a save from the service
   * editor can never set a font, corners or the workspace's "Powered by" line on one service.
   */
  private valuesOf(
    input: UpdateBookingPageThemeInput | UpdateBookingTypePageThemeInput,
    before: ThemeRow | undefined,
  ): ThemeValues {
    const full = 'font' in input;
    const v = input as Partial<UpdateBookingPageThemeInput>;
    return {
      primaryColor: input.primaryColor ?? null,
      accentColor: input.accentColor ?? null,
      backgroundColor: full ? (v.backgroundColor ?? null) : null,
      backgroundStyle: input.backgroundStyle ?? null,
      pageTitle: full ? (v.pageTitle ?? null) : null,
      welcomeText: input.welcomeText ?? null,
      buttonLabel: input.buttonLabel ?? null,
      font: full ? (v.font ?? null) : null,
      cornerStyle: full ? (v.cornerStyle ?? null) : null,
      colorMode: full ? (v.colorMode ?? null) : null,
      showPoweredBy: full ? (v.showPoweredBy ?? null) : null,
      showLanguageSwitch: full ? (v.showLanguageSwitch ?? null) : null,
      useWorkspaceBrand: full ? (v.useWorkspaceBrand ?? true) : (before?.useWorkspaceBrand ?? true),
    };
  }

  private async record(
    tx: Tx,
    orgId: number,
    themeId: number,
    action: 'insert' | 'update' | 'delete',
    delta: Record<string, { old: unknown; new: unknown }>,
    type: BookingTypeRow | null,
  ): Promise<void> {
    await this.audit.record(tx, { module: MODULE, recordId: themeId, action, delta });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: MODULE,
      aggregateId: themeId,
      eventType: 'booking_page_theme.updated',
      payload: { scope: type ? 'type' : 'workspace', bookingTypeId: type?.uuid ?? null },
    });
  }

  /** The editor's view of one scope: what is saved, what a visitor sees, and what an empty field would inherit. */
  private async view(
    tx: Tx,
    orgId: number,
    type: BookingTypeRow | null,
  ): Promise<BookingPageSettingsResponse> {
    const bundle = await this.bundle(tx, orgId);
    const org = await this.types.org(tx, orgId);
    const own = bundle.rows.find((r) => r.bookingTypeId === (type?.id ?? null));
    const saved: BookingPageTheme = {
      primaryColor: own?.primaryColor ?? null,
      accentColor: own?.accentColor ?? null,
      backgroundColor: own?.backgroundColor ?? null,
      backgroundStyle: own?.backgroundStyle ?? null,
      pageTitle: own?.pageTitle ?? null,
      welcomeText: own?.welcomeText ?? null,
      buttonLabel: own?.buttonLabel ?? null,
      font: own?.font ?? null,
      cornerStyle: own?.cornerStyle ?? null,
      colorMode: own?.colorMode ?? null,
      showPoweredBy: own?.showPoweredBy ?? null,
      showLanguageSwitch: own?.showLanguageSwitch ?? null,
      useWorkspaceBrand: own?.useWorkspaceBrand ?? true,
      logo: own?.logo ?? null,
      cover: own?.cover ?? null,
      rowVersion: own?.rowVersion ?? null,
      updatedAt: own?.updatedAt ?? null,
    };
    return {
      scope: type ? 'type' : 'workspace',
      workspaceSlug: org.slug,
      typeSlug: type?.slug ?? null,
      theme: saved,
      resolved: this.resolveFrom(bundle, type?.id ?? null),
      // What an empty field falls back to: for a service the workspace look, for the workspace the brand kit and the product.
      inherited: type
        ? this.resolveFrom(bundle, null)
        : resolveTheme({
            workspace: { ...EMPTY_LAYER, useWorkspaceBrand: own?.useWorkspaceBrand ?? true },
            brand: bundle.brand,
            canRemovePoweredBy: bundle.canRemovePoweredBy,
          }),
      brand: bundle.brand,
      canRemovePoweredBy: bundle.canRemovePoweredBy,
      limits: {
        pageTitle: BOOKING_PAGE_LIMITS.pageTitle,
        welcomeText: BOOKING_PAGE_LIMITS.welcomeText,
        buttonLabel: BOOKING_PAGE_LIMITS.buttonLabel,
        logoBytes: BOOKING_PAGE_LIMITS.logoBytes,
        coverBytes: BOOKING_PAGE_LIMITS.coverBytes,
      },
    };
  }
}
