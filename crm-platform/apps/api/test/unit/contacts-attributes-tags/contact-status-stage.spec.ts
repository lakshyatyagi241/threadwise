import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  defaultStatusForStage,
  isStatusValidForStage,
  planStatus,
  type StatusScope,
} from '../../../src/modules/crm/contacts/contact-status-stage';

const opt = (
  value: string,
  stageValue: string | null,
  extra: { isDefault?: boolean; isActive?: boolean } = {},
) => ({
  value,
  label: value.replace('_', ' '),
  stageValue,
  stageLabel: stageValue ? stageValue.toUpperCase() : null,
  isDefault: extra.isDefault ?? false,
  isActive: extra.isActive ?? true,
});

/** Qualified has two sub-states (waiting is its default), Lost has one, "do_not_contact" is valid anywhere. */
const SCOPE: StatusScope = [
  opt('waiting_for_quote', 'qualified', { isDefault: true }),
  opt('quote_sent', 'qualified'),
  opt('not_interested', 'lost', { isDefault: true }),
  opt('do_not_contact', null),
];

const plan = (over: Partial<Parameters<typeof planStatus>[0]>) =>
  planStatus({
    scope: SCOPE,
    stage: 'qualified',
    stageLabel: 'Qualified',
    stageChanged: false,
    current: null,
    requested: undefined,
    ...over,
  });

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as { code: string; message: string; getStatus(): number };
  }
  return expect.unreachable('should have thrown');
};

describe('isStatusValidForStage', () => {
  it('no status, an unscoped status and an unknown value are valid in every stage', () => {
    for (const stage of ['new', 'qualified', 'lost', 'anything']) {
      expect(isStatusValidForStage(SCOPE, null, stage)).toBe(true);
      expect(isStatusValidForStage(SCOPE, undefined, stage)).toBe(true);
      expect(isStatusValidForStage(SCOPE, '', stage)).toBe(true);
      expect(isStatusValidForStage(SCOPE, 'do_not_contact', stage)).toBe(true);
      expect(isStatusValidForStage(SCOPE, 'imported_free_text', stage)).toBe(true);
    }
  });

  it('a scoped status is valid only in its own stage', () => {
    expect(isStatusValidForStage(SCOPE, 'quote_sent', 'qualified')).toBe(true);
    expect(isStatusValidForStage(SCOPE, 'quote_sent', 'new')).toBe(false);
    expect(isStatusValidForStage(SCOPE, 'quote_sent', 'lost')).toBe(false);
  });

  it('a workspace with no scoped status never invalidates anything (backward compatible)', () => {
    const legacy: StatusScope = [opt('active', null), opt('inactive', null)];
    for (const stage of ['new', 'lost', 'whatever']) {
      expect(isStatusValidForStage(legacy, 'active', stage)).toBe(true);
    }
    expect(isStatusValidForStage([], 'active', 'new')).toBe(true);
  });

  it('a value listed twice (scoped and unscoped) is valid where either allows it', () => {
    const both: StatusScope = [opt('on_hold', 'lost'), opt('on_hold', null)];
    expect(isStatusValidForStage(both, 'on_hold', 'new')).toBe(true);
  });
});

describe('defaultStatusForStage', () => {
  it('is the active default scoped to that stage, else null', () => {
    expect(defaultStatusForStage(SCOPE, 'qualified')).toBe('waiting_for_quote');
    expect(defaultStatusForStage(SCOPE, 'lost')).toBe('not_interested');
    expect(defaultStatusForStage(SCOPE, 'new')).toBeNull();
  });

  it('ignores a hidden default and an unscoped default', () => {
    const scope: StatusScope = [
      opt('hidden_default', 'qualified', { isDefault: true, isActive: false }),
      opt('everywhere', null, { isDefault: true }),
    ];
    expect(defaultStatusForStage(scope, 'qualified')).toBeNull();
    expect(defaultStatusForStage(scope, 'new')).toBeNull();
  });
});

