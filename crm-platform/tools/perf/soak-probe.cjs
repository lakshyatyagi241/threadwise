// Script-only preload for soak.mjs (node -r). NOT imported by the app and not shipped: it answers IPC messages from the soak
// harness with memory numbers, forces a GC (needs --expose-gc) and writes heap snapshots.
const v8 = require('node:v8');
const { monitorEventLoopDelay } = require('node:perf_hooks');
if (typeof process.send === 'function') {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  process.on('message', (m) => {
    if (!m || m.soak !== true) return;
    if (m.gc && typeof global.gc === 'function') global.gc();
    if (m.snapshot) v8.writeHeapSnapshot(m.snapshot);
    const mu = process.memoryUsage();
    const hs = v8.getHeapStatistics();
    process.send({
      soak: 'sample', id: m.id, rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal, external: mu.external,
      arrayBuffers: mu.arrayBuffers, mallocedMemory: hs.malloced_memory, handles: process._getActiveHandles().length,
      requests: process._getActiveRequests().length, lagP99Ms: h.percentile(99) / 1e6, lagMaxMs: h.max / 1e6,
    });
    h.reset();
  });
}
