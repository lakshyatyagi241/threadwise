import { describe, expect, it } from 'vitest';
import { EMPTY_WIZARD_AUDIENCE, type SegmentGroup } from '@crm/contracts';
import { buildCatalog } from '@/features/segments/lib/fields';
import { addCondition, emptyRoot, newCondition } from '@/features/segments/lib/model';
import { draft, NOW, sources, uuid } from '../testing';
import {
  audienceNames,
  conditionTotal,
  countableAudience,
  editorFromRules,
  incompleteCount,
  rulesFromEditor,
  toggleId,
} from './audience';
import { controlsFor, runPath, statusTone } from './broadcast';
import { canOpenStep, decideNext, launchPreflight, previousStep } from './flow';
import { formatMinor, minorDigits, minorToMajor } from './money';

const catalog = buildCatalog({
  stages: [],
  statuses: [],
  tags: [],
  groups: [],
  users: [],
  properties: [],
});
const field = (id: string) => catalog.find((f) => f.id === id)!;

describe('audience helpers', () => {
  it('toggles an id', () => {
    expect(toggleId([], 'a')).toEqual(['a']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('turns the editor tree into the draft rules: complete conditions only', () => {
    let root = emptyRoot();
    expect(rulesFromEditor(root, catalog)).toBeNull();
    const complete = {
      ...newCondition(field('email')),
      operator: 'contains' as const,
      value: 'gmail',
    };
    root = addCondition(root, root.id, complete);
    root = addCondition(root, root.id, newCondition(field('name'))); // empty value: not finished
    const rules = rulesFromEditor(root, catalog);
    expect(rules).toMatchObject({
      type: 'group',
      children: [{ field: 'email', operator: 'contains', value: 'gmail' }],
    });
    expect(rules?.children).toHaveLength(1);
    expect(incompleteCount(root, catalog)).toBe(1);
    expect(conditionTotal(rules)).toBe(1);
    expect(conditionTotal(null)).toBe(0);
  });

  it('round-trips rules through the editor tree', () => {
    const rules: SegmentGroup = {
      type: 'group',
      combinator: 'or',
      children: [{ type: 'condition', field: 'countryCode', operator: 'equals', value: '+91' }],
    };
    expect(rulesFromEditor(editorFromRules(rules), catalog)).toEqual(rules);
    expect(editorFromRules(null).children).toEqual([]);
  });

  it('countableAudience is null with nothing chosen and keeps valid rules', () => {
    expect(countableAudience(EMPTY_WIZARD_AUDIENCE)).toBeNull();
    const a = { ...EMPTY_WIZARD_AUDIENCE, groupIds: [uuid(11)] };
    expect(countableAudience(a)).toEqual(a);
  });

  it('names the chosen sources and flags one that was deleted', () => {
    const names = audienceNames(
      { groupIds: [uuid(11), uuid(99)], segmentIds: [uuid(21)], rules: null },
      sources(),
    );
    expect(names.groups).toEqual([
      { id: uuid(11), name: 'VIP customers', found: true },
      { id: uuid(99), name: uuid(99), found: false },
    ]);
    expect(names.segments[0]).toMatchObject({ name: 'Active last 30 days', found: true });
    expect(
      audienceNames({ groupIds: [uuid(1)], segmentIds: [], rules: null }, undefined).groups[0]!
        .found,
    ).toBe(false);
  });
});

describe('broadcast controls', () => {
  it('offers what the status allows', () => {
    expect(controlsFor({ kind: 'series', status: 'active' })).toEqual(['pause', 'cancel']);
    expect(controlsFor({ kind: 'series', status: 'paused' })).toEqual(['resume', 'cancel']);
    expect(controlsFor({ kind: 'campaign', status: 'scheduled' })).toEqual(['cancel']);
    expect(controlsFor({ kind: 'campaign', status: 'running' })).toEqual(['pause', 'cancel']);
    expect(controlsFor({ kind: 'series', status: 'ended' })).toEqual([]);
    expect(controlsFor({ kind: 'campaign', status: 'cancelled' })).toEqual([]);
    expect(controlsFor({ kind: 'campaign', status: 'completed' })).toEqual([]);
  });
  it('tones and links', () => {
    expect(statusTone('paused')).toBe('warning');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('active')).toBe('success');
    expect(statusTone('ended')).toBe('neutral');
    expect(runPath(uuid(5))).toBe(`/campaigns/${uuid(5)}`);
  });
});

describe('flow', () => {
  it('blocked steps stay; clear steps advance; the last step launches', () => {
    expect(decideNext(1, [{ path: 'name', code: 'name_required' }])).toEqual({ kind: 'blocked' });
    expect(decideNext(1, [])).toEqual({ kind: 'go', step: 2 });
    expect(decideNext(3, [])).toEqual({ kind: 'go', step: 4 });
    expect(decideNext(4, [])).toEqual({ kind: 'launch' });
    expect(previousStep(1)).toBe(1);
    expect(previousStep(3)).toBe(2);
  });
  it('only reached steps open from the stepper', () => {
    expect(canOpenStep(2, 3)).toBe(true);
    expect(canOpenStep(4, 3)).toBe(false);
  });
  it('the launch preflight finds the first step with a problem', () => {
    const ctx = { slots: ['body.1'], now: NOW };
    expect(launchPreflight(draft(), ctx)).toMatchObject({ kind: 'issues', step: 1 });
    const ok = draft({
      name: 'A',
      templateId: uuid(1),
      senderKey: `waba:${uuid(31)}`,
      audience: { groupIds: [uuid(11)], segmentIds: [], rules: null },
      variables: { 'body.1': { kind: 'fixed', text: 'x' } },
    });
    expect(launchPreflight(ok, ctx)).toEqual({ kind: 'ok' });
    expect(launchPreflight({ ...ok, variables: {} }, ctx)).toMatchObject({
      kind: 'issues',
      step: 3,
    });
    expect(
      launchPreflight(ok, { ...ctx, credit: { sufficient: false, recipients: 3 } }),
    ).toMatchObject({ kind: 'issues', step: 3 });
    expect(launchPreflight(ok, { ...ctx, creditPending: true })).toEqual({ kind: 'ok' });
  });
});

describe('money', () => {
  it("uses the currency's own decimals", () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
    expect(minorToMajor(12_345, 'USD')).toBe(123.45);
    expect(minorToMajor(500, 'JPY')).toBe(500);
  });
  it('formats and survives a bad currency', () => {
    expect(formatMinor(12_345, 'USD', 'en')).toBe('$123.45');
    expect(formatMinor(100, 'XX', 'en')).toContain('1.00');
  });
});
