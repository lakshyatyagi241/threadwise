import type { InboxTag } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLabel, deleteLabel, fetchLabelList, updateLabel } from './labels-api';

export const labelLibraryKey = ['settings', 'labels'] as const;

/** The inbox keeps its own copy of the library (for the label pickers and filters); a change here must reach it too. */
const INBOX_KEYS = [
  ['inbox', 'labels'],
  ['inbox', 'conversations'],
] as const;

/** The whole label library. No request at all while `enabled` is false (the person may not manage labels). */
export const useLabelList = (enabled: boolean) =>
  useQuery({
    queryKey: labelLibraryKey,
    queryFn: ({ signal }) => fetchLabelList(signal),
    enabled,
  });

function useRefreshLibrary() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: labelLibraryKey }),
      ...INBOX_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
}

export function useCreateLabel() {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (input: Parameters<typeof createLabel>[0]) => createLabel(input),
    onSuccess: refresh,
  });
}

export function useUpdateLabel(id: string) {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateLabel>[1]) => updateLabel(id, input),
    // A conflict leaves the form holding an old version: read again either way.
    onSettled: refresh,
  });
}

export function useDeleteLabel() {
  const refresh = useRefreshLibrary();
  return useMutation({
    mutationFn: (label: InboxTag) => deleteLabel(label.id),
    onSettled: refresh,
  });
}
