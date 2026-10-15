'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaveWaFormInput } from '@crm/contracts';
import { waFormsApi } from './wa-forms-service';

export const WA_FORM_KEYS = {
  list: () => ['wa-forms', 'list'] as const,
  detail: (id: string) => ['wa-forms', 'detail', id] as const,
  submissions: (id: string) => ['wa-forms', 'submissions', id] as const,
};

export function useWaForms() {
  return useQuery({
    queryKey: WA_FORM_KEYS.list(),
    queryFn: ({ signal }) => waFormsApi.list(undefined, signal),
  });
}

export function useWaForm(id: string | null) {
  return useQuery({
    queryKey: WA_FORM_KEYS.detail(id ?? ''),
    queryFn: ({ signal }) => waFormsApi.get(id!, signal),
    enabled: id !== null,
  });
}

export function useWaFormSubmissions(id: string) {
  return useQuery({
    queryKey: WA_FORM_KEYS.submissions(id),
    queryFn: ({ signal }) => waFormsApi.submissions(id, undefined, signal),
  });
}

export function useCreateWaForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWaFormInput) => waFormsApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: WA_FORM_KEYS.list() }),
  });
}

export function useSaveWaForm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWaFormInput) => waFormsApi.update(id, input),
    onSuccess: (data) => {
      qc.setQueryData(WA_FORM_KEYS.detail(id), data);
      return qc.invalidateQueries({ queryKey: WA_FORM_KEYS.list() });
    },
  });
}

export function usePublishWaForm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => waFormsApi.publish(id),
    onSuccess: (data) => {
      qc.setQueryData(WA_FORM_KEYS.detail(id), data);
      return qc.invalidateQueries({ queryKey: WA_FORM_KEYS.list() });
    },
  });
}

export function useDuplicateWaForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => waFormsApi.duplicate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: WA_FORM_KEYS.list() }),
  });
}

export function useDeleteWaForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => waFormsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: WA_FORM_KEYS.list() }),
  });
}
