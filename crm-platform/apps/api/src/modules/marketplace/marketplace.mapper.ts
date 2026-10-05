import {
  marketListingSchema,
  marketManifestSchema,
  marketScopeSummaries,
  recipeSchema,
  type MarketAppCard,
  type MarketAppDetail,
  type MarketCardPricing,
  type MarketConnectionView,
  type MarketInstallation,
  type MarketListing,
  type MarketLock,
  type MarketManifest,
  type MarketRecipe,
  type MarketSubscription,
  type RecipeSetupView,
} from '@crm/contracts';
import type { InboundDescription } from '../../infra/providers/marketplace';
import type { CardRow, DetailRow } from './browse.repository';
import type { InstallationRow } from './installations.repository';
import { iso } from './sql-helpers';

/**
 * Stored documents come back parsed again: a manifest or a recipe that no longer validates (a contract tightened after it was saved)
 * reads as absent, so one bad row never fails a whole listing.
 */
export const readManifest = (raw: unknown): MarketManifest | null => {
  const r = marketManifestSchema.safeParse(raw);
  return r.success ? r.data : null;
};
export const readRecipe = (raw: unknown): MarketRecipe | null => {
  if (raw === null || raw === undefined) return null;
  const r = recipeSchema.safeParse(raw);
  return r.success ? r.data : null;
};
export const readListing = (raw: unknown): MarketListing => {
  const r = marketListingSchema.safeParse(raw ?? {});
  return r.success ? r.data : marketListingSchema.parse({});
};

export function toCard(
  row: CardRow,
  lock: MarketLock | null,
  pricing: MarketCardPricing,
): MarketAppCard {
  const listing = readListing(row.listing);
  return {
    id: row.uuid,
    slug: row.slug,
    kind: row.kind,
    category: { slug: row.category_slug, name: row.category_name },
    name: row.name,
    tagline: row.tagline,
    logo: listing.logo ?? row.recipe_logo,
    firstParty: row.first_party,
    featured: row.featured,
    version: row.version,
    // The operator's catalogue pricing is the authority; the manifest's `pricing` is only the developer's proposal and is not shown.
    pricing,
    connectorType: (row.connector_type as MarketAppCard['connectorType']) ?? null,
    maturity: listing.maturity ?? 'stable',
    notice: listing.notice ?? null,
    installCount: row.install_count,
    publishedAt: iso(row.published_at),
    install: row.inst_uuid
      ? {
          installationId: row.inst_uuid,
          status: row.inst_status ?? 'active',
          health: row.inst_health ?? 'unknown',
          needsReconsent: row.needs_reconsent,
        }
      : null,
    locked: lock,
  };
}

/** What an admin fills in to set an integration up. No endpoints, no mapping, no secret values. */
export function toSetupView(recipe: MarketRecipe | null): RecipeSetupView | null {
  if (!recipe) return null;
  return {
    connectorType: recipe.connector.type,
    authFields: recipe.authFields.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      required: f.required,
      help: f.help ?? null,
      placeholder: f.placeholder ?? null,
      options: f.options ?? null,
    })),
    setupInstructions: recipe.setupInstructions,
    hasTestPayload: recipe.testPayloads.length > 0,
  };
}

export function toDetail(
  row: DetailRow,
  lock: MarketLock | null,
  pricing: MarketCardPricing,
  subscription: MarketSubscription | null,
): MarketAppDetail {
  const manifest = readManifest(row.manifest);
  return {
    ...toCard(row, lock, pricing),
    description: manifest?.description ?? row.tagline,
    listing: readListing(row.listing),
    scopes: marketScopeSummaries(manifest?.scopes ?? []),
    surfaces: manifest?.surfaces ?? [],
    support: manifest?.support ?? {},
    developer: manifest?.developer ?? null,
    changelog: row.changelog,
    setup: row.kind === 'integration' ? toSetupView(readRecipe(row.recipe)) : null,
    subscription,
  };
}

