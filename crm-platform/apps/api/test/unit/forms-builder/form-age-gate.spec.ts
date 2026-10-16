import { describe, expect, it } from 'vitest';
import { FORM_FIELD_KINDS, formDefinitionSchema, type FormDefinitionInput } from '@crm/contracts';
import { publishProblems } from '../../../src/modules/forms-builder/form-definition-rules';
import {
  AGE_KEYS,
  ageAnswerOf,
  cleanGuardian,
  guardianOf,
  judgeFormAge,
  mapAnswers,
  validateSubmission,
} from '../../../src/modules/forms-builder/form-rules';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const f = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  ...over,
});
const make = (blocks: unknown[], ageGate: Record<string, unknown> = {}) =>
  formDefinitionSchema.parse({
    title: 'T',
    steps: [{ id: 'step', blocks }],
    ageGate,
  } as FormDefinitionInput);

describe('the field kinds', () => {
  it('has Date of birth and Age', () => {
    expect(FORM_FIELD_KINDS).toContain('date_of_birth');
    expect(FORM_FIELD_KINDS).toContain('age');
  });
});

describe('the definition', () => {
  it('has an age gate that is off by default, so an old form parses unchanged', () => {
    const d = make([f('a', 'short_text')]);
    expect(d.ageGate).toEqual({
      enabled: false,
      mode: 'declaration',
      minAge: null,
      whenUnder: 'block',
    });
  });

  it('refuses a second age question and a bound age field', () => {
    const two = formDefinitionSchema.safeParse({
      title: 'T',
      steps: [{ id: 's', blocks: [f('d', 'date_of_birth'), f('a', 'age')] }],
    });
    expect(two.success).toBe(false);
    const bound = formDefinitionSchema.safeParse({
      title: 'T',
      steps: [
        { id: 's', blocks: [f('a', 'age', { bind: { object: 'contact', property: 'title' } })] },
      ],
    });
    expect(bound.success).toBe(false);
  });
});

describe('validating the two new kinds', () => {
  const dobForm = make([f('dob', 'date_of_birth')]);
  const ageForm = make([f('age', 'age')]);

  it('accepts a real date of birth and a whole-number age', () => {
    const a = validateSubmission(dobForm, { dob: '2010-05-04' }, {}, NOW);
    expect(a.issues).toEqual([]);
    expect(a.values).toEqual({ dob: '2010-05-04' });
    const b = validateSubmission(ageForm, { age: '15' }, {}, NOW);
    expect(b.issues).toEqual([]);
    expect(b.values).toEqual({ age: 15 });
  });

  it('refuses the future, a bad date and an impossible age with the ordinary codes', () => {
    expect(validateSubmission(dobForm, { dob: '2030-01-01' }, {}, NOW).issues).toEqual([
      { fieldId: 'dob', code: 'invalid_date' },
    ]);
    expect(validateSubmission(dobForm, { dob: 'yesterday' }, {}, NOW).issues).toHaveLength(1);
    expect(validateSubmission(ageForm, { age: '200' }, {}, NOW).issues).toEqual([
      { fieldId: 'age', code: 'invalid_number' },
    ]);
    expect(validateSubmission(ageForm, { age: '1.5' }, {}, NOW).issues).toHaveLength(1);
  });

  it('a date of birth field always writes the contact property, bound or not; an age writes nothing', () => {
    const v = validateSubmission(dobForm, { dob: '2010-05-04' }, {}, NOW).values;
    expect(mapAnswers(dobForm, v).contact.builtin).toEqual({ date_of_birth: '2010-05-04' });
    expect(mapAnswers(dobForm, v).contact.custom).toEqual({});
    const w = validateSubmission(ageForm, { age: 15 }, {}, NOW).values;
    expect(mapAnswers(ageForm, w).contact).toEqual({ builtin: {}, custom: {} });
  });
});

