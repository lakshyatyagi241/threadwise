import { Module } from '@nestjs/common';
import { CrmModule } from '../crm';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

/**
 * Sub-agent / channel-partner module.
 *
 * Depends on CrmModule through its public barrel, so lead submission reuses
 * the one contact-creation path instead of growing a second one.
 *
 * Still to land: agent management for staff (invite, suspend, reset password),
 * commission tracking, and per-agent performance reporting.
 */
@Module({
  imports: [CrmModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
