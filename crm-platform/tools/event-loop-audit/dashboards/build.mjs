#!/usr/bin/env node
// Writes the four Grafana dashboards (EL-B04) from one compact description, so a metric rename shows up in one place.
//
//   node tools/event-loop-audit/dashboards/build.mjs           # rewrite deploy/observability/grafana/dashboards/*.json
//   node tools/event-loop-audit/dashboards/build.mjs --check   # exit 1 when the committed JSON differs from what this would write
//
// Every query uses only series the runtime monitor, the job metrics, the HTTP middleware or the probe really export; the unit test
// apps/api/test/unit/platform-infrastructure/dashboards.spec.ts checks the metric names against the source, and
// tools/event-loop-audit/scrape-demo.mjs --grafana runs every panel against a real Grafana and Prometheus.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../deploy/observability/grafana/dashboards');
const check = process.argv.includes('--check');

export const DS = { type: 'prometheus', uid: 'crm-prometheus' };
const RI = '$__rate_interval';

let nextId = 1;
const target = (expr, legend, refId, extra = {}) => ({
  datasource: DS,
  expr,
  legendFormat: legend,
  refId,
  ...extra,
});
const refIds = 'ABCDEFGHIJ';
const targets = (qs) =>
  qs.map((q, i) => {
    const [expr, legend, extra] = Array.isArray(q) ? q : [q, ''];
    return target(expr, legend ?? '', refIds[i], extra);
  });

const row = (title, y) => ({
  id: nextId++,
  type: 'row',
  title,
  collapsed: false,
  gridPos: { h: 1, w: 24, x: 0, y },
  panels: [],
});

/** thresholds: [[value, colour]] after a green base; shown as lines on time series, as colours on stats. */
const steps = (th = []) => ({
  mode: 'absolute',
  steps: [{ color: 'green', value: null }, ...th.map(([value, color]) => ({ color, value }))],
});

function timeseries(title, qs, pos, { unit = 's', th, desc, min, max, stack = false } = {}) {
  return {
    id: nextId++,
    type: 'timeseries',
    title,
    description: desc,
    datasource: DS,
    gridPos: pos,
    targets: targets(qs),
    fieldConfig: {
      defaults: {
        unit,
        min,
        max,
        custom: {
          lineWidth: 1,
          fillOpacity: stack ? 30 : 8,
          showPoints: 'never',
          spanNulls: false,
          stacking: { mode: stack ? 'normal' : 'none' },
          thresholdsStyle: { mode: th ? 'line' : 'off' },
        },
        thresholds: steps(th),
      },
      overrides: [],
    },
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
  };
}

function stat(
  title,
  expr,
  pos,
  { unit = 'none', th, desc, decimals, mappings = [], instant = true } = {},
) {
  return {
    id: nextId++,
    type: 'stat',
    title,
    description: desc,
    datasource: DS,
    gridPos: pos,
    targets: [target(expr, '', 'A', { instant, range: !instant })],
    fieldConfig: {
      defaults: { unit, decimals, thresholds: steps(th), mappings, noValue: 'no data' },
      overrides: [],
    },
    options: {
      colorMode: th ? 'background' : 'none',
      graphMode: 'none',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto',
    },
  };
}

function table(title, qs, pos, { unit = 's', desc, organize } = {}) {
  return {
    id: nextId++,
    type: 'table',
    title,
    description: desc,
    datasource: DS,
    gridPos: pos,
    targets: targets(qs.map((q) => [q[0], q[1], { instant: true, range: false, format: 'table' }])),
    transformations: [
      { id: 'merge', options: {} },
      ...(organize ? [{ id: 'organize', options: organize }] : []),
    ],
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: { showHeader: true, footer: { show: false } },
  };
}

function text(title, markdown, pos) {
  return {
    id: nextId++,
    type: 'text',
    title,
    gridPos: pos,
    options: { mode: 'markdown', content: markdown },
  };
}

const UP_DOWN = [
  {
    type: 'value',
    options: { 0: { text: 'DOWN', color: 'red' }, 1: { text: 'UP', color: 'green' } },
  },
];

