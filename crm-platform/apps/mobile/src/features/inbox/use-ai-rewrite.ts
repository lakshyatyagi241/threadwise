import type { InboxRewriteInput } from '@crm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pickAiModel } from './ai-rewrite';
import { fetchAiModels, rewriteText } from './ai-rewrite-api';

/**
 * The model the Smart AI Assistant will ask, or null while there is none (still loading, none enabled for the workspace, or the
 * person may not read the model list): the button is then left out. The list changes rarely, so ten minutes are kept.
 */
export function useAiModel(enabled: boolean) {
  const models = useQuery({
    queryKey: ['inbox', 'ai-models'],
    queryFn: ({ signal }) => fetchAiModels(signal),
    staleTime: 10 * 60_000,
    // A refused or failed list means "no assistant", not an error to show: retrying only delays the button's absence.
    retry: false,
    enabled,
  });
  return pickAiModel(models.data?.data);
}

/** One rewrite of the draft. */
export const useAiRewrite = () =>
  useMutation({ mutationFn: (input: InboxRewriteInput) => rewriteText(input) });
