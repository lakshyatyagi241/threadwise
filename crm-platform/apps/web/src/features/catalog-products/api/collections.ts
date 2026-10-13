'use client';

import { useQuery } from '@tanstack/react-query';
import {
  listCollectionsResponseSchema,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { KEYS } from './catalog';

export function useCollections() {
  return useQuery({
    queryKey: KEYS.collections,
    queryFn: ({ signal }) =>
      apiFetch('/catalog/collections', { schema: listCollectionsResponseSchema, signal }),
    retry: false,
  });
}

export const createCollection = (body: CreateCollectionInput) =>
  apiFetch('/catalog/collections', { method: 'POST', body });
export const updateCollection = (id: string, body: UpdateCollectionInput) =>
  apiFetch(`/catalog/collections/${id}`, { method: 'PUT', body });
export const deleteCollection = (id: string) =>
  apiFetch(`/catalog/collections/${id}`, { method: 'DELETE' });
export const pushCollectionToMeta = (id: string) =>
  apiFetch(`/catalog/collections/${id}/meta`, { method: 'POST', body: {} });
export const removeCollectionFromMeta = (id: string) =>
  apiFetch(`/catalog/collections/${id}/meta`, { method: 'DELETE' });
