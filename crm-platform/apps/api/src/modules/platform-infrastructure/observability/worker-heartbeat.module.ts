import { Module } from '@nestjs/common';
import { INFRA_ENV, readInfraEnv } from '../../../config/domains/platform-infrastructure.env';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

/** Imported by the worker process only (worker.ts): the API reads the heartbeat, it never writes one. */
@Module({
  providers: [
    { provide: INFRA_ENV, useFactory: () => readInfraEnv(process.env) },
    WorkerHeartbeatService,
  ],
})
export class WorkerHeartbeatModule {}
