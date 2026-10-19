// The monitor core lives in packages/observability (shared with apps/web); these names stay importable from here.
export {
  EventLoopSampler,
  classifySnapshot,
  type EventLoopSnapshot,
  type LoopLevel,
  RuntimeMonitor,
  type RuntimeMonitorOptions,
  type RuntimeService,
  Registry,
  Gauge,
  Counter,
  Histogram,
  startMetricsServer,
  type MetricsServerOptions,
  getRuntimeMonitor,
  metricsListenerDecision,
  stopRuntimeMonitor,
  type ListenerDecision,
} from '@crm/observability';
export { httpMetricsMiddleware } from './http-metrics.middleware';
export {
  attachJobMetrics,
  jobTimings,
  type JobTimingFields,
  type JobTimings,
  type ObservableWorker,
} from './job-metrics';
export { JobMetricsModule, JobMetricsService } from './job-metrics.module';
export { QueueDepthModule, QueueDepthService } from './queue-depth.module';
export { sampleQueueDepth, type DepthQueue, type QueueDepth } from './queue-depth';
export {
  Prober,
  parseProbeTargets,
  probeOnce,
  type ProbeOutcome,
  type ProbeResult,
  type ProbeTarget,
} from './probe';
export { startRuntimeMonitor } from './start-runtime-monitor';
