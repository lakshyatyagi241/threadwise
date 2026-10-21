import { Module, type DynamicModule } from '@nestjs/common';
import {
  QUEUE_GUARD_OPTIONS,
  QueueGuardService,
  type QueueGuardOptions,
} from './queue-guard.service';

/**
 * Imported by the worker process only (worker.module.ts): one trimmer, not one per API pod. The worker module passes the queues whose
 * failures the dead-letter sweep keeps, so this infra module needs no import from a domain.
 */
@Module({})
export class QueueGuardModule {
  static forRoot(options: QueueGuardOptions): DynamicModule {
    return {
      module: QueueGuardModule,
      providers: [{ provide: QUEUE_GUARD_OPTIONS, useValue: options }, QueueGuardService],
    };
  }
}
