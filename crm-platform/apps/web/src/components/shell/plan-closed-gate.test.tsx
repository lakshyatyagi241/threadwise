import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let path = '/telegram';
vi.mock('next/navigation', () => ({ usePathname: () => path }));

import { PlanClosedGate, closedPlanGate } from './plan-closed-gate';

const gates = [
  { href: '/telegram', feature: 'extra_channels' },
  { href: '/email', feature: 'email_channel' },
];

describe('closedPlanGate', () => {
  it('closes a route whose plan feature is off, and the routes under it', () => {
    expect(closedPlanGate('/telegram', gates, ['sms'])?.feature).toBe('extra_channels');
    expect(closedPlanGate('/telegram/broadcasts', gates, [])?.feature).toBe('extra_channels');
  });
  it('closes nothing when the plan has the feature, the plan is unknown or the route has no gate', () => {
    expect(closedPlanGate('/telegram', gates, ['extra_channels'])).toBeNull();
    expect(closedPlanGate('/telegram', gates, null)).toBeNull();
    expect(closedPlanGate('/inbox', gates, [])).toBeNull();
    expect(closedPlanGate('/telegramx', gates, [])).toBeNull();
  });
});

describe('PlanClosedGate', () => {
  it('does not mount the screen while the plan lacks the feature', () => {
    path = '/telegram';
    const html = renderToString(
      <PlanClosedGate gates={gates} enabled={['sms']}>
        <p>hub screen</p>
      </PlanClosedGate>,
    );
    expect(html).not.toContain('hub screen');
  });
  it('mounts it when the feature is on', () => {
    path = '/telegram';
    const html = renderToString(
      <PlanClosedGate gates={gates} enabled={['extra_channels']}>
        <p>hub screen</p>
      </PlanClosedGate>,
    );
    expect(html).toContain('hub screen');
  });
});
