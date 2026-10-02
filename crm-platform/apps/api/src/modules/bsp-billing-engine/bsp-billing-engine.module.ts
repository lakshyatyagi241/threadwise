import { Module } from '@nestjs/common';
import { CREDIT_SOURCE_PORT } from '../../infra/providers/bsp-billing-engine/credit-source.port';
import { MetaCreditSource } from '../../infra/providers/bsp-billing-engine/meta-credit-source';
import { AutoAttachSweepService } from './auto-attach-sweep.service';
import { BillingModeController } from './billing-mode.controller';
import { BillingModeService } from './billing-mode.service';
import { ResellerCostService } from './reseller-cost.service';
import { ResellerCreditService } from './reseller-credit.service';
import { ResellerPlatformController } from './reseller-platform.controller';
import { ResellerPlatformReader } from './reseller-platform.reader';
import { ResellerReportService } from './reseller-report.service';
import { ResellerSettingsService } from './reseller-settings.service';
import { ResellerRepository } from './reseller.repository';

const SERVICES = [
  ResellerRepository,
  ResellerPlatformReader,
  ResellerSettingsService,
  ResellerCreditService,
  ResellerReportService,
  ResellerCostService,
  BillingModeService,
  MetaCreditSource,
  { provide: CREDIT_SOURCE_PORT, useExisting: MetaCreditSource },
];

/**
 * The reseller billing engine: the Meta credit-line connection, the allocation register, the customer's billing-mode choice and
 * the reseller P&L. The Meta adapter is bound to its port here, in the domain's own module, not in the global providers module.
 * Registered in app.module.ts.
 */
@Module({
  controllers: [ResellerPlatformController, BillingModeController],
  providers: SERVICES,
  exports: [BillingModeService, ResellerCostService],
})
export class BspBillingEngineModule {}

/**
 * The auto-attach sweep. Imported ONLY by WorkersModule (the worker process): an HTTP pod that also swept would multiply the
 * polling and could race the worker for the same numbers.
 */
@Module({
  providers: [...SERVICES, AutoAttachSweepService],
})
export class BspBillingEngineWorkerModule {}
