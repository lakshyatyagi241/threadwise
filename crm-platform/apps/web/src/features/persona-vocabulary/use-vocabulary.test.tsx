// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSlice } from './testing';
import { useVocabulary, type Vocabulary } from './use-vocabulary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ nouns: undefined as unknown }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({ org: { persona: { nouns: state.nouns } } }),
}));

let host: HTMLElement | null = null;
async function read(locale: string, nouns: unknown): Promise<Vocabulary> {
  state.nouns = nouns;
  let got: Vocabulary | null = null;
  function Probe(): ReactNode {
    got = useVocabulary();
    return null;
  }
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={loadSlice(locale)} timeZone="UTC">
        <Probe />
      </NextIntlClientProvider>,
    );
  });
  return got!;
}
afterEach(() => {
  host?.remove();
  host = null;
});

describe('useVocabulary', () => {
  it('with no words named it gives the product words and rewrites nothing', async () => {
    const v = await read('en', undefined);
    expect(v.hasCustomWords).toBe(false);
    expect(v.noun('contact')).toEqual({
      singular: 'Contact',
      plural: 'Contacts',
      singularLower: 'contact',
      pluralLower: 'contacts',
      custom: false,
    });
    expect(v.localize('Add a contact')).toBe('Add a contact');
  });

  it('gives the workspace words for the person’s language and rewrites text with them', async () => {
    const v = await read('en', {
      en: {
        contact: { one: 'Patient', other: 'Patients' },
        appointment: { one: 'Visit', other: 'Visits' },
      },
    });
    expect(v.hasCustomWords).toBe(true);
    expect(v.noun('contact')).toMatchObject({
      singular: 'Patient',
      plural: 'Patients',
      pluralLower: 'patients',
      custom: true,
    });
    expect(v.noun('deal').custom).toBe(false);
    expect(v.localize('Create an appointment for this contact')).toBe(
      'Create a visit for this patient',
    );
  });

  it('words named for another language do not apply to this one', async () => {
    const v = await read('en', { de: { contact: { one: 'Patient', other: 'Patienten' } } });
    expect(v.hasCustomWords).toBe(false);
  });

  it('ignores words that are not safe, and nouns that are ambiguous in the language', async () => {
    const unsafe = await read('en', { en: { contact: { one: '{x}', other: 'Patients' } } });
    expect(unsafe.hasCustomWords).toBe(false);
    expect(unsafe.noun('contact').custom).toBe(false);
    // Polish uses one word for appointment and meeting: renaming either is not applied
    const pl = await read('pl', { pl: { appointment: { one: 'Wizyta', other: 'Wizyty' } } });
    expect(pl.noun('appointment')).toMatchObject({ singular: 'Spotkanie', custom: false });
  });
});
