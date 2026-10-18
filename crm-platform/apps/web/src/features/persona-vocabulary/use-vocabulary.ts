'use client';

import { useLocale, useMessages } from 'next-intl';
import { useMemo } from 'react';
import type { WorkspaceVocabNoun } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  ambiguousNouns,
  buildPlan,
  localizeText,
  safeOverrides,
  type NounForms,
} from './lib/localize';
import { readDefaults, type Tree } from './lib/overlay';

export interface Noun {
  singular: string;
  plural: string;
  /** Lower-cased for the middle of a sentence ("Add a patient"). Only Latin, Cyrillic and Greek letters change case. */
  singularLower: string;
  pluralLower: string;
  /** The workspace names this noun in the person's language (and the language can use it). */
  custom: boolean;
}

export interface Vocabulary {
  /** The word for a noun in the person's language: the workspace's, else the product's. */
  noun: (key: WorkspaceVocabNoun) => Noun;
  /**
   * Rewrites an already translated string with the workspace's words: for text that is not in a bound surface (a message built in code, a
   * label from the API). Returns the string unchanged when the workspace named nothing. See `lib/localize.ts` for what it can and cannot do.
   */
  localize: (text: string) => string;
  /** The workspace named at least one noun in the person's language. */
  hasCustomWords: boolean;
}

/**
 * The workspace's words for contact, appointment, deal and meeting (BL-310). Ordinary strings do NOT need this hook: the (app) layout
 * already rewrote the bound surfaces' messages. Use it for what is built in code (`vocab.noun('contact').pluralLower`) or arrives as
 * text (`vocab.localize(label)`).
 */
export function useVocabulary(): Vocabulary {
  const session = useSession();
  const locale = useLocale();
  const messages = useMessages() as Tree;
  const raw = session.org.persona?.nouns?.[locale];
  return useMemo(() => {
    const defaults = readDefaults(messages);
    const overrides = safeOverrides(raw);
    const skip = defaults ? ambiguousNouns(defaults, locale) : new Set<WorkspaceVocabNoun>();
    const plan = buildPlan(locale, defaults, overrides);
    const lower = (s: string) => s.toLocaleLowerCase(locale);
    const noun = (key: WorkspaceVocabNoun): Noun => {
      const own: NounForms | undefined = skip.has(key) ? undefined : overrides[key];
      const forms = own ?? defaults?.[key] ?? { one: key, other: `${key}s` };
      return {
        singular: forms.one,
        plural: forms.other,
        singularLower: lower(forms.one),
        pluralLower: lower(forms.other),
        custom: own !== undefined,
      };
    };
    return {
      noun,
      localize: (text: string) => localizeText(text, plan),
      hasCustomWords: plan !== null,
    };
  }, [messages, locale, raw]);
}

/** One noun's words: `useVocab('contact').plural` is "Patients" when the workspace says so, else "Contacts". */
export function useVocab(key: WorkspaceVocabNoun): Noun {
  const { noun } = useVocabulary();
  return noun(key);
}
