import { describe, expect, it } from 'vitest';
import type { StatusOptionResponse } from '@crm/contracts';
import { statusChoices } from './option-sets';
import {
  effectiveStage,
  hasScopedStatuses,
  isStatusAllowedInStage,
  stageDefaultStatus,
  statusAfterMove,
  statusNotice,
  statusScope,
} from './status-scope';
import { scopeStages, statusesScopedTo } from './stage-model';

const opt = (over: Partial<StatusOptionResponse>): StatusOptionResponse => ({
  id: 'id',
  moduleKey: 'contacts',
  optionGroup: 'status',
  value: 'x',
  label: 'X',
  color: null,
  position: 0,
  isDefault: false,
  isActive: true,
  isWon: false,
  isLost: false,
  stageOptionId: null,
  rowVersion: 1,
  ...over,
});

const stage = (value: string, over: Partial<StatusOptionResponse> = {}) =>
  opt({ id: `stage-${value}`, optionGroup: 'lifecycle_stage', value, label: value, ...over });
const status = (value: string, over: Partial<StatusOptionResponse> = {}) =>
  opt({ id: `status-${value}`, value, label: value.replace(/_/g, ' '), ...over });

/** New / Qualified / Lost; Qualified has two sub-states (waiting is its default), Lost one, "do not contact" is anywhere. */
const OPTIONS: StatusOptionResponse[] = [
  stage('new', { isDefault: true }),
  stage('qualified', { position: 1 }),
  stage('lost', { position: 2, isLost: true }),
  status('waiting_for_quote', { stageOptionId: 'stage-qualified', isDefault: true, position: 0 }),
  status('quote_sent', { stageOptionId: 'stage-qualified', position: 1 }),
  status('not_interested', { stageOptionId: 'stage-lost', isDefault: true, position: 2 }),
  status('do_not_contact', { position: 3 }),
];

const label = (v: string) => v;

describe('statusScope', () => {
  it('resolves the stage each status is scoped to, by the stage value', () => {
    const scope = statusScope(OPTIONS);
    expect(scope.map((s) => [s.value, s.stageValue])).toEqual([
      ['waiting_for_quote', 'qualified'],
      ['quote_sent', 'qualified'],
      ['not_interested', 'lost'],
      ['do_not_contact', null],
    ]);
  });

  it('reads both status group names, and ignores stages and lost reasons', () => {
    const scope = statusScope([
      status('a', { optionGroup: 'contact_status' }),
      status('b', { optionGroup: 'lost_reason' }),
      stage('new'),
    ]);
    expect(scope.map((s) => s.value)).toEqual(['a']);
  });

  it('a scope that points at a stage the list does not have counts as unscoped', () => {
    expect(statusScope([status('a', { stageOptionId: 'gone' })])[0]?.stageValue).toBeNull();
  });

  it('knows whether any status is scoped (the link is in use)', () => {
    expect(hasScopedStatuses(OPTIONS)).toBe(true);
    expect(hasScopedStatuses([stage('new'), status('a')])).toBe(false);
    expect(hasScopedStatuses(undefined)).toBe(false);
  });
});

describe('isStatusAllowedInStage (valid status for a stage)', () => {
  it('a scoped status is allowed only in its stage; an unscoped one anywhere', () => {
    expect(isStatusAllowedInStage(OPTIONS, 'quote_sent', 'qualified')).toBe(true);
    expect(isStatusAllowedInStage(OPTIONS, 'quote_sent', 'new')).toBe(false);
    expect(isStatusAllowedInStage(OPTIONS, 'do_not_contact', 'lost')).toBe(true);
  });

  it('a value the workspace has no option for is not judged', () => {
    expect(isStatusAllowedInStage(OPTIONS, 'imported_text', 'new')).toBe(true);
  });

  it('a workspace with nothing scoped never invalidates a status (backward compatible)', () => {
    const legacy = [stage('new'), stage('lost'), status('active'), status('vip')];
    for (const st of ['new', 'lost', 'whatever']) {
      expect(isStatusAllowedInStage(legacy, 'vip', st)).toBe(true);
    }
  });
});