/** What the connection page shows of a pull connection's schedule: when it polls next, how far it has fetched, how often it may be asked. */
function pullView(
  recipe: MarketRecipe | null,
  conn: NonNullable<InstallationRow['connection']>,
): Pick<MarketConnectionView, 'nextPollAt' | 'syncedThrough' | 'minSyncIntervalSeconds'> {
  const c = recipe?.connector;
  if (!c || c.type !== 'pull')
    return { nextPollAt: null, syncedThrough: null, minSyncIntervalSeconds: null };
  const through = c.window && conn.pollCursor ? new Date(conn.pollCursor) : null;
  return {
    nextPollAt: conn.status === 'active' ? iso(conn.nextPollAt) : null,
    syncedThrough: through && !Number.isNaN(through.getTime()) ? through.toISOString() : null,
    minSyncIntervalSeconds: c.limits.minIntervalSeconds,
  };
}

export interface InstallationViewDeps {
  /** The public base address deliveries are posted to (APP_URL). */
  publicBase: string;
  describeAuth: (recipe: MarketRecipe) => InboundDescription | null;
}

export function toInstallationView(
  row: InstallationRow,
  deps: InstallationViewDeps,
  pricing: MarketCardPricing,
  subscription: MarketSubscription | null,
): MarketInstallation {
  const recipe = readRecipe(row.recipe);
  const pendingNew = row.pending
    ? row.pending.scopes.filter((s) => !row.grantedScopes.includes(s))
    : [];
  const hints = row.credentialHints;
  const conn = row.connection;
  const inbound = conn && recipe ? deps.describeAuth(recipe) : null;
  return {
    id: row.uuid,
    app: {
      id: row.app.uuid,
      slug: row.app.slug,
      name: row.app.name,
      kind: row.app.kind,
      logo: row.app.logo,
      category: { slug: row.app.categorySlug, name: row.app.categoryName },
      connectorType: row.app.connectorType,
    },
    status: row.status,
    health: {
      status: row.health,
      checkedAt: iso(row.healthCheckedAt),
      lastError: row.lastError,
      lastErrorAt: iso(row.lastErrorAt),
    },
    version: row.version,
    pendingVersion: row.pending
      ? {
          version: row.pending.version,
          scopes: marketScopeSummaries(row.pending.scopes),
          newScopes: marketScopeSummaries(pendingNew),
        }
      : null,
    needsReconsent: row.pending !== null,
    grantedScopes: marketScopeSummaries(row.grantedScopes),
    config: row.config,
    credentials: (recipe?.authFields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      isSet: hints[f.key] !== undefined,
      hint: hints[f.key] ?? null,
    })),
    connection: conn
      ? {
          id: conn.uuid,
          type: conn.type,
          status: conn.status,
          inbound: inbound
            ? {
                url: `${deps.publicBase.replace(/\/$/, '')}/v2/public/marketplace/hooks/${conn.publicKey}`,
                method: inbound.methods[0] ?? 'POST',
                auth: inbound.auth,
                tokenHeader: inbound.tokenHeader,
                signatureHeader: inbound.signatureHeader,
                secretHint: conn.secretHint,
                methods: inbound.methods,
                formats: inbound.formats,
                delivery: inbound.mode,
              }
            : null,
          pollIntervalSeconds: conn.pollIntervalSeconds,
          ...pullView(recipe, conn),
          lastEventAt: iso(conn.lastEventAt),
          lastSuccessAt: iso(conn.lastSuccessAt),
          lastError: conn.lastError,
          counters: {
            received: conn.received,
            accepted: conn.accepted,
            duplicates: conn.duplicates,
            failed: conn.failed,
          },
        }
      : null,
    killReason: row.killReason,
    pauseReason: row.pausedBySubscription ? 'subscription_ended' : null,
    pricing,
    subscription,
    installedBy: row.installer ? { id: row.installer.uuid, name: row.installer.name } : null,
    installedAt: row.installedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}
