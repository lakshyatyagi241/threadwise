#!/usr/bin/env node
/**
 * Load test of the public WhatsApp webhook receiver (POST /v2/public/webhooks/whatsapp), the busiest route of the platform.
 * It sends signed, unique status deliveries over keep-alive connections for a fixed time and reports what the receiver costs:
 *   - throughput and latency percentiles,
 *   - CPU seconds the API process used per 1,000 requests (from `ps`, so give --pid),
 *   - Redis commands per request (from INFO stats, so give --redis-port).
 *
 *   META_APP_SECRET=bench-secret node tools/perf/webhook-bench.mjs --url http://localhost:3000 --secret bench-secret \
 *     --pid <api pid> --redis-port 6380 --seconds 20 --concurrency 32
 *
 * The API must run with the same META_APP_SECRET (or WHATSAPP_APP_SECRET). `--unsigned` sends no signature, the way the platform's
 * own forwarders do (run the API with WABA_TRUSTED_FORWARDER_IPS=127.0.0.1 so the source address authenticates them), and
 * `--numbers N` spreads the deliveries over N different phone number ids, as prod traffic is. No worker is needed: the receiver only validates and
 * queues, which is the part this measures. The numbers are for comparing two builds on one machine, not absolute capacity.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const URL_ = new URL('/v2/public/webhooks/whatsapp', arg('--url', 'http://localhost:3000'));
const SECRET = arg('--secret', process.env.META_APP_SECRET ?? '');
const SECONDS = Number(arg('--seconds', '20'));
const CONC = Number(arg('--concurrency', '32'));
const PID = arg('--pid', '');
const UNSIGNED = process.argv.includes('--unsigned');
const NUMBERS = Number(arg('--numbers', '1'));
const REDIS_PORT = arg('--redis-port', '');
if (!SECRET) {
  console.error("--secret (the API's META_APP_SECRET) is required");
  process.exit(1);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: CONC });

/** A realistic delivery-status webhook; the id is unique so the replay guard does not absorb it. */
function delivery() {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '100000000000001',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000001',
                phone_number_id: String(200000000000001 + Math.floor(Math.random() * NUMBERS)),
              },
              statuses: [
                {
                  id: `wamid.${randomUUID()}`,
                  status: 'delivered',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: '15550001111',
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function post() {
  const body = delivery();
  const signature = UNSIGNED
    ? null
    : `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  return new Promise((resolve) => {
    const t = process.hrtime.bigint();
    const req = http.request(
      URL_,
      {
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(signature ? { 'x-hub-signature-256': signature } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ ms: Number(process.hrtime.bigint() - t) / 1e6, status: res.statusCode }),
        );
      },
    );
    req.on('error', () => resolve({ ms: 0, status: 0 }));
    req.end(body);
  });
}

const cpuSeconds = () => {
  if (!PID) return null;
  const t = execFileSync('ps', ['-o', 'cputime=', '-p', PID], { encoding: 'utf8' }).trim(); // [hh:]mm:ss.cc
  return t.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
};
const redisCommands = () => {
  if (!REDIS_PORT) return null;
  const out = execFileSync('redis-cli', ['-p', REDIS_PORT, 'INFO', 'stats'], { encoding: 'utf8' });
  const m = out.match(/total_commands_processed:(\d+)/);
  return m ? Number(m[1]) : null;
};

// warm up so JIT and the connection pool are out of the measurement
await Promise.all(Array.from({ length: CONC }, () => post()));

const cpu0 = cpuSeconds();
const redis0 = redisCommands();
const lat = [];
const codes = {};
const end = Date.now() + SECONDS * 1000;
const t0 = Date.now();
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (Date.now() < end) {
      const r = await post();
      lat.push(r.ms);
      codes[r.status] = (codes[r.status] ?? 0) + 1;
    }
  }),
);
const elapsed = (Date.now() - t0) / 1000;
const cpu1 = cpuSeconds();
const redis1 = redisCommands();

lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1);
const n = lat.length;
console.log(
  `requests ${n} in ${elapsed.toFixed(1)} s = ${(n / elapsed).toFixed(0)} req/s   status ${JSON.stringify(codes)}`,
);
console.log(
  `latency ms  p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${lat[n - 1].toFixed(1)}`,
);
if (cpu0 !== null && cpu1 !== null)
  console.log(
    `api cpu     ${(((cpu1 - cpu0) / n) * 1000).toFixed(2)} cpu-seconds per 1,000 requests`,
  );
if (redis0 !== null && redis1 !== null)
  console.log(`redis       ${((redis1 - redis0) / n).toFixed(1)} commands per request`);
agent.destroy();
