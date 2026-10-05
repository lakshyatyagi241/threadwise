import { HttpStatus, Injectable } from '@nestjs/common';
import {
  compareMarketVersions,
  coreFeatureDefault,
  ERROR_CODES,
  marketManifestSchema,
  validateMarketManifest,
  validateMarketRecipe,
  type ApproveMarketVersionInput,
  type CreateMarketAppInput,
  type CreateMarketCategoryInput,
  type KillMarketAppInput,
  type MarketKillResult,
  type MarketManifest,
  type MarketOperatorApp,
  type MarketOperatorAppDetail,
  type MarketOperatorAppList,
  type MarketOperatorAppListQuery,
  type MarketOperatorCategory,
  type MarketOperatorCategoryList,
  type MarketPublishResult,
  type MarketRecipe,
  type PublishMarketAppInput,
  type RejectMarketVersionInput,
  type SaveMarketVersionInput,
  type UpdateMarketAppInput,
  type UpdateMarketCategoryInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import {
  ConnectorRegistry,
  assertRecipeUrlsPublic,
  RecipeUrlRefusedError,
} from '../../infra/providers/marketplace';
import { AuthAuditService } from '../auth';
import {
  OperatorCatalogueStore,
  type OpAppRow,
  type OpCategoryRow,
  type OpVersionRow,
} from './operator-catalogue.store';
import { parseAppRef, versionAllows, type AppRef } from './marketplace-rules';
import { toPricingView } from './pricing-model';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';
import { readListing } from './marketplace.mapper';
import { isUniqueViolation, iso } from './sql-helpers';

const toCategory = (c: OpCategoryRow): MarketOperatorCategory => ({
  id: c.uuid,
  kind: c.kind,
  slug: c.slug,
  name: c.name,
  description: c.description,
  icon: c.icon,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
  appCount: c.appCount,
  rowVersion: c.rowVersion,
});

export const toApp = (a: OpAppRow): MarketOperatorApp => ({
  id: a.uuid,
  slug: a.slug,
  kind: a.kind,
  category: { slug: a.categorySlug, name: a.categoryName },
  name: a.name,
  tagline: a.tagline,
  status: a.status,
  firstParty: a.firstParty,
  featured: a.featured,
  planFeature: a.planFeature,
  pricing: toPricingView(a.pricing, a.uuid, a.packExists),
  activeSubscriptions: a.activeSubscriptions,
  sortOrder: a.sortOrder,
  connectorType: (a.connectorType as MarketOperatorApp['connectorType']) ?? null,
  publishedVersion: a.publishedVersion,
  latestVersion: a.latestVersion,
  installCount: a.installCount,
  killReason: a.killReason,
  killedAt: iso(a.killedAt),
  publishedAt: iso(a.publishedAt),
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
  rowVersion: a.rowVersion,
});

const toVersion = (v: OpVersionRow) => ({
  id: v.uuid,
  version: v.version,
  status: v.status,
  changelog: v.changelog,
  scopes: v.scopes,
  reviewNote: v.reviewNote,
  submittedAt: iso(v.submittedAt),
  reviewedAt: iso(v.reviewedAt),
  publishedAt: iso(v.publishedAt),
  createdAt: v.createdAt.toISOString(),
});

interface Docs {
  manifest: MarketManifest;
  recipe: MarketRecipe | null;
}

/**
 * The operator's catalogue work: listings, versions, review, publish, hide and kill, and the categories. Platform data, so every
 * statement runs on the platform store (the privileged door) and every write carries its audit event in the same transaction.
 *
 * What a version must satisfy before it is stored: the manifest follows manifest v1; an integration's recipe follows the recipe schema,
 * agrees with the manifest (same slug, category and connector type), passes its connector type's own checks, and every address in it is
 * safe to call (public, https, resolves to public addresses only). A version can only be PUBLISHED when its connector type is
 * implemented, so nothing non-functional reaches a workspace.
 */
@Injectable()
export class OperatorCatalogueService {
  constructor(
    private readonly store: OperatorCatalogueStore,
    private readonly audit: AuthAuditService,
    private readonly registry: ConnectorRegistry,
    private readonly subscriptions: MarketSubscriptionLifecycle,
  ) {}

  // --- categories -------------------------------------------------------------------------------------------------------------------------

  async listCategories(): Promise<MarketOperatorCategoryList> {
    const rows = await this.store.tx((tx) => this.store.categories(tx));
    return { data: rows.map(toCategory) };
  }

  async createCategory(input: CreateMarketCategoryInput): Promise<MarketOperatorCategory> {
    try {
      const uuid = await this.store.tx(async (tx) => {
        const id = await this.store.insertCategory(tx, {
          kind: input.kind,
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder,
        });
        await this.audit.record(tx, {
          event: 'platform.market.category_created',
          status: 'success',
          payload: { category: id, kind: input.kind, slug: input.slug },
        });
        return id;
      });
      return this.category(uuid);
    } catch (e) {
      if (isUniqueViolation(e))
        throw new AppError(
          ERROR_CODES.MKT_SLUG_TAKEN,
          'A category with that slug already exists.',
          HttpStatus.CONFLICT,
        );
      throw e;
    }
  }

  async updateCategory(
    uuid: string,
    input: UpdateMarketCategoryInput,
  ): Promise<MarketOperatorCategory> {
    await this.store.tx(async (tx) => {
      const c = await this.store.categoryByUuid(tx, uuid);
      if (!c) throw this.categoryNotFound();
      const ok = await this.store.updateCategory(
        tx,
        c.id,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        },
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Category');
      await this.audit.record(tx, {
        event: 'platform.market.category_updated',
        status: 'success',
        payload: { category: uuid, slug: c.slug },
      });
    });
    return this.category(uuid);
  }

  async deleteCategory(uuid: string): Promise<void> {
    await this.store.tx(async (tx) => {
      const c = await this.store.categoryByUuid(tx, uuid);
      if (!c) throw this.categoryNotFound();
      if (c.appCount > 0) {
        throw new AppError(
          ERROR_CODES.MKT_CATEGORY_IN_USE,
          'Apps are listed in this category. Move them first, or deactivate the category.',
          HttpStatus.CONFLICT,
        );
      }
      await this.store.deleteCategory(tx, c.id);
      await this.audit.record(tx, {
        event: 'platform.market.category_deleted',
        status: 'success',
        payload: { category: uuid, slug: c.slug },
      });
    });
  }

  private async category(uuid: string): Promise<MarketOperatorCategory> {
    const c = await this.store.tx((tx) => this.store.categoryByUuid(tx, uuid));
    if (!c) throw this.categoryNotFound();
    return toCategory(c);
  }

  // --- listings -----------------------------------------------------------------------------------------------------------------------------

  async listApps(q: MarketOperatorAppListQuery): Promise<MarketOperatorAppList> {
    const out = await this.store.tx((tx) => this.store.apps(tx, q));
    if (out.badCursor)
      throw AppError.validation('Invalid pagination cursor', [
        { path: 'cursor', message: 'malformed' },
      ]);
    const hasMore = out.rows.length > q.limit;
    const items = hasMore ? out.rows.slice(0, q.limit) : out.rows;
    return {
      data: items.map(toApp),
      page: {
        nextCursor: hasMore ? items[items.length - 1]!.cursor : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  async getApp(ref: string, versionId?: string): Promise<MarketOperatorAppDetail> {
    return this.store.tx((tx) => this.detail(tx, ref, versionId));
  }

  private async detail(tx: Tx, ref: string, versionId?: string): Promise<MarketOperatorAppDetail> {
    const app = await this.requireApp(tx, ref);
    const versions = await this.store.versions(tx, app.id);
    const chosen = versionId ? versions.find((v) => v.uuid === versionId) : versions[0];
    if (!chosen) throw AppError.notFound('Version', versionId);
    const manifest = marketManifestSchema.safeParse(chosen.manifest);
    const recipe = chosen.recipe ? validateMarketRecipe(chosen.recipe) : null;
    return {
      ...toApp(app),
      listing: readListing(app.listing),
      versions: versions.map(toVersion),
      manifest: manifest.success ? manifest.data : (chosen.manifest as unknown as MarketManifest),
      recipe: recipe && recipe.ok ? recipe.recipe : null,
      versionId: chosen.uuid,
      versionStatus: chosen.status,
    };
  }

  async createApp(
    input: CreateMarketAppInput,
    operatorId: number,
  ): Promise<MarketOperatorAppDetail> {
    const docs = await this.validateDocs(input.manifest, input.recipe, {
      firstParty: input.firstParty,
      requireRecipe: false,
    });
    const slug = docs.manifest.id;
    try {
      await this.store.tx(async (tx) => {
        const category = await this.requireCategory(tx, docs.manifest);
        const appId = await this.store.insertApp(tx, {
          slug,
          kind: docs.manifest.kind,
          categoryId: category.id,
          name: docs.manifest.name,
          tagline: input.tagline,
          firstParty: input.firstParty,
          featured: input.featured,
          planFeature: input.planFeature ?? null,
          sortOrder: input.sortOrder,
          connectorType: docs.manifest.connector?.type ?? null,
          listing: input.listing,
          operatorId,
        });
        await this.store.insertVersion(tx, {
          appId,
          version: docs.manifest.version,
          manifest: docs.manifest,
          recipe: docs.recipe,
          scopes: docs.manifest.scopes,
          changelog: input.changelog,
          operatorId,
        });
        await this.audit.record(tx, {
          event: 'platform.market.app_created',
          status: 'success',
          payload: { app: slug, kind: docs.manifest.kind, version: docs.manifest.version },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new AppError(
          ERROR_CODES.MKT_SLUG_TAKEN,
          'An app with that id already exists.',
          HttpStatus.CONFLICT,
        );
      throw e;
    }
    return this.getApp(slug);
  }

  async updateApp(ref: string, input: UpdateMarketAppInput): Promise<MarketOperatorAppDetail> {
    const slug = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      // A third-party app can never own a plan feature: take the grant away before taking away the first-party flag.
      if (input.firstParty === false && app.pricing.grantsPlanFeatures.length > 0)
        throw AppError.validation('This app grants plan features, so it must stay first-party.', [
          { path: 'firstParty', message: 'Remove the plan features this app grants first.' },
        ]);
      const patch: Record<string, unknown> = {
        ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
        ...(input.listing !== undefined ? { listing: input.listing } : {}),
        ...(input.firstParty !== undefined ? { first_party: input.firstParty } : {}),
        ...(input.featured !== undefined ? { featured: input.featured } : {}),
        ...(input.planFeature !== undefined ? { plan_feature: input.planFeature } : {}),
        ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
      };
      const ok = await this.store.updateApp(tx, app.id, patch, input.rowVersion);
      if (!ok) throw AppError.rowVersionConflict('App');
      await this.audit.record(tx, {
        event: 'platform.market.app_updated',
        status: 'success',
        payload: { app: app.slug, fields: Object.keys(patch) },
      });
      return app.slug;
    });
    return this.getApp(slug);
  }

  /** Only a listing that was never published and has no installation can be deleted; anything else is hidden or killed. */
  async deleteApp(ref: string): Promise<void> {
    await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      if (app.status !== 'draft' && app.status !== 'in_review') {
        throw new AppError(
          ERROR_CODES.MKT_VERSION_STATE,
          'Only a draft listing can be deleted. Hide or kill a published one.',
          HttpStatus.CONFLICT,
        );
      }
      if (app.installCount > 0 || app.currentVersionId !== null) {
        throw new AppError(
          ERROR_CODES.MKT_VERSION_STATE,
          'This listing has been published or installed. Hide it instead.',
          HttpStatus.CONFLICT,
        );
      }
      await this.store.deleteApp(tx, app.id);
      await this.audit.record(tx, {
        event: 'platform.market.app_deleted',
        status: 'success',
        payload: { app: app.slug },
      });
    });
  }

  // --- versions and review --------------------------------------------------------------------------------------------------------------

  async saveVersion(
    ref: string,
    input: SaveMarketVersionInput,
    operatorId: number,
  ): Promise<MarketOperatorAppDetail> {
    const head = await this.store.tx((tx) => this.requireApp(tx, ref));
    const docs = await this.validateDocs(input.manifest, input.recipe, {
      firstParty: head.firstParty,
      requireRecipe: false,
      expect: head,
    });
    try {
      await this.store.tx(async (tx) => {
        const app = await this.requireApp(tx, ref, true);
        const versions = await this.store.versions(tx, app.id);
        const newest = versions.reduce<string | null>(
          (m, v) => (m === null || compareMarketVersions(v.version, m) > 0 ? v.version : m),
          null,
        );
        if (newest !== null && compareMarketVersions(docs.manifest.version, newest) <= 0) {
          throw new AppError(
            ERROR_CODES.MKT_VERSION_EXISTS,
            `The version must be higher than ${newest}.`,
            HttpStatus.CONFLICT,
            [{ path: 'manifest.version', message: `higher_than:${newest}` }],
          );
        }
        await this.requireCategory(tx, docs.manifest);
        await this.store.insertVersion(tx, {
          appId: app.id,
          version: docs.manifest.version,
          manifest: docs.manifest,
          recipe: docs.recipe,
          scopes: docs.manifest.scopes,
          changelog: input.changelog,
          operatorId,
        });
        await this.audit.record(tx, {
          event: 'platform.market.version_created',
          status: 'success',
          payload: { app: app.slug, version: docs.manifest.version },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new AppError(
          ERROR_CODES.MKT_VERSION_EXISTS,
          'That version already exists.',
          HttpStatus.CONFLICT,
        );
      throw e;
    }
    return this.getApp(head.slug);
  }

  /** Replaces the documents of a draft or rejected version. A rejected one goes back to draft. */
  async updateVersion(
    ref: string,
    versionId: string,
    input: SaveMarketVersionInput,
  ): Promise<MarketOperatorAppDetail> {
    const head = await this.store.tx((tx) => this.requireApp(tx, ref));
    const docs = await this.validateDocs(input.manifest, input.recipe, {
      firstParty: head.firstParty,
      requireRecipe: false,
      expect: head,
    });
    await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      const v = await this.requireVersion(tx, app, versionId, true);
      if (!versionAllows(v.status, 'edit')) throw this.versionState(v, 'edited');
      await this.requireCategory(tx, docs.manifest);
      const versions = await this.store.versions(tx, app.id);
      if (versions.some((o) => o.id !== v.id && o.version === docs.manifest.version)) {
        throw new AppError(
          ERROR_CODES.MKT_VERSION_EXISTS,
          'That version already exists.',
          HttpStatus.CONFLICT,
        );
      }
      await this.store.updateVersion(tx, v.id, {
        version: docs.manifest.version,
        manifest: docs.manifest,
        recipe: docs.recipe,
        scopes: docs.manifest.scopes,
        changelog: input.changelog,
        status: 'draft',
        reviewNote: null,
      });
      await this.audit.record(tx, {
        event: 'platform.market.version_updated',
        status: 'success',
        payload: { app: app.slug, version: docs.manifest.version },
      });
    });
    return this.getApp(head.slug, versionId);
  }

  async submit(ref: string, versionId: string): Promise<MarketOperatorAppDetail> {
    const head = await this.store.tx((tx) => this.requireApp(tx, ref));
    const pre = await this.store.tx(async (tx) => this.requireVersion(tx, head, versionId));
    await this.validateDocs(pre.manifest, pre.recipe ?? undefined, {
      firstParty: head.firstParty,
      requireRecipe: head.kind === 'integration',
      expect: head,
    });
    await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      const v = await this.requireVersion(tx, app, versionId, true);
      if (!versionAllows(v.status, 'submit')) throw this.versionState(v, 'submitted');
      await this.store.updateVersion(tx, v.id, {
        status: 'in_review',
        submittedAt: new Date(),
        reviewNote: null,
      });
      if (app.status === 'draft') await this.store.updateApp(tx, app.id, { status: 'in_review' });
      await this.audit.record(tx, {
        event: 'platform.market.version_submitted',
        status: 'success',
        payload: { app: app.slug, version: v.version },
      });
    });
    return this.getApp(head.slug, versionId);
  }

  async approve(
    ref: string,
    versionId: string,
    input: ApproveMarketVersionInput,
    operatorId: number,
  ): Promise<MarketOperatorAppDetail> {
    const slug = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      const v = await this.requireVersion(tx, app, versionId, true);
      if (!versionAllows(v.status, 'approve')) throw this.versionState(v, 'approved');
      await this.store.updateVersion(tx, v.id, {
        status: 'approved',
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        reviewedBy: operatorId,
      });
      await this.audit.record(tx, {
        event: 'platform.market.version_approved',
        status: 'success',
        payload: { app: app.slug, version: v.version },
      });
      return app.slug;
    });
    return this.getApp(slug, versionId);
  }

  async reject(
    ref: string,
    versionId: string,
    input: RejectMarketVersionInput,
    operatorId: number,
  ): Promise<MarketOperatorAppDetail> {
    const slug = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      const v = await this.requireVersion(tx, app, versionId, true);
      if (!versionAllows(v.status, 'reject')) throw this.versionState(v, 'rejected');
      await this.store.updateVersion(tx, v.id, {
        status: 'rejected',
        reviewNote: input.note,
        reviewedAt: new Date(),
        reviewedBy: operatorId,
      });
      if (app.status === 'in_review' && app.currentVersionId === null)
        await this.store.updateApp(tx, app.id, { status: 'draft' });
      await this.audit.record(tx, {
        event: 'platform.market.version_rejected',
        status: 'success',
        payload: { app: app.slug, version: v.version },
      });
      return app.slug;
    });
    return this.getApp(slug, versionId);
  }

  // --- publish, hide, kill ---------------------------------------------------------------------------------------------------------------

  /**
   * Makes an approved version the one new installations get. Installations whose granted scopes already cover it move to it now; those it
   * asks more of keep running on their version until their admin accepts the new permission list (re-consent).
   */
  async publish(
    ref: string,
    input: PublishMarketAppInput,
    operatorId: number,
  ): Promise<MarketPublishResult> {
    const head = await this.store.tx((tx) => this.requireApp(tx, ref));
    const picked = await this.store.tx(async (tx) =>
      input.versionId
        ? this.requireVersion(tx, head, input.versionId)
        : this.store.latestApproved(tx, head.id),
    );
    if (!picked)
      throw new AppError(
        ERROR_CODES.MKT_VERSION_STATE,
        'There is no approved version to publish.',
        HttpStatus.CONFLICT,
      );
    if (!versionAllows(picked.status, 'publish')) throw this.versionState(picked, 'published');
    const docs = await this.validateDocs(picked.manifest, picked.recipe ?? undefined, {
      firstParty: head.firstParty,
      requireRecipe: head.kind === 'integration',
      expect: head,
    });
    if (docs.manifest.connector && !this.registry.isImplemented(docs.manifest.connector.type)) {
      throw new AppError(
        ERROR_CODES.MKT_CONNECTOR_NOT_AVAILABLE,
        `The ${docs.manifest.connector.type} connector type is not available yet, so this listing cannot be published.`,
        HttpStatus.CONFLICT,
        [{ path: 'manifest.connector.type', message: docs.manifest.connector.type }],
      );
    }

    const result = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      if (app.status === 'killed') throw this.killedRefusal();
      if (app.pricing.pricingModel === 'paid_monthly' && app.pricing.priceAmount === null)
        throw new AppError(
          ERROR_CODES.MKT_VERSION_STATE,
          'This is a paid app and its price is not set. Set the price before publishing.',
          HttpStatus.CONFLICT,
          [{ path: 'pricing', message: 'price_not_set' }],
        );
      // An app that owns a plan feature cannot go on sale while every plan still grants that feature by default: it would sell what everyone
      // already has. Switch the registry default off first (after running the grandfather action while it is still on).
      const everyoneHas = app.pricing.grantsPlanFeatures.filter(
        (k) => coreFeatureDefault(k) === true,
      );
      if (everyoneHas.length > 0)
        throw new AppError(
          ERROR_CODES.MKT_VERSION_STATE,
          `This app owns ${everyoneHas.join(', ')}, which every plan still grants by default. Switch the registry default off before publishing.`,
          HttpStatus.CONFLICT,
          everyoneHas.map((k) => ({ path: 'grantsPlanFeatures', message: k })),
        );
      const v = await this.requireVersion(tx, app, picked.uuid, true);
      if (!versionAllows(v.status, 'publish')) throw this.versionState(v, 'published');
      const category = await this.requireCategory(tx, docs.manifest);
      await this.store.retireOthers(tx, app.id, v.id);
      await this.store.updateVersion(tx, v.id, { status: 'published', publishedAt: new Date() });
      await this.store.updateApp(tx, app.id, {
        status: 'published',
        current_version_id: v.id,
        name: docs.manifest.name,
        category_id: category.id,
        connector_type: docs.manifest.connector?.type ?? null,
        published_at: app.publishedAt ?? new Date(),
      });
      const moved = await this.store.applyVersion(
        tx,
        app.id,
        app,
        { id: v.id, version: v.version, scopes: v.scopes },
        operatorId,
      );
      await this.audit.record(tx, {
        event: 'platform.market.app_published',
        status: 'success',
        payload: {
          app: app.slug,
          version: v.version,
          upgraded: moved.upgraded,
          awaitingConsent: moved.awaitingConsent,
        },
      });
      return moved;
    });
    return { app: await this.appView(head.slug), ...result };
  }

  async hide(ref: string): Promise<MarketOperatorApp> {
    return this.transition(ref, 'platform.market.app_hidden', (app) => {
      if (app.status !== 'published') throw this.appState(app, 'hidden');
      return { status: 'hidden' };
    });
  }

  async unhide(ref: string): Promise<MarketOperatorApp> {
    return this.transition(ref, 'platform.market.app_unhidden', (app) => {
      if (app.status !== 'hidden' || app.currentVersionId === null)
        throw this.appState(app, 'shown again');
      return { status: 'published' };
    });
  }

  /** After a kill the listing stays out of the catalogue. This moves it to hidden so it can be fixed and published again; installations stay killed. */
  async unkill(ref: string): Promise<MarketOperatorApp> {
    return this.transition(ref, 'platform.market.app_unkilled', (app) => {
      if (app.status !== 'killed') throw this.appState(app, 'restored');
      return { status: 'hidden' };
    });
  }

  /** The kill switch: the listing is withdrawn and every installation of the app is switched off in this one transaction. */
  async kill(
    ref: string,
    input: KillMarketAppInput,
    operatorId: number,
  ): Promise<MarketKillResult> {
    const disabled = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      if (app.status === 'killed') throw this.appState(app, 'killed');
      await this.store.updateApp(tx, app.id, {
        status: 'killed',
        killed_at: new Date(),
        kill_reason: input.reason,
      });
      const n = await this.store.killInstallations(tx, app.id, app, input.reason, operatorId);
      // What was paid for runs to its end, but nothing renews: the app is withdrawn.
      await this.subscriptions.cancelAllForApp(tx, app.id, app.slug, input.reason);
      await this.audit.record(tx, {
        event: 'platform.market.app_killed',
        status: 'warning',
        payload: { app: app.slug, reason: input.reason, installations: n },
      });
      return n;
    });
    return { app: await this.appView(ref), disabledInstallations: disabled };
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------------

  private async transition(
    ref: string,
    event: string,
    decide: (app: OpAppRow) => Record<string, unknown>,
  ): Promise<MarketOperatorApp> {
    const slug = await this.store.tx(async (tx) => {
      const app = await this.requireApp(tx, ref, true);
      const patch = decide(app);
      await this.store.updateApp(tx, app.id, patch);
      await this.audit.record(tx, {
        event,
        status: 'success',
        payload: { app: app.slug, status: patch.status },
      });
      return app.slug;
    });
    return this.appView(slug);
  }

  private async appView(ref: string): Promise<MarketOperatorApp> {
    return toApp(await this.store.tx((tx) => this.requireApp(tx, ref)));
  }

  private async requireApp(tx: Tx, ref: string, forUpdate = false): Promise<OpAppRow> {
    const parsed: AppRef | null = parseAppRef(ref);
    const app = parsed ? await this.store.app(tx, parsed, forUpdate) : null;
    if (!app)
      throw new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
    return app;
  }

  private async requireVersion(
    tx: Tx,
    app: OpAppRow,
    uuid: string,
    forUpdate = false,
  ): Promise<OpVersionRow> {
    const v = await this.store.version(tx, app.id, uuid, forUpdate);
    if (!v) throw AppError.notFound('Version', uuid);
    return v;
  }

  private async requireCategory(tx: Tx, manifest: MarketManifest): Promise<OpCategoryRow> {
    const c = await this.store.categoryBySlug(tx, manifest.kind, manifest.category);
    if (!c || !c.isActive) {
      throw new AppError(
        ERROR_CODES.MKT_CATEGORY_NOT_FOUND,
        `There is no ${manifest.kind.replace('_', ' ')} category "${manifest.category}".`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'manifest.category', message: 'unknown' }],
      );
    }
    return c;
  }

  /** Manifest v1, the recipe, and everything the two must agree on. Throws with every problem, paths included. */
  private async validateDocs(
    manifestRaw: unknown,
    recipeRaw: unknown,
    o: { firstParty: boolean; requireRecipe: boolean; expect?: { slug: string; kind: string } },
  ): Promise<Docs> {
    const m = validateMarketManifest(manifestRaw);
    if (!m.ok) {
      throw new AppError(
        ERROR_CODES.MKT_MANIFEST_INVALID,
        'The manifest does not follow manifest v1.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        m.problems.map((p) => ({ path: `manifest.${p.path}`, message: p.message })),
      );
    }
    const manifest = m.manifest;
    const problems: Array<{ path: string; message: string }> = [];
    if (o.expect && manifest.id !== o.expect.slug)
      problems.push({ path: 'manifest.id', message: `must stay "${o.expect.slug}"` });
    if (o.expect && manifest.kind !== o.expect.kind)
      problems.push({ path: 'manifest.kind', message: `must stay "${o.expect.kind}"` });
    if (manifest.module && !o.firstParty)
      problems.push({
        path: 'manifest.module',
        message: 'Only a first-party app is backed by a module.',
      });
    if (problems.length > 0) {
      throw new AppError(
        ERROR_CODES.MKT_MANIFEST_INVALID,
        'The manifest does not fit the listing.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        problems,
      );
    }

    if (manifest.kind === 'mini_app') {
      if (recipeRaw !== undefined && recipeRaw !== null) {
        throw new AppError(
          ERROR_CODES.MKT_RECIPE_INVALID,
          'A mini app has no recipe.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'recipe', message: 'not_allowed' }],
        );
      }
      return { manifest, recipe: null };
    }
    if (recipeRaw === undefined || recipeRaw === null) {
      if (o.requireRecipe) {
        throw new AppError(
          ERROR_CODES.MKT_RECIPE_INVALID,
          'An integration needs its recipe.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'recipe', message: 'Required' }],
        );
      }
      return { manifest, recipe: null };
    }
    const r = validateMarketRecipe(recipeRaw);
    if (!r.ok) {
      throw new AppError(
        ERROR_CODES.MKT_RECIPE_INVALID,
        'The recipe does not follow the recipe schema.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        r.problems.map((p) => ({ path: `recipe.${p.path}`, message: p.message })),
      );
    }
    const recipe = r.recipe;
    if (recipe.key !== manifest.id)
      problems.push({ path: 'recipe.key', message: `must equal the manifest id "${manifest.id}"` });
    if (recipe.category !== manifest.category)
      problems.push({
        path: 'recipe.category',
        message: `must equal the manifest category "${manifest.category}"`,
      });
    if (recipe.connector.type !== manifest.connector?.type)
      problems.push({
        path: 'recipe.connector.type',
        message: `must equal the manifest connector type "${manifest.connector?.type}"`,
      });
    if (problems.length === 0) {
      for (const p of this.registry.get(recipe.connector.type).checkRecipe(recipe))
        problems.push({ path: `recipe.${p.path}`, message: p.message });
    }
    if (problems.length > 0) {
      throw new AppError(
        ERROR_CODES.MKT_RECIPE_INVALID,
        'The recipe does not fit the listing.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        problems,
      );
    }
    try {
      await assertRecipeUrlsPublic(recipe, {
        allowDevHosts: process.env.MARKETPLACE_ALLOW_PRIVATE_HOSTS === 'true',
      });
    } catch (e) {
      if (e instanceof RecipeUrlRefusedError) {
        throw new AppError(
          ERROR_CODES.MKT_URL_REFUSED,
          `An address in the recipe is refused: ${e.reason}.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'recipe.connector', message: e.reason }],
        );
      }
      throw e;
    }
    return { manifest, recipe };
  }

  private versionState(v: OpVersionRow, action: string): AppError {
    return new AppError(
      ERROR_CODES.MKT_VERSION_STATE,
      `A version that is ${v.status.replace('_', ' ')} cannot be ${action}.`,
      HttpStatus.CONFLICT,
      [{ path: 'status', message: v.status }],
    );
  }
  private appState(app: OpAppRow, action: string): AppError {
    return new AppError(
      ERROR_CODES.MKT_VERSION_STATE,
      `A listing that is ${app.status.replace('_', ' ')} cannot be ${action}.`,
      HttpStatus.CONFLICT,
      [{ path: 'status', message: app.status }],
    );
  }
  private killedRefusal(): AppError {
    return new AppError(
      ERROR_CODES.MKT_APP_UNAVAILABLE,
      'A killed listing cannot be published. Restore it first.',
      HttpStatus.CONFLICT,
    );
  }
  private categoryNotFound(): AppError {
    return new AppError(
      ERROR_CODES.MKT_CATEGORY_NOT_FOUND,
      'Category not found',
      HttpStatus.NOT_FOUND,
    );
  }
}
