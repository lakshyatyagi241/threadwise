import { describe, expect, it } from 'vitest';
import {
  dailyBudgetFor,
  gapSeconds,
  gateBatch,
  healthScore,
  profileOf,
  spin,
  startedAtOf,
  withinActiveHours,
} from '../../../src/modules/scheduled-queue-warmer/warmer/warmer-rules';

const warming = (over: Record<string, unknown> = {}) =>
  profileOf({ enabled: true, daily_base: 20, step_pct: 50, step_days: 2, max_daily: 100, ...over });

describe('the profile (WD-SCHED-037)', () => {
  it("is WaDesk's defaults when nothing is stored, off", () => {
    expect(profileOf(null)).toMatchObject({
      enabled: false,
      dailyBase: 20,
      stepPct: 20,
      stepDays: 3,
      maxDaily: 500,
      gapMin: 15,
      gapMax: 45,
      activeStart: 9,
      activeEnd: 21,
      spintax: false,
    });
  });
  it("reads WaDesk's snake case and ours, and clamps what is out of range", () => {
    const p = profileOf({
      daily_base: 0,
      step_pct: 900,
      step_days: 0,
      max_daily: 1,
      gap_min: 30,
      gap_max: 5,
      active_start: 99,
      active_end: -4,
    });
    expect(p).toMatchObject({
      dailyBase: 1,
      stepPct: 200,
      stepDays: 1,
      maxDaily: 1,
      gapMin: 30,
      gapMax: 30,
      activeStart: 23,
      activeEnd: 0,
    });
    expect(profileOf({ dailyBase: 7, enabled: true }).dailyBase).toBe(7);
  });
  it('reads when the ramp started', () => {
    expect(startedAtOf({ started_at: '2026-10-01' })).toBe('2026-10-01');
    expect(startedAtOf({ startedAt: '2026-10-01T10:00:00Z' })).toBe('2026-10-01');
    expect(startedAtOf({})).toBeNull();
  });
});

describe('the ramp (WD-SCHED-038)', () => {
  it('grows by the step percent every step days, capped at the ceiling', () => {
    const p = warming();
    const budget = (day: string) => dailyBudgetFor(p, '2026-10-01', '2026-09-01', day);
    expect(budget('2026-10-01')).toBe(20);
    expect(budget('2026-10-02')).toBe(20);
    expect(budget('2026-10-03')).toBe(30);
    expect(budget('2026-10-05')).toBe(45);
    expect(budget('2026-12-01')).toBe(100);
  });
  it('counts from the creation day until a start is stamped, and never before the start', () => {
    const p = warming();
    expect(dailyBudgetFor(p, null, '2026-10-01', '2026-10-05')).toBe(45);
    expect(dailyBudgetFor(p, '2026-10-10', '2026-09-01', '2026-10-01')).toBe(20);
  });
});

describe('active hours and gap', () => {
  it('a plain window, an overnight window and all day', () => {
    const day = warming({ active_start: 9, active_end: 21 });
    expect([8, 9, 20, 21].map((h) => withinActiveHours(day, h))).toEqual([false, true, true, false]);
    const night = warming({ active_start: 21, active_end: 6 });
    expect([20, 21, 23, 0, 5, 6].map((h) => withinActiveHours(night, h))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(withinActiveHours(warming({ active_start: 0, active_end: 0 }), 3)).toBe(true);
  });
  it('a gap inside the range, or the minimum when the range is a point', () => {
    const p = warming({ gap_min: 15, gap_max: 45 });
    expect(gapSeconds(p, () => 0)).toBe(15);
    expect(gapSeconds(p, () => 0.999999)).toBe(45);
    expect(gapSeconds(warming({ gap_min: 20, gap_max: 20 }), () => 0.7)).toBe(20);
  });
});

describe('the batch gate (WD-SCHED-008, 039)', () => {
  const p = warming({ active_start: 9, active_end: 21 });
  it('a number that is not warming always passes', () => {
    expect(
      gateBatch(profileOf({ enabled: false }), { requested: 9999, budget: 1, used: 1, hour: 3 }).ok,
    ).toBe(true);
  });
  it('holds outside active hours, at the budget, and when the batch does not fit; passes when it does', () => {
    expect(gateBatch(p, { requested: 1, budget: 20, used: 0, hour: 3 })).toMatchObject({
      ok: false,
      reason: 'outside_active_hours',
    });
    expect(gateBatch(p, { requested: 1, budget: 20, used: 20 })).toMatchObject({
      ok: false,
      reason: 'daily_budget_reached',
    });
    expect(gateBatch(p, { requested: 10, budget: 20, used: 15 })).toMatchObject({
      ok: false,
      reason: 'budget_capped',
      remaining: 5,
      allowed: 5,
    });
    expect(gateBatch(p, { requested: 5, budget: 20, used: 15 })).toMatchObject({
      ok: true,
      allowed: 5,
    });
  });
  it('a send for a later day ignores the hour', () => {
    expect(gateBatch(p, { requested: 5, budget: 20, used: 0 }).ok).toBe(true);
  });
});

describe('health score and spintax (WD-SCHED-040)', () => {
  it('rewards a connected, older number and punishes failures and volume far above the ramp', () => {
    const base = { status: 'connected', ageDays: 30, sent24h: 10, failed24h: 0, budget: 20 };
    expect(healthScore(base)).toBe(80);
    expect(healthScore({ ...base, failed24h: 10 })).toBe(60);
    expect(healthScore({ ...base, sent24h: 60 })).toBe(65);
    expect(healthScore({ status: 'banned', ageDays: 0, sent24h: 0, failed24h: 1000, budget: 0 })).toBe(
      0,
    );
  });
  it('varies {a|b}, leaves merge tags and single braces alone, and cannot loop', () => {
    expect(spin('Hi {there|friend}!', () => 0)).toBe('Hi there!');
    expect(spin('Hi {there|friend}!', () => 0.99)).toBe('Hi friend!');
    expect(spin('Hello {{name}}, {x} stays', () => 0)).toBe('Hello {{name}}, {x} stays');
    expect(spin('{a|{b|c}}', () => 0)).toBe('a');
    expect(spin('{'.repeat(200) + 'a|b' + '}'.repeat(200), () => 0).length).toBeLessThan(500);
  });
});