describe('judging a submission against the gate', () => {
  it('date of birth: the form age wins over the workspace age', () => {
    const d = make([f('dob', 'date_of_birth', { required: true })], {
      enabled: true,
      mode: 'dob',
      minAge: 21,
    });
    const values = { dob: '2007-01-01' };
    const j = judgeFormAge(d, values, false, 18, NOW)!;
    expect(j.minAge).toBe(21);
    expect(j.verdict.kind).toBe('under');
    const w = make([f('dob', 'date_of_birth', { required: true })], { enabled: true, mode: 'dob' });
    expect(judgeFormAge(w, values, false, 18, NOW)!.verdict.kind).toBe('adult');
    expect(judgeFormAge(w, values, false, 21, NOW)!.verdict.kind).toBe('under');
  });

  it('age: judged against the minimum', () => {
    const d = make([f('age', 'age', { required: true })], { enabled: true, mode: 'age' });
    expect(judgeFormAge(d, { age: 12 }, false, 16, NOW)!.verdict.kind).toBe('under');
    expect(judgeFormAge(d, { age: 16 }, false, 16, NOW)!.verdict.kind).toBe('adult');
  });

  it('declaration: only a ticked box is an adult', () => {
    const d = make([f('a', 'short_text')], { enabled: true, mode: 'declaration', minAge: 16 });
    expect(judgeFormAge(d, {}, true, 18, NOW)!.verdict.kind).toBe('adult');
    expect(judgeFormAge(d, {}, false, 18, NOW)!.verdict.kind).toBe('under');
  });

  it('a gate that is off judges nothing', () => {
    const d = make([f('dob', 'date_of_birth')]);
    expect(judgeFormAge(d, { dob: '2015-01-01' }, false, 18, NOW)).toBeNull();
    expect(ageAnswerOf(d, { dob: '2015-01-01' }, false)).toBeNull();
  });

  it('a missing question is an invalid answer, not an adult', () => {
    const d = make([f('dob', 'date_of_birth')], { enabled: true, mode: 'dob' });
    expect(judgeFormAge(d, {}, false, 18, NOW)!.verdict.kind).toBe('invalid');
  });
});

describe('the guardian', () => {
  it('needs a name and an email or a phone; cleans both', () => {
    expect(cleanGuardian({ name: ' Asha ', email: 'ASHA@Example.com' }, '91')).toEqual({
      name: 'Asha',
      email: 'asha@example.com',
      phone: null,
    });
    expect(cleanGuardian({ name: 'Asha', phone: '98765 43210' }, '91')).toMatchObject({
      name: 'Asha',
      email: null,
      phone: '+919876543210',
    });
    expect(cleanGuardian({ name: 'Asha' }, '91')).toBeNull();
    expect(cleanGuardian({ name: ' ', email: 'a@b.co' }, '91')).toBeNull();
    expect(cleanGuardian({ name: 'Asha', email: 'not-an-email' }, '91')).toBeNull();
    expect(cleanGuardian(undefined, '91')).toBeNull();
  });

  it('is read back out of the stored answers', () => {
    expect(
      guardianOf({ [AGE_KEYS.guardianName]: 'Asha', [AGE_KEYS.guardianEmail]: 'a@b.co' }),
    ).toEqual({ name: 'Asha', email: 'a@b.co', phone: null });
    expect(guardianOf({})).toBeNull();
  });
});

describe('what Publish checks for the gate', () => {
  const ctx = {
    contactProps: new Map(),
    companyProps: new Map(),
    contactRequired: [],
    stageUsable: () => true,
  };
  const withContact = (extra: unknown[], gate: Record<string, unknown>) =>
    make([f('e', 'email', { bind: { object: 'contact', property: 'email' } }), ...extra], gate);

  it('wants the question for a date-of-birth or age gate, and wants it required', () => {
    const missing = withContact([], { enabled: true, mode: 'dob' });
    expect(publishProblems(missing, ctx).map((p) => p.reason)).toContain('age_gate_field_missing');
    const optional = withContact([f('dob', 'date_of_birth')], { enabled: true, mode: 'dob' });
    expect(publishProblems(optional, ctx).map((p) => p.reason)).toContain(
      'age_gate_field_not_required',
    );
    const ok = withContact([f('dob', 'date_of_birth', { required: true })], {
      enabled: true,
      mode: 'dob',
    });
    expect(publishProblems(ok, ctx)).toEqual([]);
  });

  it('asks nothing for the declaration or a gate that is off', () => {
    expect(publishProblems(withContact([], { enabled: true, mode: 'declaration' }), ctx)).toEqual(
      [],
    );
    expect(publishProblems(withContact([], {}), ctx)).toEqual([]);
  });
});
