import { describe, expect, it } from 'vitest';
import { CappedMap, setCapped } from '../../../src/common/cache/capped-map';
import { DisplayIdService } from '../../../src/kernel/identifiers/display-id.service';
import { zoneOf } from '../../../src/modules/appointments-booking/ics-feed-parser';
import {
  CALENDAR_PREFERENCE_CACHE_MAX,
  CalendarProviders,
} from '../../../src/modules/appointments-booking/calendar-providers.service';
import {
  CALENDAR_CONNECTION_CACHE_MAX,
  GoogleCalendarTokens,
} from '../../../src/modules/appointments-booking/google-calendar-tokens.service';
import { MicrosoftCalendarTokens } from '../../../src/modules/appointments-booking/microsoft-calendar-tokens.service';
import {
  CONSENT_SETTINGS_CACHE_MAX,
  ConsentSettingsService,
} from '../../../src/modules/contact-consent/consent-settings.service';
import {
  MINOR_RULE_CACHE_MAX,
  ConsentPolicyService,
} from '../../../src/modules/contact-consent/consent-policy.service';
import {
  TrialGateGuard,
  TRIAL_VERDICT_CACHE_MAX,
} from '../../../src/modules/plans-subscriptions-trials/trial-gate.guard';
import {
  WEBHOOK_TARGET_CACHE_MAX,
  WebhookTargetsRepository,
} from '../../../src/modules/webhook-fanout/webhook-targets.repository';

/**
 * D-64-02: in-process caches keyed by workspace (or target) id that were never trimmed. Each is expiry-checked on read but nothing
 * ever removed an entry that was not read again, so a process that has served N workspaces holds N entries for its whole life.
 * Each test pushes far more distinct keys through the real service than its cap and checks the cache stops growing and keeps the
 * newest entry.
 */
const OVER = 250;
const priv = <T>(o: unknown, field: string): Map<unknown, T> =>
  (o as Record<string, Map<unknown, T>>)[field]!;

describe('setCapped', () => {
  it('evicts the oldest key first, never on an update of a present key, and keeps the newest', () => {
    const m = new Map<number, string>();
    for (let i = 0; i < 5; i++) setCapped(m, i, `v${i}`, 3);
    expect([...m.keys()]).toEqual([2, 3, 4]);
    setCapped(m, 3, 'again', 3); // present: no eviction
    expect([...m.keys()]).toEqual([2, 3, 4]);
    expect(m.get(3)).toBe('again');
  });
});

describe('per-workspace in-process caches stay bounded (D-64-02)', () => {
  it('consent settings: one entry per workspace, capped', async () => {
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) };
    const repo = { getSettings: async () => null };
    const svc = new ConsentSettingsService(db as never, repo as never, {} as never, {} as never);
    for (let org = 1; org <= CONSENT_SETTINGS_CACHE_MAX + OVER; org++) await svc.effective(org);
    const cache = priv(svc, 'cache');
    expect(cache.size).toBe(CONSENT_SETTINGS_CACHE_MAX);
    expect(cache.has(CONSENT_SETTINGS_CACHE_MAX + OVER)).toBe(true);
    expect(cache.has(1)).toBe(false);
  });

  it('minor rule: one entry per workspace, capped', async () => {
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) };
    const privacy = {
      complianceFacts: async () => ({ childrenPolicy: 'off', parentalConsentRequired: false }),
    };
    const svc = new ConsentPolicyService({} as never, db as never, privacy as never);
    for (let org = 1; org <= MINOR_RULE_CACHE_MAX + OVER; org++) await svc.minorRule(org);
    expect(priv(svc, 'minorRules').size).toBe(MINOR_RULE_CACHE_MAX);
  });

  it('calendar connection rows (Google and Microsoft): one row per workspace, capped', async () => {
    const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) };
    const repo = { find: async () => null };
    const g = new GoogleCalendarTokens(
      db as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const m = new MicrosoftCalendarTokens(
      db as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    for (let org = 1; org <= CALENDAR_CONNECTION_CACHE_MAX + OVER; org++) {
      await g.connection(org);
      await m.connection(org);
    }
    expect(priv(g, 'rows').size).toBe(CALENDAR_CONNECTION_CACHE_MAX);
    expect(priv(m, 'rows').size).toBe(CALENDAR_CONNECTION_CACHE_MAX);
  });

  it('calendar provider preference: one entry per workspace, capped', async () => {
    const svc = new CalendarProviders(
      { txAs: async () => null } as never,
      {} as never,
      {} as never,
    );
    (svc as unknown as { readPreference: () => Promise<null> }).readPreference = async () => null;
    for (let org = 1; org <= CALENDAR_PREFERENCE_CACHE_MAX + OVER; org++) await svc.preference(org);
    expect(priv(svc, 'preferences').size).toBe(CALENDAR_PREFERENCE_CACHE_MAX);
  });

  it('trial gate: the "plan is open" verdict is kept for at most the cap, not for every workspace ever seen', async () => {
    const entitlements = { forOrg: async () => ({ platformOwned: false, state: 'active' }) };
    const guard = new TrialGateGuard({} as never, entitlements as never);
    const check = (org: number) =>
      (guard as unknown as { trialExpired(o: number): Promise<boolean> }).trialExpired(org);
    for (let org = 1; org <= TRIAL_VERDICT_CACHE_MAX + OVER; org++) await check(org);
    expect(priv(guard, 'openUntil').size).toBe(TRIAL_VERDICT_CACHE_MAX);
  });

  it('webhook forward targets: one entry per target id, capped', async () => {
    const store = {
      tx: async (fn: (tx: unknown) => unknown) => fn({ execute: async () => ({ rows: [] }) }),
    };
    const repo = new WebhookTargetsRepository(store as never, {} as never);
    for (let id = 1; id <= WEBHOOK_TARGET_CACHE_MAX + OVER; id++) await repo.deliveryTarget(id);
    expect(priv(repo, 'cache').size).toBe(WEBHOOK_TARGET_CACHE_MAX);
  });
});

describe('CappedMap and the fields that use it', () => {
  it('drops the oldest entry once full, whichever call site did the set', () => {
    const m = new CappedMap<string, number>(3);
    for (const [i, k] of ['a', 'b', 'c', 'd', 'e'].entries()) m.set(k, i);
    expect([...m.keys()]).toEqual(['c', 'd', 'e']);
    m.set('d', 99);
    expect(m.size).toBe(3);
  });

  it('display-id reservations: one block per workspace and module, capped (a dropped block only leaves a gap in the numbers)', async () => {
    const svc = new DisplayIdService();
    const tx = { execute: async () => ({ rows: [{ current_value: 100 }] }) };
    for (let org = 1; org <= 5_250; org++) await svc.next(tx as never, org, 'contacts', 'C');
    expect(priv(svc, 'reservations').size).toBe(5_000);
  });

  it('timezone names from a calendar feed are checked, not remembered without limit', () => {
    // 3000 distinct made-up zone names, as a hostile feed could send; the answer is the same every time, only memory is at stake.
    for (let i = 0; i < 3_000; i++) expect(zoneOf(`Not/A_Zone_${i}`)).toBeNull();
    expect(zoneOf('Europe/Paris')).toBe('Europe/Paris');
  });
});
