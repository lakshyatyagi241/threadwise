'use client';

import { useQuery } from '@tanstack/react-query';
import { consentApi } from './service';

export const KEYS = {
  all: ['contact-consent'] as const,
  settings: ['contact-consent', 'settings'] as const,
  composer: ['contact-consent', 'composer'] as const,
  contact: (id: string) => ['contact-consent', 'contact', id] as const,
};

export function useConsentSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => consentApi.settings(signal),
  });
}

/** The opt-out line and the policy switch for a composer. Quiet on failure: the composer works without it. */
export function useComposerConsent(enabled = true) {
  return useQuery({
    queryKey: KEYS.composer,
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => consentApi.composerConfig(signal),
  });
}

export function useContactConsent(contactId: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.contact(contactId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => consentApi.forContact(contactId, signal),
  });
}
