import { EventEmitter } from 'node:events';
import { WorkerHost } from '@nestjs/bullmq';
import type { DiscoveryService } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RuntimeMonitor,
  attachJobMetrics,
  jobTimings,
  startRuntimeMonitor,
  stopRuntimeMonitor,
} from '../../../src/modules/platform-infrastructure';
import { JobMetricsService } from '../../../src/modules/platform-infrastructure/observability/event-loop/job-metrics.module';

const T0 = 1_700_000_000_000;

describe('jobTimings', () => {
  it('is wait = start - enqueue and duration = end - start', () => {
    expect(jobTimings({ timestamp: T0, processedOn: T0 + 250, finishedOn: T0 + 1250 })).toEqual({
      waitMs: 250,
      durationMs: 1000,
    });
  });

  it('does not count the delay the producer asked for as waiting', () => {
    const t = jobTimings({
      timestamp: T0,
      opts: { delay: 3_600_000 },
      processedOn: T0 + 3_600_300,
      finishedOn: T0 + 3_600_400,
    });
    expect(t).toEqual({ waitMs: 300, durationMs: 100 });
  });

  it('still excludes the delay when BullMQ has reset job.delay to 0 after promotion', () => {
    // Measured against a real worker: a promoted delayed job reports delay 0 and keeps the original in opts.delay.
    const t = jobTimings({
      timestamp: T0,
      delay: 0,
      opts: { delay: 1500 },
      processedOn: T0 + 1560,
      finishedOn: T0 + 1590,
    });
    expect(t).toEqual({ waitMs: 60, durationMs: 30 });
  });

  it('uses job.delay when a later change made it the larger one', () => {
    const t = jobTimings({
      timestamp: T0,
      delay: 10_000,
      opts: { delay: 1000 },
      processedOn: T0 + 10_200,
      finishedOn: T0 + 10_250,
    });
    expect(t?.waitMs).toBe(200);
  });

  it('clamps a negative wait (clock skew, early promotion) to zero', () => {
    const t = jobTimings({
      timestamp: T0,
      opts: { delay: 5000 },
      processedOn: T0 + 4000,
      finishedOn: T0 + 4100,
    });
    expect(t?.waitMs).toBe(0);
  });

  it('records no wait for a retry, but still the duration', () => {
    const t = jobTimings({
      timestamp: T0,
      attemptsStarted: 3,
      processedOn: T0 + 90_000,
      finishedOn: T0 + 90_500,
    });
    expect(t).toEqual({ waitMs: null, durationMs: 500 });
  });

  it('returns null when the job carries no usable timing', () => {
    expect(jobTimings(undefined)).toBeNull(); // a stalled-and-failed job has no job object
    expect(jobTimings({ timestamp: T0 })).toBeNull();
    expect(jobTimings({ timestamp: T0, processedOn: T0 })).toBeNull();
    expect(jobTimings({ timestamp: T0, processedOn: T0 + 10, finishedOn: T0 })).toBeNull();
  });
});

function fakeWorker(name: string) {
  return Object.assign(new EventEmitter(), { name });
}

