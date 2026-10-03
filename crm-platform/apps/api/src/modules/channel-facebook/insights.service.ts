import { Inject, Injectable } from '@nestjs/common';
import type { FbInsights, InsightsQuery } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../infra/providers/channel-facebook/facebook.port';
import { FACEBOOK_PLAN_GATE, type FacebookPlanGate } from './_shims/tokens';
import { InsightsRepository } from './insights.repository';
import { PagesRepository, type PageRow } from './pages.repository';
import { kpisFrom, lastDays, postStats, validTimeZone } from './post-rules';

/** The live 28 day metrics asked of Meta; one it no longer has simply comes back absent. */
const PAGE_METRICS = [
  'page_impressions',
  'page_impressions_unique',
  'page_post_engagements',
  'page_views_total',
  'page_fan_adds',
] as const;
const POST_METRICS = ['post_impressions', 'post_engaged_users'] as const;
const TREND_DAYS = 14;
const RECENT_POSTS = 6;

const EMPTY: Omit<FbInsights, 'pages' | 'page'> = {
  identity: null,
  followers: null,
  kpis: {},
  local: {
    convos: 0,
    convosOpen: 0,
    msgIn: 0,
    msgOut: 0,
    posts: 0,
    postsPublished: 0,
    postsScheduled: 0,
  },
  trend: { days: [], in: [], out: [] },
  contentMix: {},
  convoMix: {},
  posts: [],
};

/**
 * Page insights (WD-FB-019): the live Graph metrics blended with what this system knows locally (Messenger threads and messages,
 * posts made here), so the screen is never empty. Nothing is stored; the identity header always shows which Page is being read.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InsightsRepository,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(FACEBOOK_PLAN_GATE) private readonly plan: FacebookPlanGate,
  ) {}

  async view(q: InsightsQuery): Promise<FbInsights> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertPosts(orgId);
    const connected = (await this.db.tx((tx) => this.pages.list(tx, orgId))).filter(
      (p) => p.status === 'connected',
    );
    const brief = (p: PageRow) => ({ id: p.uuid, pageId: p.pageId, name: p.name });
    const page = connected.find((p) => p.uuid === q.page) ?? connected[0];
    if (!page) return { pages: [], page: null, ...EMPTY };

    const api = this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);
    const profile = (await api.getProfile()).data;
    const kpis = kpisFrom(await api.pageInsights(PAGE_METRICS));

    const tz = validTimeZone(q.tz);
    const days = lastDays(tz, new Date(), TREND_DAYS);
    const { local, perDay, convoMix, contentMix, latest } = await this.db.tx(async (tx) => ({
      local: await this.repo.stats(tx, orgId, page.pageId, page.id),
      perDay: await this.repo.trend(tx, orgId, page.pageId, tz, days[0]!),
      convoMix: await this.repo.threadMix(tx, orgId, page.pageId),
      contentMix: await this.repo.contentMix(tx, orgId, page.id),
      latest: await this.repo.latestPosts(tx, orgId, page.id, RECENT_POSTS),
    }));

    // Recent posts: live from Meta first, each with its numbers; this system's own posts when Meta lists none.
    const live = await api.recentPosts(RECENT_POSTS);
    const posts: FbInsights['posts'] =
      live.length > 0
        ? await Promise.all(
            live.map(async (p) => ({
              message: p.message ?? '',
              created: p.created_time ?? '',
              permalink: p.permalink_url ?? '',
              picture: p.full_picture ?? '',
              type: 'live',
              status: null,
              stats: p.id
                ? postStats(await api.postInsights(p.id, POST_METRICS))
                : { impressions: 0, engaged: 0 },
            })),
          )
        : latest.map((p) => ({
            message: p.message ?? '',
            created: (p.publishedAt ?? p.createdAt).toISOString(),
            permalink: p.fbPostId ? `https://facebook.com/${p.fbPostId}` : '',
            picture: p.photo ?? '',
            type: p.type,
            status: p.status,
            stats: { impressions: 0, engaged: 0 },
          }));

    return {
      pages: connected.map(brief),
      page: brief(page),
      identity: {
        name: profile?.name ?? page.name ?? page.pageId,
        category: profile?.category ?? page.category ?? 'Facebook Page',
        username: profile?.username ?? page.username,
        avatar: profile?.picture?.data?.url || page.pictureUrl,
        pageId: page.pageId,
      },
      followers: profile?.followers_count ?? profile?.fan_count ?? page.fanCount,
      kpis,
      local,
      trend: {
        days,
        in: days.map((d) => perDay.get(d)?.in ?? 0),
        out: days.map((d) => perDay.get(d)?.out ?? 0),
      },
      contentMix,
      convoMix,
      posts,
    };
  }
}
