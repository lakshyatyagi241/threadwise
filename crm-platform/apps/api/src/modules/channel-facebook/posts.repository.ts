import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface PostMedia {
  photos?: string[];
  video?: string;
}

export interface PostRow {
  id: number;
  uuid: string;
  pageRowId: number;
  pageUuid: string;
  pageName: string | null;
  type: string;
  status: string;
  message: string | null;
  link: string | null;
  media: PostMedia;
  fbPostId: string | null;
  scheduledPublishTime: Date | null;
  publishedAt: Date | null;
  error: string | null;
  createdAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  facebook_page_id: number | string;
  page_uuid: string;
  page_name: string | null;
  type: string;
  status: string;
  message: string | null;
  link: string | null;
  media_json: unknown;
  fb_post_id: string | null;
  scheduled_publish_time: Date | string | null;
  published_at: Date | string | null;
  error: string | null;
  created_at: Date | string;
}

const SELECT = sql.raw(`
  SELECT p.id, p.uuid, p.facebook_page_id, pg.uuid AS page_uuid, pg.name AS page_name, p.type, p.status, p.message, p.link,
         p.media_json, p.fb_post_id, p.scheduled_publish_time, p.published_at, p.error, p.created_at
  FROM facebook_posts p
  JOIN facebook_pages pg ON pg.org_id = p.org_id AND pg.id = p.facebook_page_id`);

const date = (v: Date | string | null) => (v === null ? null : new Date(v));
const media = (x: unknown): PostMedia => {
  const m = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
  return {
    ...(Array.isArray(m.photos)
      ? { photos: m.photos.filter((u): u is string => typeof u === 'string') }
      : {}),
    ...(typeof m.video === 'string' ? { video: m.video } : {}),
  };
};
const toRow = (r: Raw): PostRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  pageRowId: Number(r.facebook_page_id),
  pageUuid: r.page_uuid,
  pageName: r.page_name,
  type: r.type,
  status: r.status,
  message: r.message,
  link: r.link,
  media: media(r.media_json),
  fbPostId: r.fb_post_id,
  scheduledPublishTime: date(r.scheduled_publish_time),
  publishedAt: date(r.published_at),
  error: r.error,
  createdAt: new Date(r.created_at),
});

export interface PostFilter {
  /** Only this Page's posts (its row id). */
  pageRowId: number | null;
  /** `failed` also covers drafts: both are unpublished and retryable. */
  status: 'all' | 'scheduled' | 'published' | 'failed';
  type: string;
  since: Date | null;
  /** An `ILIKE` pattern over the message and the link. */
  like: string | null;
}

export interface PostAggregates {
  total: number;
  scheduled: number;
  published: number;
  failed: number;
  types: Record<string, number>;
}

/** `facebook_posts`, always inside the caller's tenant transaction. */
@Injectable()
export class PostsRepository {
  private where(orgId: number, f: PostFilter): SQL {
    const parts: SQL[] = [sql`p.org_id = ${orgId}`];
    if (f.pageRowId !== null) parts.push(sql`p.facebook_page_id = ${f.pageRowId}`);
    if (f.status === 'failed') parts.push(sql`p.status IN ('failed', 'draft')`);
    else if (f.status !== 'all') parts.push(sql`p.status = ${f.status}`);
    if (f.type !== 'all') parts.push(sql`p.type = ${f.type}`);
    if (f.since) parts.push(sql`p.created_at >= ${f.since}`);
    if (f.like) parts.push(sql`(p.message ILIKE ${f.like} OR p.link ILIKE ${f.like})`);
    return sql.join(parts, sql` AND `);
  }

  /** Scheduled first, then failed or draft, then the rest; within each, the latest schedule and the newest. */
  async list(
    tx: Tx,
    orgId: number,
    f: PostFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: PostRow[]; total: number }> {
    const where = this.where(orgId, f);
    const rows = await tx.execute(sql`
      ${SELECT} WHERE ${where}
      ORDER BY CASE p.status WHEN 'scheduled' THEN 0 WHEN 'failed' THEN 1 WHEN 'draft' THEN 1 ELSE 2 END,
               p.scheduled_publish_time DESC NULLS LAST, p.id DESC
      LIMIT ${limit} OFFSET ${offset}`);
    const count = await tx.execute(
      sql`SELECT count(*)::int AS n FROM facebook_posts p WHERE ${where}`,
    );
    return {
      rows: (rows.rows as unknown as Raw[]).map(toRow),
      total: Number((count.rows[0] as { n: number }).n),
    };
  }

  /** The KPI and type counts over one Page (or all), ignoring every other filter. */
  async aggregates(tx: Tx, orgId: number, pageRowId: number | null): Promise<PostAggregates> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
             count(*) FILTER (WHERE status = 'published')::int AS published,
             count(*) FILTER (WHERE status IN ('failed', 'draft'))::int AS failed,
             type, count(*)::int AS n
      FROM facebook_posts
      WHERE org_id = ${orgId} ${pageRowId === null ? sql`` : sql`AND facebook_page_id = ${pageRowId}`}
      GROUP BY ROLLUP (type)`);
    const types: Record<string, number> = {};
    let overall = { total: 0, scheduled: 0, published: 0, failed: 0 };
    for (const r of res.rows as Array<{
      total: number;
      scheduled: number;
      published: number;
      failed: number;
      type: string | null;
      n: number;
    }>) {
      if (r.type === null) overall = r;
      else types[r.type] = r.n;
    }
    return { ...overall, types };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<PostRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF p` : sql``}`,
    );
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<PostRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE p.org_id = ${orgId} AND p.id = ${id}`);
    const r = (res.rows as unknown as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      pageRowId: number;
      userId: number | null;
      type: string;
      status: 'draft' | 'scheduled';
      message: string | null;
      link: string | null;
      media: PostMedia;
      scheduledPublishTime: Date | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO facebook_posts (org_id, facebook_page_id, user_id, type, status, message, link, media_json, scheduled_publish_time)
      VALUES (${orgId}, ${v.pageRowId}, ${v.userId}, ${v.type}, ${v.status}, ${v.message}, ${v.link},
              ${JSON.stringify(v.media)}::jsonb, ${v.scheduledPublishTime})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** What Meta answered: live or held with its id, or failed with the reason. */
  async markResult(
    tx: Tx,
    orgId: number,
    id: number,
    v:
      | { ok: true; fbPostId: string; status: 'published' | 'scheduled' }
      | { ok: false; error: string },
  ): Promise<void> {
    if (v.ok) {
      await tx.execute(sql`
        UPDATE facebook_posts SET fb_post_id = ${v.fbPostId || null}, status = ${v.status},
               published_at = CASE WHEN ${v.status === 'published'} THEN now() ELSE NULL END, error = NULL
        WHERE org_id = ${orgId} AND id = ${id}`);
    } else {
      await tx.execute(
        sql`UPDATE facebook_posts SET status = 'failed', error = ${v.error} WHERE org_id = ${orgId} AND id = ${id}`,
      );
    }
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM facebook_posts WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
