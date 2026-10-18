import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RolesPermissionsModule } from '../roles-permissions';
import { FailedOperationsController } from './failed-operations.controller';
import { FailedOperationsRepository } from './failed-operations.repository';
import { FailedOperationsService } from './failed-operations.service';
import { FailureRecorder } from './failure-recorder';

/**
 * The durable record of background work that failed for good, and the operator's redrive of it (API process). The worker side
 * (capturing, the reconcile sweep) is {@link FailedOperationsWorkerModule}, imported only by the worker.
 */
@Module({
  imports: [RolesPermissionsModule],
  controllers: [FailedOperationsController],
  providers: [FailedOperationsRepository, FailedOperationsService, FailureRecorder, CryptoService],
  exports: [FailedOperationsService, FailedOperationsRepository, FailureRecorder],
})
export class FailedOperationsModule {}
