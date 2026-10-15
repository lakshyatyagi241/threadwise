// Child process of bench.mjs: a bare Node HTTP server with the real RuntimeMonitor (or none), so the bench measures the
// monitor and the loop, not Nest, Postgres or Redis. NOT a model of the API: it says nothing about real endpoint latency.
import { createServer } from 'node:http';
import { RuntimeMonitor } from '../../apps/api/src/modules/platform-infrastructure/observability/event-loop';

const port = Number(process.env.BENCH_PORT);
const monitored = process.env.BENCH_MONITOR === '1';
const monitor = monitored
  ? new RuntimeMonitor({
      service: 'api',
      instance: 'bench',
      intervalMs: 1000,
      log: () => undefined,
    })
  : undefined;
monitor?.start();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const started = process.hrtime.bigint();
  const done = () => {
    res.end('ok');
    if (monitor) {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      monitor.observeHttp(req.method ?? 'GET', url.pathname, res.statusCode, ms);
    }
  };
  if (url.pathname === '/block') {
    const end = Date.now() + Number(url.searchParams.get('ms') ?? 100);
    while (Date.now() < end) {
      /* deliberate synchronous CPU work */
    }
    done();
  } else if (url.pathname === '/metrics') {
    res.end(monitor?.render() ?? '');
  } else {
    // A typical async handler: waits on "I/O" without holding the loop.
    setTimeout(done, 5);
  }
}).listen(port, '127.0.0.1', () => process.send?.('ready'));
