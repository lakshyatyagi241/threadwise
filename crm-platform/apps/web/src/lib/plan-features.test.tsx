import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanFeaturesProvider, usePlanFeature } from './plan-features';

function Probe({ feature }: { feature: string }) {
  return <span>{usePlanFeature(feature) ? 'on' : 'off'}</span>;
}
const render = (features: readonly string[] | null | 'none', feature = 'lead_scoring') =>
  renderToStaticMarkup(
    features === 'none' ? (
      <Probe feature={feature} />
    ) : (
      <PlanFeaturesProvider features={features}>
        <Probe feature={feature} />
      </PlanFeaturesProvider>
    ),
  );

describe('usePlanFeature', () => {
  it('is on when the workspace has the feature', () => {
    expect(render(['marketplace', 'lead_scoring'])).toContain('on');
  });

  it('is off when the workspace does not have it (the app is not installed)', () => {
    expect(render(['marketplace'])).toContain('off');
    expect(render([])).toContain('off');
  });

  it('removes nothing while the entitlements are unknown: the failed call, or no provider mounted', () => {
    expect(render(null)).toContain('on');
    expect(render('none')).toContain('on');
  });
});
