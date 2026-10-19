'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaveWaChatLinkInput, WaChatLinkListQuery } from '@crm/contracts';
import { waChatLinksApi } from './wa-chat-links-service';

export const WA_CHAT_LINK_KEYS = {
  list: (status: WaChatLinkListQuery['status']) => ['wa-links', 'list', status] as const,
  detail: (id: string) => ['wa-links', 'detail', id] as const,
};

export function useWaChatLinks(status: WaChatLinkListQuery['status'] = 'all') {
  return useQuery({
    queryKey: WA_CHAT_LINK_KEYS.list(status),
    queryFn: ({ signal }) => waChatLinksApi.list({ limit: 20, status }, signal),
  });
}

export function useWaChatLink(id: string | null) {
  return useQuery({
    queryKey: WA_CHAT_LINK_KEYS.detail(id ?? ''),
    queryFn: ({ signal }) => waChatLinksApi.get(id!, signal),
    enabled: id !== null,
  });
}

function useInvalidateLinks() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['wa-links'] });
}

export function useCreateWaChatLink() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (input: SaveWaChatLinkInput) => waChatLinksApi.create(input),
    onSuccess: invalidate,
  });
}

export function useSaveWaChatLink(id: string) {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (input: SaveWaChatLinkInput) => waChatLinksApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDuplicateWaChatLink() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (id: string) => waChatLinksApi.duplicate(id),
    onSuccess: invalidate,
  });
}

export function useDeleteWaChatLink() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (id: string) => waChatLinksApi.remove(id),
    onSuccess: invalidate,
  });
}
