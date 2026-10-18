#!/usr/bin/env node
// How long does the WhatsApp webhook take to acknowledge, and how long does it hold the event loop, at the body sizes Meta can send,
// under a burst? (EL-B09)
//
//   node tools/event-loop-audit/measure-webhook-ack.mjs                 # sizes 0.1, 1, 4 MiB; concurrency 1 and 8; 4 s each
//   node tools/event-loop-audit/measure-webhook-ack.mjs --seconds=8
//
// A small Express server in a child process reproduces the app's path to the acknowledgement with the app's own settings: the JSON
// parser with `verify` keeping the raw bytes (apps/api/src/modules/platform-infrastructure/body-limits/body-limits.ts), then what
// `WabaWebhookService.receive` does before it answers, in the same order: re-parse the raw bytes (`JSON.parse(rawBody.toString())`),
// split the changes, HMAC-SHA256 the raw bytes for the platform secret(s), SHA-256 the raw bytes for the job id, answer. Two variants:
// `current` (the code as it was: the body is parsed twice) and `single-parse` (the service reuses the parser's result). The database,
// Redis and the queue are NOT in the path here: this is the CPU the loop spends on one delivery, which is what a burst multiplies.
// Synthetic payloads in the shape of Meta's `messages` webhook (about 560 bytes per message). This machine only.
import { fork } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SECRET = 'platform-app-secret-for-the-bench';

if (process.argv.includes('--server')) {
  // ---- the server side --------------------------------------------------------------------------------------------------------
  const require = createRequire(join(root, 'apps/api/package.json'));
  const express = require('express');
  const variant = process.argv[process.argv.indexOf('--server') + 1];
  const secrets = Number(process.argv[process.argv.indexOf('--server') + 2] ?? 1);
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const app = express();
  app.get('/__stats', (_req, res) => {
    const s = { p50: h.percentile(50) / 1e6, p99: h.percentile(99) / 1e6, max: h.max / 1e6 };
    h.reset();
    res.json(s);
  });
  const keepRaw = (req, _res, buf) => {
    req.rawBody = buf;
  };
  app.post('/hook', express.json({ limit: 4096 * 1024, verify: keepRaw }), (req, res) => {
    const raw = req.rawBody;
    const payload = variant === 'single-parse' ? req.body : JSON.parse(raw.toString('utf8'));
    const changes = [];
    for (const entry of payload.entry ?? [])
      for (const change of entry.changes ?? [])
        changes.push({ field: change.field, value: change.value });
    const given = Buffer.from(
      String(req.headers['x-hub-signature-256'] ?? '').replace(/^sha256=/, ''),
      'hex',
    );
    let ok = false;
    // the platform secrets are tried in turn: the wrong ones first when more than one is configured
    for (let i = 0; i < secrets; i++) {
      const secret = i === secrets - 1 ? SECRET : `${SECRET}-other-${i}`;
      const expected = createHmac('sha256', secret).update(raw).digest();
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        ok = true;
        break;
      }
    }
    if (!ok) return res.status(401).json({ error: 'bad signature' });
    createHash('sha256').update(raw).digest('hex'); // the queue job id
    res.json({ received: true, changes: changes.length });
  });
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', (m) => m === 'stop' && process.exit(0));
} else {
  // ---- the client side --------------------------------------------------------------------------------------------------------
  const SECONDS = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) ?? 4);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length
      ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10
      : undefined;
  };
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const WORDS =
    'hello order shipped thanks please refund invoice delivery address pickup yes no later today tomorrow price'.split(
      ' ',
    );
  const text = (n) => {
    const out = [];
    let len = 0;
    while (len < n) {
      const w =
        rnd() < 0.15
          ? Math.floor(rnd() * 36 ** 6).toString(36)
          : WORDS[Math.floor(rnd() * WORDS.length)];
      out.push(w);
      len += w.length + 1;
    }
    return out.join(' ').slice(0, n);
  };
  /** A Meta `messages` delivery of about `bytes`: one entry, one change, many inbound text messages with their contacts. */
  function payload(bytes) {
    const messages = [];
    const contacts = [];
    let size = 400;
    for (let i = 0; size < bytes; i++) {
      const wa = `9198${String(10000000 + (i % 5000))}`;
      const m = {
        from: wa,
        id: `wamid.${Math.floor(rnd() * 36 ** 10).toString(36)}${i}`,
        timestamp: String(1_760_000_000 + i),
        text: { body: text(120 + Math.floor(rnd() * 120)) },
        type: 'text',
      };
      messages.push(m);
      contacts.push({ profile: { name: `Customer ${i % 5000}` }, wa_id: wa });
      size += JSON.stringify(m).length + 80;
    }
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
                  display_phone_number: '919800000000',
                  phone_number_id: '110000000000001',
                },
                contacts,
                messages,
              },
            },
          ],
        },
      ],
    });
  }

  const rows = [];
  for (const variant of ['current', 'single-parse']) {
    for (const [label, bytes] of [
      ['0.1 MiB', 100 * 1024],
      ['1 MiB', 1024 * 1024],
      ['4 MiB (the cap)', 4000 * 1024],
    ]) {
      const body = payload(bytes);
      const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
      for (const concurrency of [1, 8]) {
        const child = fork(fileURLToPath(import.meta.url), ['--server', variant, '2'], {
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        const { port } = await new Promise((r) => child.once('message', r));
        const url = `http://127.0.0.1:${port}`;
        const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signature };
        await fetch(`${url}/hook`, { method: 'POST', headers, body }); // warm
        await fetch(`${url}/__stats`).then((r) => r.json()); // reset the server's meter
        const lat = [];
        let failed = 0;
        const end = Date.now() + SECONDS * 1000;
        const worker = async () => {
          while (Date.now() < end) {
            const t0 = performance.now();
            const r = await fetch(`${url}/hook`, { method: 'POST', headers, body });
            await r.arrayBuffer();
            if (!r.ok) failed += 1;
            lat.push(performance.now() - t0);
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        const loop = await fetch(`${url}/__stats`).then((r) => r.json());
        child.send('stop');
        const row = {
          variant,
          body: label,
          bodyBytes: body.length,
          concurrency,
          requests: lat.length,
          failed,
          acksPerSecond: Math.round((lat.length / SECONDS) * 10) / 10,
          ackMs: { p50: q(lat, 0.5), p95: q(lat, 0.95), p99: q(lat, 0.99), max: q(lat, 1) },
          serverLoopDelayMs: {
            p50: Math.round(loop.p50 * 10) / 10,
            p99: Math.round(loop.p99 * 10) / 10,
            max: Math.round(loop.max * 10) / 10,
          },
        };
        rows.push(row);
        console.log(
          `${variant.padEnd(12)} ${label.padEnd(16)} c=${String(concurrency).padEnd(2)} ${String(row.acksPerSecond).padStart(7)} acks/s   ack p50 ${String(row.ackMs.p50).padStart(7)} p99 ${String(row.ackMs.p99).padStart(7)} ms   server loop p99 ${String(row.serverLoopDelayMs.p99).padStart(7)} max ${String(row.serverLoopDelayMs.max).padStart(7)} ms${failed ? `   FAILED ${failed}` : ''}`,
        );
        await sleep(500);
      }
    }
  }
  const dir = join(root, 'reports/event-loop');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'webhook-ack.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, seconds: SECONDS, note: "Express + the app's JSON parser settings + the service's pre-acknowledgement CPU work (re-parse, HMAC for 2 platform secrets, SHA-256 job id). No database, Redis or queue in the path. Synthetic Meta-shaped payloads; this machine only.", rows }, null, 1)}\n`,
  );
}
