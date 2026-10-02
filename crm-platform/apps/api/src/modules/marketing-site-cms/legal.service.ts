import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  LEGAL_SLUGS,
  isLegalSlug,
  legalSectionSchema,
  type LegalPageAdmin,
  type LegalPageListResponse,
  type LegalPagePublic,
  type LegalPublicListResponse,
  type LegalSlug,
  type UpdateLegalPageRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, HtmlSanitizerService } from '../auth';
import { CMS_EVENTS, iso, num, operatorId } from './cms-context';
import { legalReadMinutes, normaliseSections } from './cms-rules';
import { CmsStore } from './cms-store';
import { LEGAL_TEMPLATES, legalTemplate } from './legal-templates';

interface Row {
  uuid: string;
  slug: string;
  title: string;
  subtitle: string | null;
  updated_label: string | null;
  effective_label: string | null;
  sections: unknown;
  is_published: boolean;
  sort: number;
  row_version: number;
  updated_at: Date | string;
}

const COLS = sql.raw(
  'uuid, slug, title, subtitle, updated_label, effective_label, sections, is_published, sort, row_version, updated_at',
);

const sectionsOf = (raw: unknown) => {
  const parsed = z.array(legalSectionSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
};

/**
 * The five legal documents (TW-CMS-013, 033..036). The rows are seeded once, when the application starts, from the
 * starter templates (never overwriting an existing row), instead of being created by a GET as Reference's admin list did.
 * A visitor's request for a slug with no row falls back to the template, so the page is never empty by accident.
 */
@Injectable()
export class LegalService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegalService.name);
  private readonly brand: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
    private readonly html: HtmlSanitizerService,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seed();
    } catch (err) {
      // A database that is not reachable yet must not stop the API starting; public reads fall back to the templates.
      this.logger.warn({ err }, 'could not seed the legal pages');
    }
  }

  /** Inserts any missing canonical row from its template. Idempotent; an edited row is never touched. */
  async seed(): Promise<number> {
    return this.store.tx(async (tx) => {
      let created = 0;
      for (const t of LEGAL_TEMPLATES) {
        const doc = legalTemplate(t.slug, this.brand);
        const res = await tx.execute(sql`
          INSERT INTO legal_pages (slug, title, subtitle, sections, is_published, sort)
          VALUES (${doc.slug}, ${doc.title}, ${doc.subtitle}, ${JSON.stringify(doc.sections)}::jsonb, true, ${doc.sort})
          ON CONFLICT (slug) DO NOTHING
          RETURNING 1
        `);
        created += res.rows.length;
      }
      return created;
    });
  }

  private toAdmin(r: Row): LegalPageAdmin {
    return {
      id: r.uuid,
      slug: r.slug as LegalSlug,
      title: r.title,
      subtitle: r.subtitle,
      updatedLabel: r.updated_label,
      effectiveLabel: r.effective_label,
      sections: sectionsOf(r.sections),
      isPublished: r.is_published,
      sort: num(r.sort),
      rowVersion: num(r.row_version),
      updatedAt: iso(r.updated_at)!,
    };
  }

  // --- operator -------------------------------------------------------------------------------------------------------

  async list(): Promise<LegalPageListResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT ${COLS} FROM legal_pages WHERE slug IN (${sql.join(
        LEGAL_SLUGS.map((s) => sql`${s}`),
        sql`, `,
      )}) ORDER BY sort, id`,
    );
    return { data: (res.rows as unknown as Row[]).map((r) => this.toAdmin(r)) };
  }

  async get(slug: string): Promise<LegalPageAdmin> {
    if (!isLegalSlug(slug)) throw AppError.notFound('Legal page', slug);
    const res = await this.db.primary.execute(
      sql`SELECT ${COLS} FROM legal_pages WHERE slug = ${slug}`,
    );
    const row = res.rows[0] as unknown as Row | undefined;
    if (!row) throw AppError.notFound('Legal page', slug);
    return this.toAdmin(row);
  }

  async update(slug: string, req: UpdateLegalPageRequest): Promise<LegalPageAdmin> {
    if (!isLegalSlug(slug)) throw AppError.notFound('Legal page', slug);
    operatorId();
    const sections = normaliseSections(req.sections, (h) => this.html.sanitize(h));
    const blank = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);

    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE legal_pages
        SET title = ${req.title}, subtitle = ${blank(req.subtitle)}, updated_label = ${blank(req.updatedLabel)},
            effective_label = ${blank(req.effectiveLabel)}, sections = ${JSON.stringify(sections)}::jsonb,
            is_published = ${req.isPublished}
        WHERE slug = ${slug} AND row_version = ${req.rowVersion}
        RETURNING ${COLS}
      `);
      const row = res.rows[0] as unknown as Row | undefined;
      if (!row) throw await this.missOrConflict(tx, slug);
      await this.audit.record(tx, {
        event: CMS_EVENTS.legalUpdated,
        status: 'success',
        payload: { slug, sections: sections.length, isPublished: req.isPublished },
      });
      return this.toAdmin(row);
    });
  }

  async toggle(slug: string, rowVersion?: number): Promise<LegalPageAdmin> {
    if (!isLegalSlug(slug)) throw AppError.notFound('Legal page', slug);
    operatorId();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE legal_pages SET is_published = NOT is_published
        WHERE slug = ${slug} AND (${rowVersion ?? null}::int IS NULL OR row_version = ${rowVersion ?? null})
        RETURNING ${COLS}
      `);
      const row = res.rows[0] as unknown as Row | undefined;
      if (!row) throw await this.missOrConflict(tx, slug);
      await this.audit.record(tx, {
        event: CMS_EVENTS.legalToggled,
        status: 'success',
        payload: { slug, isPublished: row.is_published },
      });
      return this.toAdmin(row);
    });
  }

  private async missOrConflict(tx: Tx, slug: string) {
    const exists = await tx.execute(sql`SELECT 1 FROM legal_pages WHERE slug = ${slug}`);
    return exists.rows.length
      ? AppError.rowVersionConflict('This page')
      : AppError.notFound('Legal page', slug);
  }

  // --- visitors -------------------------------------------------------------------------------------------------------

  async publicList(): Promise<LegalPublicListResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT slug, title FROM legal_pages WHERE is_published ORDER BY sort, id`,
    );
    return {
      data: (res.rows as unknown as Array<{ slug: string; title: string }>)
        .filter((r) => isLegalSlug(r.slug))
        .map((r) => ({ slug: r.slug as LegalSlug, title: r.title })),
    };
  }

  /** A published row, or the template when the row is missing; a hidden row is a 404. Bodies are sanitised again. */
  async publicGet(slug: string): Promise<LegalPagePublic> {
    if (!isLegalSlug(slug)) throw AppError.notFound('Legal page', slug);
    const res = await this.db.primary.execute(
      sql`SELECT ${COLS} FROM legal_pages WHERE slug = ${slug}`,
    );
    const row = res.rows[0] as unknown as Row | undefined;
    if (row && !row.is_published) throw AppError.notFound('Legal page', slug);
    const doc = row
      ? {
          title: row.title,
          subtitle: row.subtitle,
          updatedLabel: row.updated_label,
          effectiveLabel: row.effective_label,
          sections: sectionsOf(row.sections),
        }
      : (() => {
          const t = legalTemplate(slug, this.brand);
          return {
            title: t.title,
            subtitle: t.subtitle,
            updatedLabel: null,
            effectiveLabel: null,
            sections: t.sections,
          };
        })();
    return {
      slug,
      ...doc,
      sections: doc.sections.map((s) => ({ ...s, body: this.html.sanitize(s.body) })),
      readMinutes: legalReadMinutes(doc.sections.length),
    };
  }
}
