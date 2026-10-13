'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

/** Puts a contact back where it was before the AI moved it after reading the chat (lead scoring's automatic stage change). */
export function useUndoStageChange() {
  return useMutation({
    mutationFn: (suggestionId: string) =>
      apiFetch(`/lead-scoring/suggestions/${encodeURIComponent(suggestionId)}/undo`, {
        method: 'POST',
        schema: z.unknown(),
      }),
  });
}
