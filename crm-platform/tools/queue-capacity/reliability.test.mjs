// Run: node --test tools/queue-capacity/reliability.test.mjs
// Proves the queue reliability ratchet passes on the repo and FAILS on each kind of bad example.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, load, parseProcessors, parseQueues, scanEnqueues } from './reliability.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the repo passes', () => assert.deepEqual(check(load(ROOT)), []));

const QUEUES_TS = `export const QUEUES = {
  /** a */
  ALPHA: 'alpha',
  BETA_TWO: 'beta-two',
  GAMMA: 'gamma',
} as const;`;

const producer = (extra) => ({
  path: 'modules/x/x.service.ts',
  text: `
    class X {
      constructor(@InjectQueue(QUEUES.ALPHA) private readonly alpha: Queue,
                  @InjectQueue(QUEUES.BETA_TWO) private readonly beta: Queue) {}
      run() {
        ${extra}
      }
    }`,
});

test('queues are read from queues.ts, processors from @Processor', () => {
  assert.deepEqual(parseQueues(QUEUES_TS), {
    ALPHA: 'alpha',
    BETA_TWO: 'beta-two',
    GAMMA: 'gamma',
  });
  const p = parseProcessors([
    { path: 'a.ts', text: '@Processor(QUEUES.ALPHA, { concurrency: 2 }) class P {}' },
  ]);
  assert.deepEqual([...p], ['ALPHA']);
});

test('enqueue sites are found with their jobId and inline overrides', () => {
  const sites = scanEnqueues([
    producer(`
      this.alpha.add('a', {}, { jobId: 'x' });
      this.alpha.add('b', {}, { jobId: 'y', attempts: 1, removeOnComplete: true });
      this.beta.addBulk([{ name: 'c', data: {} }]);
      this.other.add('ignored', {});`),
  ]);
  assert.equal(sites.length, 3);
  assert.deepEqual(
    sites.map((s) => [s.queue, s.jobId, s.overrides]),
    [
      ['ALPHA', true, []],
      ['ALPHA', true, ['attempts', 'removeOnComplete']],
      ['BETA_TWO', false, []],
    ],
  );
});

// a clean world: three queues, two with a consumer, one scheduled elsewhere
function world(over = {}) {
  const queues = parseQueues(QUEUES_TS);
  const sites = scanEnqueues([
    producer(`this.alpha.add('a', {}, { jobId: 'x' }); this.beta.add('b', {}, { jobId: 'y' });`),
  ]);
  const registry = {
    overrides: {},
    noJobId: [],
    idempotency: {
      ALPHA: { status: 'documented', file: 'a.ts', quote: 'Idempotent: a repeat is skipped' },
      BETA_TWO: { status: 'not-demonstrated' },
      GAMMA: { status: 'no-consumer' },
    },
  };
  return {
    queues,
    sites,
    processors: new Set(['ALPHA', 'BETA_TWO']),
    registry,
    fileText: (p) =>
      p === 'a.ts' ? '/** Idempotent:\n * a repeat is skipped by the insert. */' : undefined,
    ...over,
  };
}

test('a clean example passes', () => assert.deepEqual(check(world()), []));

test('fails: a producer overrides retry or retention and the queue has no written reason', () => {
  const w = world({
    sites: scanEnqueues([producer(`this.alpha.add('a', {}, { jobId: 'x', attempts: 1 });`)]),
  });
  assert.match(
    check(w).join('\n'),
    /ALPHA: a producer overrides attempts inline and the queue has no written reason/,
  );
  w.registry.overrides = { ALPHA: 'one attempt: a repeat would message the customer twice' };
  assert.deepEqual(check(w), []);
});

test('fails: a written reason for an override that no longer exists', () => {
  const w = world();
  w.registry.overrides = { BETA_TWO: 'old reason' };
  assert.match(
    check(w).join('\n'),
    /overrides: BETA_TWO has a reason but no producer overrides anything/,
  );
});

test('fails: an enqueue without a jobId and no reason', () => {
  const w = world({ sites: scanEnqueues([producer(`this.alpha.add('a', {});`)]) });
  assert.match(
    check(w).join('\n'),
    /ALPHA: modules\/x\/x.service.ts:\d+ enqueues without a jobId and has no reason/,
  );
  w.registry.noJobId = [
    { queue: 'ALPHA', file: 'modules/x/x.service.ts', reason: 'deduplicated by a replay key' },
  ];
  assert.deepEqual(check(w), []);
});

test('fails: a noJobId reason for a site that now has a jobId', () => {
  const w = world();
  w.registry.noJobId = [{ queue: 'ALPHA', file: 'modules/x/x.service.ts', reason: 'stale' }];
  assert.match(
    check(w).join('\n'),
    /noJobId: ALPHA in modules\/x\/x.service.ts no longer enqueues without a jobId/,
  );
});

test('fails: a queue with no idempotency entry, and an entry for a queue that is gone', () => {
  const w = world();
  delete w.registry.idempotency.BETA_TWO;
  w.registry.idempotency.GONE = { status: 'not-demonstrated' };
  const out = check(w).join('\n');
  assert.match(out, /BETA_TWO: no entry in "idempotency"/);
  assert.match(out, /idempotency: GONE is not a queue in queues.ts/);
});

test('fails: the quote that proves a documented queue is no longer in its file', () => {
  const w = world({ fileText: () => '/** nothing about repeats here */' });
  assert.match(
    check(w).join('\n'),
    /ALPHA: the quote "Idempotent: a repeat is skipped" is no longer in a.ts/,
  );
});

test('fails: documented without a quote, an unknown status, and a consumer mismatch', () => {
  const w = world();
  w.registry.idempotency.ALPHA = { status: 'documented' };
  w.registry.idempotency.BETA_TWO = { status: 'sure' };
  w.processors.add('GAMMA'); // GAMMA now has a consumer, so no-consumer is wrong
  const out = check(w).join('\n');
  assert.match(out, /ALPHA: documented needs a file and a quote/);
  assert.match(out, /BETA_TWO: idempotency status "sure"/);
  assert.match(out, /GAMMA: marked no-consumer but has a @Processor/);
});

test('fails: a queue without a @Processor that is not marked no-consumer', () => {
  const w = world({ processors: new Set(['ALPHA']) });
  assert.match(
    check(w).join('\n'),
    /BETA_TWO: has no @Processor, so it must be marked no-consumer/,
  );
});
