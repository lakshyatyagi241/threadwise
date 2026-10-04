import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateMarketManifest,
  validateMarketRecipe,
  type MarketManifest,
  type MarketRecipe,
} from '@crm/contracts';

/** The SQL of the migration that publishes the Indian lead portals. The specs read it, so what ships is what is tested. */
export const PORTAL_SEED_FILE = resolve(
  __dirname,
  '../../../../../packages/db/migrations/20261024090100_mkt_portal_recipes.sql',
);

export interface SeededPortal {
  slug: string;
  manifest: MarketManifest;
  recipe: MarketRecipe;
  listing: Record<string, unknown>;
}

export const portalSql = (): string => readFileSync(PORTAL_SEED_FILE, 'utf8');

/** Every portal of the seed: three jsonb documents per row, in the order manifest, recipe, listing. */
export function seededPortals(): SeededPortal[] {
  const docs = [...portalSql().matchAll(/\$j\$(.*?)\$j\$::jsonb/gs)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
  if (docs.length % 3 !== 0) throw new Error('the seed has a row that is not three documents');
  const out: SeededPortal[] = [];
  for (let i = 0; i < docs.length; i += 3) {
    const m = validateMarketManifest(docs[i]);
    const r = validateMarketRecipe(docs[i + 1]);
    if (!m.ok) throw new Error(`manifest ${i / 3}: ${JSON.stringify(m.problems)}`);
    if (!r.ok) throw new Error(`recipe ${i / 3}: ${JSON.stringify(r.problems)}`);
    out.push({
      slug: m.manifest.id,
      manifest: m.manifest,
      recipe: r.recipe,
      listing: docs[i + 2]!,
    });
  }
  return out;
}

export const seededPortal = (slug: string): SeededPortal => {
  const p = seededPortals().find((x) => x.slug === slug);
  if (!p) throw new Error(`no seeded portal ${slug}`);
  return p;
};
