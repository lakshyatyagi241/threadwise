'use client';

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { ListApiLibraryLogsQuery } from '@crm/contracts';
import type { PageQuery, ApisQuery } from './service';
import { apiLibraryApi } from './service';

export const KEYS = {
  all: ['api-library'] as const,
  list: ['api-library', 'list'] as const,
  options: ['api-library', 'options'] as const,
  detail: (id: string) => ['api-library', 'detail', id] as const,
  usage: (id: string) => ['api-library', 'usage', id] as const,
  contactProperties: ['api-library', 'contact-properties'] as const,
  logs: ['api-library', 'logs'] as const,
  log: (id: string) => ['api-library', 'log', id] as const,
};

/** After a create, update or delete: the list, the pickers and the open detail are stale. */
export const refreshApis = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.all });

type ListFilters = Pick<ApisQuery, 'search' | 'method'>;

/**
 * The list screen: one numbered page at a time. The previous page stays on screen (dimmed by the caller through
 * `isPlaceholderData`) while the next one loads, so paging and filtering never blank the table.
 */
export function useApiList(filters: ListFilters, paging: PageQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.list, filters, paging],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => apiLibraryApi.list({ ...filters, ...paging }, signal),
  });
}

export function useApiDetail(id: string | null) {
  return useQuery({
    queryKey: KEYS.detail(id ?? ''),
    enabled: id !== null,
    retry: false,
    // The form owns its copy once loaded; a background refetch must not replace what the person is typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => apiLibraryApi.get(id!, signal),
  });
}

export function useApiUsage(id: string | null) {
  return useQuery({
    queryKey: KEYS.usage(id ?? ''),
    enabled: id !== null,
    retry: false,
    queryFn: ({ signal }) => apiLibraryApi.usage(id!, signal),
  });
}

/**
 * The slim feed of the pickers: the form's variable menu (APIs -> Name -> Name.field) and the flow node's "choose an API". The API
 * opens it for `integ.apilibrary.read` or `flb.flows.read`, so a flow author needs no access to the screen.
 */
export function useApiLibraryOptions(enabled = true) {
  return useQuery({
    queryKey: KEYS.options,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiLibraryApi.options(signal),
  });
}

export function useContactProperties(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.contactProperties,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => apiLibraryApi.contactProperties(signal),
  });
}

export type LogFilters = Partial<
  Omit<ListApiLibraryLogsQuery, 'cursor' | 'limit' | 'page' | 'order'>
>;

/** Logs of every API (the full page) or of one (`apiId` set: the drawer on a list row), one numbered page at a time. */
export function useApiLogs(filters: LogFilters, paging: PageQuery, enabled: boolean) {
  const { apiId, ...rest } = filters;
  return useQuery({
    queryKey: [...KEYS.logs, filters, paging],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiId
        ? apiLibraryApi.apiLogs(apiId, { ...rest, ...paging }, signal)
        : apiLibraryApi.logs({ ...rest, ...paging }, signal),
  });
}

export function useApiLog(id: string | null) {
  return useQuery({
    queryKey: KEYS.log(id ?? ''),
    enabled: id !== null,
    retry: false,
    queryFn: ({ signal }) => apiLibraryApi.log(id!, signal),
  });
}
