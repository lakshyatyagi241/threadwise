import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  LEGAL_SLUGS,
  type BlogAdminListQuery,
  type BlogAdminListResponse,
  type BlogCard,
  type BlogCategory,
  type BlogCategoryListResponse,
  type BlogIndexResponse,
  type BlogPostAdmin,
  type BlogPostPublic,
  type BlogPublicQuery,
  type CreateBlogPostRequest,
  type SitemapResponse,
  type UpdateBlogPostRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, HtmlSanitizerService } from '../auth';
import { CMS_EVENTS, iso, num, operatorId } from './cms-context';
import {
  escapeLike,
  DB_NOW,
  type PublishDate,
  readMinutes,
  resolvePublishedAt,
  seoDescription,
  slugify,
  toggledPost,
  uniqueSlug,
} from './cms-rules';
import { CmsStore } from './cms-store';

interface PostRow {
  id: string | number;
  uuid: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string | null;
  featured_image: string | null;
  tags: unknown;
  author_name: string | null;
  status: 'draft' | 'published';
  published_at: Date | string | null;
  /** Evaluated by the database, with its own clock. */
  live: boolean;
  views: string | number;
  is_featured: boolean;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  og_image: string | null;
  canonical_url: string | null;
  noindex: boolean;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  /** The ordering timestamp with microseconds, for the keyset cursor. */
  sort_iso: string;
  sort_at: Date | string;
  cat_uuid: string | null;
  cat_name: string | null;
  cat_slug: string | null;
}

const SELECT = (sortExpr: SQL) => sql`
  SELECT p.id, p.uuid, p.title, p.slug, p.excerpt, p.body, p.featured_image, p.tags, p.author_name, p.status,
         p.published_at, p.views, p.is_featured, p.meta_title, p.meta_description, p.meta_keywords, p.og_image,
         p.canonical_url, p.noindex, p.row_version, p.created_at, p.updated_at,
         (p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= now())) AS live,
         ${sortExpr} AS sort_at,
         to_char((${sortExpr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_iso,
         c.uuid AS cat_uuid, c.name AS cat_name, c.slug AS cat_slug
  FROM blog_posts p LEFT JOIN blog_categories c ON c.id = p.category_id`;

const BY_CREATED = sql`p.created_at`;
const BY_PUBLISHED = sql`COALESCE(p.published_at, p.created_at)`;
const LIVE = sql`p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= now())`;

const tagsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];

/** A date, or the database's own `now()` for the stamp-now sentinel. */
const stamp = (d: PublishDate): SQL | Date | null => (d === DB_NOW ? sql`now()` : d);

const blank = (v: string | null | undefined): string | null =>
  v && v.trim() !== '' ? v.trim() : null;

/**
 * The blog (WD-CMS-011, 012, 029..032, 014): categories and posts for the operator, the live subset for visitors.
 *
 * Scheduling needs no job: a post is live when its status is published and its date has come, evaluated at read.
 * Bodies are sanitised on write and again when served. The view counter is bumped through `cms_record_blog_view()`,
 * which does not touch `updated_at` or `row_version`.
 */
