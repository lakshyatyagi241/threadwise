import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type MarketAppDetail,
  type MarketAppList,
  type MarketAppListQuery,
  type MarketCategoryList,
  type MarketCategoryListQuery,
  type MarketShelves,
  type MarketAppKind,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { BrowseRepository, type CardRow } from './browse.repository';
import { MarketplaceAccess } from './marketplace-access.service';
import { parseAppRef } from './marketplace-rules';
import { readManifest, toCard, toDetail } from './marketplace.mapper';
import { cardPricing, PricingAccess } from './pricing-access.service';
import { toSubscriptionView } from './pricing-model';

const SHELF_SIZE = 8;

const pricingFacts = (r: CardRow) => ({
  appId: r.id,
  slug: r.slug,
  uuid: r.uuid,
  pricing: r.pricing,
  sub: r.sub,
  installed: r.inst_uuid !== null,
});

/**
 * Browse, search, categories, shelves and an app's page, for the calling workspace. Every statement runs in the workspace's tenant
 * transaction; the catalogue's row-level security means a draft, an app in review, and a hidden or killed app the workspace has not
 * installed do not exist for it.
 */
@Injectable()
export class BrowseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BrowseRepository,
    private readonly access: MarketplaceAccess,
    private readonly pricing: PricingAccess,
  ) {}

  async categories(q: MarketCategoryListQuery): Promise<MarketCategoryList> {
    const { orgId } = RequestContextStore.require();
    const vis = await this.pricing.visibility(orgId);
    const rows = await this.db.tx((tx) => this.repo.categories(tx, orgId, vis, q.kind));
    return {
      data: rows.map((c) => ({
        id: c.uuid,
        kind: c.kind,
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        sortOrder: c.sort_order,
        appCount: c.app_count,
      })),
    };
  }

  async list(q: MarketAppListQuery): Promise<MarketAppList> {
    const { orgId } = RequestContextStore.require();
    const vis = await this.pricing.visibility(orgId);
    const { page, installedCount } = await this.db.tx(async (tx) => ({
      page: await this.repo.list(tx, orgId, q, vis),
      installedCount: await this.repo.installedCount(tx, orgId),
    }));
    if (page.badCursor)
      throw AppError.validation('Invalid pagination cursor', [
        { path: 'cursor', message: 'malformed' },
      ]);
    const { items, nextCursor, hasMore } = this.repo.nextCursor(page.rows, q.limit);
    return {
      data: await this.cards(orgId, items, installedCount),
      page: { nextCursor, hasMore, limit: q.limit },
    };
  }

  async shelves(kind: MarketAppKind): Promise<MarketShelves> {
    const { orgId } = RequestContextStore.require();
    const vis = await this.pricing.visibility(orgId);
    const r = await this.db.tx(async (tx) => ({
      popular: await this.repo.shelf(tx, orgId, kind, 'popular', SHELF_SIZE, vis),
      fresh: await this.repo.shelf(tx, orgId, kind, 'new', SHELF_SIZE, vis),
      featured: await this.repo.shelf(tx, orgId, kind, 'featured', SHELF_SIZE, vis, true),
      installedCount: await this.repo.installedCount(tx, orgId),
    }));
    return {
      popular: await this.cards(orgId, r.popular, r.installedCount),
      new: await this.cards(orgId, r.fresh, r.installedCount),
      featured: await this.cards(orgId, r.featured, r.installedCount),
    };
  }

  async detail(ref: string): Promise<MarketAppDetail> {
    const { orgId } = RequestContextStore.require();
    const parsed = parseAppRef(ref);
    if (!parsed) throw this.notFound();
    const vis = await this.pricing.visibility(orgId);
    const { row, installedCount } = await this.db.tx(async (tx) => ({
      row: await this.repo.detail(tx, orgId, parsed, vis),
      installedCount: await this.repo.installedCount(tx, orgId),
    }));
    if (!row) throw this.notFound();
    const evaluate = await this.access.evaluator(orgId, installedCount);
    const lock = await evaluate(this.lockFacts(row));
    const facts = pricingFacts(row);
    const priced = cardPricing(facts, await (await this.pricing.evaluator(orgId))(facts));
    const subscription = row.sub
      ? toSubscriptionView(row.sub, row.pricing, row.status, new Date())
      : null;
    return toDetail(row, lock, priced, subscription);
  }

  private async cards(orgId: number, rows: CardRow[], installedCount: number) {
    const evaluate = await this.access.evaluator(orgId, installedCount);
    const price = await this.pricing.evaluator(orgId);
    const out = [];
    for (const r of rows) {
      const facts = pricingFacts(r);
      out.push(
        toCard(r, await evaluate(this.lockFacts(r)), cardPricing(facts, await price(facts))),
      );
    }
    return out;
  }

  private lockFacts(r: CardRow) {
    return {
      planFeature: r.plan_feature,
      moduleSlug: readManifest(r.manifest)?.module ?? null,
      installed: r.inst_uuid !== null,
    };
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
  }
}
