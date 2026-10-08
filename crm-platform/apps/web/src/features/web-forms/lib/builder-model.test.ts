import { FORM_BLOCK_ID, formDefinitionSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { definition, field, loose, PROPERTIES } from '../test-fixtures';
import {
  addBlock,
  addOption,
  bindField,
  blankDefinition,
  boundKeys,
  canMove,
  changeKind,
  definitionProblems,
  duplicateBlock,
  fieldFromProperty,
  fieldsOf,
  isBound,
  isDirty,
  moveBlock,
  moveOption,
  newField,
  newHiddenField,
  newId,
  removeBlock,
  removeOption,
  setOptionLabel,
  updateBlock,
} from './builder-model';
import { findProperty, groupProperties, kindChoices, kindTraits } from './build-view';
import type { FieldBlock } from './types';

const COPY = { title: 'Untitled form', submitLabel: 'Send', successMessage: 'Thanks' };
const ids = (d: ReturnType<typeof definition>) => d.steps[0]!.blocks.map((b) => b.id);
const byId = (id: string) => PROPERTIES.find((p) => `${p.object}:${p.property}` === id)!;

describe('blankDefinition and ids', () => {
  it('is a valid single-step form with the contract defaults', () => {
    const d = blankDefinition(COPY);
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0]!.blocks).toEqual([]);
    expect(d.settings.submitLabel).toBe('Send');
    expect(d.theme.layout).toBe('classic');
  });

  it('sets the direction from the language', () => {
    expect(blankDefinition(COPY, 'ar').settings).toMatchObject({ locale: 'ar', dir: 'rtl' });
    expect(blankDefinition(COPY, 'en').settings).toMatchObject({ locale: 'en', dir: 'ltr' });
  });

  it('makes ids the contract accepts, and different every time', () => {
    const made = Array.from({ length: 200 }, () => newId('f'));
    expect(new Set(made).size).toBe(200);
    for (const id of made) expect(id).toMatch(FORM_BLOCK_ID);
  });
});

describe('new fields', () => {
  it('starts a choice with two options so it is valid at once', () => {
    const f = newField('dropdown', 'Topic', ['One', 'Two']);
    expect(f.options).toEqual([
      { value: 'opt_1', label: 'One' },
      { value: 'opt_2', label: 'Two' },
    ]);
    expect(newField('short_text', 'Name').options).toBeUndefined();
  });

  it('gives a rating its 1 to 5 range and a hidden field its source', () => {
    expect(newField('rating', 'How was it?').validation).toEqual({ min: 1, max: 5 });
    expect(newHiddenField('utm_campaign', 'Campaign')).toMatchObject({
      kind: 'hidden',
      hiddenSource: 'utm_campaign',
      required: false,
    });
    expect(newHiddenField('constant', 'Channel').constant).toBe('');
  });
});

