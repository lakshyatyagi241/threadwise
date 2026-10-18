import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getRuntimeMonitor } from '@crm/observability';
import { QUEUES } from '../../../../infra/queue/queues';
import { sampleQueueDepth, type DepthQueue } from './queue-depth';

const INTERVAL_MS = 15_000;

/**
 * Exports each queue's backlog and oldest waiting age from the worker process (QCAP-013, 014, 017, 018, 019).
 *
 * `crm_queue_jobs_total` and the wait/duration histograms already say how fast finished jobs went; they say nothing about work that has
 * not started, which is where a saturated queue shows first. Labels are the fixed queue name and state, never a job or tenant.
 * Prometheus derives growth (`deriv`), drain time (backlog / (completion rate - arrival rate)) and the alert on oldest age from these.
 */
@Injectable()
export class QueueDepthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueDepthService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    const monitor = getRuntimeMonitor();
    if (!monitor) return;
    const pending = monitor.metrics.gauge(
      'crm_queue_jobs_pending',
      'Jobs in a queue by state (waiting = runnable and not started, delayed = scheduled or backing off)',
    );
    const oldest = monitor.metrics.gauge(
      'crm_queue_oldest_waiting_seconds',
      'Age of the oldest runnable job that has not started, by queue (0 when none waits)',
    );
    const queues: Array<[string, DepthQueue]> = [];
    for (const name of Object.values(QUEUES)) {
      try {
        queues.push([name, this.moduleRef.get<DepthQueue>(getQueueToken(name), { strict: false })]);
      } catch {
        this.logger.warn({ queue: name }, 'queue handle not available; depth not exported');
      }
    }
    const tick = async () => {
      if (this.running) return; // a slow Redis must not stack samples
      this.running = true;
      try {
        for (const [name, queue] of queues) {
          try {
            const d = await sampleQueueDepth(queue);
            pending.set(d.waiting, { queue: name, state: 'waiting' });
            pending.set(d.active, { queue: name, state: 'active' });
            pending.set(d.delayed, { queue: name, state: 'delayed' });
            pending.set(d.failed, { queue: name, state: 'failed' });
            oldest.set(d.oldestWaitingSeconds, { queue: name });
          } catch {
            // Observability must never fail the worker; a missed sample leaves the last value.
          }
        }
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Imported by the worker process only. */
@Module({ providers: [QueueDepthService] })
export class QueueDepthModule {}