describe('statusAfterMove (reset rules)', () => {
  it('keeps a status that is valid in the new stage', () => {
    expect(statusAfterMove(OPTIONS, 'do_not_contact', 'lost')).toEqual({
      status: 'do_not_contact',
      changed: false,
    });
    expect(statusAfterMove(OPTIONS, 'quote_sent', 'qualified')).toEqual({
      status: 'quote_sent',
      changed: false,
    });
  });

  it("resets an invalid status to the new stage's default", () => {
    expect(statusAfterMove(OPTIONS, 'quote_sent', 'lost')).toEqual({
      status: 'not_interested',
      changed: true,
    });
  });

  it('clears an invalid status when the new stage has no default', () => {
    expect(statusAfterMove(OPTIONS, 'quote_sent', 'new')).toEqual({ status: null, changed: true });
  });

  it('fills the default in when there was no status, and does nothing when the stage has none', () => {
    expect(statusAfterMove(OPTIONS, null, 'qualified')).toEqual({
      status: 'waiting_for_quote',
      changed: true,
    });
    expect(statusAfterMove(OPTIONS, '', 'qualified').status).toBe('waiting_for_quote');
    expect(statusAfterMove(OPTIONS, null, 'new')).toEqual({ status: null, changed: false });
  });

  it('a hidden default is not applied', () => {
    const hidden = OPTIONS.map((o) =>
      o.value === 'not_interested' ? { ...o, isActive: false } : o,
    );
    expect(statusAfterMove(hidden, 'quote_sent', 'lost')).toEqual({ status: null, changed: true });
  });

  it('never changes anything in a workspace that did not scope a status', () => {
    const legacy = [stage('new'), stage('lost'), status('active', { isDefault: true })];
    expect(statusAfterMove(legacy, 'active', 'lost')).toEqual({ status: 'active', changed: false });
    expect(statusAfterMove(legacy, null, 'lost')).toEqual({ status: null, changed: false });
  });
});

describe('stageDefaultStatus / effectiveStage', () => {
  it('the default status of a stage, if it has one', () => {
    expect(stageDefaultStatus(OPTIONS, 'qualified')).toBe('waiting_for_quote');
    expect(stageDefaultStatus(OPTIONS, 'new')).toBeNull();
  });

  it('an empty stage on the form means the workspace default stage, else new', () => {
    expect(effectiveStage(OPTIONS, '')).toBe('new');
    expect(effectiveStage([stage('lead', { isDefault: true })], '')).toBe('lead');
    expect(effectiveStage([], '')).toBe('new');
    expect(effectiveStage(OPTIONS, 'lost')).toBe('lost');
  });
});

describe('statusChoices by stage (contact form)', () => {
  it('offers only the statuses that fit the chosen stage, in saved order', () => {
    expect(statusChoices(OPTIONS, label, undefined, 'qualified').map((c) => c.value)).toEqual([
      'waiting_for_quote',
      'quote_sent',
      'do_not_contact',
    ]);
    expect(statusChoices(OPTIONS, label, undefined, 'lost').map((c) => c.value)).toEqual([
      'not_interested',
      'do_not_contact',
    ]);
    expect(statusChoices(OPTIONS, label, undefined, 'new').map((c) => c.value)).toEqual([
      'do_not_contact',
    ]);
  });

  it('without a stage (filters, import) every status is offered', () => {
    expect(statusChoices(OPTIONS, label).map((c) => c.value)).toHaveLength(4);
  });

  it('a blank form stage is the workspace default stage', () => {
    expect(statusChoices(OPTIONS, label, undefined, '').map((c) => c.value)).toEqual([
      'do_not_contact',
    ]);
  });

  it('keeps the status the contact already holds so the select can show it', () => {
    expect(statusChoices(OPTIONS, label, 'quote_sent', 'new').map((c) => c.value)).toEqual([
      'do_not_contact',
      'quote_sent',
    ]);
  });

  it('a workspace with configured statuses never falls back to the platform four, even with none valid', () => {
    const only = [stage('new'), stage('q'), status('s', { stageOptionId: 'stage-q' })];
    expect(statusChoices(only, label, undefined, 'new')).toEqual([]);
  });

  it('a workspace with no statuses still offers the platform four in any stage', () => {
    expect(statusChoices([stage('new')], label, undefined, 'new').map((c) => c.value)).toEqual([
      'active',
      'prospect',
      'customer',
      'vip',
    ]);
  });
});

describe('statusNotice (toast after a stage change)', () => {
  it('says nothing when the status is the same', () => {
    expect(statusNotice('quote_sent', 'quote_sent')).toEqual({ kind: 'none' });
    expect(statusNotice(null, null)).toEqual({ kind: 'none' });
    expect(statusNotice('', null)).toEqual({ kind: 'none' });
  });

  it('reset: replaced by another; set: filled in from empty; cleared: removed', () => {
    expect(statusNotice('quote_sent', 'not_interested')).toEqual({
      kind: 'reset',
      status: 'not_interested',
    });
    expect(statusNotice(null, 'waiting_for_quote')).toEqual({
      kind: 'set',
      status: 'waiting_for_quote',
    });
    expect(statusNotice('quote_sent', null)).toEqual({ kind: 'cleared' });
  });
});

describe('stage screen helpers', () => {
  it('lists the stages a status can be limited to, and the statuses a stage owns', () => {
    expect(scopeStages(OPTIONS).map((s) => s.value)).toEqual(['new', 'qualified', 'lost']);
    expect(statusesScopedTo(OPTIONS, 'stage-qualified').map((s) => s.value)).toEqual([
      'waiting_for_quote',
      'quote_sent',
    ]);
    expect(statusesScopedTo(OPTIONS, 'stage-new')).toEqual([]);
  });
});
