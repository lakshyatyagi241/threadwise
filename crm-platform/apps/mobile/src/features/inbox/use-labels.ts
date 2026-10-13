import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { attachContactTag, detachContactTag, fetchAllTags, fetchContactTags } from './labels-api';

const tagsKey = ['inbox', 'tags'] as const;
const contactTagsKey = (contactId: string) => ['inbox', 'contact-tags', contactId] as const;
const ONE_MINUTE = 60_000;

/** The workspace's tags: the labels that can be chosen. No request without the permission to read them. */
export const useWorkspaceTags = (enabled: boolean) =>
  useQuery({
    queryKey: tagsKey,
    queryFn: ({ signal }) => fetchAllTags(signal),
    enabled,
    staleTime: ONE_MINUTE,
  });

/** The labels the contact has now. */
export const useContactTags = (contactId: string, enabled: boolean) =>
  useQuery({
    queryKey: contactTagsKey(contactId),
    queryFn: ({ signal }) => fetchContactTags(contactId, signal),
    enabled: enabled && contactId !== '',
  });

/** Puts a label on the contact (by id, or by a new name) or takes one off; the lists are read again either way. */
export function useChangeLabels(contactId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contactTagsKey(contactId) }),
      queryClient.invalidateQueries({ queryKey: tagsKey }),
    ]);
  const attach = useMutation({
    mutationFn: (tag: { tagId: string } | { name: string }) =>
      attachContactTag(contactId, tag, Crypto.randomUUID()),
    onSettled: refresh,
  });
  const detach = useMutation({
    mutationFn: (tagId: string) => detachContactTag(contactId, tagId),
    onSettled: refresh,
  });
  return { attach, detach };
}