@Injectable()
export class BlogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
    private readonly html: HtmlSanitizerService,
  ) {}

  // --- mappers --------------------------------------------------------------------------------------------------------

  private toAdmin(r: PostRow): BlogPostAdmin {
    const publishedAt = r.published_at ? new Date(r.published_at) : null;
    return {
      id: r.uuid,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      body: r.body,
      featuredImage: r.featured_image,
      category: r.cat_uuid ? { id: r.cat_uuid, name: r.cat_name!, slug: r.cat_slug! } : null,
      tags: tagsOf(r.tags),
      authorName: r.author_name,
      status: r.status,
      publishedAt: iso(publishedAt),
      live: r.live,
      views: num(r.views),
      isFeatured: r.is_featured,
      metaTitle: r.meta_title,
      metaDescription: r.meta_description,
      metaKeywords: r.meta_keywords,
      ogImage: r.og_image,
      canonicalUrl: r.canonical_url,
      noindex: r.noindex,
      rowVersion: num(r.row_version),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  private toCard(r: PostRow): BlogCard {
    return {
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      featuredImage: r.featured_image,
      category: r.cat_uuid ? { name: r.cat_name!, slug: r.cat_slug! } : null,
      authorName: r.author_name,
      publishedAt: iso(r.published_at),
      readMinutes: readMinutes(r.body),
      isFeatured: r.is_featured,
    };
  }

  // --- operator reads -------------------------------------------------------------------------------------------------

  async adminList(q: BlogAdminListQuery): Promise<BlogAdminListResponse> {
    const conds: SQL[] = [sql`TRUE`];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(sql`(p.title ILIKE ${like} OR p.slug ILIKE ${like})`);
    }
    if (q.status) conds.push(sql`p.status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      conds.push(
        sql`(p.created_at, p.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    const [rows, kpi] = await Promise.all([
      this.db.primary.execute(
        sql`${SELECT(BY_CREATED)} WHERE ${sql.join(conds, sql` AND `)} ORDER BY p.created_at DESC, p.id DESC LIMIT ${q.limit + 1}`,
      ),
      this.db.primary.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'published')::int AS published,
               count(*) FILTER (WHERE status = 'draft')::int AS drafts,
               COALESCE(sum(views), 0)::bigint AS views
        FROM blog_posts
      `),
    ]);
    const wrapped = (rows.rows as unknown as PostRow[]).map((r) => ({
      item: this.toAdmin(r),
      id: num(r.id),
      createdAt: new Date(r.created_at),
      createdAtIso: r.sort_iso,
    }));
    const { items, page } = buildPage(wrapped, q.limit);
    const k = kpi.rows[0] as { total: number; published: number; drafts: number; views: string };
    return {
      data: items.map((w) => w.item),
      page,
      summary: {
        total: num(k.total),
        published: num(k.published),
        drafts: num(k.drafts),
        views: num(k.views),
      },
    };
  }

  private async findAdmin(
    tx: Tx | DatabaseService['primary'],
    uuid: string,
  ): Promise<PostRow | null> {
    const res = await tx.execute(sql`${SELECT(BY_CREATED)} WHERE p.uuid = ${uuid}`);
    return (res.rows[0] as unknown as PostRow | undefined) ?? null;
  }

  async adminGet(uuid: string): Promise<BlogPostAdmin> {
    const row = await this.findAdmin(this.db.primary, uuid);
    if (!row) throw AppError.notFound('Blog post', uuid);
    return this.toAdmin(row);
  }

  async categories(): Promise<BlogCategoryListResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT uuid, name, slug FROM blog_categories ORDER BY name, id`,
    );
    return {
      data: (res.rows as unknown as Array<{ uuid: string; name: string; slug: string }>).map(
        (c) => ({
          id: c.uuid,
          name: c.name,
          slug: c.slug,
        }),
      ),
    };
  }

  // --- operator writes ------------------------------------------------------------------------------------------------

  private async takenSlugs(
    tx: Tx,
    table: 'blog_posts' | 'blog_categories',
    base: string,
  ): Promise<Set<string>> {
    const like = `${escapeLike(base)}-%`;
    const res = await tx.execute(
      table === 'blog_posts'
        ? sql`SELECT slug FROM blog_posts WHERE slug = ${base} OR slug LIKE ${like}`
        : sql`SELECT slug FROM blog_categories WHERE slug = ${base} OR slug LIKE ${like}`,
    );
    return new Set((res.rows as unknown as Array<{ slug: string }>).map((r) => r.slug));
  }

  /** An inline category wins over the select; a name that already exists (case-insensitive) is reused, not duplicated. */
  private async resolveCategory(
    tx: Tx,
    req: { categoryId?: string | null; newCategory?: string | null },
  ): Promise<number | null> {
    const name = blank(req.newCategory);
    if (name) {
      const existing = await tx.execute(
        sql`SELECT id FROM blog_categories WHERE lower(name) = lower(${name}) LIMIT 1`,
      );
      if (existing.rows[0]) return num((existing.rows[0] as { id: unknown }).id);
      const base = slugify(name, 'category');
      const slug = uniqueSlug(base, await this.takenSlugs(tx, 'blog_categories', base));
      const created = await tx.execute(
        sql`INSERT INTO blog_categories (name, slug) VALUES (${name}, ${slug}) RETURNING id`,
      );
      return num((created.rows[0] as { id: unknown }).id);
    }
    if (req.categoryId) {
      const found = await tx.execute(
        sql`SELECT id FROM blog_categories WHERE uuid = ${req.categoryId}`,
      );
      if (!found.rows[0]) {
        throw AppError.validation('Unknown category', [
          { path: 'categoryId', message: 'Unknown category' },
        ]);
      }
      return num((found.rows[0] as { id: unknown }).id);
    }
    return null;
  }

  async createCategory(name: string): Promise<BlogCategory> {
    operatorId();
    return this.store.tx(async (tx) => {
      const id = await this.resolveCategory(tx, { newCategory: name });
      const res = await tx.execute(
        sql`SELECT uuid, name, slug FROM blog_categories WHERE id = ${id}`,
      );
      const c = res.rows[0] as unknown as { uuid: string; name: string; slug: string };
      return { id: c.uuid, name: c.name, slug: c.slug };
    });
  }

  async create(req: CreateBlogPostRequest): Promise<BlogPostAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const base = slugify(blank(req.slug) ?? req.title, 'post');
      const slug = uniqueSlug(base, await this.takenSlugs(tx, 'blog_posts', base));
      const categoryId = await this.resolveCategory(tx, req);
      const publishedAt = resolvePublishedAt(
        req.status,
        req.publishedAt ? new Date(req.publishedAt) : null,
        null,
      );
      const res = await tx.execute(sql`
        INSERT INTO blog_posts (title, slug, excerpt, body, featured_image, category_id, tags, author_name, status,
                                published_at, is_featured, meta_title, meta_description, meta_keywords, og_image,
                                canonical_url, noindex)
        VALUES (${req.title}, ${slug}, ${blank(req.excerpt)}, ${req.body ? this.html.sanitize(req.body) : null},
                ${blank(req.featuredImage)}, ${categoryId},
                ${req.tags.length ? JSON.stringify([...new Set(req.tags)]) : null}::jsonb, ${blank(req.authorName)},
                ${req.status}, ${stamp(publishedAt)}, ${req.isFeatured}, ${blank(req.metaTitle)},
                ${blank(req.metaDescription)}, ${blank(req.metaKeywords)}, ${blank(req.ogImage)},
                ${blank(req.canonicalUrl)}, ${req.noindex})
        RETURNING uuid
      `);
      const uuid = (res.rows[0] as { uuid: string }).uuid;
      await this.audit.record(tx, {
        event: CMS_EVENTS.blogCreated,
        status: 'success',
        payload: { slug, status: req.status },
      });
      return this.toAdmin((await this.findAdmin(tx, uuid))!);
    });
  }

  async update(uuid: string, req: UpdateBlogPostRequest): Promise<BlogPostAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, slug, row_version, published_at FROM blog_posts WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as unknown as
        | {
            id: string | number;
            slug: string;
            row_version: number;
            published_at: Date | string | null;
          }
        | undefined;
      if (!cur) throw AppError.notFound('Blog post', uuid);
      if (num(cur.row_version) !== req.rowVersion) throw AppError.rowVersionConflict('This post');

      // A blank slug keeps the current one; a changed one must be free (WaDesk let the unique index fail with a 500).
      let slug = cur.slug;
      const wanted = blank(req.slug);
      if (wanted && slugify(wanted, 'post') !== cur.slug) {
        slug = slugify(wanted, 'post');
        const clash = await tx.execute(
          sql`SELECT 1 FROM blog_posts WHERE slug = ${slug} AND id <> ${cur.id}`,
        );
        if (clash.rows.length) {
          throw new AppError(
            ERROR_CODES.CMS_SLUG_TAKEN,
            'That address is already used by another post.',
            HttpStatus.CONFLICT,
          );
        }
      }
      const categoryId = await this.resolveCategory(tx, req);
      const publishedAt = resolvePublishedAt(
        req.status,
        req.publishedAt ? new Date(req.publishedAt) : null,
        cur.published_at ? new Date(cur.published_at) : null,
      );
      await tx.execute(sql`
        UPDATE blog_posts
        SET title = ${req.title}, slug = ${slug}, excerpt = ${blank(req.excerpt)},
            body = ${req.body ? this.html.sanitize(req.body) : null}, featured_image = ${blank(req.featuredImage)},
            category_id = ${categoryId},
            tags = ${req.tags.length ? JSON.stringify([...new Set(req.tags)]) : null}::jsonb,
            author_name = ${blank(req.authorName)}, status = ${req.status}, published_at = ${stamp(publishedAt)},
            is_featured = ${req.isFeatured}, meta_title = ${blank(req.metaTitle)},
            meta_description = ${blank(req.metaDescription)}, meta_keywords = ${blank(req.metaKeywords)},
            og_image = ${blank(req.ogImage)}, canonical_url = ${blank(req.canonicalUrl)}, noindex = ${req.noindex}
        WHERE id = ${cur.id}
      `);
      await this.audit.record(tx, {
        event: CMS_EVENTS.blogUpdated,
        status: 'success',
        payload: { slug, status: req.status },
      });
      return this.toAdmin((await this.findAdmin(tx, uuid))!);
    });
  }

  async toggle(uuid: string, rowVersion?: number): Promise<BlogPostAdmin> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, status, published_at, row_version FROM blog_posts WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as unknown as
        | {
            id: string | number;
            status: 'draft' | 'published';
            published_at: Date | string | null;
            row_version: number;
          }
        | undefined;
      if (!cur) throw AppError.notFound('Blog post', uuid);
      if (rowVersion !== undefined && num(cur.row_version) !== rowVersion) {
        throw AppError.rowVersionConflict('This post');
      }
      const next = toggledPost(cur.status, cur.published_at ? new Date(cur.published_at) : null);
      await tx.execute(
        sql`UPDATE blog_posts SET status = ${next.status}, published_at = ${stamp(next.publishedAt)} WHERE id = ${cur.id}`,
      );
      await this.audit.record(tx, {
        event: CMS_EVENTS.blogToggled,
        status: 'success',
        payload: { uuid, status: next.status },
      });
      return this.toAdmin((await this.findAdmin(tx, uuid))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    operatorId();
    await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`DELETE FROM blog_posts WHERE uuid = ${uuid} RETURNING slug`);
      const row = res.rows[0] as { slug: string } | undefined;
      if (!row) throw AppError.notFound('Blog post', uuid);
      await this.audit.record(tx, {
        event: CMS_EVENTS.blogDeleted,
        status: 'success',
        payload: { slug: row.slug },
      });
    });
  }

  // --- visitors -------------------------------------------------------------------------------------------------------

  async publicIndex(q: BlogPublicQuery): Promise<BlogIndexResponse> {
    const conds: SQL[] = [LIVE];
    if (q.category) {
      // An unknown category slug is ignored and shows everything (WD-CMS-011 rule 1).
      const known = await this.db.primary.execute(
        sql`SELECT 1 FROM blog_categories WHERE slug = ${q.category}`,
      );
      if (known.rows.length) conds.push(sql`c.slug = ${q.category}`);
    }
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(sql`(p.title ILIKE ${like} OR p.excerpt ILIKE ${like})`);
    }
    const listConds = [...conds];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      listConds.push(
        sql`(${BY_PUBLISHED}, p.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id})`,
      );
    }
    const [rows, featured, cats] = await Promise.all([
      this.db.primary.execute(
        sql`${SELECT(BY_PUBLISHED)} WHERE ${sql.join(listConds, sql` AND `)} ORDER BY ${BY_PUBLISHED} DESC, p.id DESC LIMIT ${q.limit + 1}`,
      ),
      q.cursor
        ? Promise.resolve(null)
        : this.db.primary.execute(
            sql`${SELECT(BY_PUBLISHED)} WHERE ${LIVE} AND p.is_featured ORDER BY ${BY_PUBLISHED} DESC, p.id DESC LIMIT 1`,
          ),
      this.db.primary.execute(sql`SELECT name, slug FROM blog_categories ORDER BY name, id`),
    ]);
    const wrapped = (rows.rows as unknown as PostRow[]).map((r) => ({
      item: this.toCard(r),
      id: num(r.id),
      createdAt: new Date(r.sort_at),
      createdAtIso: r.sort_iso,
    }));
    const { items, page } = buildPage(wrapped, q.limit);
    const f = featured?.rows[0] as unknown as PostRow | undefined;
    return {
      data: items.map((w) => w.item),
      page,
      featured: f ? this.toCard(f) : null,
      categories: cats.rows as unknown as Array<{ name: string; slug: string }>,
    };
  }

  /** A live post, with the view counter bumped. Anything else (missing, draft, scheduled) is a 404. */
  async publicPost(slug: string): Promise<BlogPostPublic> {
    const res = await this.db.primary.execute(
      sql`${SELECT(BY_PUBLISHED)} WHERE ${LIVE} AND p.slug = ${slug}`,
    );
    const r = res.rows[0] as unknown as PostRow | undefined;
    if (!r) throw AppError.notFound('Blog post', slug);

    await this.db.primary.execute(sql`SELECT cms_record_blog_view(${slug})`);

    const related = await this.db.primary.execute(sql`
      ${SELECT(BY_PUBLISHED)}
      WHERE ${LIVE} AND p.slug <> ${slug}
        AND (${r.cat_uuid}::uuid IS NULL OR c.uuid = ${r.cat_uuid}::uuid)
      ORDER BY ${BY_PUBLISHED} DESC, p.id DESC LIMIT 3
    `);
    const body = this.html.sanitize(r.body);
    return {
      ...this.toCard(r),
      body,
      tags: tagsOf(r.tags),
      updatedAt: iso(r.updated_at)!,
      seo: {
        title: blank(r.meta_title) ?? r.title,
        description: seoDescription({
          metaDescription: r.meta_description,
          excerpt: r.excerpt,
          body: r.body,
        }),
        ogImage: blank(r.og_image) ?? blank(r.featured_image),
        canonicalUrl: blank(r.canonical_url),
        noindex: r.noindex,
      },
      related: (related.rows as unknown as PostRow[]).map((x) => this.toCard(x)),
    };
  }

  /** Live, indexable posts and the public pages that change, for sitemap.xml (WD-CMS-014). */
  async sitemap(): Promise<SitemapResponse> {
    const [posts, cats, legal] = await Promise.all([
      this.db.primary.execute(
        sql`SELECT p.slug, p.updated_at FROM blog_posts p WHERE ${LIVE} AND NOT p.noindex ORDER BY p.updated_at DESC`,
      ),
      this.db.primary.execute(sql`SELECT slug FROM blog_categories ORDER BY name`),
      this.db.primary.execute(
        sql`SELECT slug FROM legal_pages WHERE is_published AND slug IN (${sql.join(
          LEGAL_SLUGS.map((s) => sql`${s}`),
          sql`, `,
        )}) ORDER BY sort`,
      ),
    ]);
    return {
      posts: (posts.rows as unknown as Array<{ slug: string; updated_at: Date | string }>).map(
        (r) => ({
          slug: r.slug,
          lastModified: iso(r.updated_at)!,
        }),
      ),
      categories: cats.rows as unknown as Array<{ slug: string }>,
      legal: legal.rows as unknown as Array<{ slug: string }>,
    };
  }
}
