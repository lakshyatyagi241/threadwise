import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quickAccessResponseSchema, type QuickAccessEntry } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const KEY = ['shell', 'quick-access'] as const;

export const useQuickAccess = () =>
  useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      apiFetch('/shell/quick-access', { schema: quickAccessResponseSchema, signal }),
    staleTime: 5 * 60_000,
  });

export function useSaveQuickAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: QuickAccessEntry[]) =>
      apiFetch('/shell/quick-access', {
        method: 'PUT',
        body: { items },
        schema: quickAccessResponseSchema,
      }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
