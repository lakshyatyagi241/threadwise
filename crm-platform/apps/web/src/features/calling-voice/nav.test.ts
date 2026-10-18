import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { NAV } from '@/features/_registry/nav.generated';
import { gateFor } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import { nav } from './nav';
import { settings } from './settings';

/**
 * BL-257: the Call logs screen holds every call, not only WhatsApp calls, so it is open to anyone with the log's read right, with or
 * without the plan feature `waba_calling`. The menu entry, the route guard (the paywall reads its gates from the same list) and the
 * API agree; what is WhatsApp's (the calling tile in Settings) keeps its plan gate.
 */
const caps = (permissions: string[], planFeatures: string[] | null) => ({
  ...CAPABILITIES_UNKNOWN,
  permissions: new Set(permissions),
  planFeatures: planFeatures ? new Set(planFeatures) : null,
});
const entry = (c: ReturnType<typeof caps>) => resolveNav(NAV, c).find((i) => i.id === 'call-logs');

describe('calling-voice nav', () => {
  it('is one Inbox & Chat entry gated by the log permission alone', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'call-logs',
      group: 'inbox',
      href: '/call-logs',
      order: 20,
      gates: { permission: 'call.logs.read' },
    });
    expect(nav[0]!.gates).not.toHaveProperty('planFeature');
    expect(hasNavIcon(nav[0]!.icon)).toBe(true);
  });

  it('shows the entry, unlocked, to a workspace without WhatsApp calling', () => {
    const item = entry(caps(['call.logs.read'], ['analytics']));
    expect(item).toBeDefined();
    expect(item!.locked).toBe(false);
  });

  it('shows it unlocked with WhatsApp calling too, and when the plan is not known', () => {
    expect(entry(caps(['call.logs.read'], ['waba_calling']))?.locked).toBe(false);
    expect(entry(caps(['call.logs.read'], null))?.locked).toBe(false);
  });

  it('removes it for a person without the log permission, whatever the plan', () => {
    expect(entry(caps(['call.calls.use'], ['waba_calling']))).toBeUndefined();
    expect(entry(caps([], []))).toBeUndefined();
  });

  it('opens no paywall on the call log routes: no plan feature is registered for them', () => {
    const gates = NAV.filter((n) => n.gates?.planFeature).map((n) => ({
      href: n.href,
      feature: n.gates!.planFeature!,
    }));
    for (const path of ['/call-logs', '/call-logs/analytics', '/call-logs/4f0c1f6e']) {
      expect(gateFor(path, gates), path).toBeNull();
    }
  });

  it('keeps the WhatsApp calling tile in Settings behind the plan feature', () => {
    expect(settings).toHaveLength(1);
    expect(settings[0]!.gates).toMatchObject({
      permission: 'call.calls.use',
      planFeature: 'waba_calling',
    });
  });
});
