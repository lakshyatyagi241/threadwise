import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  type CreateGuidebookArticleRequest,
  type GuidebookAdminListQuery,
  type GuidebookAdminListResponse,
  type GuidebookArticle,
  type GuidebookArticleAdmin,
  type GuidebookBrowseQuery,
  type GuidebookBrowseResponse,
  type GuidebookCard,
  type GuidebookVote,
  type UpdateGuidebookArticleRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, HtmlSanitizerService } from '../auth';
import { CMS_EVENTS, iso, num, operatorId } from './cms-context';
import { decodeTupleCursor, encodeTupleCursor, escapeLike, slugify, uniqueSlug } from './cms-rules';
import { CmsStore } from './cms-store';
import { fallbackArticleSlug, guidebookReadMinutes, renderMarkdown } from './guidebook-rules';

interface Row {
  id: string | number;
  uuid: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  body: string | null;
  is_published: boolean;
  sort_order: number;
  views_count: number;
  helpful_count: number;
  not_helpful_count: number;
  published_at: Date | string | null;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLS = sql`id, uuid, slug, title, category, excerpt, body, is_published, sort_order, views_count, helpful_count,
  not_helpful_count, published_at, row_version, created_at, updated_at`;

const blank = (v: string | null | undefined): string | null =>
  v && v.trim() !== '' ? v.trim() : null;

const toAdmin = (r: Row): GuidebookArticleAdmin => ({
  id: r.uuid,
  slug: r.slug,
  title: r.title,
  category: r.category,
  excerpt: r.excerpt,
  body: r.body,
  isPublished: r.is_published,
  sortOrder: num(r.sort_order),
  views: num(r.views_count),
  helpful: num(r.helpful_count),
  notHelpful: num(r.not_helpful_count),
  publishedAt: iso(r.published_at),
  rowVersion: num(r.row_version),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const toCard = (
  r: Pick<Row, 'slug' | 'title' | 'category' | 'excerpt' | 'body'>,
): GuidebookCard => ({
  slug: r.slug,
  title: r.title,
  category: r.category,
  excerpt: r.excerpt,
  readMinutes: guidebookReadMinutes(r.body),
});

/**
 * The help centre (TW-CMS-044..050). The operator authors Markdown; signed-in workspace users read it. The article is
 * platform data (readable by every connection, written only through `CmsStore`); a vote is tenant data, one row per
 * user and article, and the two counters on the article move through `cms_guidebook_vote()` / `cms_guidebook_view()`
 * without touching `updated_at` or `row_version`.
 *
 * Deliberate differences from Reference: a user has one vote they can change (Reference counted unlimited votes), a view or
 * vote no longer refreshes "updated", the toggle writes an audit row too, and search escapes `%` and `_`.
 */
@Injectable()
export class GuidebookService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
    private readonly html: HtmlSanitizerService,
  ) {}

  // --- operator -------------------------------------------------------------------------------------------------------

  async adminList(q: GuidebookAdminListQuery): Promise<GuidebookAdminListResponse> {
    const conds: SQL[] = [sql`TRUE`];
    if (q.category) conds.push(sql`category = ${q.category}`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(sql`(title ILIKE ${like} OR slug ILIKE ${like} OR body ILIKE ${like})`);
    }
    if (q.cursor) {
      const [c, s, t, i] = decodeTupleCursor(q.cursor, 4);
      conds.push(
        sql`(category, sort_order, title, id) > (${String(c)}, ${num(s)}, ${String(t)}, ${num(i)})`,
      );
    }
    const [rows, cats, kpi] = await Promise.all([
      this.db.primary.execute(
        sql`SELECT ${COLS} FROM guidebook_articles WHERE ${sql.join(conds, sql` AND `)}
            ORDER BY category, sort_order, title, id LIMIT ${q.limit + 1}`,
      ),
      this.db.primary.execute(
        sql`SELECT DISTINCT category FROM guidebook_articles ORDER BY category`,
      ),
      this.db.primary.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE is_published)::int AS published,
               count(*) FILTER (WHERE NOT is_published)::int AS drafts,
               COALESCE(sum(views_count), 0)::bigint AS views, COALESCE(sum(helpful_count), 0)::bigint AS helpful,
               COALESCE(sum(not_helpful_count), 0)::bigint AS not_helpful
        FROM guidebook_articles`),
    ]);
    const all = rows.rows as unknown as Row[];
    const hasMore = all.length > q.limit;
    const page = hasMore ? all.slice(0, q.limit) : all;
    const last = page[page.length - 1];
    const k = kpi.rows[0] as Record<string, unknown>;
    return {
      data: page.map(toAdmin),
      page: {
        hasMore,
        limit: q.limit,
        nextCursor:
          hasMore && last
            ? encodeTupleCursor([last.category, num(last.sort_order), last.title, num(last.id)])
            : null,
      },
      categories: (cats.rows as unknown as Array<{ category: string }>).map((c) => c.category),
      summary: {
        total: num(k.total),
        published: num(k.published),
        drafts: num(k.drafts),
        views: num(k.views),
        helpful: num(k.helpful),
        notHelpful: num(k.not_helpful),
      },
    };
  }

  private async find(tx: Tx | DatabaseService['primary'], uuid: string): Promise<Row | null> {
    const res = await tx.execute(sql`SELECT ${COLS} FROM guidebook_articles WHERE uuid = ${uuid}`);
    return (res.rows[0] as unknown as Row | undefined) ?? null;
  }

  async adminGet(uuid: string): Promise<GuidebookArticleAdmin> {
    const row = await this.find(this.db.primary, uuid);
    if (!row) throw AppError.notFound('Guidebook article', uuid);
    return toAdmin(row);
  }

  private async takenSlugs(tx: Tx, base: string, exceptId?: string | number): Promise<Set<string>> {
    const like = `${escapeLike(base)}-%`;
    const res = await tx.execute(
      sql`SELECT slug FROM guidebook_articles WHERE (slug = ${base} OR slug LIKE ${like})
          ${exceptId === undefined ? sql`` : sql`AND id <> ${num(exceptId)}`}`,
    );
    return new Set((res.rows as unknown as Array<{ slug: string }>).map((r) => r.slug));
  }

  async create(req: CreateGuidebookArticleRequest): Promise<GuidebookArticleAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const base = slugify(blank(req.slug) ?? req.title, fallbackArticleSlug());
      const slug = uniqueSlug(base, await this.takenSlugs(tx, base));
      const res = await tx.execute(sql`
        INSERT INTO guidebook_articles (slug, title, category, excerpt, body, is_published, sort_order, published_at)
        VALUES (${slug}, ${req.title}, ${req.category}, ${blank(req.excerpt)}, ${req.body ?? null},
                ${req.isPublished}, ${req.sortOrder}, ${req.isPublished ? sql`now()` : null})
        RETURNING uuid`);
      const uuid = (res.rows[0] as { uuid: string }).uuid;
      await this.audit.record(tx, {
        event: CMS_EVENTS.guidebookChanged,
        status: 'success',
        payload: { action: 'created', slug, title: req.title },
      });
      return toAdmin((await this.find(tx, uuid))!);
    });
  }

  async update(uuid: string, req: UpdateGuidebookArticleRequest): Promise<GuidebookArticleAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, slug, row_version, published_at FROM guidebook_articles WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as
        | {
            id: string | number;
            slug: string;
            row_version: number;
            published_at: Date | string | null;
          }
        | undefined;
      if (!cur) throw AppError.notFound('Guidebook article', uuid);
      if (num(cur.row_version) !== req.rowVersion)
        throw AppError.rowVersionConflict('This article');

      // A blank slug keeps the current one; a changed one is made unique, never an error (Reference: -2, -3, ...).
      let slug = cur.slug;
      const wanted = blank(req.slug);
      if (wanted && slugify(wanted, cur.slug) !== cur.slug) {
        const base = slugify(wanted, cur.slug);
        slug = uniqueSlug(base, await this.takenSlugs(tx, base, cur.id));
      }
      // Stamped now on first publish only; unpublishing through the form clears it (Reference rule 2).
      const publishedAt = req.isPublished
        ? cur.published_at
          ? sql`published_at`
          : sql`now()`
        : sql`NULL`;
      await tx.execute(sql`
        UPDATE guidebook_articles
        SET slug = ${slug}, title = ${req.title}, category = ${req.category}, excerpt = ${blank(req.excerpt)},
            body = ${req.body ?? null}, is_published = ${req.isPublished}, sort_order = ${req.sortOrder},
            published_at = ${publishedAt}
        WHERE id = ${cur.id}`);
      await this.audit.record(tx, {
        event: CMS_EVENTS.guidebookChanged,
        status: 'success',
        payload: { action: 'updated', slug, title: req.title },
      });
      return toAdmin((await this.find(tx, uuid))!);
    });
  }

  async toggle(uuid: string, rowVersion?: number): Promise<GuidebookArticleAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, is_published, row_version FROM guidebook_articles WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as
        { id: string | number; is_published: boolean; row_version: number } | undefined;
      if (!cur) throw AppError.notFound('Guidebook article', uuid);
      if (rowVersion !== undefined && num(cur.row_version) !== rowVersion) {
        throw AppError.rowVersionConflict('This article');
      }
      // Publishing stamps the date when empty; unpublishing through the toggle keeps it (unlike the form).
      await tx.execute(
        cur.is_published
          ? sql`UPDATE guidebook_articles SET is_published = false WHERE id = ${cur.id}`
          : sql`UPDATE guidebook_articles SET is_published = true, published_at = COALESCE(published_at, now()) WHERE id = ${cur.id}`,
      );
      await this.audit.record(tx, {
        event: CMS_EVENTS.guidebookChanged,
        status: 'success',
        payload: { action: cur.is_published ? 'unpublished' : 'published', uuid },
      });
      return toAdmin((await this.find(tx, uuid))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    operatorId();
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM guidebook_articles WHERE uuid = ${uuid} RETURNING slug, title`,
      );
      const row = res.rows[0] as { slug: string; title: string } | undefined;
      if (!row) throw AppError.notFound('Guidebook article', uuid);
      await this.audit.record(tx, {
        event: CMS_EVENTS.guidebookChanged,
        status: 'success',
        payload: { action: 'deleted', slug: row.slug, title: row.title },
      });
    });
  }

  /** Markdown to the sanitised HTML a reader would get (the editor's preview). */
  preview(body: string): { html: string } {
    return { html: this.html.sanitize(renderMarkdown(body)) };
  }

  // --- signed-in readers ----------------------------------------------------------------------------------------------

  async browse(q: GuidebookBrowseQuery): Promise<GuidebookBrowseResponse> {
    const conds: SQL[] = [sql`is_published`];
    if (q.category) conds.push(sql`category = ${q.category}`);
    if (q.q) {
      // ponytail: ILIKE over a few dozen articles; a tsvector index when the help centre grows past a few thousand.
      const like = `%${escapeLike(q.q)}%`;
      conds.push(sql`(title ILIKE ${like} OR excerpt ILIKE ${like} OR body ILIKE ${like})`);
    }
    if (q.cursor) {
      const [s, t, i] = decodeTupleCursor(q.cursor, 3);
      conds.push(sql`(sort_order, title, id) > (${num(s)}, ${String(t)}, ${num(i)})`);
    }
    const [rows, cats] = await Promise.all([
      this.db.primary.execute(
        sql`SELECT slug, title, category, excerpt, body, sort_order, id FROM guidebook_articles
            WHERE ${sql.join(conds, sql` AND `)} ORDER BY sort_order, title, id LIMIT ${q.limit + 1}`,
      ),
      this.db.primary.execute(
        sql`SELECT category AS name, count(*)::int AS count FROM guidebook_articles WHERE is_published
            GROUP BY category ORDER BY category`,
      ),
    ]);
    const all = rows.rows as unknown as Row[];
    const hasMore = all.length > q.limit;
    const page = hasMore ? all.slice(0, q.limit) : all;
    const last = page[page.length - 1];
    const categories = (cats.rows as unknown as Array<{ name: string; count: number }>).map(
      (c) => ({
        name: c.name,
        count: num(c.count),
      }),
    );
    return {
      data: page.map(toCard),
      page: {
        hasMore,
        limit: q.limit,
        nextCursor:
          hasMore && last
            ? encodeTupleCursor([num(last.sort_order), last.title, num(last.id)])
            : null,
      },
      categories,
      totalPublished: categories.reduce((n, c) => n + c.count, 0),
    };
  }

  /** One published article; counts a view. A draft or unknown slug is a 404 (the web app sends the reader back to the list). */
  async article(slug: string): Promise<GuidebookArticle> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, slug, title, category, excerpt, body, updated_at FROM guidebook_articles
            WHERE slug = ${slug} AND is_published`,
      );
      const a = res.rows[0] as unknown as Row | undefined;
      if (!a) throw AppError.notFound('Guidebook article', slug);
      await tx.execute(sql`SELECT cms_guidebook_view(${slug})`);
      const [related, mine] = await Promise.all([
        tx.execute(
          sql`SELECT slug, title, category, excerpt, body FROM guidebook_articles
              WHERE is_published AND category = ${a.category} AND id <> ${num(a.id)}
              ORDER BY sort_order, title, id LIMIT 4`,
        ),
        ctx.userId
          ? tx.execute(
              sql`SELECT vote FROM guidebook_votes WHERE article_id = ${num(a.id)} AND user_id = ${ctx.userId}`,
            )
          : Promise.resolve({ rows: [] as unknown[] }),
      ]);
      return {
        ...toCard(a),
        bodyHtml: this.html.sanitize(renderMarkdown(a.body ?? '')),
        updatedAt: iso(a.updated_at)!,
        myVote: ((mine.rows[0] as { vote?: GuidebookVote } | undefined)?.vote ??
          null) as GuidebookVote | null,
        related: (related.rows as unknown as Row[]).map(toCard),
      };
    });
  }

  /** One vote per user and article; voting again replaces it and the counters follow. */
  async vote(slug: string, vote: GuidebookVote): Promise<GuidebookVote> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    const userId = ctx.userId;
    return this.db.tx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT id FROM guidebook_articles WHERE slug = ${slug} AND is_published`,
      );
      const article = found.rows[0] as { id: string | number } | undefined;
      if (!article) throw AppError.notFound('Guidebook article', slug);
      const articleId = num(article.id);
      const prev = await tx.execute(
        sql`SELECT vote FROM guidebook_votes WHERE article_id = ${articleId} AND user_id = ${userId} FOR UPDATE`,
      );
      const old = (prev.rows[0] as { vote?: GuidebookVote } | undefined)?.vote ?? null;
      if (old === vote) return vote;
      await tx.execute(sql`
        INSERT INTO guidebook_votes (org_id, article_id, user_id, vote)
        VALUES (${ctx.orgId}, ${articleId}, ${userId}, ${vote})
        ON CONFLICT (org_id, article_id, user_id) DO UPDATE SET vote = EXCLUDED.vote`);
      await tx.execute(
        sql`SELECT cms_guidebook_vote(${articleId}::bigint, ${old}::text, ${vote}::text)`,
      );
      return vote;
    });
  }
}
