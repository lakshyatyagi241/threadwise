import {
  MARKET_APP_KINDS,
  MARKET_SLUG_RE,
  type CreateMarketCategoryInput,
  type MarketAppKind,
  type MarketOperatorCategory,
  type UpdateMarketCategoryInput,
} from '@crm/contracts';
import type { FieldProblems } from './listing-form';

export const CATEGORY_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  descriptionMax: 300,
  sortOrderMax: 10_000,
} as const;

const ICON_RE = /^[a-z0-9-]{1,32}$/;

export interface CategoryDraft {
  kind: MarketAppKind;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: string;
  isActive: boolean;
}

export const emptyCategoryDraft = (kind: MarketAppKind = 'integration'): CategoryDraft => ({
  kind,
  slug: '',
  name: '',
  description: '',
  icon: '',
  sortOrder: '100',
  isActive: true,
});

export const draftFromCategory = (c: MarketOperatorCategory): CategoryDraft => ({
  kind: c.kind,
  slug: c.slug,
  name: c.name,
  description: c.description ?? '',
  icon: c.icon ?? '',
  sortOrder: String(c.sortOrder),
  isActive: c.isActive,
});

/** Problems by field. The slug is only checked on create: it cannot be changed afterwards. */
export function categoryProblems(d: CategoryDraft, mode: 'create' | 'edit'): FieldProblems {
  const out: FieldProblems = {};
  if (mode === 'create') {
    if (d.slug.trim() === '') out.slug = { code: 'required' };
    else if (!MARKET_SLUG_RE.test(d.slug.trim())) out.slug = { code: 'slug' };
  }
  const name = d.name.trim().length;
  if (name === 0) out.name = { code: 'required' };
  else if (name < CATEGORY_LIMITS.nameMin)
    out.name = { code: 'tooShort', values: { min: CATEGORY_LIMITS.nameMin } };
  else if (name > CATEGORY_LIMITS.nameMax)
    out.name = { code: 'tooLong', values: { max: CATEGORY_LIMITS.nameMax } };
  if (d.description.trim().length > CATEGORY_LIMITS.descriptionMax)
    out.description = { code: 'tooLong', values: { max: CATEGORY_LIMITS.descriptionMax } };
  if (d.icon.trim() !== '' && !ICON_RE.test(d.icon.trim())) out.icon = { code: 'icon' };
  const so = d.sortOrder.trim();
  if (!/^\d+$/.test(so) || Number(so) > CATEGORY_LIMITS.sortOrderMax)
    out.sortOrder = { code: 'number', values: { max: CATEGORY_LIMITS.sortOrderMax } };
  return out;
}

export function createBody(d: CategoryDraft): CreateMarketCategoryInput {
  return {
    kind: d.kind,
    slug: d.slug.trim(),
    name: d.name.trim(),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    ...(d.icon.trim() ? { icon: d.icon.trim() } : {}),
    sortOrder: Number(d.sortOrder.trim() || '0'),
  };
}

/** The PATCH body: `rowVersion` and only what changed; null when nothing did. A blank description or icon clears it. */
export function updateBody(
  c: MarketOperatorCategory,
  d: CategoryDraft,
): UpdateMarketCategoryInput | null {
  const body: UpdateMarketCategoryInput = { rowVersion: c.rowVersion };
  let changed = false;
  if (d.name.trim() !== c.name) {
    body.name = d.name.trim();
    changed = true;
  }
  if (d.description.trim() !== (c.description ?? '')) {
    body.description = d.description.trim() === '' ? null : d.description.trim();
    changed = true;
  }
  if (d.icon.trim() !== (c.icon ?? '')) {
    body.icon = d.icon.trim() === '' ? null : d.icon.trim();
    changed = true;
  }
  if (Number(d.sortOrder.trim() || '0') !== c.sortOrder) {
    body.sortOrder = Number(d.sortOrder.trim() || '0');
    changed = true;
  }
  if (d.isActive !== c.isActive) {
    body.isActive = d.isActive;
    changed = true;
  }
  return changed ? body : null;
}

/** A category with apps in it (any status) cannot be deleted: deactivate it, or move the apps first. */
export const canDeleteCategory = (c: Pick<MarketOperatorCategory, 'appCount'>): boolean =>
  c.appCount === 0;

/** Categories by kind, each group in the order the operator set (sort order, then name). */
export function groupCategories(
  categories: readonly MarketOperatorCategory[],
): Array<{ kind: MarketAppKind; categories: MarketOperatorCategory[] }> {
  return MARKET_APP_KINDS.map((kind) => ({
    kind,
    categories: categories
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  }));
}
