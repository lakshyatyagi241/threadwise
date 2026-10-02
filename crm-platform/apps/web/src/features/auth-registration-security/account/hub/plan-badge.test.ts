import type { PlansResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { planBadgeName } from './plan-badge';

const card = (name: string, current: boolean) =>
  ({ name, current }) as PlansResponse['data'][number];
const plans = (data: PlansResponse['data'], currentSlug: string | null) => ({ data, currentSlug });

describe('planBadgeName', () => {
  it('uses the name of the current plan card', () => {
    expect(
      planBadgeName(plans([card('Free', false), card('Growth', true)], 'growth'), 'x', 'Free'),
    ).toBe('Growth');
  });

  it('falls back to the slug when no card is current', () => {
    expect(planBadgeName(plans([card('Free', false)], 'legacy-pro'), null, 'Free')).toBe(
      'legacy-pro',
    );
  });

  it('falls back to the session plan while the catalogue is not loaded', () => {
    expect(planBadgeName(undefined, 'starter', 'Free')).toBe('starter');
  });

  it('reads as the free label when there is no plan or it is "free"', () => {
    expect(planBadgeName(undefined, null, 'Free')).toBe('Free');
    expect(planBadgeName(undefined, '', 'Free')).toBe('Free');
    expect(planBadgeName(plans([], 'FREE'), null, 'Gratis')).toBe('Gratis');
  });
});
