import { WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { attachJobMetrics, type ObservableWorker } from './job-metrics';
import { getRuntimeMonitor } from './start-runtime-monitor';

/**
 * Attaches job timing to every BullMQ worker the process created, in one place, so the ~40 processors need no edit and a new
 * processor is covered the day it is written.
 *
 * `@nestjs/bullmq` creates each worker in `onModuleInit` and documents `onApplicationBootstrap` as the point where
 * `WorkerHost.worker` is safe to read. A processor whose worker is not available (request-scoped) is skipped.
 */
@Injectable()
export class JobMetricsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobMetricsService.name);

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): number {
    const monitor = getRuntimeMonitor();
    if (!monitor) return 0;
    let attached = 0;
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!(instance instanceof WorkerHost)) continue;
      try {
        // A BullMQ Worker's `on` is overloaded per event; the hook only needs the completed/failed shape.
        attachJobMetrics(instance.worker as unknown as ObservableWorker, monitor);
        attached += 1;
      } catch (err) {
        this.logger.warn({ err, processor: wrapper.name }, 'job metrics not attached to a worker');
      }
    }
    return attached;
  }
}

/** Imported by the worker process only: the API enqueues, it never runs a processor. */
@Module({ imports: [DiscoveryModule], providers: [JobMetricsService] })
export class JobMetricsModule {}
