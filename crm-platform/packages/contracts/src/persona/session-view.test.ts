// The session schema is imported FIRST on purpose. `session.ts` embeds the persona view, and `definition.ts` reads `session.ts`: if the view
// ever imports `definition.ts` again, this entry order makes `personaViewSchema` undefined and the import throws.
import { sessionOrgSchema } from '../auth-registration-security/session';
import { describe, expect, it } from 'vitest';

describe('org.persona.nouns on the session', () => {
  const org = {
    id: '3f0c0c0e-6a55-4a5a-9d57-0d5d3b4a8a10',
    slug: 'clinic',
    name: 'Clinic',
    plan: 'trial',
    timezone: null,
    currency: null,
    messageFooter: null,
    onboardingStep: 'done',
  };
  const persona = {
    key: 'generic',
    version: 1,
    rev: 4,
    solo: false,
    showAll: false,
    defaultVisibility: 'show',
    modules: {},
  };

  it('accepts a persona view with and without words', () => {
    expect(sessionOrgSchema.safeParse({ ...org, persona }).success).toBe(true);
    const withWords = {
      ...persona,
      nouns: { en: { contact: { one: 'Patient', other: 'Patients' } } },
    };
    const parsed = sessionOrgSchema.parse({ ...org, persona: withWords });
    expect(parsed.persona?.nouns?.en?.contact).toEqual({ one: 'Patient', other: 'Patients' });
  });

  it('refuses a noun without both forms', () => {
    expect(
      sessionOrgSchema.safeParse({
        ...org,
        persona: { ...persona, nouns: { en: { contact: { one: 'Patient' } } } },
      }).success,
    ).toBe(false);
  });
});