const variable = {
  query: (name, label, query, { multi = true, includeAll = true, regex } = {}) => ({
    name,
    label,
    type: 'query',
    datasource: DS,
    definition: query,
    query: { query, refId: 'v', qryType: 1 },
    refresh: 2,
    sort: 1,
    multi,
    includeAll,
    allValue: '.*',
    current: includeAll ? { text: 'All', value: '$__all' } : {},
    regex,
  }),
  custom: (name, label, values, def) => ({
    name,
    label,
    type: 'custom',
    query: values.join(','),
    options: values.map((v) => ({ text: v, value: v, selected: v === def })),
    current: { text: def, value: def },
    multi: false,
    includeAll: false,
  }),
};

function dashboard({ uid, title, description, tags, panels, templating = [], annotations = [] }) {
  return {
    uid,
    title,
    description,
    tags: ['threadwise', 'event-loop', ...tags],
    schemaVersion: 39,
    version: 1,
    editable: true,
    graphTooltip: 1,
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
    timepicker: {},
    timezone: 'utc',
    templating: { list: templating },
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: 'grafana', uid: '-- Grafana --' },
          enable: true,
          hide: true,
          iconColor: 'rgba(0, 211, 255, 1)',
          name: 'Annotations & Alerts',
          type: 'dashboard',
        },
        ...annotations,
      ],
    },
    panels,
    links: [],
  };
}

// ---- shared panel groups ---------------------------------------------------------------------------------------------------------

/** Event loop, process and runtime panels, the same for any service. `sel` is the label selector, `y` the first free row. */
function runtimePanels(sel, y, { who }) {
  const p99 = `crm_event_loop_delay_p99_seconds{${sel}}`;
  return [
    row('Event loop', y),
    timeseries(
      'Event loop delay',
      [
        [`max(crm_event_loop_delay_p50_seconds{${sel}})`, 'p50'],
        [`max(crm_event_loop_delay_p95_seconds{${sel}})`, 'p95'],
        [`max(${p99})`, 'p99'],
        [`max(crm_event_loop_delay_max_seconds{${sel}})`, 'max in window'],
      ],
      { h: 8, w: 12, x: 0, y: y + 1 },
      {
        th: [
          [0.05, 'orange'],
          [0.25, 'red'],
        ],
        desc: `Worst ${who} instance per reporting window. Lines: 50 ms (p99 warning target) and 250 ms. Alerts: EventLoopDelayP95Warning (20 ms, 5 m average), EventLoopDelayP99Warning (50 ms), EventLoopLongStall* (2 s and 10 s).`,
      },
    ),
    timeseries(
      'Event loop utilization',
      [
        [`max(crm_event_loop_utilization_ratio{${sel}})`, 'worst instance'],
        [`avg(crm_event_loop_utilization_ratio{${sel}})`, 'average'],
      ],
      { h: 8, w: 6, x: 12, y: y + 1 },
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        th: [[0.85, 'red']],
        desc: 'Share of the window the loop spent running JavaScript. EventLoopUtilizationHigh fires above 0.85 for 5 minutes.',
      },
    ),
    timeseries(
      'Windows over the delay target',
      [
        [
          `sum by (level) (increase(crm_event_loop_blocked_windows_total{${sel}}[${RI}]))`,
          '{{level}}',
        ],
      ],
      { h: 8, w: 6, x: 18, y: y + 1 },
      {
        unit: 'none',
        stack: true,
        desc: 'Reporting windows whose loop DELAY crossed the warn or critical target (utilization alone never counts).',
      },
    ),
    row('Process', y + 9),
    timeseries(
      'Heap used against its limit',
      [
        [
          `max(crm_process_heap_used_bytes{${sel}} / crm_process_heap_limit_bytes{${sel}})`,
          'worst instance',
        ],
      ],
      { h: 8, w: 6, x: 0, y: y + 10 },
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        th: [
          [0.75, 'orange'],
          [0.9, 'red'],
        ],
        desc: 'ProcessHeapNearLimit at 0.75, HeapNearOom at 0.90.',
      },
    ),
    timeseries(
      'Memory',
      [
        [`max(crm_process_rss_bytes{${sel}})`, 'rss'],
        [`max(crm_process_heap_used_bytes{${sel}})`, 'heap used'],
        [`max(crm_process_external_bytes{${sel}})`, 'external'],
      ],
      { h: 8, w: 6, x: 6, y: y + 10 },
      { unit: 'bytes' },
    ),
    timeseries(
      'GC pause',
      [
        [`max(crm_gc_pause_max_seconds{${sel}})`, 'longest pause in window'],
        [
          `sum by (kind) (rate(crm_gc_pause_seconds_total{${sel}}[${RI}]))`,
          'time in GC per second, {{kind}}',
        ],
      ],
      { h: 8, w: 6, x: 12, y: y + 10 },
      { th: [[0.1, 'red']], desc: 'GcPauseHigh fires when one pause passes 100 ms.' },
    ),
    timeseries(
      'CPU and throttling',
      [
        [`max(crm_process_cpu_ratio{${sel}})`, 'process CPU (1 = one core)'],
        [
          `max(rate(crm_container_cpu_throttled_seconds_total{${sel}}[${RI}]))`,
          'container throttled, s per s',
        ],
      ],
      { h: 8, w: 6, x: 18, y: y + 10 },
      { unit: 'none', desc: 'ContainerCpuThrottled fires above 0.1 throttled seconds per second.' },
    ),
  ];
}

