import { Module } from '@nestjs/common';
import { RolesPermissionsModule } from '../roles-permissions';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { DeploymentsStore } from './deployments.store';

/** Operator dashboard of deployments (Geta publishes). The operator guards come from the auth and roles-permissions barrels. */
@Module({
  imports: [RolesPermissionsModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService, DeploymentsStore],
})
export class PlatformDeploymentsModule {}