describe('planStatus: a stage move', () => {
  it('keeps a status that is still valid (unscoped statuses never move)', () => {
    expect(plan({ stage: 'lost', stageChanged: true, current: 'do_not_contact' })).toEqual({
      status: undefined,
      reset: false,
    });
    expect(plan({ stage: 'qualified', stageChanged: true, current: 'quote_sent' })).toEqual({
      status: undefined,
      reset: false,
    });
  });

  it('resets an invalid status to the new stage default', () => {
    expect(plan({ stage: 'lost', stageChanged: true, current: 'quote_sent' })).toEqual({
      status: 'not_interested',
      reset: true,
    });
  });

  it('clears an invalid status when the new stage has no default', () => {
    expect(plan({ stage: 'new', stageChanged: true, current: 'quote_sent' })).toEqual({
      status: null,
      reset: true,
    });
  });

  it('fills the default in when the contact had no status, and leaves it empty when there is no default', () => {
    expect(plan({ stage: 'qualified', stageChanged: true, current: null })).toEqual({
      status: 'waiting_for_quote',
      reset: true,
    });
    expect(plan({ stage: 'new', stageChanged: true, current: null })).toEqual({
      status: undefined,
      reset: false,
    });
  });

  it('works the same for a won or lost stage (they are just stages with a default)', () => {
    expect(plan({ stage: 'lost', stageChanged: true, current: 'waiting_for_quote' }).status).toBe(
      'not_interested',
    );
  });

  it('a request that sends the contact status unchanged is treated as not sent', () => {
    expect(
      plan({ stage: 'lost', stageChanged: true, current: 'quote_sent', requested: 'quote_sent' }),
    ).toEqual({
      status: 'not_interested',
      reset: true,
    });
  });

  it('an explicit valid status wins over the default; an explicit clear stays clear', () => {
    expect(
      plan({
        stage: 'qualified',
        stageChanged: true,
        current: 'quote_sent',
        requested: 'do_not_contact',
      }),
    ).toEqual({ status: 'do_not_contact', reset: false });
    expect(
      plan({ stage: 'lost', stageChanged: true, current: 'quote_sent', requested: null }),
    ).toEqual({
      status: null,
      reset: false,
    });
  });
});

describe('planStatus: no stage move', () => {
  it('changes nothing when the status is not touched, even if it is out of scope', () => {
    expect(plan({ stage: 'new', current: 'quote_sent' })).toEqual({
      status: undefined,
      reset: false,
    });
  });

  it('sets a status that belongs to the stage, or an unscoped one', () => {
    expect(plan({ current: 'waiting_for_quote', requested: 'quote_sent' })).toEqual({
      status: 'quote_sent',
      reset: false,
    });
    expect(plan({ stage: 'new', current: null, requested: 'do_not_contact' }).status).toBe(
      'do_not_contact',
    );
  });

  it('rejects a status scoped to another stage: 422 CON_STATUS_STAGE_MISMATCH naming the stages', () => {
    const e = thrown(() => plan({ stage: 'lost', stageLabel: 'Lost', requested: 'quote_sent' }));
    expect(e.code).toBe(ERROR_CODES.CON_STATUS_STAGE_MISMATCH);
    expect(e.getStatus()).toBe(422);
    expect(e.message).toContain('"QUALIFIED"');
    expect(e.message).toContain('"Lost"');
  });

  it('a status sent unchanged is not re-validated (editing other fields of a contact that predates scoping)', () => {
    expect(plan({ stage: 'lost', current: 'quote_sent', requested: 'quote_sent' })).toEqual({
      status: undefined,
      reset: false,
    });
  });

  it('clearing a status is always allowed', () => {
    expect(plan({ current: 'quote_sent', requested: null })).toEqual({
      status: null,
      reset: false,
    });
  });
});

describe('planStatus: create', () => {
  const create = (stage: string, requested?: string) =>
    plan({ stage, stageChanged: true, current: null, requested });

  it('starts in the stage default status when none is given', () => {
    expect(create('qualified').status).toBe('waiting_for_quote');
    expect(create('new').status).toBeUndefined();
  });

  it('takes the status it was given if it fits the stage, 422 if it does not', () => {
    expect(create('qualified', 'quote_sent').status).toBe('quote_sent');
    expect(thrown(() => create('new', 'quote_sent')).code).toBe(
      ERROR_CODES.CON_STATUS_STAGE_MISMATCH,
    );
  });
});
