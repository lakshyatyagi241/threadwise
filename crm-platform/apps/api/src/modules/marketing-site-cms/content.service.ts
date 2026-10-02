import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql, type SQL } from 'drizzle-orm';
import {
  CMS_KEYS,
  CMS_PAGES,
  THEME_PRESETS,
  layoutKeys,
  scopePrefixes,
  type CmsEntry,
  type CmsScope,
  type OperatorContentResponse,
  type PublicContentResponse,
  type ResetRequest,
  type SaveDraftRequest,
  type SaveDraftResponse,
  type SaveLayoutRequest,
  type SaveLayoutResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, HtmlSanitizerService, PlatformSettingsService } from '../auth';
import { checkContentValue, checkLayout } from './cms-rules';
import { CMS_EVENTS, num, operatorId } from './cms-context';
import { CmsStore } from './cms-store';

const FRONTEND_ENABLED_KEY = 'cms.frontend_enabled';
const COLS = sql.raw('ckey, type, draft, published, row_version');

interface Row {
  ckey: string;
  type: string;
  draft: string | null;
  published: string | null;
  row_version: number;
}

const ENTRY_TYPES = new Set(['text', 'longtext', 'richtext', 'link', 'color', 'json']);
const toEntry = (r: Row): CmsEntry => ({
  key: r.ckey,
  type: (ENTRY_TYPES.has(r.type) ? r.type : 'text') as CmsEntry['type'],
  draft: r.draft,
  published: r.published,
  rowVersion: num(r.row_version),
});

/** Which rows a scope covers. `all` has no prefix; `site` is the navigation and footer; a page is `<page>.`. */
function inScope(scope: CmsScope): SQL {
  const prefixes = scopePrefixes(scope);
  if (!prefixes) return sql`TRUE`;
  return sql`(${sql.join(
    prefixes.map((p) => sql`ckey LIKE ${`${p}%`}`),
    sql` OR `,
  )})`;
}

const PENDING = sql`draft IS NOT NULL AND COALESCE(draft, '') <> COALESCE(published, '')`;

const parseArray = (raw: string | null | undefined): string[] | null => {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
};

/**
 * The editable content store (TW-CMS-008, 018..026, 028): one row per key, a draft the editor works on and the value
 * visitors read. Reads for visitors need no privilege; every write goes through the store's privileged transaction and
 * records a security event in the same transaction.
 *
 * Deliberate differences from Reference (see the port map):
 *   - one language: the published value applies to every visitor (Reference ignored it for non-default locales);
 *   - reset is a draft tombstone (an empty string), reversible with Discard and live only after Publish;
 *   - every key is checked against the registry; links, colours and rich text are validated or sanitised on write;
 *   - a draft save can carry the row version it was based on and gets a 409 if the row moved.
 */
