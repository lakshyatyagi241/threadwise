import { describe, expect, it } from 'vitest';
import { nextManualStatus, showsOutsideHoursNotice, statusView } from './agent-status';

const features = { bar: true, automation: true };

describe('statusView', () => {
  it('Available', () => {
    expect(statusView({ state: 'available', reason: 'default' })).toEqual({
      tone: 'available',
      word: 'available',
      leaveUntil: null,
    });
  });
  it('Away by choice', () => {
    expect(statusView({ state: 'away', reason: 'manual' })).toMatchObject({
      tone: 'away',
      word: 'away',
    });
  });
  it('On leave until a date, or open ended', () => {
    expect(statusView({ state: 'away', reason: 'leave', leaveUntil: '2026-06-05' })).toEqual({
      tone: 'leave',
      word: 'onLeaveUntil',
      leaveUntil: '2026-06-05',
    });
    expect(statusView({ state: 'away', reason: 'leave', leaveUntil: null })).toMatchObject({
      word: 'onLeaveOpen',
    });
  });
  it('Away outside working hours', () => {
    expect(statusView({ state: 'away', reason: 'schedule' })).toMatchObject({
      tone: 'away',
      word: 'awayHours',
    });
  });
  it('an older answer with only the stored word still reads', () => {
    expect(statusView({ status: 'online' } as never)).toMatchObject({ tone: 'available' });
    expect(statusView({ status: 'offline' } as never)).toMatchObject({ tone: 'away' });
  });
});

describe('nextManualStatus', () => {
  it('offers the opposite of the current state', () => {
    expect(nextManualStatus({ state: 'available' })).toBe('offline');
    expect(nextManualStatus({ state: 'away', reason: 'schedule' })).toBe('online');
    expect(nextManualStatus({ state: 'away', reason: 'leave' })).toBe('online');
  });
});

describe('showsOutsideHoursNotice', () => {
  it('only for Away by schedule on a plan with the automation', () => {
    expect(showsOutsideHoursNotice({ reason: 'schedule', features })).toBe(true);
    expect(
      showsOutsideHoursNotice({ reason: 'schedule', features: { bar: true, automation: false } }),
    ).toBe(false);
    expect(showsOutsideHoursNotice({ reason: 'manual', features })).toBe(false);
    expect(showsOutsideHoursNotice({ reason: 'leave', features })).toBe(false);
  });
});
