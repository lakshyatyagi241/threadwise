import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { NAV } from '@/features/_registry/nav.generated';
import { gateFor } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import { nav } from './nav';
import { settings } from './settings';

/**
 * The Call logs screen follows the voice feature: it needs the log's read right AND the plan feature `waba_calling`. A workspace without
 * the feature gets no menu entry and no route (the app gate closes the address, no paywall). The calling tile in Settings keeps its plan
 * gate too.
 */
const caps = (permissions: string[], planFeatures: string[] | null) => ({
  ...CAPABILITIES_UNKNOWN,
  permissions: new Set(permissions),
  planFeatures: planFeatures ? new Set(planFeatures) : null,
});
const entry = (c: ReturnType<typeof caps>) => resolveNav(NAV, c).find((i) => i.id === 'call-logs');

describe('calling-voice nav', () => {
  it('is one Inbox & Chat entry gated by the log permission and the voice feature', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'call-logs',
      group: 'inbox',
      href: '/call-logs',
      order: 20,
      gates: { permission: 'call.logs.read', app: 'waba_calling' },
    });
    expect(nav[0]!.gates).not.toHaveProperty('planFeature');
    expect(hasNavIcon(nav[0]!.icon)).toBe(true);
  });

  it('removes the entry for a workspace without the voice feature', () => {
    expect(entry(caps(['call.logs.read'], ['analytics']))).toBeUndefined();
    expect(entry(caps(['call.logs.read'], []))).toBeUndefined();
  });

  it('shows it, unlocked, with the voice feature, and when the plan is not known yet', () => {
    expect(entry(caps(['call.logs.read'], ['waba_calling']))?.locked).toBe(false);
    expect(entry(caps(['call.logs.read'], null))?.locked).toBe(false);
  });

  it('removes it for a person without the log permission, whatever the plan', () => {
    expect(entry(caps(['call.calls.use'], ['waba_calling']))).toBeUndefined();
    expect(entry(caps([], []))).toBeUndefined();
  });

  it('closes the routes through the app gate instead of opening a paywall', () => {
    const gates = NAV.filter((n) => n.gates?.planFeature).map((n) => ({
      href: n.href,
      feature: n.gates!.planFeature!,
    }));
    for (const path of ['/call-logs', '/call-logs/analytics', '/call-logs/4f0c1f6e']) {
      expect(gateFor(path, gates), path).toBeNull();
    }
    expect(NAV.find((n) => n.id === 'call-logs')?.gates?.app).toBe('waba_calling');
  });

  it('keeps the WhatsApp calling tile in Settings behind the plan feature', () => {
    expect(settings).toHaveLength(1);
    expect(settings[0]!.gates).toMatchObject({
      permission: 'call.calls.use',
      planFeature: 'waba_calling',
    });
  });
});
