import { describe, expect, it } from 'vitest';
import {
  GENERIC_PERSONA_DEFINITION,
  GENERIC_PERSONA_KEY,
  personaDefinitionSchema,
  personaKeySchema,
} from './definition';
import {
  EMPTY_OVERRIDES,
  operatorOverridesSchema,
  parseOperatorOverrides,
  parseWorkspaceOverrides,
  workspaceOverridesSchema,
} from './overrides';

const clinic = {
  ...GENERIC_PERSONA_DEFINITION,
  label: { en: 'Clinic / Doctor' },
  modules: {
    default: 'hide' as const,
    ids: { 'nav:inbox': 'show' as const, 'section:contact.meetings': 'hide' as const },
  },
  vocabulary: {
    nouns: { contact: { en: { one: 'Patient', other: 'Patients' } } },
    phrases: { 'contacts-attributes-tags.list.addContact': { en: 'Add patient' } },
  },
};

describe('persona definition', () => {
  it('the generic persona is valid, shows everything and has nothing else', () => {
    const parsed = personaDefinitionSchema.parse(GENERIC_PERSONA_DEFINITION);
    expect(parsed).toEqual(GENERIC_PERSONA_DEFINITION);
    expect(GENERIC_PERSONA_KEY).toBe('generic');
    expect(parsed.modules).toEqual({ default: 'show', ids: {} });
    expect(parsed.vocabulary).toEqual({ nouns: {}, phrases: {} });
    expect(parsed.presets.templates).toEqual([]);
    expect(parsed.checklist).toEqual([]);
  });

  it('accepts an allow-list persona with words', () => {
    expect(personaDefinitionSchema.safeParse(clinic).success).toBe(true);
  });

  it('needs an English label and summary', () => {
    expect(personaDefinitionSchema.safeParse({ ...clinic, label: { hi: 'x' } }).success).toBe(
      false,
    );
    expect(personaDefinitionSchema.safeParse({ ...clinic, summary: {} }).success).toBe(false);
  });

  it('rejects a malformed module id, an unknown noun and an unknown schema version', () => {
    expect(
      personaDefinitionSchema.safeParse({
        ...clinic,
        modules: { default: 'show', ids: { 'nav:Inbox': 'hide' } },
      }).success,
    ).toBe(false);
    expect(
      personaDefinitionSchema.safeParse({
        ...clinic,
        vocabulary: { nouns: { customer: { en: { one: 'a', other: 'b' } } }, phrases: {} },
      }).success,
    ).toBe(false);
    expect(personaDefinitionSchema.safeParse({ ...clinic, schemaVersion: 2 }).success).toBe(false);
  });

  it('needs both forms of a noun and limits the text length', () => {
    const noun = (forms: object) => ({
      ...clinic,
      vocabulary: { nouns: { contact: { en: forms } }, phrases: {} },
    });
    expect(personaDefinitionSchema.safeParse(noun({ one: 'Patient' })).success).toBe(false);
    expect(
      personaDefinitionSchema.safeParse(noun({ one: 'a'.repeat(41), other: 'b' })).success,
    ).toBe(false);
  });

  it('bounds the number of module ids a document may name', () => {
    const ids = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`nav:m${i}`, 'hide' as const]));
    expect(
      personaDefinitionSchema.safeParse({ ...clinic, modules: { default: 'show', ids: ids(600) } })
        .success,
    ).toBe(true);
    expect(
      personaDefinitionSchema.safeParse({ ...clinic, modules: { default: 'show', ids: ids(601) } })
        .success,
    ).toBe(false);
    const entries = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`nav:m${i}`, { state: 'hide' }]));
    expect(workspaceOverridesSchema.safeParse({ v: 1, modules: entries(601) }).success).toBe(false);
    // an oversized stored document is treated as silent rather than inflating every session
    expect(parseWorkspaceOverrides({ v: 1, modules: entries(601) })).toEqual(EMPTY_OVERRIDES);
  });

  it('keeps persona keys to the documented pattern', () => {
    for (const ok of ['generic', 'dental_clinic', 'a1']) {
      expect(personaKeySchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['', 'a', 'Clinic', '1clinic', 'with-dash', 'x'.repeat(41)]) {
      expect(personaKeySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('override documents', () => {
  it('an operator entry needs a reason of at least 5 characters, a workspace entry does not', () => {
    const op = (reason?: string) => ({
      v: 1,
      modules: { 'nav:deals': { state: 'show', ...(reason ? { reason } : {}) } },
    });
    expect(operatorOverridesSchema.safeParse(op()).success).toBe(false);
    expect(operatorOverridesSchema.safeParse(op('abcd')).success).toBe(false);
    expect(operatorOverridesSchema.safeParse(op('asked by phone')).success).toBe(true);
    expect(
      workspaceOverridesSchema.safeParse({ v: 1, modules: { 'nav:deals': { state: 'hide' } } })
        .success,
    ).toBe(true);
  });

  it('only the operator may lock: a workspace entry with locked is rejected', () => {
    const entry = { state: 'hide', locked: true, reason: 'because we said so' };
    expect(
      workspaceOverridesSchema.safeParse({ v: 1, modules: { 'nav:deals': entry } }).success,
    ).toBe(false);
    const parsed = operatorOverridesSchema.parse({ v: 1, modules: { 'nav:deals': entry } });
    expect(parsed.modules['nav:deals']?.locked).toBe(true);
  });

  it('locked defaults to false for the operator', () => {
    const parsed = operatorOverridesSchema.parse({
      v: 1,
      modules: { 'nav:deals': { state: 'show', reason: 'wants a pipeline' } },
    });
    expect(parsed.modules['nav:deals']?.locked).toBe(false);
  });

  it('the empty column default and a missing document both read as no overrides', () => {
    for (const raw of [{}, null, undefined, EMPTY_OVERRIDES]) {
      expect(parseOperatorOverrides(raw)).toEqual(EMPTY_OVERRIDES);
      expect(parseWorkspaceOverrides(raw)).toEqual(EMPTY_OVERRIDES);
    }
  });

  it('a stored document that no longer parses is treated as silent, never as an error', () => {
    expect(parseWorkspaceOverrides({ v: 9, modules: 'broken' })).toEqual(EMPTY_OVERRIDES);
    expect(parseOperatorOverrides('nonsense')).toEqual(EMPTY_OVERRIDES);
  });

  it('limits words to the persona nouns and to both forms', () => {
    const doc = (vocab: object) => ({ v: 1, vocab });
    expect(
      workspaceOverridesSchema.safeParse(
        doc({ contact: { en: { one: 'Client', other: 'Clients' } } }),
      ).success,
    ).toBe(true);
    expect(
      workspaceOverridesSchema.safeParse(doc({ widget: { en: { one: 'a', other: 'b' } } })).success,
    ).toBe(false);
    expect(
      workspaceOverridesSchema.safeParse(doc({ contact: { en: { one: 'Client' } } })).success,
    ).toBe(false);
  });
});
