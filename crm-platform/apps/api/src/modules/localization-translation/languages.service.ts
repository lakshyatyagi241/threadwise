import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  directionOf,
  resolveLocale,
  type ActiveLanguage,
  type ActiveLanguagesResponse,
  type LanguageItem,
  type LanguageListResponse,
  type MyLocaleResponse,
  type SetMyLocaleResponse,
  type TextDirection,
  type UpdateLanguageRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { AuthAuditService, PlatformSettingsService, PlatformStore } from '../auth';

export const DEFAULT_LANGUAGE_KEY = 'i18n.default_language';
const ACTIVE_CACHE_KEY = 'locale:active_languages';
const ACTIVE_CACHE_TTL = 600;

interface LanguageRow {
  uuid: string;
  code: string;
  name: string;
  native_name: string | null;
  direction: TextDirection;
  is_active: boolean;
  sort_order: number;
  row_version: number;
}

const COLUMNS = sql`uuid, code, name, native_name, direction, is_active, sort_order, row_version`;
const rowsOf = <T>(res: { rows: unknown[] }) => res.rows as T[];

const toItem = (r: LanguageRow, defaultCode: string): LanguageItem => ({
  id: r.uuid,
  code: r.code,
  name: r.name,
  nativeName: r.native_name,
  direction: r.direction,
  isActive: r.is_active,
  isDefault: r.code === defaultCode,
  sortOrder: r.sort_order,
  rowVersion: r.row_version,
});

const toActive = (r: LanguageRow): ActiveLanguage => ({
  code: r.code,
  name: r.name,
  nativeName: r.native_name,
  direction: r.direction,
});

/**
 * The platform language registry and the locale a caller ends up in (TW-I18N-001..011).
 *
 * Reads of the ACTIVE list are cached in Redis for ten minutes and every write below deletes the key in the same
 * request: Reference flushed on toggle and set-default but not on edit or delete, so a deleted language stayed
 * selectable for up to ten minutes. Writes are one privileged transaction through PlatformStore that also records the
 * security event, so a change and its audit row commit together.
 */
