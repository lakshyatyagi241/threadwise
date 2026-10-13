'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

/** Puts a contact back where it was before the AI moved it after reading the chat (the growth pilot's auto-stage undo). */
export function useUndoStageChange() {
  return useMutation({
    mutationFn: (suggestionId: string) =>
      apiFetch(`/growth/auto-stage/${encodeURIComponent(suggestionId)}/undo`, {
        method: 'POST',
        schema: z.unknown(),
      }),
  });
}
