import { describe, expect, it } from 'vitest';
import {
  EMPTY_WIZARD_DRAFT,
  firstRunInstant,
  parseTestRecipients,
  retryInstant,
  retryWindowCloses,
  saveWizardDraftSchema,
  updateWizardDraftSchema,
  wizardDraftSchema,
  wizardLaunchIssues,
  wizardScheduleSchema,
  wizardStepIssues,
  wizardVariableSourceSchema,
  type WizardDraft,
} from '@crm/contracts';

const T = '3f2b8c1e-7c1d-4a55-9d10-0d0a6f0f9a11';
const NOW = new Date('2026-10-06T10:00:00Z');
const draft = (o: Partial<WizardDraft> = {}): WizardDraft => wizardDraftSchema.parse({ ...o });

describe('the draft', () => {
  it('an empty draft is valid: a half-filled draft is a normal thing to save', () => {
    expect(EMPTY_WIZARD_DRAFT).toMatchObject({
      name: '',
      templateId: null,
      audience: { groupIds: [], segmentIds: [], rules: null },
      variables: {},
      schedule: { mode: 'now' },
      retries: { enabled: false },
      step: 1,
    });
  });

  it('saving takes any subset; unknown keys are dropped, not stored', () => {
    expect(saveWizardDraftSchema.parse({ name: 'Diwali' })).toEqual({ name: 'Diwali' });
    expect(saveWizardDraftSchema.parse({ name: 'x', hacker: 1 })).toEqual({ name: 'x' });
  });

  it('an update always carries the row version', () => {
    expect(updateWizardDraftSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateWizardDraftSchema.safeParse({ name: 'x', rowVersion: 3 }).success).toBe(true);
  });

  it('refuses what cannot be stored: a bad id, an oversized name, a step out of range', () => {
    expect(wizardDraftSchema.safeParse({ templateId: 'nope' }).success).toBe(false);
    expect(wizardDraftSchema.safeParse({ name: 'x'.repeat(192) }).success).toBe(false);
    expect(wizardDraftSchema.safeParse({ step: 5 }).success).toBe(false);
  });

  it("the audience rules are the segment engine's own tree: an unknown field or a too-deep tree is refused", () => {
    const rule = (field: string) => ({
      audience: {
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field, operator: 'equals', value: 'x' }],
        },
      },
    });
    expect(wizardDraftSchema.safeParse(rule('name')).success).toBe(true);
    expect(wizardDraftSchema.safeParse(rule('countryCode')).success).toBe(true);
    expect(wizardDraftSchema.safeParse(rule('nonsense')).success).toBe(false);
  });
});

describe('variable sources', () => {
  it('a field with a fallback, or fixed text', () => {
    expect(
      wizardVariableSourceSchema.parse({ kind: 'field', field: 'first_name', fallback: 'there' }),
    ).toBeTruthy();
    expect(wizardVariableSourceSchema.parse({ kind: 'fixed', text: 'SALE50' })).toBeTruthy();
  });

  it('fixed text may not carry braces (they would be read as a merge tag) and may not be empty', () => {
    expect(wizardVariableSourceSchema.safeParse({ kind: 'fixed', text: '{{name}}' }).success).toBe(
      false,
    );
    expect(wizardVariableSourceSchema.safeParse({ kind: 'fixed', text: '  ' }).success).toBe(false);
  });
});

