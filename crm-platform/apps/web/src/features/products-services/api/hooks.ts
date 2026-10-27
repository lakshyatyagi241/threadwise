'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSalesItemInput,
  ListSalesItemsQuery,
  UpdateSalesItemInput,
} from '@crm/contracts';
import { productsApi } from './service';

export const KEYS = {
  all: ['products-services'] as const,
  list: (q: Partial<ListSalesItemsQuery>) => ['products-services', 'list', q] as const,
};

export function useSalesItems(query: Partial<ListSalesItemsQuery>) {
  return useQuery({
    queryKey: KEYS.list(query),
    queryFn: ({ signal }) => productsApi.list(query, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSalesItemMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: KEYS.all });
  return {
    create: useMutation({
      mutationFn: (input: CreateSalesItemInput) => productsApi.create(input),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: UpdateSalesItemInput }) =>
        productsApi.update(v.id, v.input),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => productsApi.remove(id),
      onSuccess: done,
    }),
  };
}
