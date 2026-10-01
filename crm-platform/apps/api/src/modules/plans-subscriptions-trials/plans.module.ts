import { Module } from '@nestjs/common';
import { PlanAdminService } from './plan-admin.service';
import { PlanStore } from './plan-store';
import { PlansCoreModule } from './plans-core.module';
import { PlatformPlansController } from './platform-plans.controller';
import { PlansController } from './plans.controller';

/**
 * The plan HTTP surface: the workspace's plan list and the operator catalogue.
 * It imports the auth module (through its barrel) for the operator guard, the
 * gate-exempt marker and the audit writer; the auth module imports only
 * PlansCoreModule, so there is no cycle. Registered in app.module.ts.
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [PlansController, PlatformPlansController],
  providers: [PlanAdminService, PlanStore],
})
export class PlansModule {}
