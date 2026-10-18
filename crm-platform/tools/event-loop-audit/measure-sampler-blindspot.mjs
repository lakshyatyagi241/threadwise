#!/usr/bin/env node
// Does a stall that starts right after a window boundary get recorded? (EL-B10)
//
//   pnpm --filter @crm/observability build
//   node tools/event-loop-audit/measure-sampler-blindspot.mjs
//
// For each trial: start a sampler with a short window, call sample() at the boundary, then block the loop for STALL_MS inside the same
// tick (so the stall begins before the histogram's first tick after the boundary), wait for the next window and read it. The old
// behaviour (ONE histogram, reset in place) is reproduced by injecting a plain `monitorEventLoopDelay` histogram; the new one is the
// sampler's default. A trial "sees" the stall when the next window's worst delay is at least 80 % of it.
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'packages/observability/package.json'));
const { EventLoopSampler } = require(join(root, 'packages/observability/dist/index.js'));

const TRIALS = Number(process.argv.find((a) => a.startsWith('--trials='))?.slice(9) ?? 40);
const WINDOW_MS = 250;
const STALL_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const block = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* hold the loop */
  }
};

async function trial(mode) {
  const sampler =
    mode === 'single'
      ? new EventLoopSampler({ histogram: monitorEventLoopDelay({ resolution: 10 }) })
      : new EventLoopSampler({ windowHintMs: WINDOW_MS });
  sampler.start();
  await sleep(WINDOW_MS);
  sampler.sample(); // the boundary
  block(STALL_MS); // begins before any tick of the new window
  await sleep(WINDOW_MS);
  const next = sampler.sample();
  sampler.stop();
  return next ? next.delayMaxMs : 0;
}

const results = {};
for (const mode of ['single', 'two-histograms']) {
  let seen = 0;
  const maxes = [];
  for (let i = 0; i < TRIALS; i++) {
    const max = await trial(mode === 'single' ? 'single' : 'dual');
    maxes.push(Math.round(max));
    if (max >= STALL_MS * 0.8) seen += 1;
  }
  results[mode] = {
    trials: TRIALS,
    stallsSeen: seen,
    nextWindowMaxMs: {
      min: Math.min(...maxes),
      median: [...maxes].sort((a, b) => a - b)[Math.floor(maxes.length / 2)],
      max: Math.max(...maxes),
    },
  };
  console.log(
    `${mode.padEnd(15)} ${seen}/${TRIALS} stalls of ${STALL_MS} ms seen in the next window (worst delay min ${results[mode].nextWindowMaxMs.min}, median ${results[mode].nextWindowMaxMs.median} ms)`,
  );
}
const dir = join(root, 'reports/event-loop');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'sampler-blindspot.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, windowMs: WINDOW_MS, stallMs: STALL_MS, results }, null, 1)}\n`,
);