// ---- dashboards ------------------------------------------------------------------------------------------------------------------

function apiDashboard() {
  nextId = 1;
  const S = 'service="api",instance=~"$instance"';
  const H = `crm_http_request_duration_seconds_bucket{${S},route=~"$route"}`;
  const panels = [
    row('Is it up, and what do callers see', 0),
    stat(
      'Metrics target',
      'min(up{job="crm-api"})',
      { h: 4, w: 4, x: 0, y: 1 },
      {
        mappings: UP_DOWN,
        desc: 'Prometheus can scrape the API metrics listener. RuntimeMetricsTargetDown.',
      },
    ),
    stat(
      'Probe',
      'min(crm_probe_up)',
      { h: 4, w: 4, x: 4, y: 1 },
      {
        mappings: UP_DOWN,
        desc: 'The probe process reached the API from outside its loop. ApiProbeFailing.',
      },
    ),
    stat('Instances reporting', `count(crm_runtime_last_report_timestamp_seconds{service="api"})`, {
      h: 4,
      w: 4,
      x: 8,
      y: 1,
    }),
    stat(
      'Seconds since last report',
      `time() - max(crm_runtime_last_report_timestamp_seconds{service="api"})`,
      { h: 4, w: 4, x: 12, y: 1 },
      { unit: 's', decimals: 0, th: [[60, 'red']], desc: 'RuntimeMetricsStale fires above 60 s.' },
    ),
    stat(
      'Caller p95 (probe, 5 m)',
      'histogram_quantile(0.95, sum by (le) (rate(crm_probe_http_duration_seconds_bucket[5m])))',
      { h: 4, w: 4, x: 16, y: 1 },
      { unit: 's', decimals: 3, th: [[1, 'red']], desc: 'ApiCallerLatencyHigh fires above 1 s.' },
    ),
    stat(
      '5xx share (5 m)',
      `sum(rate(crm_http_request_duration_seconds_count{${S},status="5xx"}[5m])) / sum(rate(crm_http_request_duration_seconds_count{${S}}[5m]))`,
      { h: 4, w: 4, x: 20, y: 1 },
      {
        unit: 'percentunit',
        decimals: 2,
        th: [
          [0.01, 'orange'],
          [0.05, 'red'],
        ],
      },
    ),
    row('Caller-visible latency', 5),
    timeseries(
      'Probe latency by target',
      [
        [
          `histogram_quantile(0.5, sum by (le, target) (rate(crm_probe_http_duration_seconds_bucket[${RI}])))`,
          'p50 {{target}}',
        ],
        [
          `histogram_quantile(0.95, sum by (le, target) (rate(crm_probe_http_duration_seconds_bucket[${RI}])))`,
          'p95 {{target}}',
        ],
        [
          `histogram_quantile(0.99, sum by (le, target) (rate(crm_probe_http_duration_seconds_bucket[${RI}])))`,
          'p99 {{target}}',
        ],
      ],
      { h: 8, w: 12, x: 0, y: 6 },
      {
        th: [[1, 'red']],
        desc: 'Timed by a separate process, so a stalled loop shows here even when the API cannot report it.',
      },
    ),
    timeseries(
      'Request latency (all routes)',
      [
        [`histogram_quantile(0.5, sum by (le) (rate(${H}[${RI}])))`, 'p50'],
        [`histogram_quantile(0.95, sum by (le) (rate(${H}[${RI}])))`, 'p95'],
        [`histogram_quantile(0.99, sum by (le) (rate(${H}[${RI}])))`, 'p99'],
      ],
      { h: 8, w: 12, x: 12, y: 6 },
      {
        desc: 'Measured inside the API from first byte to response end; the probe above adds the queueing before it.',
      },
    ),
    row('Traffic', 14),
    timeseries(
      'Requests per second by status class',
      [
        [
          `sum by (status) (rate(crm_http_request_duration_seconds_count{${S},route=~"$route"}[${RI}]))`,
          '{{status}}',
        ],
      ],
      { h: 8, w: 8, x: 0, y: 15 },
      { unit: 'reqps', stack: true },
    ),
    timeseries(
      '5xx share',
      [
        [
          `sum(rate(crm_http_request_duration_seconds_count{${S},route=~"$route",status="5xx"}[${RI}])) / sum(rate(crm_http_request_duration_seconds_count{${S},route=~"$route"}[${RI}]))`,
          '5xx / all',
        ],
      ],
      { h: 8, w: 8, x: 8, y: 15 },
      {
        unit: 'percentunit',
        th: [
          [0.01, 'orange'],
          [0.05, 'red'],
        ],
      },
    ),
    table(
      'Slowest routes (p95, last 15 m)',
      [
        [`topk(10, histogram_quantile(0.95, sum by (le, route) (rate(${H}[15m]))))`, 'p95'],
        [
          `topk(10, sum by (route) (rate(crm_http_request_duration_seconds_count{${S},route=~"$route"}[15m])))`,
          'req/s',
        ],
      ],
      { h: 8, w: 8, x: 16, y: 15 },
      {
        desc: 'Route templates, not URLs. Routes past the cardinality cap are counted under route="overflow".',
        organize: {
          excludeByName: { Time: true },
          renameByName: { 'Value #A': 'p95 (s)', 'Value #B': 'req/s' },
        },
      },
    ),
    ...runtimePanels(S, 23, { who: 'API' }),
  ];
  return dashboard({
    uid: 'crm-api',
    title: 'Threadwise API: event loop, latency, process',
    description:
      'Loop delay and utilization, caller-visible latency (probe), request latency and errors by route, heap, GC and CPU for the API process.',
    tags: ['api'],
    panels,
    templating: [
      variable.query(
        'instance',
        'Instance',
        'label_values(crm_runtime_last_report_timestamp_seconds{service="api"}, instance)',
      ),
      variable.query(
        'route',
        'Route',
        'label_values(crm_http_request_duration_seconds_count{service="api"}, route)',
      ),
    ],
  });
}

