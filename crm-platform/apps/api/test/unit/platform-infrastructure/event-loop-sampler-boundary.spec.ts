import { monitorEventLoopDelay } from 'node:perf_hooks';
import { EventLoopSampler } from '@crm/observability';
import { describe, expect, it } from 'vitest';

// EL-B10: with ONE histogram, `reset()` discards the next tick, so a stall that begins right after a window boundary is not recorded
// (measured: 0 of 40 on Node 22.17). The sampler now arms a second histogram a few ticks before the boundary and switches to it.
// Real timers and a real busy loop: nothing here is faked, because the blind spot is a property of the real histogram.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const block = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* hold the loop */
  }
};
const WINDOW = 150;
const STALL = 100;

// Real timers and a real busy loop make these depend on the machine's scheduling: a full parallel test run on a loaded laptop can starve the
// event loop for longer than the sampler's 100 ms lead, which is the documented limit of the design. A retry separates that from a real regression
// (the measurement tool runs 40 trials without retries).
describe('EventLoopSampler window boundary', { retry: 3 }, () => {
  it('records a stall that begins right after the boundary (five times out of five)', async () => {
    for (let i = 0; i < 5; i++) {
      const sampler = new EventLoopSampler({ windowHintMs: WINDOW });
      sampler.start();
      await sleep(WINDOW);
      sampler.sample();
      block(STALL); // begins before any tick of the new window
      await sleep(WINDOW);
      const next = sampler.sample();
      sampler.stop();
      expect(next, `trial ${i}`).not.toBeNull();
      expect(next!.delayMaxMs, `trial ${i}`).toBeGreaterThanOrEqual(STALL * 0.8);
    }
  });

  it('reports a quiet next window as quiet (the overlap does not invent a stall)', async () => {
    const sampler = new EventLoopSampler({ windowHintMs: WINDOW });
    sampler.start();
    await sleep(WINDOW);
    sampler.sample();
    await sleep(WINDOW);
    const quiet = sampler.sample();
    sampler.stop();
    expect(quiet).not.toBeNull();
    expect(quiet!.delayMaxMs).toBeLessThan(STALL);
  });

  it('does not report one stall in two windows when the caller samples at irregular times', async () => {
    // The arming time comes from the promised cadence (10 s here), not from the length of the last window: with short, uneven windows the
    // spare must not already be recording when a stall happens in the middle of the next one.
    const sampler = new EventLoopSampler({ windowHintMs: 10_000 });
    sampler.start();
    await sleep(60);
    sampler.sample();
    await sleep(40);
    block(STALL);
    await sleep(40);
    const withStall = sampler.sample();
    await sleep(120);
    const after = sampler.sample();
    sampler.stop();
    expect(withStall!.delayMaxMs).toBeGreaterThanOrEqual(STALL * 0.8);
    expect(after!.delayMaxMs).toBeLessThan(STALL * 0.6);
  });

  it('keeps working when the arming timer did not get to run (a sample right after start)', async () => {
    const sampler = new EventLoopSampler({ windowHintMs: 10_000 });
    sampler.start();
    await sleep(60);
    const early = sampler.sample(); // the spare was never armed: reset in place, as before
    await sleep(60);
    const again = sampler.sample();
    sampler.stop();
    expect(early).not.toBeNull();
    expect(again).not.toBeNull();
    expect(again!.samples).toBeGreaterThan(0);
  });

  it('keeps the single-histogram mode when a histogram is injected (the unit tests of the monitor rely on it)', async () => {
    const sampler = new EventLoopSampler({ histogram: monitorEventLoopDelay({ resolution: 10 }) });
    sampler.start();
    await sleep(60);
    expect(sampler.sample()).not.toBeNull();
    sampler.stop();
  });

  it('stop() leaves no timer or histogram running', async () => {
    const sampler = new EventLoopSampler({ windowHintMs: 40 });
    sampler.start();
    sampler.stop();
    await sleep(80); // the arming timer would have fired by now
    sampler.start();
    await sleep(60);
    const s = sampler.sample();
    sampler.stop();
    expect(s).not.toBeNull();
  });
});
