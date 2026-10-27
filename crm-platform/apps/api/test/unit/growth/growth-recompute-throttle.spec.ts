import { describe, expect, it } from 'vitest';
import { THROTTLE_KEY } from '../../../src/modules/platform-infrastructure/rate-limit/throttle.decorators';
import { GrowthController } from '../../../src/modules/growth-pilot/growth.controller';

/**
 * Issue #1180: the propensity recompute trains a model inside the request, with no throttle, so any caller holding the permission
 * could start a heavy training run as often as it liked.
 */
describe('growth propensity recompute is throttled (#1180)', () => {
  it('carries a throttle policy on the recompute route', () => {
    const spec = Reflect.getMetadata(THROTTLE_KEY, GrowthController.prototype.recompute);
    expect(spec).toBeDefined();
    expect(spec).toMatchObject({ by: 'actor' });
  });
});