function workersDashboard() {
  nextId = 1;
  const S = 'service="worker",instance=~"$instance"';
  const Q = `queue=~"$queue"`;
  const panels = [
    row('Is it up, and is work waiting', 0),
    stat(
      'Metrics target',
      'min(up{job="crm-worker"})',
      { h: 4, w: 4, x: 0, y: 1 },
      { mappings: UP_DOWN, desc: 'RuntimeMetricsTargetDown.' },
    ),
    stat(
      'Instances reporting',
      `count(crm_runtime_last_report_timestamp_seconds{service="worker"})`,
      { h: 4, w: 4, x: 4, y: 1 },
    ),
    stat(
      'Seconds since last report',
      `time() - max(crm_runtime_last_report_timestamp_seconds{service="worker"})`,
      { h: 4, w: 4, x: 8, y: 1 },
      { unit: 's', decimals: 0, th: [[60, 'red']], desc: 'RuntimeMetricsStale fires above 60 s.' },
    ),
    stat(
      'Job wait p95 (5 m)',
      `histogram_quantile(0.95, sum by (le) (rate(crm_queue_job_wait_seconds_bucket{${S},${Q}}[5m])))`,
      { h: 4, w: 4, x: 12, y: 1 },
      {
        unit: 's',
        decimals: 2,
        th: [
          [30, 'orange'],
          [120, 'red'],
        ],
        desc: 'Time between a job being added and starting. The first number to rise when workers fall behind.',
      },
    ),
    stat(
      'Failed share (5 m)',
      `sum(rate(crm_queue_jobs_total{${S},${Q},outcome="failed"}[5m])) / sum(rate(crm_queue_jobs_total{${S},${Q}}[5m]))`,
      { h: 4, w: 4, x: 16, y: 1 },
      {
        unit: 'percentunit',
        decimals: 2,
        th: [
          [0.02, 'orange'],
          [0.1, 'red'],
        ],
      },
    ),
    stat(
      'Retries (1 h)',
      `sum(increase(crm_queue_job_retries_total{${S},${Q}}[1h]))`,
      { h: 4, w: 4, x: 20, y: 1 },
      {
        decimals: 0,
        desc: 'Extra starts of jobs that finished: retries after a failure plus restarts after a stall.',
      },
    ),
    row('Queues', 5),
    timeseries(
      'Jobs finished per second',
      [
        [
          `sum by (queue, outcome) (rate(crm_queue_jobs_total{${S},${Q}}[${RI}]))`,
          '{{queue}} {{outcome}}',
        ],
      ],
      { h: 8, w: 8, x: 0, y: 6 },
      { unit: 'ops', stack: true },
    ),
    timeseries(
      'Wait before start, p95 by queue',
      [
        [
          `histogram_quantile(0.95, sum by (le, queue) (rate(crm_queue_job_wait_seconds_bucket{${S},${Q}}[${RI}])))`,
          '{{queue}}',
        ],
      ],
      { h: 8, w: 8, x: 8, y: 6 },
      {
        desc: 'WorkerEventLoopBlockingWithQueueImpact combines a blocked worker loop with a rise here.',
      },
    ),
    timeseries(
      'Run time, p95 by queue',
      [
        [
          `histogram_quantile(0.95, sum by (le, queue) (rate(crm_queue_job_duration_seconds_bucket{${S},${Q}}[${RI}])))`,
          '{{queue}}',
        ],
      ],
      { h: 8, w: 8, x: 16, y: 6 },
    ),
    timeseries(
      'Failed jobs per second by queue',
      [
        [
          `sum by (queue) (rate(crm_queue_jobs_total{${S},${Q},outcome="failed"}[${RI}]))`,
          '{{queue}}',
        ],
      ],
      { h: 8, w: 12, x: 0, y: 14 },
      { unit: 'ops' },
    ),
    timeseries(
      'Retries per second by queue',
      [[`sum by (queue) (rate(crm_queue_job_retries_total{${S},${Q}}[${RI}]))`, '{{queue}}']],
      { h: 8, w: 12, x: 12, y: 14 },
      { unit: 'ops' },
    ),
    ...runtimePanels(S, 22, { who: 'worker' }),
  ];
  return dashboard({
    uid: 'crm-workers',
    title: 'Threadwise workers: queues, event loop, process',
    description:
      'Queue throughput, wait, run time, failures and retries per queue, with the worker loop, heap, GC and CPU.',
    tags: ['worker', 'queues'],
    panels,
    templating: [
      variable.query(
        'instance',
        'Instance',
        'label_values(crm_runtime_last_report_timestamp_seconds{service="worker"}, instance)',
      ),
      variable.query(
        'queue',
        'Queue',
        'label_values(crm_queue_jobs_total{service="worker"}, queue)',
      ),
    ],
  });
}

