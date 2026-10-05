import { Module } from '@nestjs/common';
import { PlatformInfrastructureModule } from '../modules/platform-infrastructure';
import { HealthController } from './health.controller';

@Module({
  imports: [PlatformInfrastructureModule],
  controllers: [HealthController],
})
export class HealthModule {}
