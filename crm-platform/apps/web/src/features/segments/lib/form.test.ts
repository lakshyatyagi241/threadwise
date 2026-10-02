import { describe, expect, it } from 'vitest';
import { buildCatalog, type Lookups } from './fields';
import {
  blankForm,
  formFromSegment,
  formSignature,
  formToInput,
  hasProblems,
  indexPathOf,
  mapServerProblems,
  validateForm,
  type SegmentForm,
} from './form';
import {
  addCondition,
  conditionsOf,
  emptyRoot,
  newCondition,
  setValue,
  type Condition,
} from './model';

const lookups: Lookups = {
  stages: [{ value: 'new', label: 'New' }],
  statuses: [],
  tags: [],
  groups: [],
  users: [],
  properties: [],
};
const catalog = buildCatalog(lookups);
const stage = catalog.find((f) => f.id === 'lifecycleStage')!;

const formWith = (value: Condition['value'], over: Partial<SegmentForm> = {}): SegmentForm => {
  const r = emptyRoot();
  return {
    ...blankForm(),
    name: 'Hot leads',
    rules: addCondition(r, r.id, { ...newCondition(stage), value }),
    ...over,
  };
};

describe('validateForm', () => {
  it('passes a named segment with one complete condition', () => {
    expect(hasProblems(validateForm(formWith('new'), catalog))).toBe(false);
  });

  it('needs a name, at most 191 characters', () => {
    expect(validateForm(formWith('new', { name: '  ' }), catalog).name).toBe('required');
    expect(validateForm(formWith('new', { name: 'x'.repeat(192) }), catalog).name).toBe('tooLong');
    expect(validateForm(formWith('new', { name: 'x'.repeat(191) }), catalog).name).toBeUndefined();
  });

  it('limits the description to 1000 characters', () => {
    expect(
      validateForm(formWith('new', { description: 'x'.repeat(1001) }), catalog).description,
    ).toBe('tooLong');
  });

  it('needs at least one condition', () => {
    expect(validateForm({ ...blankForm(), name: 'x' }, catalog).rules).toBe('empty');
  });

  it('names the incomplete condition and says the rules are incomplete', () => {
    const f = formWith('');
    const p = validateForm(f, catalog);
    expect(p.rules).toBe('incomplete');
    expect(p.conditions[conditionsOf(f.rules)[0]!.id]).toBe('empty');
  });

  it('flags a condition on a field that no longer exists', () => {
    const f = formWith('new');
    const c = conditionsOf(f.rules)[0]!;
    const gone = { ...f, rules: { ...f.rules, children: [{ ...c, field: 'custom.deleted' }] } };
    expect(validateForm(gone, catalog).conditions[c.id]).toBe('field');
  });
});

describe('formToInput', () => {
  it('builds the create body the contract accepts', () => {
    const input = formToInput(
      formWith('new', { description: '  warm ', visibility: 'shared' }),
      catalog,
    );
    expect(input).toMatchObject({
      name: 'Hot leads',
      description: 'warm',
      visibility: 'shared',
      rules: {
        type: 'group',
        combinator: 'and',
        children: [
          { type: 'condition', field: 'lifecycleStage', operator: 'equals', value: 'new' },
        ],
      },
    });
  });

  it('is null while the rules are not valid, and a blank description is null', () => {
    expect(formToInput(formWith(''), catalog)).toBeNull();
    expect(formToInput(formWith('new'), catalog)?.description).toBeNull();
  });
});

describe('unsaved changes', () => {
  it('has the same signature for the same segment, whatever the local ids', () => {
    expect(formSignature(formWith('new'))).toBe(formSignature(formWith('new')));
  });

  it('changes with the name, description, colour, visibility, or any rule', () => {
    const base = formSignature(formWith('new'));
    expect(formSignature(formWith('new', { name: 'Other' }))).not.toBe(base);
    expect(formSignature(formWith('new', { description: 'd' }))).not.toBe(base);
    expect(formSignature(formWith('new', { color: '#22C55E' }))).not.toBe(base);
    expect(formSignature(formWith('new', { visibility: 'shared' }))).not.toBe(base);
    const f = formWith('new');
    const changed = { ...f, rules: setValue(f.rules, conditionsOf(f.rules)[0]!.id, 'won') };
    expect(formSignature(changed)).not.toBe(base);
  });

  it('ignores spaces around the name', () => {
    expect(formSignature(formWith('new', { name: ' Hot leads ' }))).toBe(
      formSignature(formWith('new')),
    );
  });

  it('a segment loaded from the server starts out unchanged', () => {
    const wire = formToInput(formWith('new'), catalog)!;
    const loaded = formFromSegment({
      name: wire.name,
      description: wire.description ?? null,
      color: wire.color ?? null,
      visibility: wire.visibility,
      rules: wire.rules,
    });
    expect(formSignature(loaded)).toBe(formSignature(formWith('new')));
  });
});

describe('server validation mapped to the form', () => {
  it('reads index paths from the problem path', () => {
    expect(indexPathOf('rules.children.1.children.0.value')).toEqual([1, 0]);
    expect(indexPathOf('rules.children[2].value')).toEqual([2]);
    expect(indexPathOf('rules')).toEqual([]);
    expect(indexPathOf('name')).toBeNull();
  });

  it('puts name and description errors on their fields', () => {
    const p = mapServerProblems(
      [
        { path: 'name', message: 'too long' },
        { path: 'description', message: 'bad' },
      ],
      emptyRoot(),
    );
    expect(p).toMatchObject({ name: 'too long', description: 'bad', conditions: {} });
  });

  it('puts a rule error on the condition it names, and the rest on the rules', () => {
    const f = formWith('new');
    const id = conditionsOf(f.rules)[0]!.id;
    const p = mapServerProblems(
      [
        { path: 'rules.children.0.value', message: 'a number is required' },
        { path: 'rules.children.7.value', message: 'no such place' },
        { path: 'rules', message: 'at most 50 conditions' },
      ],
      f.rules,
    );
    expect(p.conditions[id]).toBe('a number is required');
    expect(p.rules).toBe('no such place');
  });

  it('keeps the first message per place and ignores paths it does not know', () => {
    const f = formWith('new');
    const p = mapServerProblems(
      [
        { path: 'name', message: 'first' },
        { path: 'name', message: 'second' },
        { path: 'somethingElse', message: 'x' },
      ],
      f.rules,
    );
    expect(p.name).toBe('first');
  });
});