describe('schedule', () => {
  it('now, scheduled with a zone, or recurring with a rule', () => {
    expect(wizardScheduleSchema.parse({ mode: 'now' })).toEqual({ mode: 'now' });
    expect(
      wizardScheduleSchema.safeParse({
        mode: 'scheduled',
        date: '2026-10-07',
        time: '09:00',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(true);
    expect(
      wizardScheduleSchema.safeParse({
        mode: 'scheduled',
        date: '2026-10-07',
        time: '25:00',
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(false);
    expect(
      wizardScheduleSchema.safeParse({
        mode: 'scheduled',
        date: '2026-02-31',
        time: '09:00',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
    expect(
      wizardScheduleSchema.safeParse({
        mode: 'scheduled',
        date: '2026-10-07',
        time: '09:00',
        timezone: 'Mars/Base',
      }).success,
    ).toBe(false);
  });

  it("the first run is read in the schedule's own zone", () => {
    const s = wizardScheduleSchema.parse({
      mode: 'scheduled',
      date: '2026-10-07',
      time: '09:00',
      timezone: 'Asia/Kolkata',
    });
    expect(firstRunInstant(s)?.toISOString()).toBe('2026-10-07T03:30:00.000Z');
    expect(firstRunInstant({ mode: 'now' })).toBeNull();
  });
});

describe('step validation (the web before Next, the API at launch)', () => {
  const ok = draft({
    name: 'Offer',
    templateId: T,
    audience: { groupIds: [T], segmentIds: [], rules: null },
    variables: { 'body.1': { kind: 'field', field: 'first_name' } },
  });

  it('step 1 needs a name and a template', () => {
    expect(wizardStepIssues(1, EMPTY_WIZARD_DRAFT, { now: NOW }).map((i) => i.code)).toEqual([
      'name_required',
      'template_required',
    ]);
    expect(wizardStepIssues(1, ok, { now: NOW })).toEqual([]);
    expect(wizardStepIssues(1, draft({ name: '   ', templateId: T }), { now: NOW })[0]?.code).toBe(
      'name_required',
    );
  });

  it('step 2 needs a group, a segment or a condition', () => {
    expect(wizardStepIssues(2, EMPTY_WIZARD_DRAFT, { now: NOW })[0]?.code).toBe(
      'audience_required',
    );
    expect(wizardStepIssues(2, ok, { now: NOW })).toEqual([]);
  });

  it('step 3 names every placeholder without a source', () => {
    const issues = wizardStepIssues(3, ok, { slots: ['body.1', 'body.2', 'header.1'], now: NOW });
    expect(issues.map((i) => i.path)).toEqual(['variables.body.2', 'variables.header.1']);
    expect(wizardStepIssues(3, ok, { slots: ['body.1'], now: NOW })).toEqual([]);
  });

  it('step 4: a scheduled time must be in the future, in its own zone', () => {
    const past = draft({
      schedule: { mode: 'scheduled', date: '2026-10-06', time: '15:00', timezone: 'Asia/Kolkata' },
    });
    // 15:00 IST on the 6th is 09:30Z, before NOW (10:00Z).
    expect(wizardStepIssues(4, past, { now: NOW })[0]?.code).toBe('schedule_in_past');
    const future = draft({
      schedule: { mode: 'scheduled', date: '2026-10-06', time: '16:00', timezone: 'Asia/Kolkata' },
    });
    expect(wizardStepIssues(4, future, { now: NOW })).toEqual([]);
  });

  it('step 4: a recurring start must be in the future too', () => {
    const rule = (startDate: string) => ({
      mode: 'recurring' as const,
      rule: {
        frequency: 'weekly' as const,
        interval: 1,
        startDate,
        timeOfDay: '09:00',
        timezone: 'UTC',
        weekdays: [1],
        ends: { kind: 'never' as const },
      },
    });
    expect(
      wizardStepIssues(4, draft({ schedule: rule('2026-10-05') }), { now: NOW })[0]?.code,
    ).toBe('schedule_in_past');
    expect(wizardStepIssues(4, draft({ schedule: rule('2026-10-12') }), { now: NOW })).toEqual([]);
  });

  it('step 4: retries need an end date that is not past and not before the send', () => {
    const base = { schedule: { mode: 'now' as const } };
    expect(
      wizardStepIssues(4, draft({ ...base, retries: { enabled: true } }), { now: NOW }).map(
        (i) => i.code,
      ),
    ).toEqual(['retry_end_required']);
    expect(
      wizardStepIssues(
        4,
        draft({ ...base, retries: { enabled: true, endDate: '2026-10-05', timezone: 'UTC' } }),
        { now: NOW },
      ).map((i) => i.code),
    ).toContain('retry_end_in_past');
    expect(
      wizardStepIssues(
        4,
        draft({ ...base, retries: { enabled: true, endDate: '2026-10-09', timezone: 'UTC' } }),
        { now: NOW },
      ),
    ).toEqual([]);
    // Retries off: the end date is not looked at.
    expect(
      wizardStepIssues(4, draft({ ...base, retries: { enabled: false, endDate: '2020-01-01' } }), {
        now: NOW,
      }),
    ).toEqual([]);
    // A retry window that closes before a scheduled send ever starts.
    const early = draft({
      schedule: { mode: 'scheduled', date: '2026-10-20', time: '09:00', timezone: 'UTC' },
      retries: { enabled: true, endDate: '2026-10-10', timezone: 'UTC' },
    });
    expect(wizardStepIssues(4, early, { now: NOW }).map((i) => i.code)).toContain(
      'retry_end_before_send',
    );
  });

  it('a launch checks every step in order', () => {
    const issues = wizardLaunchIssues(EMPTY_WIZARD_DRAFT, { slots: ['body.1'], now: NOW }).map(
      (i) => i.code,
    );
    expect(issues).toEqual([
      'name_required',
      'template_required',
      'audience_required',
      'variable_unmapped',
    ]);
  });
});

describe('test recipients', () => {
  it('splits on commas, spaces and new lines, keeps the first of a repeat, and sorts valid from invalid', () => {
    expect(parseTestRecipients('+919876543210, +14155550123\n+919876543210;12345')).toEqual({
      valid: ['+919876543210', '+14155550123'],
      invalid: ['12345'],
      tooMany: false,
    });
  });

  it('E.164 only: a plus, no leading zero after it, 8 to 15 digits', () => {
    const bad = ['9876543210', '+0123456789', '+1234567', '+1234567890123456', '+91 98765 43210'];
    for (const b of bad.slice(0, 4)) expect(parseTestRecipients(b).invalid).toEqual([b]);
    // A space inside splits it into two pieces, both invalid.
    expect(parseTestRecipients(bad[4]!).valid).toEqual([]);
  });

  it('more than ten valid numbers is too many', () => {
    const many = Array.from({ length: 11 }, (_, i) => `+9198765432${String(10 + i)}`).join(',');
    expect(parseTestRecipients(many).tooMany).toBe(true);
    expect(parseTestRecipients(many.split(',').slice(0, 10).join(',')).tooMany).toBe(false);
  });

  it('empty input has nothing valid', () => {
    expect(parseTestRecipients('  , ;')).toEqual({ valid: [], invalid: [], tooMany: false });
  });
});

describe('the retry window', () => {
  it('closes at the start of the day after the end date, in the zone', () => {
    expect(
      retryWindowCloses({ endDate: '2026-10-09', timezone: 'Asia/Kolkata' }, 'UTC')?.toISOString(),
    ).toBe('2026-10-09T18:30:00.000Z');
    expect(retryWindowCloses({ endDate: '2026-10-09' }, 'UTC')?.toISOString()).toBe(
      '2026-10-10T00:00:00.000Z',
    );
    expect(retryWindowCloses({ endDate: null }, 'UTC')).toBeNull();
  });

  it('retry k is the first send plus k whole days', () => {
    const first = new Date('2026-10-06T10:17:42Z');
    expect(retryInstant(first, 1).toISOString()).toBe('2026-10-07T10:17:42.000Z');
    expect(retryInstant(first, 3).toISOString()).toBe('2026-10-09T10:17:42.000Z');
  });
});
