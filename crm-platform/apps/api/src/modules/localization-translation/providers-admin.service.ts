import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  UNOFFICIAL_PROVIDER_SLUGS,
  type TranslationProviderItem,
  type TranslationProviderListResponse,
  type TranslationProviderSlug,
  type UpdateTranslationProviderRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DRIVERS, isKnownProvider } from '../../infra/providers/localization-translation/drivers';
import { AuthAuditService, PlatformSettingsService, PlatformStore } from '../auth';
import { ProviderCredentials } from './provider-credentials';
import { OFFICIAL_ONLY_KEY, ProviderRouterService } from './provider-router.service';
import { missingCredentials } from './translation-policy';

interface ProviderDbRow {
  uuid: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  credentials: string | null;
  sort_order: number;
  row_version: number;
}

const COLUMNS = sql`uuid, slug, name, description, is_active, is_default, credentials, sort_order, row_version`;
const rowsOf = (res: { rows: unknown[] }) => res.rows as unknown as ProviderDbRow[];

const asSlug = (slug: string): TranslationProviderSlug => {
  if (!isKnownProvider(slug)) throw AppError.notFound('Translation provider', slug);
  return slug;
};

/**
 * The operator's translation-provider catalogue (TW-I18N-014..018): credentials, order, activation, the default and
 * the compliance lockdown. Every write is one privileged transaction through PlatformStore that also records the
 * security event. Credential VALUES are never written to an event, only which keys were touched.
 */
@Injectable()
export class ProvidersAdminService {
  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
    private readonly settings: PlatformSettingsService,
    private readonly credentials: ProviderCredentials,
    private readonly router: ProviderRouterService,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private async lockdownOn(): Promise<boolean> {
    return (await this.settings.get<boolean>(OFFICIAL_ONLY_KEY)) === true;
  }

  private toItem(row: ProviderDbRow, lockdown: boolean): TranslationProviderItem {
    const slug = asSlug(row.slug);
    const creds = this.credentials.decrypt(slug, row.credentials);
    return {
      id: row.uuid,
      slug,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      isDefault: row.is_default,
      sortOrder: row.sort_order,
      official: DRIVERS[slug].official,
      skippedByLockdown: lockdown && UNOFFICIAL_PROVIDER_SLUGS.includes(slug),
      credentialFields: this.credentials.fields(slug, creds),
      rowVersion: row.row_version,
    };
  }

  /** Rows whose slug no driver implements are skipped, as Reference did. */
  async list(): Promise<TranslationProviderListResponse> {
    const [lockdown, rows] = await Promise.all([
      this.lockdownOn(),
      this.store.tx(async (tx) =>
        rowsOf(
          await tx.execute(
            sql`SELECT ${COLUMNS} FROM translation_providers ORDER BY sort_order, id`,
          ),
        ),
      ),
    ]);
    return {
      data: rows.filter((r) => isKnownProvider(r.slug)).map((r) => this.toItem(r, lockdown)),
      lockdown: { enabled: lockdown },
    };
  }

  private async lock(tx: Tx, uuid: string, rowVersion: number): Promise<ProviderDbRow> {
    const row = rowsOf(
      await tx.execute(
        sql`SELECT ${COLUMNS} FROM translation_providers WHERE uuid = ${uuid} FOR UPDATE`,
      ),
    )[0];
    if (!row || !isKnownProvider(row.slug)) throw AppError.notFound('Translation provider', uuid);
    if (row.row_version !== rowVersion) throw AppError.rowVersionConflict('Translation provider');
    return row;
  }

  /** TW-I18N-015. */
  async update(uuid: string, body: UpdateTranslationProviderRequest): Promise<TranslationProviderItem> {
    const operatorId = this.operatorId();
    const lockdown = await this.lockdownOn();
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, body.rowVersion);
      const slug = asSlug(row.slug);
      const existing = this.credentials.decrypt(slug, row.credentials);
      const { credentials, problems } = this.credentials.merge(
        slug,
        existing,
        body.credentials,
        body.clear,
      );
      if (problems.length > 0) {
        throw AppError.validation('The credentials failed validation.', problems);
      }
      // A required credential cannot be removed from a provider that is switched on.
      const missing = missingCredentials(slug, credentials);
      if (row.is_active && missing.length > 0) {
        throw new AppError(
          ERROR_CODES.I18N_PROVIDER_CREDENTIALS_MISSING,
          `${row.name} is active and needs: ${missing.join(', ')}. Deactivate it first.`,
          HttpStatus.CONFLICT,
          missing.map((m) => ({ path: `credentials.${m}`, message: 'required' })),
        );
      }

