import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PlansCoreModule } from '../../../src/modules/plans-subscriptions-trials';
import { FormsBuilderWorkerModule } from '../../../src/modules/forms-builder/forms-builder-worker.module';
import { LeadsWorkerModule } from '../../../src/modules/leads/leads-worker.module';
import { MarketplaceWorkerModule } from '../../../src/modules/marketplace/marketplace-worker.module';

/**
 * These worker modules provide their own NotificationsRepository, whose plan gate reads PlanEntitlementService as an optional
 * dependency: without PlansCoreModule the gate is silently skipped and a workspace gets notifications for a feature its plan lacks.
 */
describe('worker modules that provide NotificationsRepository', () => {
  it.each([
    ['FormsBuilderWorkerModule', FormsBuilderWorkerModule],
    ['LeadsWorkerModule', LeadsWorkerModule],
    ['MarketplaceWorkerModule', MarketplaceWorkerModule],
  ])('%s imports PlansCoreModule', (_name, mod) => {
    const imports = Reflect.getMetadata('imports', mod) as unknown[];
    expect(imports).toContain(PlansCoreModule);
  });
});
