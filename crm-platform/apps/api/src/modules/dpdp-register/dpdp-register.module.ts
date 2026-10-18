import { Module } from '@nestjs/common';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { DpdpRegisterController } from './dpdp-register.controller';
import { DpdpRegisterService } from './dpdp-register.service';

/**
 * The DPDP compliance register of the super admin console (spec docs/specs/dpdp-compliance-register.md). The platform door
 * (PlatformStore), the security policy and the audit trail come from the global auth module, the configuration from the global config
 * module. Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule],
  controllers: [DpdpRegisterController],
  providers: [DpdpRegisterService],
})
export class DpdpRegisterModule {}