describe('attachJobMetrics', () => {
  let monitor: RuntimeMonitor | undefined;
  afterEach(() => monitor?.stop());

  it('records wait, duration and outcome by queue name', () => {
    monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    const worker = fakeWorker('waba-ingest');
    attachJobMetrics(worker, monitor);
    worker.emit('completed', { timestamp: T0, processedOn: T0 + 40, finishedOn: T0 + 540 });
    worker.emit(
      'failed',
      { timestamp: T0, processedOn: T0 + 10, finishedOn: T0 + 20 },
      new Error('x'),
    );
    const out = monitor.render();
    expect(out).toMatch(/crm_queue_jobs_total\{[^}]*queue="waba-ingest",outcome="completed"\} 1/);
    expect(out).toMatch(/crm_queue_jobs_total\{[^}]*queue="waba-ingest",outcome="failed"\} 1/);
    expect(out).toMatch(/crm_queue_job_wait_seconds_count\{[^}]*queue="waba-ingest"\} 2/);
    expect(out).toMatch(/crm_queue_job_duration_seconds_count\{[^}]*queue="waba-ingest"\} 2/);
  });

  it('leaves the wait histogram alone for a retry', () => {
    monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    const worker = fakeWorker('webhook-deliver');
    attachJobMetrics(worker, monitor);
    worker.emit('failed', {
      timestamp: T0,
      attemptsStarted: 2,
      processedOn: T0 + 60_000,
      finishedOn: T0 + 60_100,
    });
    const out = monitor.render();
    expect(out).toMatch(/crm_queue_jobs_total\{[^}]*queue="webhook-deliver",outcome="failed"\} 1/);
    expect(out).toMatch(/crm_queue_job_duration_seconds_count\{[^}]*queue="webhook-deliver"\} 1/);
    expect(out).not.toContain('crm_queue_job_wait_seconds');
  });

  it('ignores a failure with no job and never throws into the worker', () => {
    const worker = fakeWorker('q');
    attachJobMetrics(worker, {
      observeJob: () => {
        throw new Error('boom');
      },
    });
    expect(() => worker.emit('failed', undefined, new Error('stalled'))).not.toThrow();
    expect(() =>
      worker.emit('completed', { timestamp: T0, processedOn: T0, finishedOn: T0 + 1 }),
    ).not.toThrow();
  });

  it('puts nothing but the queue name, outcome and identity in the labels', () => {
    monitor = new RuntimeMonitor({ service: 'worker', intervalMs: 60_000 });
    const worker = fakeWorker('con-import');
    attachJobMetrics(worker, monitor);
    worker.emit('completed', {
      timestamp: T0,
      processedOn: T0 + 1,
      finishedOn: T0 + 2,
      id: 'job-secret-123',
      name: 'import-contacts',
      data: { phone: '+919999999999' },
    });
    const out = monitor.render();
    expect(out).not.toContain('job-secret-123');
    expect(out).not.toContain('919999999999');
    expect(out).not.toContain('import-contacts');
  });
});

class Proc extends WorkerHost {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

function discoveryOf(...instances: unknown[]): DiscoveryService {
  return {
    getProviders: () => instances.map((instance, i) => ({ instance, name: `P${i}` })),
  } as unknown as DiscoveryService;
}

describe('JobMetricsService', () => {
  afterEach(() => stopRuntimeMonitor());

  it('attaches to every WorkerHost processor and nothing else', () => {
    const monitor = startRuntimeMonitor('worker', {});
    const a = new Proc();
    const b = new Proc();
    const wa = fakeWorker('outbox');
    const wb = fakeWorker('campaign');
    (a as unknown as { _worker: unknown })._worker = wa;
    (b as unknown as { _worker: unknown })._worker = wb;
    const service = new JobMetricsService(discoveryOf(a, { not: 'a processor' }, b, null));
    expect(service.onApplicationBootstrap()).toBe(2);
    wa.emit('completed', { timestamp: T0, processedOn: T0 + 5, finishedOn: T0 + 15 });
    wb.emit('completed', { timestamp: T0, processedOn: T0 + 5, finishedOn: T0 + 15 });
    const out = monitor!.render();
    expect(out).toContain('queue="outbox"');
    expect(out).toContain('queue="campaign"');
  });

  it('skips a processor whose worker is not available and keeps going', () => {
    startRuntimeMonitor('worker', {});
    const broken = new Proc(); // no _worker: the getter throws
    const ok = new Proc();
    (ok as unknown as { _worker: unknown })._worker = fakeWorker('sched-run');
    const service = new JobMetricsService(discoveryOf(broken, ok));
    expect(service.onApplicationBootstrap()).toBe(1);
  });

  it('does nothing when monitoring is switched off', () => {
    expect(startRuntimeMonitor('worker', { OBS_RUNTIME_MONITOR: 'false' })).toBeUndefined();
    const p = new Proc();
    (p as unknown as { _worker: unknown })._worker = fakeWorker('q');
    expect(new JobMetricsService(discoveryOf(p)).onApplicationBootstrap()).toBe(0);
  });
});
