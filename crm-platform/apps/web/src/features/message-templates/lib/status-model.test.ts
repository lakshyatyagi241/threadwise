import { describe, expect, it } from 'vitest';
import { tplStatusSchema } from '@crm/contracts';
import {
  STATUSES,
  canDuplicate,
  canEdit,
  isLive,
  statusGroupOf,
  canRefresh,
  canSubmit,
  categoryTone,
  isAwaitingReview,
  qualityTone,
  statusTone,
} from './status-model';

describe('status model', () => {
  it('knows every status the contract has', () => {
    expect([...STATUSES].sort()).toEqual([...tplStatusSchema.options].sort());
  });

  it('gives each status a tone', () => {
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('pending')).toBe('warning');
    expect(statusTone('rejected')).toBe('danger');
    expect(statusTone('disabled')).toBe('danger');
    expect(statusTone('draft')).toBe('neutral');
    for (const s of STATUSES) expect(statusTone(s)).toBeTruthy();
  });

  it('colours the quality score and ignores unknown ones', () => {
    expect(qualityTone('GREEN')).toBe('success');
    expect(qualityTone('yellow')).toBe('warning');
    expect(qualityTone('RED')).toBe('danger');
    expect(qualityTone('UNKNOWN')).toBe('neutral');
    expect(qualityTone(null)).toBe('neutral');
  });

  it('tones the categories', () => {
    expect(categoryTone('MARKETING')).toBe('warning');
    expect(categoryTone('UTILITY')).toBe('success');
    expect(categoryTone(null)).toBe('neutral');
  });

  it('allows editing everything but a disabled or missing template, and only the shapes the API builds', () => {
    expect(
      ['draft', 'pending', 'rejected', 'approved', 'paused'].every((st) => canEdit(st as never)),
    ).toBe(true);
    expect(['disabled', 'deleted'].some((st) => canEdit(st as never))).toBe(false);
    expect(canEdit('approved', 'carousel')).toBe(false);
    expect(canEdit('approved', 'media')).toBe(true);
  });

  it('edits a live template in place only once Meta holds it', () => {
    expect(isLive('approved', 'M1')).toBe(true);
    expect(isLive('paused', 'M1')).toBe(true);
    expect(isLive('approved', null)).toBe(false);
    expect(isLive('rejected', 'M1')).toBe(false);
  });

  it('duplicates an approved template, and only one the API can build', () => {
    expect(canDuplicate('approved')).toBe(true);
    expect(canDuplicate('approved', 'media')).toBe(true);
    expect(canDuplicate('approved', 'carousel')).toBe(false);
    expect(
      ['draft', 'pending', 'rejected', 'paused', 'disabled'].some((st) =>
        canDuplicate(st as never),
      ),
    ).toBe(false);
  });

  it("groups statuses the way the library's tabs count them", () => {
    expect(statusGroupOf('approved')).toBe('approved');
    expect(statusGroupOf('pending')).toBe('pending');
    expect(statusGroupOf('draft')).toBe('pending');
    expect(statusGroupOf('rejected')).toBe('rejected');
    expect(statusGroupOf('paused')).toBe('rejected');
    expect(statusGroupOf('disabled')).toBe('rejected');
    expect(statusGroupOf('deleted')).toBeNull();
  });

  it('retries a submit for a draft or a rejected template only', () => {
    expect(canSubmit('draft')).toBe(true);
    expect(canSubmit('rejected')).toBe(true);
    expect(canSubmit('pending')).toBe(false);
    expect(canSubmit('approved')).toBe(false);
  });

  it('polls only while Meta is reviewing', () => {
    expect(isAwaitingReview('pending')).toBe(true);
    expect(isAwaitingReview('approved')).toBe(false);
  });

  it('cannot refresh a draft that never reached Meta', () => {
    expect(canRefresh('draft', null)).toBe(false);
    expect(canRefresh('draft', 'meta-1')).toBe(true);
    expect(canRefresh('pending', null)).toBe(true);
  });
});
