import { describe, expect, it } from 'vitest';
import { GENERIC_PERSONA_DEFINITION, type PersonaDefinition } from './definition';
import { parseOperatorOverrides, parseWorkspaceOverrides } from './overrides';
import { explainNoun, resolveAllNouns, resolveNouns, vocabularyLocales } from './resolve';
import { personaViewSchema } from './view';
import {
  MAX_NOUN_LENGTH,
  isSafeNoun,
  saveWorkspaceVocabularySchema,
  workspaceNounFormsSchema,
  workspaceVocabularyResponseSchema,
} from './vocabulary';

const persona = (nouns: PersonaDefinition['vocabulary']['nouns']): PersonaDefinition => ({
  ...GENERIC_PERSONA_DEFINITION,
  vocabulary: { nouns, phrases: {} },
});
const clinic = persona({
  contact: { en: { one: 'Patient', other: 'Patients' }, hi: { one: 'मरीज', other: 'मरीज' } },
  appointment: { en: { one: 'Visit', other: 'Visits' } },
});
const ws = (vocab: Record<string, unknown>) => parseWorkspaceOverrides({ v: 1, vocab });
const op = (vocab: Record<string, unknown>) => parseOperatorOverrides({ v: 1, vocab });

describe('isSafeNoun: what may be dropped into an ICU message', () => {
  it.each([
    'Patient',
    'Client',
    'Real estate lead',
    'Member (gold)',
    'Rendez-vous',
    "Client d'entreprise",
    'Klient’s',
    'मरीज',
    '患者',
    'مريض',
    'Q&A',
    'A/B test',
    'Dr. Smith',
  ])('accepts %s', (v) => expect(isSafeNoun(v)).toBe(true));

  it.each([
    '',
    ' ',
    '{name}',
    'Pat{ient',
    'Patient}',
    '<b>Patient</b>',
    'Patient<script>',
    '#Patient',
    "Patient'",
    "'Patient",
    "Pat''ient",
    "Client's {x}",
    'Patient\\n',
    'Pa|tient',
    'Patient "x"',
    '-Patient',
    'Patient-',
    'a'.repeat(MAX_NOUN_LENGTH + 1),
  ])('refuses %j', (v) => expect(isSafeNoun(v)).toBe(false));

  it('accepts exactly the longest allowed name', () => {
    expect(isSafeNoun('a'.repeat(MAX_NOUN_LENGTH))).toBe(true);
  });
});

describe('workspace vocabulary schemas', () => {
  it('trims the words and needs both forms', () => {
    expect(workspaceNounFormsSchema.parse({ one: ' Patient ', other: 'Patients ' })).toEqual({
      one: 'Patient',
      other: 'Patients',
    });
    expect(workspaceNounFormsSchema.safeParse({ one: 'Patient' }).success).toBe(false);
    expect(workspaceNounFormsSchema.safeParse({ one: 'Patient', other: '{x}' }).success).toBe(
      false,
    );
  });

  it('a save names only the four nouns, with a map of languages or null', () => {
    const ok = saveWorkspaceVocabularySchema.safeParse({
      rev: 3,
      nouns: {
        contact: { en: { one: 'Patient', other: 'Patients' }, hi: null },
        deal: null,
      },
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { rev: 3, nouns: {} },
      { rev: 0, nouns: { contact: null } },
      { rev: 3, nouns: { task: null } },
      { rev: 3, nouns: { contact: { 'not a locale!': { one: 'a', other: 'b' } } } },
      { rev: 3, nouns: { contact: { en: { one: '', other: 'x' } } } },
    ]) {
      expect(saveWorkspaceVocabularySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('the response carries a row per noun and the layer that speaks', () => {
    const body = {
      locale: 'en',
      rev: 2,
      personaKey: 'clinic',
      nouns: [
        {
          noun: 'contact',
          effective: { one: 'Patient', other: 'Patients' },
          source: 'persona',
          workspace: null,
          workspaceLocales: [],
        },
      ],
    };
    expect(workspaceVocabularyResponseSchema.safeParse(body).success).toBe(true);
    expect(
      workspaceVocabularyResponseSchema.safeParse({
        ...body,
        nouns: [{ ...body.nouns[0], source: 'someone' }],
      }).success,
    ).toBe(false);
  });
});

describe('explainNoun: which layer speaks', () => {
  const forms = (one: string) => ({ one, other: `${one}s` });

  it('workspace > operator > persona > nothing', () => {
    const input = {
      definition: clinic,
      operator: op({ contact: { en: forms('Client') } }),
      workspace: ws({ contact: { en: forms('Member') } }),
    };
    expect(explainNoun(input, 'contact', 'en')).toEqual({
      source: 'workspace',
      forms: forms('Member'),
    });
    expect(explainNoun({ ...input, workspace: null }, 'contact', 'en')?.source).toBe('operator');
    expect(
      explainNoun({ ...input, workspace: null, operator: null }, 'contact', 'en')?.source,
    ).toBe('persona');
    expect(explainNoun({ definition: GENERIC_PERSONA_DEFINITION }, 'contact', 'en')).toBeNull();
    expect(explainNoun({ definition: clinic }, 'deal', 'en')).toBeNull();
  });

  it("uses a persona's words in a language only when it has them for every noun it renames (no half-renamed screens)", () => {
    // clinic names `appointment` only in English: in Hindi the whole persona layer is silent
    expect(explainNoun({ definition: clinic }, 'contact', 'hi')).toBeNull();
    expect(resolveNouns({ definition: clinic }, 'hi')).toEqual({});
    // ...but the workspace's own words in Hindi still count
    const input = { definition: clinic, workspace: ws({ contact: { hi: forms('ग्राहक') } }) };
    expect(explainNoun(input, 'contact', 'hi')?.source).toBe('workspace');
  });
});

describe('resolveAllNouns: the words of the session view', () => {
  it('is undefined when no layer names anything: the generic golden view carries no field', () => {
    expect(resolveAllNouns({ definition: GENERIC_PERSONA_DEFINITION })).toBeUndefined();
    expect(
      resolveAllNouns({
        definition: GENERIC_PERSONA_DEFINITION,
        operator: op({}),
        workspace: ws({}),
      }),
    ).toBeUndefined();
  });

  it('lists every language that has words, merged workspace > operator > persona', () => {
    const input = {
      definition: clinic,
      operator: op({ meeting: { en: { one: 'Consult', other: 'Consults' } } }),
      workspace: ws({ contact: { en: { one: 'Client', other: 'Clients' } } }),
    };
    expect(vocabularyLocales(input)).toEqual(['en', 'hi']);
    expect(resolveAllNouns(input)).toEqual({
      en: {
        contact: { one: 'Client', other: 'Clients' },
        appointment: { one: 'Visit', other: 'Visits' },
        meeting: { one: 'Consult', other: 'Consults' },
      },
      // Hindi: the persona layer is incomplete there (appointment has no Hindi), so it contributes nothing
    });
  });

  it('rides on the session view as an optional field', () => {
    const base = {
      key: 'generic',
      version: 1,
      rev: 1,
      solo: false,
      showAll: false,
      defaultVisibility: 'show',
      modules: {},
    };
    expect(personaViewSchema.safeParse(base).success).toBe(true);
    expect(
      personaViewSchema.safeParse({
        ...base,
        nouns: { en: { contact: { one: 'Patient', other: 'Patients' } } },
      }).success,
    ).toBe(true);
    expect(personaViewSchema.parse(base)).not.toHaveProperty('nouns');
  });
});