      const touched = Object.entries(body.credentials ?? {})
        .filter(([k, v]) => v.trim() !== '' && DRIVERS[slug].credentialFields.some((f) => f.key === k))
        .map(([k]) => k);
      const updated = rowsOf(
        await tx.execute(sql`
          UPDATE translation_providers
          SET credentials = ${this.credentials.encrypt(credentials)},
              sort_order = ${body.sortOrder ?? row.sort_order}
          WHERE uuid = ${uuid}
          RETURNING ${COLUMNS}
        `),
      )[0]!;
      await this.audit.record(tx, {
        event: 'platform.i18n.translation_provider_updated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { provider: slug, fieldsSet: touched, fieldsCleared: body.clear ?? [] },
      });
      return this.toItem(updated, lockdown);
    });
    this.router.invalidate();
    return item;
  }

  /** The providers (other than `except`) that could carry the traffic once the lockdown removes the free ones. */
  private async usableOfficial(tx: Tx, except?: string): Promise<number> {
    const rows = rowsOf(
      await tx.execute(sql`SELECT ${COLUMNS} FROM translation_providers WHERE is_active`),
    );
    return rows.filter(
      (r) =>
        isKnownProvider(r.slug) &&
        DRIVERS[r.slug].official &&
        r.slug !== except &&
        missingCredentials(r.slug, this.credentials.decrypt(r.slug, r.credentials)).length === 0,
    ).length;
  }

  /** TW-I18N-016. Activation needs every required credential; with the lockdown on, the last official one stays. */
  async toggle(uuid: string, rowVersion: number): Promise<TranslationProviderItem> {
    const operatorId = this.operatorId();
    const lockdown = await this.lockdownOn();
    const blocked: { slug: string; missing: string[] } = { slug: '', missing: [] };

    try {
      const item = await this.store.tx(async (tx) => {
        const row = await this.lock(tx, uuid, rowVersion);
        const slug = asSlug(row.slug);
        const next = !row.is_active;

        if (next) {
          const missing = missingCredentials(slug, this.credentials.decrypt(slug, row.credentials));
          if (missing.length > 0) {
            blocked.slug = slug;
            blocked.missing = missing;
            throw new AppError(
              ERROR_CODES.I18N_PROVIDER_CREDENTIALS_MISSING,
              `Configure required fields first: ${missing.join(', ')}`,
              HttpStatus.CONFLICT,
              missing.map((m) => ({ path: `credentials.${m}`, message: 'required' })),
            );
          }
        } else if (
          lockdown &&
          DRIVERS[slug].official &&
          (await this.usableOfficial(tx, slug)) === 0
        ) {
          throw new AppError(
            ERROR_CODES.I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER,
            'The compliance lockdown is on and this is the last usable official provider. Turn the lockdown off first.',
            HttpStatus.CONFLICT,
          );
        }

        const updated = rowsOf(
          await tx.execute(
            sql`UPDATE translation_providers SET is_active = ${next} WHERE uuid = ${uuid} RETURNING ${COLUMNS}`,
          ),
        )[0]!;
        await this.audit.record(tx, {
          event: next
            ? 'platform.i18n.translation_provider_activated'
            : 'platform.i18n.translation_provider_deactivated',
          status: 'success',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { provider: slug },
        });
        return this.toItem(updated, lockdown);
      });
      this.router.invalidate();
      return item;
    } catch (err) {
      // The refusal rolled its transaction back, so the event that records it is written on its own.
      if (blocked.slug) {
        await this.audit.recordStandalone({
          event: 'platform.i18n.translation_provider_toggle_blocked',
          status: 'failure',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { provider: blocked.slug, missingFields: blocked.missing },
        });
      }
      throw err;
    }
  }

  /** TW-I18N-017. Exactly one default; the partial unique index backs the rule up. */
  async setDefault(uuid: string, rowVersion: number): Promise<TranslationProviderItem> {
    const operatorId = this.operatorId();
    const lockdown = await this.lockdownOn();
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, rowVersion);
      if (!row.is_active) {
        throw new AppError(
          ERROR_CODES.I18N_PROVIDER_INACTIVE,
          'Activate this provider before making it the default.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.execute(sql`UPDATE translation_providers SET is_default = false WHERE is_default AND uuid <> ${uuid}`);
      const updated = rowsOf(
        await tx.execute(
          sql`UPDATE translation_providers SET is_default = true WHERE uuid = ${uuid} RETURNING ${COLUMNS}`,
        ),
      )[0]!;
      await this.audit.record(tx, {
        event: 'platform.i18n.translation_provider_default_changed',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { provider: row.slug },
      });
      return this.toItem(updated, lockdown);
    });
    this.router.invalidate();
    return item;
  }

  /**
   * TW-I18N-018. Turning it on needs at least one active official provider whose required credentials are all present
   * (Reference only checked that the credential map was non-empty).
   */
  async setLockdown(enabled: boolean): Promise<TranslationProviderListResponse> {
    const operatorId = this.operatorId();
    const previous = await this.lockdownOn();
    await this.store.tx(async (tx) => {
      if (enabled && (await this.usableOfficial(tx)) === 0) {
        throw new AppError(
          ERROR_CODES.I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER,
          'Activate and configure at least one official paid provider (DeepL or Google Cloud) before enabling the lockdown.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${OFFICIAL_ONLY_KEY}, ${JSON.stringify(enabled)}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
      await this.audit.record(tx, {
        event: enabled
          ? 'platform.i18n.translation_lockdown_enabled'
          : 'platform.i18n.translation_lockdown_disabled',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { previous, now: enabled },
      });
    });
    this.settings.invalidate();
    this.router.invalidate();
    return this.list();
  }
}
