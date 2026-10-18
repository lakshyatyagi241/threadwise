import type { WorkspaceVocabularyResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { buildSave, dirtyNouns, formFromResponse, rowProblem, type VocabForm } from './form';

const row = (
  noun: 'contact' | 'appointment' | 'deal' | 'meeting',
  over: Partial<WorkspaceVocabularyResponse['nouns'][number]> = {},
): WorkspaceVocabularyResponse['nouns'][number] => ({
  noun,
  effective: null,
  source: 'default',
  workspace: null,
  workspaceLocales: [],
  ...over,
});
const response = (nouns = [row('contact'), row('appointment'), row('deal'), row('meeting')]) =>
  ({ locale: 'en', rev: 4, personaKey: 'generic', nouns }) as WorkspaceVocabularyResponse;
const OPTS = {
  locale: 'en',
  allLocales: ['en', 'hi', 'ja'],
  applyToAll: false,
  singleForm: () => false,
};

describe('formFromResponse', () => {
  it('starts empty for the product words, with the workspace words if it has them, else what the business type says', () => {
    const form = formFromResponse(
      response([
        row('contact'),
        row('appointment', {
          effective: { one: 'Visit', other: 'Visits' },
          source: 'persona',
        }),
        row('deal', {
          effective: { one: 'Case', other: 'Cases' },
          source: 'workspace',
          workspace: { one: 'Admission', other: 'Admissions' },
          workspaceLocales: ['en'],
        }),
        row('meeting'),
      ]),
    );
    expect(form.contact).toEqual({ one: '', other: '' });
    expect(form.appointment).toEqual({ one: 'Visit', other: 'Visits' });
    expect(form.deal).toEqual({ one: 'Admission', other: 'Admissions' });
    expect(form.meeting).toEqual({ one: '', other: '' });
  });
});

describe('rowProblem', () => {
  it('needs both forms or neither, and safe text', () => {
    expect(rowProblem({ one: '', other: '' }, false)).toBeNull();
    expect(rowProblem({ one: 'Patient', other: 'Patients' }, false)).toBeNull();
    expect(rowProblem({ one: 'Patient', other: '' }, false)).toBe('incomplete');
    expect(rowProblem({ one: '', other: 'Patients' }, false)).toBe('incomplete');
    expect(rowProblem({ one: '{x}', other: 'Patients' }, false)).toBe('invalid');
    expect(rowProblem({ one: 'Patient', other: '<b>' }, false)).toBe('invalid');
  });

  it('a language with one word for both numbers asks for one word only', () => {
    expect(rowProblem({ one: '患者', other: '' }, true)).toBeNull();
    expect(rowProblem({ one: '{', other: '' }, true)).toBe('invalid');
  });
});

describe('buildSave', () => {
  const base: VocabForm = formFromResponse(response());
  const edit = (patch: Partial<VocabForm>): VocabForm => ({ ...base, ...patch });

  it('sends nothing when nothing changed', () => {
    expect(dirtyNouns(base, base)).toEqual([]);
    expect(buildSave(4, base, base, OPTS)).toBeNull();
    // whitespace around a word is not a change
    expect(buildSave(4, base, edit({ contact: { one: ' ', other: ' ' } }), OPTS)).toBeNull();
  });

  it('sends only the changed noun, for the language being edited, with the revision it read', () => {
    const form = edit({ contact: { one: ' Patient ', other: 'Patients' } });
    expect(buildSave(4, base, form, OPTS)).toEqual({
      rev: 4,
      nouns: { contact: { en: { one: 'Patient', other: 'Patients' } } },
    });
  });

  it('"every language" sends the words for all of them', () => {
    const form = edit({ deal: { one: 'Case', other: 'Cases' } });
    const body = buildSave(4, base, form, { ...OPTS, applyToAll: true })!;
    expect(Object.keys(body.nouns.deal as object)).toEqual(['en', 'hi', 'ja']);
    expect((body.nouns.deal as Record<string, unknown>).ja).toEqual({
      one: 'Case',
      other: 'Cases',
    });
  });

  it('clearing a word sends null for this language, or for the noun when "every language" is on', () => {
    const had: VocabForm = edit({ contact: { one: 'Patient', other: 'Patients' } });
    const cleared: VocabForm = { ...had, contact: { one: '', other: '' } };
    expect(buildSave(4, had, cleared, OPTS)!.nouns).toEqual({ contact: { en: null } });
    expect(buildSave(4, had, cleared, { ...OPTS, applyToAll: true })!.nouns).toEqual({
      contact: null,
    });
  });

  it('copies the singular to the plural for a noun the language writes with one word', () => {
    const form = edit({ contact: { one: '患者', other: '' } });
    const body = buildSave(4, base, form, { ...OPTS, locale: 'ja', singleForm: () => true })!;
    expect(body.nouns.contact).toEqual({ ja: { one: '患者', other: '患者' } });
  });
});
