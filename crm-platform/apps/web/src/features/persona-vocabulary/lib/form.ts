import {
  WORKSPACE_VOCAB_NOUNS,
  isSafeNoun,
  type SaveWorkspaceVocabularyInput,
  type WorkspaceVocabularyResponse,
  type WorkspaceVocabNoun,
} from '@crm/contracts';

/** The form of the "Words we use" screen: one singular and one plural per noun, in the language of the person editing. */
export interface RowForm {
  one: string;
  other: string;
}
export type VocabForm = Record<WorkspaceVocabNoun, RowForm>;
export type RowProblem = 'incomplete' | 'invalid';

const EMPTY: RowForm = { one: '', other: '' };

/**
 * What the inputs start with: the workspace's own words, else what is shown now from the business type or the account team (so an admin
 * edits from it), else nothing (the product's word shows as the placeholder).
 */
export function formFromResponse(res: WorkspaceVocabularyResponse): VocabForm {
  const form = {} as VocabForm;
  for (const noun of WORKSPACE_VOCAB_NOUNS) {
    const row = res.nouns.find((n) => n.noun === noun);
    const forms = row?.workspace ?? row?.effective ?? null;
    form[noun] = forms ? { one: forms.one, other: forms.other } : { ...EMPTY };
  }
  return form;
}

const clean = (r: RowForm): RowForm => ({ one: r.one.trim(), other: r.other.trim() });

export function rowDirty(a: RowForm, b: RowForm): boolean {
  const x = clean(a);
  const y = clean(b);
  return x.one !== y.one || x.other !== y.other;
}

export function dirtyNouns(form: VocabForm, baseline: VocabForm): WorkspaceVocabNoun[] {
  return WORKSPACE_VOCAB_NOUNS.filter((n) => rowDirty(form[n], baseline[n]));
}

/**
 * Whether a row can be saved. Both words or neither (neither = go back to the product's word). A language that uses one word for both
 * numbers (`singleForm`) asks for one word only.
 */
export function rowProblem(r: RowForm, singleForm: boolean): RowProblem | null {
  const { one, other } = clean(r);
  if (one === '' && other === '') return null;
  if (singleForm) return isSafeNoun(one) ? null : 'invalid';
  if (one === '' || other === '') return 'incomplete';
  return isSafeNoun(one) && isSafeNoun(other) ? null : 'invalid';
}

export interface BuildOptions {
  locale: string;
  /** Every language of the app: used when the words should apply to all of them. */
  allLocales: readonly string[];
  applyToAll: boolean;
  /** Nouns the language writes with one word for both numbers: the singular is copied to the plural. */
  singleForm: (noun: WorkspaceVocabNoun) => boolean;
}

/** The body of `PUT /v2/persona/vocabulary`: only the nouns that changed. `null` when nothing did. */
export function buildSave(
  rev: number,
  baseline: VocabForm,
  form: VocabForm,
  opts: BuildOptions,
): SaveWorkspaceVocabularyInput | null {
  const nouns: SaveWorkspaceVocabularyInput['nouns'] = {};
  for (const noun of dirtyNouns(form, baseline)) {
    const { one, other } = clean(form[noun]);
    if (one === '' && other === '') {
      // Cleared: this language goes back to the business type's or the product's word; "all languages" clears the noun everywhere.
      nouns[noun] = opts.applyToAll ? null : { [opts.locale]: null };
      continue;
    }
    const forms = { one, other: opts.singleForm(noun) ? one : other };
    nouns[noun] = opts.applyToAll
      ? Object.fromEntries(opts.allLocales.map((l) => [l, forms]))
      : { [opts.locale]: forms };
  }
  return Object.keys(nouns).length > 0 ? { rev, nouns } : null;
}
