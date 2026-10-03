import { WARMER_DEFAULTS, type WarmerNumber } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { engineOf, formToProfile, healthTone, profileToForm, rollup } from './warmer-model';

const number = (over: Partial<WarmerNumber> & { enabled?: boolean } = {}): WarmerNumber => ({
  key: 'baileys:x',
  engine: 'baileys',
  label: 'Shop',
  phone: null,
  status: 'connected',
  profile: { ...WARMER_DEFAULTS, enabled: over.enabled ?? true },
  startedAt: null,
  budget: 20,
  sentToday: 5,
  remaining: 15,
  health: 80,
  ...over,
});

describe('warmer form', () => {
  it('shows a profile as text and reads it back unchanged', () => {
    const f = profileToForm({ ...WARMER_DEFAULTS, enabled: true, spintax: true });
    expect(f.dailyBase).toBe('20');
    expect(f.enabled).toBe(true);
    const r = formToProfile(f);
    expect(r).toEqual({ ok: true, value: { ...WARMER_DEFAULTS, enabled: true, spintax: true } });
  });

  it('flags a blank, fractional or out of range box on its own field', () => {
    const f = profileToForm({ ...WARMER_DEFAULTS });
    const r = formToProfile({
      ...f,
      dailyBase: '',
      stepPct: '1.5',
      activeStart: '24',
      gapMax: '99999',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual([
        'activeStart',
        'dailyBase',
        'gapMax',
        'stepPct',
      ]);
    }
  });

  it('keeps the ceiling at or above the first day budget', () => {
    const f = profileToForm({ ...WARMER_DEFAULTS });
    const r = formToProfile({ ...f, dailyBase: '100', maxDaily: '50' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.maxDaily).toMatch(/ceiling/i);
  });
});

describe('health and rollups', () => {
  it('tones the score at 70 and 40', () => {
    expect(healthTone(70)).toBe('success');
    expect(healthTone(69)).toBe('warning');
    expect(healthTone(40)).toBe('warning');
    expect(healthTone(39)).toBe('danger');
  });
  it('counts budget and sent for warming numbers only, health for all', () => {
    const r = rollup([
      number(),
      number({ enabled: false, budget: 100, sentToday: 50, health: 40 }),
    ]);
    expect(r).toEqual({ warming: 1, connected: 2, budget: 20, sent: 5, avgHealth: 60 });
    expect(rollup([])).toEqual({ warming: 0, connected: 0, budget: 0, sent: 0, avgHealth: 0 });
  });
  it('names the engine, unknown ones as the unofficial API', () => {
    expect(engineOf('waba')).toBe('waba');
    expect(engineOf('twilio')).toBe('twilio');
    expect(engineOf('baileys')).toBe('baileys');
    expect(engineOf('other')).toBe('baileys');
  });
});
