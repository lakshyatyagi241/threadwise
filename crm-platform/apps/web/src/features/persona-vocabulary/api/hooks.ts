'use client';

import { useQuery } from '@tanstack/react-query';
import { vocabularyApi } from './service';

export const KEYS = {
  all: ['persona-vocabulary'] as const,
  words: (locale: string) => ['persona-vocabulary', 'words', locale] as const,
};

export function useWorkspaceWords(locale: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.words(locale),
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => vocabularyApi.get(locale, signal),
  });
}