describe('mapping a CRM property', () => {
  it('takes label, kind and the workspace required rule from the property', () => {
    const f = fieldFromProperty(byId('contact:budget'));
    expect(f).toMatchObject({
      kind: 'currency',
      label: 'Budget',
      required: true,
      bind: { object: 'contact', property: 'budget' },
    });
  });

  it('copies a choice property options', () => {
    const f = fieldFromProperty(byId('contact:interest'));
    expect(f.kind).toBe('dropdown');
    expect(f.options).toEqual([
      { value: 'a', label: 'Apples' },
      { value: 'b', label: 'Bananas' },
    ]);
  });

  it('binds an existing field and detaches it again', () => {
    const base = newField('short_text', 'Anything');
    const bound = bindField(base, byId('contact:email'));
    expect(bound).toMatchObject({ kind: 'email', bind: { object: 'contact', property: 'email' } });
    expect(bindField(bound, null).bind).toBeUndefined();
  });

  it('makes a field required when the workspace requires the property', () => {
    expect(bindField(newField('number', 'Budget'), byId('contact:budget')).required).toBe(true);
  });

  it('keeps a choice kind for the options it carries and drops options for a plain kind', () => {
    const choice = newField('dropdown', 'Pick');
    expect(changeKind(choice, 'radio').options).toHaveLength(2);
    expect(changeKind(choice, 'dropdown').options).toBeDefined();
    const plain = changeKind({ ...choice, kind: 'dropdown' }, 'dropdown');
    expect(plain.options).toBeDefined();
  });

  it('lists only the kinds a field can change into without losing its answer', () => {
    expect(kindChoices({ kind: 'short_text' })).toEqual([
      'short_text',
      'long_text',
      'email',
      'phone',
    ]);
    expect(
      kindChoices({ kind: 'short_text', bind: { object: 'contact', property: 'name' } }),
    ).toEqual(['short_text']);
    expect(kindChoices({ kind: 'hidden' })).toEqual(['hidden']);
    expect(kindChoices({ kind: 'date' })).toEqual(['date']);
  });

  it('shows the controls each kind needs', () => {
    expect(kindTraits('dropdown')).toMatchObject({
      options: true,
      placeholder: true,
      pattern: false,
    });
    expect(kindTraits('short_text')).toMatchObject({ textLimits: true, pattern: true });
    expect(kindTraits('number')).toMatchObject({ range: true, textLimits: false });
    expect(kindTraits('hidden').required).toBe(false);
  });

  it('groups and filters the picker list, required first', () => {
    const groups = groupProperties(PROPERTIES, '');
    expect(groups.map((g) => g.object)).toEqual(['contact', 'company']);
    expect(groups[0]!.items[0]!.property).toBe('budget');
    expect(groupProperties(PROPERTIES, 'bana').flatMap((g) => g.items)).toHaveLength(0);
    expect(groupProperties(PROPERTIES, 'company name')[0]!.items[0]!.object).toBe('company');
    expect(findProperty(PROPERTIES, { object: 'contact', property: 'email' })?.label).toBe('Email');
    expect(findProperty(PROPERTIES, undefined)).toBeNull();
  });
});

describe('editing the block list', () => {
  const d = definition();

  it('adds at the end or at a position', () => {
    const f = newField('date', 'Day');
    expect(ids(addBlock(d, f)).at(-1)).toBe(f.id);
    expect(ids(addBlock(d, f, 1))[1]).toBe(f.id);
  });

  it('moves a block up and down and stops at the ends', () => {
    expect(ids(moveBlock(d, 'f_email', -1)).slice(0, 2)).toEqual(['f_email', 'f_name']);
    expect(ids(moveBlock(d, 'f_name', -1))).toEqual(ids(d));
    expect(ids(moveBlock(d, 'f_msg', 1))).toEqual(ids(d));
    expect(canMove(d, 'f_name', -1)).toBe(false);
    expect(canMove(d, 'f_name', 1)).toBe(true);
    expect(canMove(d, 'f_msg', 1)).toBe(false);
  });

  it('removes a block and updates one', () => {
    expect(ids(removeBlock(d, 'f_topic'))).not.toContain('f_topic');
    const out = updateBlock(d, 'f_name', (b) => ({ ...(b as FieldBlock), label: 'Full name' }));
    expect(fieldsOf(out)[0]!.label).toBe('Full name');
  });

  it('duplicates a block next to itself, unbound, with a new id', () => {
    const copy = duplicateBlock(d, 'f_email')!;
    expect(ids(copy.def)).toHaveLength(ids(d).length + 1);
    expect(ids(copy.def)[ids(d).indexOf('f_email') + 1]).toBe(copy.id);
    const dup = fieldsOf(copy.def).find((f) => f.id === copy.id)!;
    expect(dup.bind).toBeUndefined();
    expect(dup.label).toBe('Email');
    expect(duplicateBlock(d, 'nope')).toBeNull();
  });

  it('never changes the definition it was given', () => {
    const before = JSON.stringify(d);
    moveBlock(d, 'f_email', -1);
    removeBlock(d, 'f_name');
    duplicateBlock(d, 'f_name');
    expect(JSON.stringify(d)).toBe(before);
  });

  it('edits the options of a choice', () => {
    let f = newField('radio', 'Pick');
    f = addOption(f, 'Three');
    expect(f.options!.map((o) => o.label)).toEqual(['Option 1', 'Option 2', 'Three']);
    expect(new Set(f.options!.map((o) => o.value)).size).toBe(3);
    f = moveOption(f, 2, -1);
    expect(f.options![1]!.label).toBe('Three');
    f = setOptionLabel(f, 0, 'Zero');
    expect(f.options![0]!.label).toBe('Zero');
    f = removeOption(f, 0);
    expect(f.options).toHaveLength(2);
    expect(moveOption(f, 0, -1)).toBe(f);
  });

  it('tracks which properties are bound', () => {
    const keys = boundKeys(d);
    expect(isBound(keys, { object: 'contact', property: 'email' })).toBe(true);
    expect(isBound(keys, { object: 'company', property: 'name' })).toBe(false);
  });

  it('knows when the working copy differs from the saved one', () => {
    expect(isDirty(d, definition())).toBe(false);
    expect(isDirty({ ...d, title: 'Other' }, d)).toBe(true);
  });
});

