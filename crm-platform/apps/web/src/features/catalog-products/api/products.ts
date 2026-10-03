'use client';

import { useQuery } from '@tanstack/react-query';
import {
  PRODUCTS_PAGE_SIZE,
  listProductsResponseSchema,
  productResponseSchema,
  productShareLinksSchema,
  sendProductResponseSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import type { ProductsListState } from '../lib/pages';
import { KEYS } from './catalog';
import { useNumberedPage } from './numbered-pages';

/** One numbered page of 25 products with the total of the search (WaDesk's table and pager). */
export function useProductsPage(state: ProductsListState) {
  const res = useNumberedPage({
    key: KEYS.products,
    path: '/catalog/products',
    schema: listProductsResponseSchema,
    query: { q: state.q || undefined, limit: PRODUCTS_PAGE_SIZE, includeTotal: true },
    page: state.page,
  });
  return { ...res, total: (res.meta as { total?: number } | undefined)?.total };
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: id ? KEYS.product(id) : ['cat', 'product', 'none'],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/catalog/products/${id}`, { schema: productResponseSchema, signal }),
    retry: false,
    // The form owns what is typed; do not replace it under the person's hands when the window regains focus.
    refetchOnWindowFocus: false,
  });
}

export const createProduct = (body: CreateProductInput) =>
  apiFetch('/catalog/products', { method: 'POST', body });
export const updateProduct = (id: string, body: UpdateProductInput) =>
  apiFetch(`/catalog/products/${id}`, { method: 'PUT', body });
export const deleteProduct = (id: string) =>
  apiFetch(`/catalog/products/${id}`, { method: 'DELETE' });

export const getShareLinks = (id: string) =>
  apiFetch(`/catalog/products/${id}/share-links`, { schema: productShareLinksSchema });
export const sendProduct = (id: string, phone: string) =>
  apiFetch(`/catalog/products/${id}/send`, {
    method: 'POST',
    body: { phone },
    schema: sendProductResponseSchema,
  });
