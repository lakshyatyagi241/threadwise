import {
  CATALOG_SEND_MAX_PRODUCTS,
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_NAME_MAX,
  trimLikeThreadwise,
  type CollectionResponse,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from '@crm/contracts';

/** The pure half of the Collections tab (TW-CAT-017, 018). */

export const COLLECTION_MAX_PRODUCTS = CATALOG_SEND_MAX_PRODUCTS;

export interface PickItem {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  priceDisplay: string;
}

export interface CollectionForm {
  name: string;
  description: string;
  /** In the order they will be saved: kept members first, then new picks in the order they were ticked. */
  productIds: string[];
}

export const EMPTY_COLLECTION_FORM: CollectionForm = { name: '', description: '', productIds: [] };

export function formFromCollection(c: CollectionResponse): CollectionForm {
  return {
    name: c.name,
    description: c.description ?? '',
    productIds: c.products.map((p) => p.id),
  };
}

/** Ticking beyond 30 is refused (the box stays unticked), as Reference's picker did; unticking always works. */
export function togglePick(
  selected: string[],
  id: string,
  max = COLLECTION_MAX_PRODUCTS,
): { selected: string[]; refused: boolean } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), refused: false };
  if (selected.length >= max) return { selected, refused: true };
  return { selected: [...selected, id], refused: false };
}

/** The picker filter: a case-insensitive match on the name and the SKU together. */
export function filterPick<T extends { name: string; sku: string | null }>(
  items: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((i) => `${i.name} ${i.sku ?? ''}`.toLowerCase().includes(needle));
}

/**
 * What the edit picker offers: the active products the API listed, plus members of this collection that are not in that
 * list (drafts, or beyond the cap) so saving never drops them silently.
 */
export function pickerItems(pick: PickItem[], members: CollectionResponse['products']): PickItem[] {
  const known = new Set(pick.map((p) => p.id));
  const extra = members
    .filter((m) => !known.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      sku: m.sku,
      imageUrl: m.imageUrl,
      priceDisplay: m.priceDisplay,
    }));
  return [...extra, ...pick];
}

export type CollectionProblem =
  'nameRequired' | 'nameTooLong' | 'descriptionTooLong' | 'noProducts' | 'tooManyProducts';

export function collectionProblems(form: CollectionForm): CollectionProblem[] {
  const out: CollectionProblem[] = [];
  const name = trimLikeThreadwise(form.name);
  if (!name) out.push('nameRequired');
  else if (name.length > COLLECTION_NAME_MAX) out.push('nameTooLong');
  if (trimLikeThreadwise(form.description).length > COLLECTION_DESCRIPTION_MAX)
    out.push('descriptionTooLong');
  if (form.productIds.length === 0) out.push('noProducts');
  if (form.productIds.length > COLLECTION_MAX_PRODUCTS) out.push('tooManyProducts');
  return out;
}

export function buildCollectionInput(form: CollectionForm): CreateCollectionInput {
  const description = trimLikeThreadwise(form.description);
  return {
    name: trimLikeThreadwise(form.name),
    description: description || null,
    productIds: form.productIds,
    isActive: true,
  };
}

export function buildCollectionUpdate(
  form: CollectionForm,
  rowVersion: number,
): UpdateCollectionInput {
  return { ...buildCollectionInput(form), rowVersion };
}

/** The products a send can use: members that are live (active). */
export const liveProductIds = (c: CollectionResponse): string[] =>
  c.products.filter((p) => p.active).map((p) => p.id);
