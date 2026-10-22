import { describe, expect, it } from 'vitest';
import {
  META_EDIT_DAY_MS,
  META_EDIT_MONTH_LIMIT,
  META_EDIT_MONTH_MS,
  metaEditBlockOf,
  metaEditLogAfter,
} from '../../../src/modules/message-templates/meta-edit-rules';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const live = (
  over: Partial<{ status: string; metaTemplateId: string | null; metaEditLog: string[] }> = {},
) => ({
  status: 'approved',
  metaTemplateId: 'M1',
  metaEditLog: [] as string[],
  ...over,
});

describe('metaEditBlockOf', () => {
  it('never limits a template Meta has not received', () => {
    expect(metaEditBlockOf(live({ metaTemplateId: null, status: 'draft' }), NOW)).toBeNull();
    expect(metaEditBlockOf(live({ metaTemplateId: null, status: 'pending' }), NOW)).toBeNull();
  });

  it('refuses an edit while Meta reviews the template', () => {
    expect(metaEditBlockOf(live({ status: 'pending' }), NOW)).toEqual({
      reason: 'in_review',
      until: null,
    });
  });

  it('lets an approved template be edited when it has no recent edit', () => {
    expect(metaEditBlockOf(live(), NOW)).toBeNull();
    expect(metaEditBlockOf(live({ metaEditLog: [ago(META_EDIT_DAY_MS + 1)] }), NOW)).toBeNull();
  });

  it('allows one edit in 24 hours on an approved template', () => {
    const last = ago(3 * 60 * 60 * 1000);
    expect(metaEditBlockOf(live({ metaEditLog: [last] }), NOW)).toEqual({
      reason: 'daily_limit',
      until: new Date(new Date(last).getTime() + META_EDIT_DAY_MS),
    });
  });

  it('allows ten edits in 30 days on an approved template', () => {
    const times = Array.from({ length: META_EDIT_MONTH_LIMIT }, (_, i) =>
      ago(META_EDIT_MONTH_LIMIT * 2 * META_EDIT_DAY_MS - i * 2 * META_EDIT_DAY_MS),
    );
    const until = new Date(new Date(times[0]).getTime() + META_EDIT_MONTH_MS);
    expect(metaEditBlockOf(live({ metaEditLog: times }), NOW)).toEqual({
      reason: 'monthly_limit',
      until,
    });
  });

  it('reports the later of the two limits when both bind', () => {
    const times = Array.from({ length: META_EDIT_MONTH_LIMIT - 1 }, (_, i) =>
      ago((META_EDIT_MONTH_LIMIT - i) * 2 * META_EDIT_DAY_MS),
    );
    const recent = ago(60 * 1000);
    const monthly = new Date(new Date(times[0]).getTime() + META_EDIT_MONTH_MS);
    const daily = new Date(new Date(recent).getTime() + META_EDIT_DAY_MS);
    expect(daily < monthly).toBe(true);
    expect(metaEditBlockOf(live({ metaEditLog: [...times, recent] }), NOW)).toEqual({
      reason: 'monthly_limit',
      until: monthly,
    });
  });

  it('never limits a rejected or paused template', () => {
    const log = [ago(60 * 1000)];
    expect(metaEditBlockOf(live({ status: 'rejected', metaEditLog: log }), NOW)).toBeNull();
    expect(metaEditBlockOf(live({ status: 'paused', metaEditLog: log }), NOW)).toBeNull();
  });

  it('ignores edits older than 30 days', () => {
    const old = Array.from({ length: META_EDIT_MONTH_LIMIT }, () => ago(META_EDIT_MONTH_MS + 1000));
    expect(metaEditBlockOf(live({ metaEditLog: old }), NOW)).toBeNull();
  });
});

describe('metaEditLogAfter', () => {
  it('appends this edit and drops the ones outside the 30-day window', () => {
    const old = ago(META_EDIT_MONTH_MS + 1000);
    const kept = ago(META_EDIT_DAY_MS * 2);
    expect(metaEditLogAfter([old, kept], NOW)).toEqual([kept, NOW.toISOString()]);
  });

  it('starts an empty log on the first edit', () => {
    expect(metaEditLogAfter([], NOW)).toEqual([NOW.toISOString()]);
  });
});
