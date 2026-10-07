import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinitionInput } from '@crm/contracts';
import {
  publishProblems,
  type PublishContext,
} from '../../../src/modules/forms-builder/form-definition-rules';

const f = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  ...over,
});
const make = (blocks: unknown[], extra: Record<string, unknown> = {}) =>
  formDefinitionSchema.parse({
    title: 'T',
    steps: [{ id: 'step', blocks }],
    ...extra,
  } as FormDefinitionInput);
const email = f('email', 'email', {
  required: true,
  bind: { object: 'contact', property: 'email' },
});

const ctx = (over: Partial<PublishContext> = {}): PublishContext => ({
  contactProps: new Map([
    ['budget', { type: 'integer', label: 'Budget' }],
    ['plan', { type: 'select', label: 'Plan' }],
    ['agree', { type: 'boolean', label: 'Agree' }],
  ]),
  companyProps: new Map([['segment', { type: 'text', label: 'Segment' }]]),
  contactRequired: [],
  stageUsable: (s) => s === 'qualified',
  ...over,
});
const problems = (def: ReturnType<typeof make>, c = ctx()) =>
  publishProblems(def, c).map((p) => `${p.path}:${p.reason}`);

describe('publishProblems (spec 7.1 and 9.3)', () => {
  it('a form that reaches a person and binds only known properties can be published', () => {
    expect(
      problems(
        make([f('name', 'short_text', { bind: { object: 'contact', property: 'name' } }), email]),
      ),
    ).toEqual([]);
  });

  it('no_fields: a form with nothing to fill (a hidden field is not an input)', () => {
    expect(problems(make([f('h', 'hidden', { hiddenSource: 'referrer' })]))).toContain(
      'steps:no_fields',
    );
    expect(problems(make([]))).toContain('steps:no_fields');
  });

  it('no_contact_point: neither an email nor a phone is bound', () => {
    expect(
      problems(make([f('name', 'short_text', { bind: { object: 'contact', property: 'name' } })])),
    ).toContain('steps:no_contact_point');
    expect(problems(make([f('x', 'short_text')]))).toContain('steps:no_contact_point');
    expect(
      problems(make([f('p', 'phone', { bind: { object: 'contact', property: 'phone' } })])),
    ).not.toContain('steps:no_contact_point');
  });

  it('crm_required_unbound: a property the workspace requires must be collected, and required', () => {
    const c = ctx({ contactRequired: [{ key: 'budget', label: 'Budget' }] });
    expect(problems(make([email]), c)).toContain('contact.budget:crm_required_unbound');
    const optional = f('budget', 'number', { bind: { object: 'contact', property: 'budget' } });
    expect(problems(make([email, optional]), c)).toContain(
      'steps.0.blocks.1.required:crm_required_not_required',
    );
    const ok = f('budget', 'number', {
      required: true,
      bind: { object: 'contact', property: 'budget' },
    });
    expect(problems(make([email, ok]), c)).toEqual([]);
  });

  it('bind_unknown_property: a custom property the registry does not have (or has inactive)', () => {
    const ghost = f('g', 'short_text', { bind: { object: 'contact', property: 'ghost_field' } });
    expect(problems(make([email, ghost]))).toContain('steps.0.blocks.1.bind:bind_unknown_property');
  });

  it('bind_type_mismatch: the kind of field must suit the property it writes', () => {
    const wrongEmail = f('e', 'short_text', {
      required: true,
      bind: { object: 'contact', property: 'email' },
    });
    expect(problems(make([wrongEmail]))).toContain('steps.0.blocks.0.bind:bind_type_mismatch');
    const wrongPhone = f('p', 'short_text', { bind: { object: 'contact', property: 'phone' } });
    expect(problems(make([email, wrongPhone]))).toContain(
      'steps.0.blocks.1.bind:bind_type_mismatch',
    );
    const budgetAsDate = f('b', 'date', { bind: { object: 'contact', property: 'budget' } });
    expect(problems(make([email, budgetAsDate]))).toContain(
      'steps.0.blocks.1.bind:bind_type_mismatch',
    );
    const selectOk = f('s', 'dropdown', {
      options: [{ value: 'a', label: 'A' }],
      bind: { object: 'contact', property: 'plan' },
    });
    expect(problems(make([email, selectOk]))).toEqual([]);
    const tickAsBoolean = f('t', 'checkbox', { bind: { object: 'contact', property: 'agree' } });
    expect(problems(make([email, tickAsBoolean]))).toEqual([]);
  });

  it('company_fields_need_match: a form that writes a company cannot opt out of matching', () => {
    const co = f('co', 'short_text', { bind: { object: 'company', property: 'name' } });
    expect(problems(make([email, co], { mapping: { company: { match: 'none' } } }))).toContain(
      'mapping.company.match:company_fields_need_match',
    );
    expect(
      problems(make([email, co], { mapping: { company: { match: 'name_or_domain' } } })),
    ).toEqual([]);
    expect(problems(make([email], { mapping: { company: { match: 'none' } } }))).toEqual([]);
  });

  it('company custom properties come from the companies registry, not the contacts one', () => {
    const seg = f('seg', 'short_text', { bind: { object: 'company', property: 'segment' } });
    expect(problems(make([email, seg]))).toEqual([]);
    const wrong = f('bud', 'number', { bind: { object: 'company', property: 'budget' } });
    expect(problems(make([email, wrong]))).toContain('steps.0.blocks.1.bind:bind_unknown_property');
  });

  it('lifecycle_stage_unknown: a stage the workspace no longer allows', () => {
    expect(problems(make([email], { after: { lifecycleStage: 'qualified' } }))).toEqual([]);
    expect(problems(make([email], { after: { lifecycleStage: 'gone' } }))).toContain(
      'after.lifecycleStage:lifecycle_stage_unknown',
    );
  });

  it('every problem is listed at once', () => {
    const all = problems(
      make([f('x', 'short_text', { bind: { object: 'contact', property: 'ghost' } })]),
    );
    expect(all).toEqual(
      expect.arrayContaining([
        'steps:no_contact_point',
        'steps.0.blocks.0.bind:bind_unknown_property',
      ]),
    );
  });
});
