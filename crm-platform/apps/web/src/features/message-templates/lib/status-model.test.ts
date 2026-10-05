import { describe, expect, it } from 'vitest';
import { tplStatusSchema } from '@crm/contracts';
import {
  STATUSES,
  canEdit,
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

  it('allows editing only before approval or after a rejection', () => {
    expect(['draft', 'pending', 'rejected'].every((s) => canEdit(s as never))).toBe(true);
    expect(['approved', 'paused', 'disabled', 'deleted'].some((s) => canEdit(s as never))).toBe(
      false,
    );
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