@Injectable()
export class CmsContentService {
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
    private readonly html: HtmlSanitizerService,
    private readonly settings: PlatformSettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
  }

  // --- reads ----------------------------------------------------------------------------------------------------------

  async homepageEnabled(): Promise<boolean> {
    return (await this.settings.get<unknown>(FRONTEND_ENABLED_KEY)) !== false;
  }

  /** Published values only. Empty values are dropped so the page falls back to the shipped default. */
  async publicContent(): Promise<PublicContentResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT ckey, published FROM frontend_content WHERE published IS NOT NULL AND published <> ''`,
    );
    const values: Record<string, string> = {};
    const hidden: Record<string, string[]> = {};
    const order: Record<string, string[]> = {};
    for (const r of res.rows as unknown as Array<{ ckey: string; published: string }>) {
      let matched = false;
      for (const page of CMS_PAGES) {
        const k = layoutKeys(page);
        if (r.ckey === k.hidden || r.ckey === k.order) {
          const arr = parseArray(r.published);
          if (arr) (r.ckey === k.hidden ? hidden : order)[page] = arr;
          matched = true;
        }
      }
      if (!matched) values[r.ckey] = r.published;
    }
    return {
      values,
      hidden,
      order,
      homepageEnabled: await this.homepageEnabled(),
      brandName: this.brand,
    };
  }

  /** Everything the editor needs: stored rows (draft and published), the pending count, the homepage switch. */
  async operatorContent(): Promise<OperatorContentResponse> {
    const [rows, pending] = await Promise.all([
      this.db.primary.execute(sql`SELECT ${COLS} FROM frontend_content ORDER BY ckey`),
      this.db.primary.execute(
        sql`SELECT count(*)::int AS n FROM frontend_content WHERE ${PENDING}`,
      ),
    ]);
    return {
      entries: (rows.rows as unknown as Row[]).map(toEntry),
      pending: num((pending.rows[0] as { n: number }).n),
      homepageEnabled: await this.homepageEnabled(),
    };
  }

  // --- drafts ---------------------------------------------------------------------------------------------------------

  private async upsertDraft(
    tx: Tx,
    key: string,
    value: string,
    operator: number,
    expectedVersion?: number,
  ): Promise<CmsEntry> {
    const type = key.includes('.__') ? 'json' : (CMS_KEYS.get(key)?.type ?? 'text');
    if (expectedVersion !== undefined) {
      const res = await tx.execute(sql`
        UPDATE frontend_content SET draft = ${value}, type = ${type}, updated_by = ${operator}
        WHERE ckey = ${key} AND row_version = ${expectedVersion}
        RETURNING ${COLS}
      `);
      if (!res.rows[0]) throw AppError.rowVersionConflict('This field');
      return toEntry(res.rows[0] as unknown as Row);
    }
    const res = await tx.execute(sql`
      INSERT INTO frontend_content (ckey, type, draft, updated_by)
      VALUES (${key}, ${type}, ${value}, ${operator})
      ON CONFLICT (ckey) DO UPDATE
        SET draft = EXCLUDED.draft, type = EXCLUDED.type, updated_by = EXCLUDED.updated_by
      RETURNING ${COLS}
    `);
    return toEntry(res.rows[0] as unknown as Row);
  }

  async saveDraft(req: SaveDraftRequest): Promise<SaveDraftResponse> {
    const operator = operatorId();
    // The last value for a key wins when a request names it twice.
    const byKey = new Map<string, { value: string; rowVersion?: number; index: number }>();
    const problems: Array<{ path: string; message: string }> = [];
    req.entries.forEach((e, index) => {
      const checked = checkContentValue(e.key, e.value, (h) => this.html.sanitize(h));
      if (!checked.ok) problems.push({ path: `entries.${index}.value`, message: checked.message });
      else byKey.set(e.key, { value: checked.value, rowVersion: e.rowVersion, index });
    });
    if (problems.length) throw AppError.validation('Some values are not valid.', problems);

    return this.store.tx(async (tx) => {
      const entries: CmsEntry[] = [];
      for (const [key, v] of byKey) {
        entries.push(await this.upsertDraft(tx, key, v.value, operator, v.rowVersion));
      }
      await this.audit.record(tx, {
        event: CMS_EVENTS.draftSaved,
        status: 'success',
        payload: { count: entries.length, keys: entries.slice(0, 20).map((e) => e.key) },
      });
      return { entries };
    });
  }

  async saveLayout(req: SaveLayoutRequest): Promise<SaveLayoutResponse> {
    const operator = operatorId();
    const checked = checkLayout(req.page, req.hidden, req.order);
    if (!checked.ok)
      throw AppError.validation(checked.message, [{ path: 'page', message: checked.message }]);
    const keys = layoutKeys(req.page);

    return this.store.tx(async (tx) => {
      if (checked.hidden)
        await this.upsertDraft(tx, keys.hidden, JSON.stringify(checked.hidden), operator);
      if (checked.order)
        await this.upsertDraft(tx, keys.order, JSON.stringify(checked.order), operator);
      await this.audit.record(tx, {
        event: CMS_EVENTS.layoutSaved,
        status: 'success',
        payload: { page: req.page, hidden: checked.hidden, order: checked.order },
      });
      const res = await tx.execute(
        sql`SELECT ckey, COALESCE(draft, published) AS v FROM frontend_content WHERE ckey IN (${keys.hidden}, ${keys.order})`,
      );
      const stored = new Map(
        (res.rows as unknown as Array<{ ckey: string; v: string | null }>).map((r) => [
          r.ckey,
          r.v,
        ]),
      );
      return {
        hidden: parseArray(stored.get(keys.hidden)) ?? [],
        order: parseArray(stored.get(keys.order)) ?? [],
      };
    });
  }

  // --- publish, discard, reset ----------------------------------------------------------------------------------------

  /** Copies each pending draft over the live value. Returns how many rows changed for visitors. */
  async publish(scope: CmsScope): Promise<number> {
    const operator = operatorId();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE frontend_content SET published = draft, updated_by = ${operator}
        WHERE ${PENDING} AND ${inScope(scope)}
        RETURNING 1
      `);
      // A published empty value equals the default, so the row carries nothing any more.
      await tx.execute(sql`
        DELETE FROM frontend_content
        WHERE COALESCE(draft, '') = '' AND COALESCE(published, '') = '' AND ${inScope(scope)}
      `);
      const count = res.rows.length;
      await this.audit.record(tx, {
        event: CMS_EVENTS.published,
        status: 'success',
        payload: { scope, count },
      });
      return count;
    });
  }

  /**
   * Throws away unpublished drafts and keeps what is live: a never-published row is removed (its default returns),
   * every other pending row gets its draft set back to the live value.
   */
  async discard(scope: CmsScope): Promise<number> {
    const operator = operatorId();
    return this.store.tx(async (tx) => {
      const removed = await tx.execute(sql`
        DELETE FROM frontend_content
        WHERE ${PENDING} AND COALESCE(published, '') = '' AND ${inScope(scope)}
        RETURNING 1
      `);
      const reverted = await tx.execute(sql`
        UPDATE frontend_content SET draft = published, updated_by = ${operator}
        WHERE ${PENDING} AND ${inScope(scope)}
        RETURNING 1
      `);
      const count = removed.rows.length + reverted.rows.length;
      await this.audit.record(tx, {
        event: CMS_EVENTS.discarded,
        status: 'success',
        payload: { scope, count },
      });
      return count;
    });
  }

  /** Sets the draft to "use the default" for one key or a whole scope. Live only after Publish. */
  async reset(req: ResetRequest): Promise<number> {
    const operator = operatorId();
    if (
      req.key !== undefined &&
      !CMS_KEYS.has(req.key) &&
      !/^[a-z]+\.__(hidden|order)$/.test(req.key)
    ) {
      throw AppError.validation('Unknown content key', [
        { path: 'key', message: 'Unknown content key' },
      ]);
    }
    const where = req.key !== undefined ? sql`ckey = ${req.key}` : inScope(req.scope ?? 'all');
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE frontend_content SET draft = '', updated_by = ${operator}
        WHERE ${where} AND draft IS DISTINCT FROM ''
        RETURNING 1
      `);
      const count = res.rows.length;
      await this.audit.record(tx, {
        event: CMS_EVENTS.reset,
        status: 'success',
        payload: { key: req.key, scope: req.scope, count },
      });
      return count;
    });
  }

  /** Writes the preset's brand and accent tokens as drafts. Returns the tokens written. */
  async applyPreset(presetId: string): Promise<Record<string, string>> {
    const operator = operatorId();
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset)
      throw AppError.validation('Unknown preset', [{ path: 'preset', message: 'Unknown preset' }]);
    await this.store.tx(async (tx) => {
      for (const [token, value] of Object.entries(preset.tokens)) {
        await this.upsertDraft(tx, `theme.${token}`, value, operator);
      }
      await this.audit.record(tx, {
        event: CMS_EVENTS.presetApplied,
        status: 'success',
        payload: { preset: preset.id },
      });
    });
    return preset.tokens;
  }

  // --- homepage switch (TW-CMS-028) -----------------------------------------------------------------------------------

  /**
   * Written straight to `platform_settings` in the same transaction as its audit row (PlatformSettingsService.set has
   * its own transaction and could not be atomic with the event), then the settings snapshot is dropped.
   */
  async setHomepageEnabled(enabled: boolean): Promise<boolean> {
    const operator = operatorId();
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${FRONTEND_ENABLED_KEY}, ${JSON.stringify(enabled)}::jsonb, false, ${operator}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, is_secret = false, updated_by = EXCLUDED.updated_by, updated_at = now()
      `);
      await this.audit.record(tx, {
        event: CMS_EVENTS.homepageToggled,
        status: 'success',
        payload: { enabled },
      });
    });
    this.settings.invalidate();
    return enabled;
  }
}