@Injectable()
export class LanguagesService {
  private readonly logger = new Logger(LanguagesService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
    private readonly settings: PlatformSettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private async flush(): Promise<void> {
    try {
      await this.redis.del(ACTIVE_CACHE_KEY);
    } catch (err) {
      this.logger.warn({ err }, 'could not clear the active-language cache; it expires on its own');
    }
  }

  // --- reads --------------------------------------------------------------------------------------------------------

  /** The platform default language code. Always a string; `en` when nothing was ever chosen. */
  async defaultCode(): Promise<string> {
    return (await this.settings.get<string>(DEFAULT_LANGUAGE_KEY)) ?? 'en';
  }

  /** Active languages in registry order. */
  async active(): Promise<ActiveLanguage[]> {
    try {
      const cached = await this.redis.get(ACTIVE_CACHE_KEY);
      if (cached) return JSON.parse(cached) as ActiveLanguage[];
    } catch {
      /* a cache miss is always safe */
    }
    const rows = await this.store.tx(async (tx) =>
      rowsOf<LanguageRow>(
        await tx.execute(
          sql`SELECT ${COLUMNS} FROM languages WHERE is_active ORDER BY sort_order, name`,
        ),
      ),
    );
    const active = rows.map(toActive);
    try {
      await this.redis.set(ACTIVE_CACHE_KEY, JSON.stringify(active), 'EX', ACTIVE_CACHE_TTL);
    } catch {
      /* best effort */
    }
    return active;
  }

  /** Public list for the language switcher. */
  async publicList(): Promise<ActiveLanguagesResponse> {
    const [data, defaultCode] = await Promise.all([this.active(), this.defaultCode()]);
    return {
      data,
      defaultLocale: resolveLocale({ platformDefault: defaultCode, active: data }),
    };
  }

  async list(): Promise<LanguageListResponse> {
    const defaultCode = await this.defaultCode();
    const rows = await this.store.tx(async (tx) =>
      rowsOf<LanguageRow>(
        await tx.execute(sql`SELECT ${COLUMNS} FROM languages ORDER BY sort_order, name`),
      ),
    );
    return {
      data: rows.map((r) => toItem(r, defaultCode)),
      stats: { total: rows.length, active: rows.filter((r) => r.is_active).length, defaultCode },
    };
  }

  // --- registry writes ----------------------------------------------------------------------------------------------

  private async lock(tx: Tx, uuid: string, rowVersion: number): Promise<LanguageRow> {
    const row = rowsOf<LanguageRow>(
      await tx.execute(sql`SELECT ${COLUMNS} FROM languages WHERE uuid = ${uuid} FOR UPDATE`),
    )[0];
    if (!row) throw AppError.notFound('Language', uuid);
    if (row.row_version !== rowVersion) throw AppError.rowVersionConflict('Language');
    return row;
  }

  private defaultRefused(row: LanguageRow): AppError {
    return new AppError(
      ERROR_CODES.I18N_LANGUAGE_IS_DEFAULT,
      `${row.name} is the platform default. Make another language the default first.`,
      HttpStatus.CONFLICT,
    );
  }

  /** TW-I18N-003. Unlike Reference, the default language cannot be switched off (it would be the fallback for everyone). */
  async toggle(uuid: string, rowVersion: number): Promise<LanguageItem> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, rowVersion);
      if (row.is_active && row.code === defaultCode) throw this.defaultRefused(row);
      const next = !row.is_active;
      const updated = rowsOf<LanguageRow>(
        await tx.execute(
          sql`UPDATE languages SET is_active = ${next} WHERE uuid = ${uuid} RETURNING ${COLUMNS}`,
        ),
      )[0]!;
      await this.audit.record(tx, {
        event: next ? 'platform.i18n.language_activated' : 'platform.i18n.language_deactivated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { language: row.code },
      });
      return toItem(updated, defaultCode);
    });
    await this.flush();
    return item;
  }

  /** TW-I18N-004. The target must be active. */
  async setDefault(uuid: string, rowVersion: number): Promise<LanguageItem> {
    const operatorId = this.operatorId();
    const previous = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, rowVersion);
      if (!row.is_active) {
        throw new AppError(
          ERROR_CODES.I18N_LANGUAGE_INACTIVE,
          `Activate ${row.name} first before setting it as the default.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${DEFAULT_LANGUAGE_KEY}, ${JSON.stringify(row.code)}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
      await this.audit.record(tx, {
        event: 'platform.i18n.language_default_changed',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { previous, now: row.code },
      });
      return toItem(row, row.code);
    });
    this.settings.invalidate();
    await this.flush();
    return item;
  }

  /** TW-I18N-002. */
  async update(uuid: string, body: UpdateLanguageRequest): Promise<LanguageItem> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, body.rowVersion);
      if (!body.isActive && row.code === defaultCode) throw this.defaultRefused(row);
      const updated = rowsOf<LanguageRow>(
        await tx.execute(sql`
          UPDATE languages
          SET name = ${body.name}, native_name = ${body.nativeName || null}, direction = ${body.direction},
              is_active = ${body.isActive}, sort_order = ${body.sortOrder}
          WHERE uuid = ${uuid}
          RETURNING ${COLUMNS}
        `),
      )[0]!;
      await this.audit.record(tx, {
        event: 'platform.i18n.language_updated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { language: row.code, isActive: body.isActive, direction: body.direction },
      });
      return toItem(updated, defaultCode);
    });
    await this.flush();
    return item;
  }

  /**
   * TW-I18N-005. Hard delete (this repo has no soft delete) and never the default. Users and workspaces that named the
   * language are left alone: resolution simply stops honouring a code that is no longer active.
   */
  async remove(uuid: string, rowVersion: number): Promise<void> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    await this.store.tx(async (tx) => {
      const row = await this.lock(tx, uuid, rowVersion);
      if (row.code === defaultCode) throw this.defaultRefused(row);
      await tx.execute(sql`DELETE FROM languages WHERE uuid = ${uuid}`);
      await this.audit.record(tx, {
        event: 'platform.i18n.language_deleted',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { language: row.code, name: row.name },
      });
    });
    await this.flush();
  }

  /**
   * TW-I18N-006. A language may only exist when its UI catalogue ships with the product, so adding one is refused, as
   * in Reference. Kept as a real route so a client gets a stable error code instead of a 404.
   */
  addDisabled(): never {
    throw new AppError(
      ERROR_CODES.I18N_ADD_LANGUAGE_DISABLED,
      'Adding languages is disabled: a language needs a shipped UI catalogue before it can be offered.',
      HttpStatus.CONFLICT,
    );
  }

  // --- the caller's own locale --------------------------------------------------------------------------------------

  /** TW-I18N-009: persist a signed-in user's choice. Only an active language is accepted. */
  async setMyLocale(code: string): Promise<SetMyLocaleResponse> {
    const ctx = RequestContextStore.require();
    const active = await this.active();
    const language = active.find((l) => l.code === code);
    if (!language || !ctx.userId) {
      throw new AppError(
        ERROR_CODES.I18N_LANGUAGE_NOT_AVAILABLE,
        'That language is not available.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.db.tx(async (tx) => {
      // The profile row is created with the user; the upsert covers accounts that predate it.
      await tx.execute(sql`
        INSERT INTO user_profiles (org_id, user_id, locale)
        VALUES (${ctx.orgId}, ${ctx.userId}, ${code})
        ON CONFLICT (org_id, user_id) DO UPDATE SET locale = EXCLUDED.locale
      `);
    });
    return { ok: true, locale: code, direction: language.direction };
  }

  /** The inputs the web app needs to resolve a signed-in user's locale. */
  async myLocale(): Promise<MyLocaleResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) return { userLocale: null, workspaceDefault: null };
    const row = await this.db.tx(async (tx) =>
      rowsOf<{ user_locale: string | null; workspace_default: string | null }>(
        await tx.execute(sql`
          SELECT (SELECT locale FROM user_profiles WHERE org_id = ${ctx.orgId} AND user_id = ${ctx.userId}) AS user_locale,
                 (SELECT default_language FROM workspace_settings WHERE org_id = ${ctx.orgId}) AS workspace_default
        `),
      ),
    );
    return {
      userLocale: row[0]?.user_locale ?? null,
      workspaceDefault: row[0]?.workspace_default ?? null,
    };
  }

  /** Direction of a code, for callers that already hold the active list. */
  async directionFor(code: string): Promise<TextDirection> {
    return directionOf(code, await this.active());
  }
}
