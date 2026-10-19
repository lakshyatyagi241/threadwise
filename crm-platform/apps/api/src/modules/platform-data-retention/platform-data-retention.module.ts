import { Module } from '@nestjs/common';
import { DataRetentionModule } from '../data-retention';
import { RolesPermissionsModule } from '../roles-permissions';
import { RetentionDashboardController } from './retention-dashboard.controller';
import { RetentionDashboardService } from './retention-dashboard.service';

/** The super admin retention dashboard. Reads the archive store only to list its months; deleting is the nightly jobs' work. */
@Module({
  imports: [RolesPermissionsModule, DataRetentionModule],
  controllers: [RetentionDashboardController],
  providers: [RetentionDashboardService],
})
export class PlatformDataRetentionModule {}
