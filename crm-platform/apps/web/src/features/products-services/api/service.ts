import {
  listSalesItemsResponseSchema,
  salesItemSchema,
  type CreateSalesItemInput,
  type ListSalesItemsQuery,
  type UpdateSalesItemInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const BASE = '/products-services';

export const productsApi = {
  list: (query: Partial<ListSalesItemsQuery>, signal?: AbortSignal) =>
    apiFetch(BASE, { schema: listSalesItemsResponseSchema, query, signal }),
  create: (input: CreateSalesItemInput) =>
    apiFetch(BASE, { method: 'POST', body: input, schema: salesItemSchema }),
  update: (id: string, input: UpdateSalesItemInput) =>
    apiFetch(`${BASE}/${id}`, { method: 'PATCH', body: input, schema: salesItemSchema }),
  remove: (id: string) => apiFetch(`${BASE}/${id}`, { method: 'DELETE' }),
};
