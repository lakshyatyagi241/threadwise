'use strict';
// Preload for the regression gate's detection proof (EL-B06): `node -r inject-block.cjs dist/src/main.js` blocks the event loop on
// purpose, so the gate can be shown to FAIL on a real stall in a real API process. Never loaded unless run-load.mjs is given
// --inject-block-ms; nothing in the application knows about it.
//
//   INJECT_BLOCK_MS         how long each block holds the loop (default 300)
//   INJECT_BLOCK_EVERY_MS   how often (default 5000, one reporting window)
//   INJECT_BLOCK_AFTER_MS   quiet time after start before the first block (default 0; run-load starts it with the profile instead)
//
// A block is a busy loop on the main thread: the same shape as a synchronous gunzip or a big JSON.parse, which is what the monitor
// is there to catch. The first block waits for the file at INJECT_BLOCK_GO to exist, so the boot and the seeding are not disturbed.
const { existsSync } = require('node:fs');

const holdMs = Number(process.env.INJECT_BLOCK_MS || 300);
const everyMs = Number(process.env.INJECT_BLOCK_EVERY_MS || 5000);
const goFile = process.env.INJECT_BLOCK_GO;

const timer = setInterval(() => {
  if (goFile && !existsSync(goFile)) return;
  const end = Date.now() + holdMs;
  while (Date.now() < end) {
    /* hold the loop */
  }
}, everyMs);
timer.unref();
