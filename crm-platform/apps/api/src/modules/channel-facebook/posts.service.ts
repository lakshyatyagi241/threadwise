import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateFbPostInput,
  type FbMyPosts,
  type FbPost,
  type FbPostList,
  type ListFbPostsQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphResult,
} from '../../infra/providers/channel-facebook/facebook.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { FACEBOOK_PLAN_GATE, type FacebookPlanGate } from './_shims/tokens';
import { TOKEN_INVALID_MESSAGE, clipError, isTokenError } from './page-rules';
import {
  PAGE_SIZE,
  POST_ERROR_LIMIT,
  checkSchedule,
  contentProblem,
  keepPhotos,
  likePattern,
  postType,
  rangeSince,
} from './post-rules';
import { PagesRepository, type PageRow } from './pages.repository';
import { PostsRepository, type PostRow } from './posts.repository';

const MODULE_KEY = 'facebook_posts';

const invalid = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Facebook posts (WD-FB-016 to 018): compose, publish or schedule, list, retry, delete, and the live "My posts" grid.
 *
 * A post row is written BEFORE Meta is called, so a failure leaves a `failed` row with the reason that can be retried, never a
 * post that vanished. A scheduled post is held by Meta (`published=false` with a time); there is no local sweeper.
 *
 * Uploading a file waits on the storage domain: photos and the video are public addresses for now (recorded in the parity file).
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PostsRepository,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(FACEBOOK_PLAN_GATE) private readonly plan: FacebookPlanGate,
  ) {}

  toResponse(r: PostRow): FbPost {
    return {
      id: r.uuid,
      pageId: r.pageUuid,
      pageName: r.pageName,
      type: r.type as FbPost['type'],
      status: r.status as FbPost['status'],
      message: r.message,
      link: r.link,
      photos: r.media.photos ?? [],
      video: r.media.video ?? null,
      fbPostId: r.fbPostId,
      scheduledPublishTime: r.scheduledPublishTime?.toISOString() ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private api(page: PageRow): FacebookPageApi {
    return this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);
  }

  private async connectedPages(orgId: number): Promise<PageRow[]> {
    return (await this.db.tx((tx) => this.pages.list(tx, orgId))).filter(
      (p) => p.status === 'connected',
    );
  }

  /** The connected Pages, the KPI cards and the filtered, paginated list (15 a page). */
  async list(q: ListFbPostsQuery): Promise<FbPostList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertPosts(orgId);
    const connected = await this.connectedPages(orgId);
    return this.db.tx(async (tx) => {
      // An unknown Page in the filter matches nothing, as a Page id of someone else's did in WaDesk.
      let pageRowId: number | null = null;
      if (q.account) {
        const page = await this.pages.findByUuid(tx, orgId, q.account);
        if (!page) return this.empty(connected, q.page);
        pageRowId = page.id;
      }
      const filter = {
        pageRowId,
        status: q.status,
        type: q.type,
        since: rangeSince(q.range, new Date()),
        like: q.q ? likePattern(q.q) : null,
      };
      const { rows, total } = await this.repo.list(
        tx,
        orgId,
        filter,
        PAGE_SIZE,
        (q.page - 1) * PAGE_SIZE,
      );
      const agg = await this.repo.aggregates(tx, orgId, pageRowId);
      const t = (k: string) => agg.types[k] ?? 0;
      return {
        data: rows.map((r) => this.toResponse(r)),
        counts: { scheduled: agg.scheduled, published: agg.published, failed: agg.failed },
        typeCounts: {
          all: agg.total,
          text: t('text'),
          link: t('link'),
          photo: t('photo'),
          multi_photo: t('multi_photo'),
          video: t('video'),
          reel: t('reel'),
        },
        meta: {
          page: q.page,
          perPage: PAGE_SIZE,
          total,
          lastPage: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        },
        pages: connected.map((p) => ({ id: p.uuid, pageId: p.pageId, name: p.name })),
      };
    });
  }

  private empty(connected: PageRow[], page: number): FbPostList {
    return {
      data: [],
      counts: { scheduled: 0, published: 0, failed: 0 },
      typeCounts: { all: 0, text: 0, link: 0, photo: 0, multi_photo: 0, video: 0, reel: 0 },
      meta: { page, perPage: PAGE_SIZE, total: 0, lastPage: 1 },
      pages: connected.map((p) => ({ id: p.uuid, pageId: p.pageId, name: p.name })),
    };
  }

  /**
   * Makes a post. The row is saved first (`draft`, or `scheduled`), then Meta is called; the row ends `published`, `scheduled` or
   * `failed` with Meta's reason. A refusal by Meta is not an HTTP error: the failed post is the answer, and can be retried.
   */
  async create(input: CreateFbPostInput): Promise<FbPost> {
    const ctx = RequestContextStore.require();
    await this.plan.assertPosts(ctx.orgId);

    const page = await this.db.tx((tx) => this.pages.findByUuid(tx, ctx.orgId, input.pageId));
    if (!page || page.status !== 'connected') {
      throw invalid('FB_PAGE_UNAVAILABLE', 'Pick a connected Facebook Page.');
    }

    const message = (input.message ?? '').trim();
    const link = (input.link ?? '').trim();
    const video = (input.videoUrl ?? '').trim();
    const photos = video === '' ? keepPhotos(input.photoUrls ?? []) : [];
    const problem = contentProblem({ message, link, photos, video });
    if (problem) throw invalid('FB_POST_INVALID', problem);

    const when = checkSchedule(input.scheduledAt ? new Date(input.scheduledAt) : null, new Date());
    if (!when.ok) throw invalid('FB_SCHEDULE_INVALID', when.message);

    const type = postType({ photos, link, video, asReel: input.asReel === true });
    const id = await this.db.tx(async (tx) => {
      const rowId = await this.repo.insert(tx, ctx.orgId, {
        pageRowId: page.id,
        userId: ctx.userId,
        type,
        status: when.ts === null ? 'draft' : 'scheduled',
        message: message === '' ? null : message,
        link: link === '' ? null : link,
        media: video !== '' ? { video } : { photos },
        scheduledPublishTime: when.at,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: rowId, action: 'insert' });
      return rowId;
    });

    const api = this.api(page);
    const res =
      type === 'reel'
        ? await api.postReel(video, message, when.ts)
        : type === 'video'
          ? await api.postVideo(video, message, when.ts)
          : await api.publish({ message, link, photos, scheduledTs: when.ts });
    return this.settle(ctx.orgId, page, id, res, when.ts === null ? 'published' : 'scheduled');
  }

  /** Publish a draft or failed post now (retry). A post already live or held by Meta would be posted twice, so it is refused. */
  async publish(uuid: string): Promise<FbPost> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertPosts(orgId);
    const { post, page } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, orgId, uuid, true);
      if (!found) throw AppError.notFound('Facebook post', uuid);
      const owner = await this.pages.findById(tx, orgId, found.pageRowId);
      if (!owner) throw AppError.notFound('Facebook post', uuid);
      return { post: found, page: owner };
    });
    if (post.status !== 'draft' && post.status !== 'failed') {
      throw invalid(
        'FB_POST_INVALID',
        'This post is already published or scheduled.',
        HttpStatus.CONFLICT,
      );
    }

    const api = this.api(page);
    const video = post.media.video ?? '';
    const message = post.message ?? '';
    const res =
      post.type === 'reel'
        ? await api.postReel(video, message, null)
        : post.type === 'video'
          ? await api.postVideo(video, message, null)
          : await api.publish({
              message,
              link: post.link ?? '',
              photos: post.media.photos ?? [],
              scheduledTs: null,
            });
    return this.settle(orgId, page, post.id, res, 'published');
  }

  /** Writes what Meta answered onto the post and returns it. A revoked token also flags the Page. */
  private async settle(
    orgId: number,
    page: PageRow,
    postId: number,
    res: GraphResult<{ id: string }>,
    status: 'published' | 'scheduled',
  ): Promise<FbPost> {
    const ok = res.ok;
    const error = (res.error ?? 'publish failed').slice(0, POST_ERROR_LIMIT);
    return this.db.tx(async (tx) => {
      if (!ok && isTokenError(res.code)) {
        await this.pages.markExpired(
          tx,
          orgId,
          page.id,
          clipError(res.error) ?? TOKEN_INVALID_MESSAGE,
        );
      }
      await this.repo.markResult(
        tx,
        orgId,
        postId,
        ok ? { ok: true, fbPostId: res.data?.id ?? '', status } : { ok: false, error },
      );
      const row = await this.repo.findById(tx, orgId, postId);
      if (!row) throw AppError.notFound('Facebook post', String(postId));
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: postId,
        eventType: ok ? `facebook.post.${status}` : 'facebook.post.failed',
        payload: { uuid: row.uuid, page: page.pageId, type: row.type, ...(ok ? {} : { error }) },
      });
      if (!ok)
        this.logger.warn(
          { orgId, page: page.pageId, post: row.uuid, error },
          'facebook post refused',
        );
      return this.toResponse(row);
    });
  }

  /** Delete from Meta when it has an id (a failure there is ignored: the post goes locally regardless), then locally. */
  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertPosts(orgId);
    const found = await this.db.tx(async (tx) => {
      const post = await this.repo.findByUuid(tx, orgId, uuid);
      if (!post) throw AppError.notFound('Facebook post', uuid);
      return { post, page: await this.pages.findById(tx, orgId, post.pageRowId) };
    });
    if (found.post.fbPostId && found.page) {
      await this.api(found.page)
        .deletePost(found.post.fbPostId)
        .catch(() => undefined);
    }
    await this.db.tx(async (tx) => {
      await this.repo.remove(tx, orgId, found.post.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: found.post.id,
        action: 'delete',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.post.id,
        eventType: 'facebook.post.deleted',
        payload: { uuid: found.post.uuid, status: found.post.status },
      });
    });
  }

  /** The Page's live feed (50 newest). Nothing is stored; Meta not answering is an empty grid, never an error. */
  async myPosts(pageUuid: string | undefined): Promise<FbMyPosts> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertPosts(orgId);
    const connected = await this.connectedPages(orgId);
    const brief = (p: PageRow) => ({ id: p.uuid, pageId: p.pageId, name: p.name });
    const page = connected.find((p) => p.uuid === pageUuid) ?? connected[0];
    if (!page) return { pages: [], page: null, items: [] };
    const feed = await this.api(page)
      .recentPosts(50)
      .catch(() => []);
    return {
      pages: connected.map(brief),
      page: brief(page),
      items: feed.map((p) => ({
        id: p.id,
        message: p.message ?? '',
        createdTime: p.created_time ?? '',
        permalinkUrl: p.permalink_url ?? '',
        picture: p.full_picture ?? '',
      })),
    };
  }
}