describe('definitionProblems (the checks before Publish)', () => {
  const codes = (d: ReturnType<typeof definition>, props = PROPERTIES) =>
    definitionProblems(d, props).map((p) => p.code);

  it('accepts a form with a name, an email and the required property', () => {
    const d = addBlock(
      definition(),
      field({
        id: 'f_budget',
        kind: 'currency',
        label: 'Budget',
        required: true,
        bind: { object: 'contact', property: 'budget' },
      }),
    );
    expect(codes(d)).toEqual([]);
  });

  it('asks for a field, and for a way to reach the person', () => {
    expect(codes(blankDefinition(COPY), [])).toEqual(['no_fields']);
    const noContact = loose({
      steps: [{ id: 's', blocks: [field({ id: 'f_a', kind: 'short_text', label: 'A' })] }],
    });
    expect(codes(noContact, [])).toEqual(['no_contact_point']);
  });

  it('wants a workspace-required property bound and required', () => {
    expect(codes(definition())).toContain('crm_required_unbound');
    const optional = addBlock(
      definition(),
      field({
        id: 'f_budget',
        kind: 'currency',
        label: 'Budget',
        bind: { object: 'contact', property: 'budget' },
      }),
    );
    expect(codes(optional)).toContain('crm_required_optional');
  });

  it('finds empty labels, missing or repeated options and bad ranges', () => {
    const d = loose({
      steps: [
        {
          id: 's',
          blocks: [
            field({
              id: 'f_e',
              kind: 'email',
              label: '  ',
              bind: { object: 'contact', property: 'email' },
            }),
            field({
              id: 'f_c',
              kind: 'radio',
              label: 'C',
              options: [
                { value: 'x', label: 'Same' },
                { value: 'y', label: 'same' },
              ],
            }),
            field({ id: 'f_n', kind: 'number', label: 'N', validation: { min: 5, max: 1 } }),
            {
              ...field({ id: 'f_h', kind: 'hidden', label: 'H' }),
              hiddenSource: 'constant' as const,
            },
          ],
        },
      ],
    });
    const found = codes(d, []);
    expect(found).toEqual(
      expect.arrayContaining(['empty_label', 'duplicate_option', 'bad_range', 'constant_empty']),
    );
  });

  it('refuses a redirect that is not https', () => {
    const d = definition();
    const bad = {
      ...d,
      settings: { ...d.settings, successMode: 'redirect' as const, redirectUrl: undefined },
    };
    expect(codes(bad)).toContain('redirect_not_https');
  });

  it('only builds forms the contract accepts', () => {
    expect(formDefinitionSchema.safeParse(definition()).success).toBe(true);
    const blank = blankDefinition(COPY);
    expect(formDefinitionSchema.safeParse(addBlock(blank, newField('dropdown', 'D'))).success).toBe(
      true,
    );
  });
});
