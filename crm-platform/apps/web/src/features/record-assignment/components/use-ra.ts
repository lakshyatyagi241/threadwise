'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import { useVocabulary } from '@/features/persona-vocabulary';

type Values = Record<string, string | number>;
type RichValues = Record<string, string | number | ((chunks: ReactNode) => ReactNode)>;

export interface Ra {
  /** A message of `record-assignment`, with the workspace's own words for contact and deal filled in ({contacts}, {Deal}, ...). */
  t: (key: string, values?: Values) => string;
  rich: (key: string, values: RichValues) => ReactNode;
}

/**
 * The screen's translator. The nouns the workspace chose (BL-310: a contact may be a Patient, a deal an Admission) go into every message
 * as `{contact}`, `{contacts}` (lower case, for the middle of a sentence) and `{Contact}`, `{Contacts}` (as written), likewise for deals;
 * companies have no workspace noun, so their words are in the messages themselves.
 */
export function useRa(): Ra {
  const base = useTranslations('record-assignment');
  const tCompanies = useTranslations('companies.nav');
  const { noun } = useVocabulary();
  const contact = noun('contact');
  const deal = noun('deal');
  return useMemo(() => {
    const nouns: Values = {
      contact: contact.singularLower,
      contacts: contact.pluralLower,
      Contact: contact.singular,
      Contacts: contact.plural,
      deal: deal.singularLower,
      deals: deal.pluralLower,
      Deal: deal.singular,
      Deals: deal.plural,
      Companies: tCompanies('companies'),
    };
    return {
      t: (key, values) => base(key, { ...nouns, ...values }),
      rich: (key, values) => base.rich(key, { ...nouns, ...values }),
    };
  }, [base, tCompanies, contact, deal]);
}
