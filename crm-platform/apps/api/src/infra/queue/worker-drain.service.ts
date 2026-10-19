import { WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

/** The slice of a BullMQ `Worker` the drain uses. */
export interface ClosableWorker {
  name: string;
  close(): Promise<void>;
}

/** Closes every worker and waits for its running jobs. One that fails to close must not stop the others. */
export async function drainWorkers(
  workers: ClosableWorker[],
  onError: (name: string, err: unknown) => void = () => undefined,
): Promise<number> {
  const results = await Promise.all(
    workers.map((w) =>
      w.close().then(
        () => true,
        (err: unknown) => {
          onError(w.name, err);
          return false;
        },
      ),
    ),
  );
  return results.filter(Boolean).length;
}

/**
 * Lets running jobs finish before the database goes away. On SIGTERM Nest runs `onModuleDestroy` of every module, then
 * `onApplicationShutdown`; @nestjs/bullmq closes its workers (which waits for active jobs) only in the second step, and the database
 * pools used to close in the first. A job running at deploy time (a migration lasts up to an hour) therefore kept running against a
 * closed pool and failed with "Cannot use a pool after calling end on the pool". Closing the workers here, in the first step, and
 * closing the pools in the second (DatabaseService.onApplicationShutdown) puts the drain before the close. Worker process only.
 */
@Injectable()
export class WorkerDrainService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerDrainService.name);

  constructor(private readonly discovery: DiscoveryService) {}

  async onModuleDestroy(): Promise<void> {
    const workers: ClosableWorker[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!(instance instanceof WorkerHost)) continue;
      try {
        workers.push(instance.worker);
      } catch {
        // a processor whose worker never started has nothing to drain
      }
    }
    const closed = await drainWorkers(workers, (queue, err) =>
      this.logger.warn({ err, queue }, 'worker did not close cleanly'),
    );
    this.logger.log({ workers: workers.length, closed }, 'workers drained before shutdown');
  }
}