function realtimeDashboard() {
  nextId = 1;
  const S = 'service="api",instance=~"$instance"';
  const panels = [
    text(
      'What this dashboard covers',
      [
        'Sockets are served by the **API process** (`realtime.gateway.ts`, socket.io with the Redis adapter), so the realtime path shares the API loop. Everything here is that process, read for the realtime question: is the loop that fans messages out healthy, and how many handles does it hold.',
        '',
        '**Not measured today (no series exists):** connected sockets, rooms, events emitted per second, fan-out latency, Redis adapter lag. Those need new counters in the gateway; they are tracked as EL-B18 and are not drawn here with substitute numbers.',
      ].join('\n'),
      { h: 5, w: 24, x: 0, y: 0 },
    ),
    row('The loop that fans messages out', 5),
    timeseries(
      'Event loop delay',
      [
        [`max(crm_event_loop_delay_p95_seconds{${S}})`, 'p95'],
        [`max(crm_event_loop_delay_p99_seconds{${S}})`, 'p99'],
        [`max(crm_event_loop_delay_max_seconds{${S}})`, 'max in window'],
      ],
      { h: 8, w: 8, x: 0, y: 6 },
      {
        th: [
          [0.05, 'orange'],
          [0.25, 'red'],
        ],
        desc: 'A delay here is a pause in every connected client’s updates.',
      },
    ),
    timeseries(
      'Event loop utilization',
      [[`max(crm_event_loop_utilization_ratio{${S}})`, 'worst instance']],
      { h: 8, w: 8, x: 8, y: 6 },
      { unit: 'percentunit', min: 0, max: 1, th: [[0.85, 'red']] },
    ),
    timeseries(
      'Open handles (sockets, timers, requests)',
      [
        [`max(crm_process_active_resources{${S}})`, 'worst instance'],
        [`sum(crm_process_active_resources{${S}})`, 'all instances'],
      ],
      { h: 8, w: 8, x: 16, y: 6 },
      {
        unit: 'none',
        desc: 'process.getActiveResourcesInfo().length: every open socket counts, but so do timers and pending requests. A trend, not a connection count.',
      },
    ),
    row('Memory and pauses', 14),
    timeseries(
      'Heap used against its limit',
      [
        [
          `max(crm_process_heap_used_bytes{${S}} / crm_process_heap_limit_bytes{${S}})`,
          'worst instance',
        ],
      ],
      { h: 8, w: 8, x: 0, y: 15 },
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        th: [
          [0.75, 'orange'],
          [0.9, 'red'],
        ],
      },
    ),
    timeseries(
      'External and RSS memory',
      [
        [`max(crm_process_external_bytes{${S}})`, 'external (buffers, sockets)'],
        [`max(crm_process_rss_bytes{${S}})`, 'rss'],
      ],
      { h: 8, w: 8, x: 8, y: 15 },
      { unit: 'bytes' },
    ),
    timeseries(
      'GC pause (longest in window)',
      [[`max(crm_gc_pause_max_seconds{${S}})`, 'longest pause']],
      { h: 8, w: 8, x: 16, y: 15 },
      { th: [[0.1, 'red']] },
    ),
    row('Seen from outside', 23),
    timeseries(
      'Probe latency by target',
      [
        [
          `histogram_quantile(0.95, sum by (le, target) (rate(crm_probe_http_duration_seconds_bucket[${RI}])))`,
          'p95 {{target}}',
        ],
      ],
      { h: 8, w: 12, x: 0, y: 24 },
      {
        th: [[1, 'red']],
        desc: 'The probe calls /health and /ready, not a socket. It shows the same loop stalling from a caller’s side.',
      },
    ),
    timeseries(
      'Seconds since the API last reported',
      [
        [
          `time() - max by (instance) (crm_runtime_last_report_timestamp_seconds{${S}})`,
          '{{instance}}',
        ],
      ],
      { h: 8, w: 12, x: 12, y: 24 },
      { th: [[60, 'red']] },
    ),
  ];
  return dashboard({
    uid: 'crm-realtime',
    title: 'Threadwise realtime: the loop behind the sockets',
    description:
      'The API process read for the realtime question: loop delay and utilization, open handles, heap and GC. Socket-level counters do not exist yet (EL-B18).',
    tags: ['realtime'],
    panels,
    templating: [
      variable.query(
        'instance',
        'Instance',
        'label_values(crm_runtime_last_report_timestamp_seconds{service="api"}, instance)',
      ),
    ],
  });
}

