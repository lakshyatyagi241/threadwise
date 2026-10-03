import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface LocalStats {
  convos: number;
  convosOpen: number;
  msgIn: number;
  msgOut: number;
  posts: number;
  postsPublished: number;
  postsScheduled: number;
}

export interface LocalPost {
  message: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  fbPostId: string | null;
  type: string;
  status: string;
  photo: string | null;
}

/**
 * What this system knows about one Page, for the insights screen (WD-FB-019): its Messenger and comment threads (`fb:<page>:...`)
 * and the posts made here. Read-only, always inside the caller's tenant transaction.
 */
@Injectable()
export class InsightsRepository {
  async stats(tx: Tx, orgId: number, pageId: string, pageRowId: number): Promise<LocalStats> {
    const convos = await tx.execute(sql`
      SELECT count(*)::int AS convos, count(*) FILTER (WHERE c.status IN ('open', 'pending'))::int AS open
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'facebook' AND ch.external_id = ${pageId}`);
    const msgs = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE m.direction = 'in')::int AS msg_in, count(*) FILTER (WHERE m.direction = 'out')::int AS msg_out
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'facebook' AND ch.external_id = ${pageId}
        AND m.created_at >= now() - interval '28 days'`);
    const posts = await tx.execute(sql`
      SELECT count(*)::int AS posts, count(*) FILTER (WHERE status = 'published')::int AS published,
             count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled
      FROM facebook_posts WHERE org_id = ${orgId} AND facebook_page_id = ${pageRowId}`);
    const c = convos.rows[0] as { convos: number; open: number };
    const m = msgs.rows[0] as { msg_in: number; msg_out: number };
    const p = posts.rows[0] as { posts: number; published: number; scheduled: number };
    return {
      convos: c.convos,
      convosOpen: c.open,
      msgIn: m.msg_in,
      msgOut: m.msg_out,
      posts: p.posts,
      postsPublished: p.published,
      postsScheduled: p.scheduled,
    };
  }

  /** Messages per day and direction since the first day (in the viewer's zone), keyed `YYYY-MM-DD`. */
  async trend(
    tx: Tx,
    orgId: number,
    pageId: string,
    tz: string,
    firstDay: string,
  ): Promise<Map<string, { in: number; out: number }>> {
    const res = await tx.execute(sql`
      SELECT to_char(m.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, m.direction, count(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'facebook' AND ch.external_id = ${pageId}
        AND m.created_at >= (${firstDay}::date)::timestamp AT TIME ZONE ${tz}
      GROUP BY 1, 2`);
    const out = new Map<string, { in: number; out: number }>();
    for (const r of res.rows as Array<{ day: string; direction: string; n: number }>) {
      const d = out.get(r.day) ?? { in: 0, out: 0 };
      if (r.direction === 'in') d.in = r.n;
      else if (r.direction === 'out') d.out = r.n;
      out.set(r.day, d);
    }
    return out;
  }

  /** Threads by status. */
  async threadMix(tx: Tx, orgId: number, pageId: string): Promise<Record<string, number>> {
    const res = await tx.execute(sql`
      SELECT c.status AS status, count(*)::int AS n
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = 'facebook' AND ch.external_id = ${pageId}
      GROUP BY 1`);
    return Object.fromEntries(
      (res.rows as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]),
    );
  }

  /** Posts made here by type. */
  async contentMix(tx: Tx, orgId: number, pageRowId: number): Promise<Record<string, number>> {
    const res = await tx.execute(sql`
      SELECT coalesce(type, 'photo') AS type, count(*)::int AS n
      FROM facebook_posts WHERE org_id = ${orgId} AND facebook_page_id = ${pageRowId} GROUP BY 1`);
    return Object.fromEntries(
      (res.rows as Array<{ type: string; n: number }>).map((r) => [r.type, r.n]),
    );
  }

  /** The newest posts made here, for when Meta lists none. */
  async latestPosts(tx: Tx, orgId: number, pageRowId: number, limit: number): Promise<LocalPost[]> {
    const res = await tx.execute(sql`
      SELECT message, created_at, published_at, fb_post_id, type, status, media_json -> 'photos' ->> 0 AS photo
      FROM facebook_posts WHERE org_id = ${orgId} AND facebook_page_id = ${pageRowId}
      ORDER BY id DESC LIMIT ${limit}`);
    return (
      res.rows as Array<{
        message: string | null;
        created_at: Date | string;
        published_at: Date | string | null;
        fb_post_id: string | null;
        type: string;
        status: string;
        photo: string | null;
      }>
    ).map((r) => ({
      message: r.message,
      createdAt: new Date(r.created_at),
      publishedAt: r.published_at ? new Date(r.published_at) : null,
      fbPostId: r.fb_post_id,
      type: r.type,
      status: r.status,
      photo: r.photo,
    }));
  }
}
