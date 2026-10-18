import { Module } from '@nestjs/common';
import { FailedOperationsModule } from '../failed-operations';
import { RolesPermissionsModule } from '../roles-permissions';
import { AsyncOpsController } from './async-ops.controller';
import { AsyncOpsService } from './async-ops.service';
import { AsyncOpsStore } from './async-ops.store';

/** Operator tools for failed background work (ASYNC-044). The operator guards come from the auth and roles-permissions barrels. */
@Module({
  imports: [RolesPermissionsModule, FailedOperationsModule],
  controllers: [AsyncOpsController],
  providers: [AsyncOpsService, AsyncOpsStore],
})
export class PlatformAsyncOpsModule {}