function releaseDashboard() {
  nextId = 1;
  const S = 'service="$service"';
  // PromQL puts `offset` right after a selector (`m{..}[1h] offset 1d`), never after a whole expression, so every query here is a
  // function of the offset text and places it itself.
  const OFF = 'offset $compare';
  // The same query now and `$compare` ago, on one graph: a release (or any change) shows as the two lines parting.
  const pair = (fn, legend) => [
    [fn(''), `${legend} now`],
    [fn(OFF), `${legend} $compare ago`],
  ];
  const httpP95 = (win, o) =>
    `histogram_quantile(0.95, sum by (le) (rate(crm_http_request_duration_seconds_bucket{service="api"}[${win}] ${o})))`;
  const routeP95 = (win, o) =>
    `histogram_quantile(0.95, sum by (le, route) (rate(crm_http_request_duration_seconds_bucket{service="api"}[${win}] ${o})))`;
  const panels = [
    text(
      'How to read this',
      [
        'Each graph draws the same query **now** and **`$compare` ago** (pick it at the top), so a release, a config change or a new traffic mix shows as the two lines parting. Vertical marks are process (re)starts of the chosen service, which is where a deploy lands.',
        '',
        '**Limit:** the series carry no release or version label, so "before" is a time offset, not a named release. Compare like with like (same weekday and hour: choose 1d or 7d), and read a difference next to the traffic panel, because load moves latency too. Adding a `release` label from the image tag is tracked as EL-B18.',
      ].join('\n'),
      { h: 5, w: 24, x: 0, y: 0 },
    ),
    row('Same moment, one window earlier', 5),
    stat(
      'Loop delay p99 now (1 h avg)',
      `avg_over_time(crm_event_loop_delay_p99_seconds{${S}}[1h])`,
      { h: 4, w: 6, x: 0, y: 6 },
      { unit: 's', decimals: 4 },
    ),
    stat(
      'Loop delay p99 $compare ago (1 h avg)',
      `avg_over_time(crm_event_loop_delay_p99_seconds{${S}}[1h] ${OFF})`,
      { h: 4, w: 6, x: 6, y: 6 },
      { unit: 's', decimals: 4 },
    ),
    stat(
      'Change in loop delay p99',
      `avg_over_time(crm_event_loop_delay_p99_seconds{${S}}[1h]) / avg_over_time(crm_event_loop_delay_p99_seconds{${S}}[1h] ${OFF}) - 1`,
      { h: 4, w: 6, x: 12, y: 6 },
      {
        unit: 'percentunit',
        decimals: 0,
        th: [
          [0.25, 'orange'],
          [1, 'red'],
        ],
        desc: 'Positive means slower than the earlier window. Small absolute delays swing this a lot: read it with the two numbers beside it.',
      },
    ),
    stat(
      'Request p95 change (API, 1 h)',
      `${httpP95('1h', '')} / ${httpP95('1h', OFF)} - 1`,
      { h: 4, w: 6, x: 18, y: 6 },
      {
        unit: 'percentunit',
        decimals: 0,
        th: [
          [0.25, 'orange'],
          [1, 'red'],
        ],
      },
    ),
    row('Now against $compare ago', 10),
    timeseries(
      'Event loop delay p99',
      pair((o) => `max(crm_event_loop_delay_p99_seconds{${S}} ${o})`, 'p99'),
      { h: 8, w: 12, x: 0, y: 11 },
      { th: [[0.05, 'orange']] },
    ),
    timeseries(
      'Event loop utilization',
      pair((o) => `max(crm_event_loop_utilization_ratio{${S}} ${o})`, 'ELU'),
      { h: 8, w: 12, x: 12, y: 11 },
      { unit: 'percentunit', min: 0, max: 1 },
    ),
    timeseries(
      'Request latency p95 (API)',
      pair((o) => httpP95(RI, o), 'p95'),
      { h: 8, w: 12, x: 0, y: 19 },
    ),
    timeseries(
      'Requests per second (API)',
      pair(
        (o) => `sum(rate(crm_http_request_duration_seconds_count{service="api"}[${RI}] ${o}))`,
        'req/s',
      ),
      { h: 8, w: 12, x: 12, y: 19 },
      {
        unit: 'reqps',
        desc: 'If this differs a lot, the latency difference may be load, not the release.',
      },
    ),
    timeseries(
      '5xx share (API)',
      pair(
        (o) =>
          `sum(rate(crm_http_request_duration_seconds_count{service="api",status="5xx"}[${RI}] ${o})) / sum(rate(crm_http_request_duration_seconds_count{service="api"}[${RI}] ${o}))`,
        '5xx',
      ),
      { h: 8, w: 12, x: 0, y: 27 },
      { unit: 'percentunit' },
    ),
    timeseries(
      'Heap used against its limit',
      pair(
        (o) =>
          `max(crm_process_heap_used_bytes{${S}} ${o} / crm_process_heap_limit_bytes{${S}} ${o})`,
        'heap',
      ),
      { h: 8, w: 12, x: 12, y: 27 },
      { unit: 'percentunit', min: 0, max: 1 },
    ),
    timeseries(
      'Queue wait p95 (workers)',
      pair(
        (o) =>
          `histogram_quantile(0.95, sum by (le) (rate(crm_queue_job_wait_seconds_bucket{service="worker"}[${RI}] ${o})))`,
        'wait p95',
      ),
      { h: 8, w: 12, x: 0, y: 35 },
    ),
    timeseries(
      'Process starts',
      [[`sum(changes(crm_process_start_time_seconds{${S}}[${RI}]))`, 'starts']],
      { h: 8, w: 12, x: 12, y: 35 },
      {
        unit: 'none',
        stack: true,
        desc: 'A restart shows as a step in crm_process_start_time_seconds.',
      },
    ),
    row('Routes: where did it change', 43),
    table(
      'Route p95, last hour against $compare earlier',
      [
        [`topk(15, ${routeP95('1h', '')})`, 'now'],
        [`topk(15, ${routeP95('1h', OFF)})`, 'before'],
      ],
      { h: 10, w: 24, x: 0, y: 44 },
      {
        desc: 'Merged by route. A route present in only one column was not called in the other window.',
        organize: {
          excludeByName: { Time: true },
          renameByName: { 'Value #A': 'p95 now (s)', 'Value #B': 'p95 before (s)' },
        },
      },
    ),
  ];
  return dashboard({
    uid: 'crm-release-comparison',
    title: 'Threadwise release comparison: now against earlier',
    description:
      'The same loop, latency, error, heap and queue queries now and one chosen window earlier, with process restarts marked. No release label exists on the series yet (EL-B18).',
    tags: ['release'],
    panels,
    templating: [
      variable.custom('service', 'Service', ['api', 'worker'], 'api'),
      variable.custom('compare', 'Compare with', ['1h', '6h', '1d', '3d', '7d'], '1d'),
    ],
    annotations: [
      {
        name: 'Process (re)start',
        datasource: DS,
        enable: true,
        iconColor: 'purple',
        expr: 'changes(crm_process_start_time_seconds{service="$service"}[2m]) > 0',
        titleFormat: 'Process start',
        textFormat: '{{service}} {{instance}}',
        step: '1m',
        useValueForTime: false,
      },
    ],
  });
}

export const DASHBOARDS = {
  'crm-api.json': apiDashboard,
  'crm-workers.json': workersDashboard,
  'crm-realtime.json': realtimeDashboard,
  'crm-release-comparison.json': releaseDashboard,
};

if (process.argv[1]?.endsWith('build.mjs')) {
  mkdirSync(outDir, { recursive: true });
  let stale = 0;
  for (const [file, build] of Object.entries(DASHBOARDS)) {
    const json = `${JSON.stringify(build(), null, 2)}\n`;
    const path = join(outDir, file);
    if (check) {
      const same = existsSync(path) && readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === json;
      if (!same) {
        stale += 1;
        console.error(`stale: ${file}`);
      }
    } else {
      writeFileSync(path, json);
      console.log(`wrote ${file}`);
    }
  }
  if (check && stale) {
    console.error('run: node tools/event-loop-audit/dashboards/build.mjs');
    process.exit(1);
  }
  if (check) console.log('dashboards are up to date');
}
