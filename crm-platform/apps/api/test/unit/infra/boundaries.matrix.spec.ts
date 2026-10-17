import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUEUES, DEFAULT_JOB_OPTIONS, jobOptionsFor } from '../../../src/infra/queue/queues';

/**
 * Boundary matrices (QA task 7), the parts that need no database: they read the source and check that the pieces at the
 * edges of the system are wired to each other. They run in the unit suite and fail the day someone adds a queue nobody
 * consumes, or a subscriber that is never registered.
 *
 *  - Queues: every name in QUEUES is a unique kebab-case string, has a consumer (a @Processor or a Worker) and a producer.
 *  - Outbox subscribers: every class that declares `eventTypes` registers itself with OutboxSubscriberRegistry, has a stable
 *    `name` that no other subscriber uses (the registry silently ignores a second subscriber with a name it already has),
 *    and listens for at least one event type.
 *  - Job options: the defaults give every queue retries with backoff and bounded history.
 *
 * The runtime halves (a job really is retried, an event really reaches its subscriber) need Redis and Postgres and live in
 * test/integration.
 */
const SRC = resolve(__dirname, '../../../src');
const AUDIT = readFileSync(
  resolve(__dirname, '../../../../../docs/quality/idempotency-audit.md'),
  'utf8',
);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.ts') && !n.endsWith('.spec.ts') && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({
  path,
  rel: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));
const queueEntries = Object.entries(QUEUES) as Array<[string, string]>;

/**
 * Names reserved in QUEUES that no code uses as a BullMQ queue today. The work is either done by an @Interval service
 * (the outbox drain, partition maintenance, the SLA sweep) or not built yet (billing posting, counter flush, bulk jobs).
 * Listing them here keeps the matrix strict for every other queue. The list only shrinks: a reserved queue that gains a
 * consumer and a producer fails "is still unused" until it is taken off, and a new unused queue fails its own rows.
 */
const RESERVED: Record<string, string> = {
  OUTBOX: 'drained by workers/outbox-drain.service.ts on an @Interval, not through BullMQ',
  BILLING_POSTING: 'not built: wallet charges are settled per message by the billing engine',
  SLA_SWEEP: 'run by team-inbox-routing-sla/sla-sweep.service.ts on a schedule',
  COUNTER_FLUSH: 'not built',
  PARTITION_MAINTENANCE: 'run by workers/partition-maintenance.service.ts on a schedule',
  BULK_JOBS:
    'not built: imports and exports have their own queues (con-import, msg-log-export, ...)',
};

/** Files other than the queue definitions that mention a queue through its key or its literal name. */
function mentions(key: string, name: string) {
  const byKey = new RegExp(`QUEUES\\.${key}\\b`);
  const byName = new RegExp(`['"\`]${name}['"\`]`);
  return FILES.filter(
    (f) => f.rel !== 'infra/queue/queues.ts' && (byKey.test(f.text) || byName.test(f.text)),
  );
}

describe('queues', () => {
  it('has at least thirty queues, so a failed import of the list is not a silent pass', () => {
    expect(queueEntries.length).toBeGreaterThan(30);
  });

  it('gives every queue a distinct name', () => {
    const names = queueEntries.map(([, v]) => v);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  describe.each(queueEntries)('%s (%s)', (key, name) => {
    const consumers = () =>
      mentions(key, name).filter((f) =>
        /@Processor\(|new Worker\(|extends WorkerHost/.test(f.text),
      );
    const producers = () =>
      mentions(key, name).filter((f) =>
        /@InjectQueue\(|\.add\(|getQueue\(|new Queue\(|enqueue/i.test(f.text),
      );

    it('is a lower-case kebab-case name', () => {
      expect(name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    });
    if (key in RESERVED) {
      it(`is reserved and still unused (${RESERVED[key]})`, () => {
        expect(
          consumers().length + producers().length,
          `${key} is used now: take it off RESERVED`,
        ).toBe(0);
      });
    } else {
      it('has a consumer: a @Processor or a Worker that names it', () => {
        expect(
          consumers().map((f) => f.rel),
          `no processor or worker mentions ${key}`,
        ).not.toEqual([]);
      });
      it('has a producer: something that adds jobs or injects the queue', () => {
        expect(
          producers().map((f) => f.rel),
          `nothing enqueues to ${key}`,
        ).not.toEqual([]);
      });
    }
  });

  it('only reserves names that exist in QUEUES', () => {
    expect(Object.keys(RESERVED).filter((k) => !(k in QUEUES))).toEqual([]);
  });
});

describe('default job options', () => {
  it('retry with exponential backoff, and keep bounded history', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThan(1);
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBeGreaterThan(0);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toMatchObject({
      count: expect.any(Number),
      age: expect.any(Number),
    });
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toMatchObject({
      count: expect.any(Number),
      age: expect.any(Number),
    });
  });

  it('keeps Redis history small: an hour of completions, three days of failures', () => {
    // Redis runs as a small noeviction instance and every queue keeps its own history (cost hygiene, event-based analytics plan B7).
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete.count).toBeLessThanOrEqual(1_000);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete.age).toBeLessThanOrEqual(3_600);
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.count).toBeLessThanOrEqual(2_000);
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.age).toBeLessThanOrEqual(3 * 24 * 3_600);
  });

  it('drops a completed job at once on the queues that carry message text, phone numbers or raw webhook bodies', () => {
    for (const queue of [QUEUES.WABA_INGEST, QUEUES.WEBHOOK_FORWARD]) {
      expect(jobOptionsFor(queue).removeOnComplete, queue).toBe(true);
      // Failures stay, bounded, so a dead job can still be debugged.
      expect(jobOptionsFor(queue).removeOnFail, queue).toEqual(DEFAULT_JOB_OPTIONS.removeOnFail);
      expect(jobOptionsFor(queue).attempts, queue).toBe(DEFAULT_JOB_OPTIONS.attempts);
    }
  });

  it('gives every other queue exactly the defaults', () => {
    for (const queue of Object.values(QUEUES)) {
      if (queue === QUEUES.WABA_INGEST || queue === QUEUES.WEBHOOK_FORWARD) continue;
      expect(jobOptionsFor(queue), queue).toEqual(DEFAULT_JOB_OPTIONS);
    }
  });
});

const subscribers = FILES.filter(
  (f) => /\breadonly eventTypes\b/.test(f.text) && /implements[^{]*OutboxSubscriber/.test(f.text),
).flatMap((f) => {
  // A file can hold more than one subscriber (commerce-resume.ts has two): one record per `readonly name = '...'`.
  const names = [...f.text.matchAll(/readonly name\s*=\s*'([^']+)'/g)].map((m) => m[1]!);
  return names.map((name) => ({ rel: f.rel, text: f.text, name }));
});

describe('outbox subscribers', () => {
  it('finds the subscribers (at least forty), so a changed convention cannot make this matrix empty', () => {
    expect(subscribers.length).toBeGreaterThanOrEqual(40);
  });

  it('gives every subscriber a name no other subscriber uses', () => {
    const names = subscribers.map((s) => s.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  describe.each(subscribers.map((s) => [s.name, s.rel, s.text] as const))(
    '%s (%s)',
    (_name, rel, text) => {
      it('registers itself with the registry', () => {
        expect(text, `${rel} never calls registry.register(this)`).toMatch(
          /registry\.register\(\s*(this|new )/,
        );
      });
      it('listens for at least one event type', () => {
        expect(text).toMatch(
          /readonly eventTypes\s*(:[^=]+)?=\s*(\[[^\]]*\S[^\]]*\]|[A-Za-z_][A-Za-z0-9_.()]*)/,
        );
      });
      it('says how a redelivered event is harmless: in its own comment, or in docs/quality/idempotency-audit.md', () => {
        const own =
          /idempoten|dedupe|redeliver|at[- ]least[- ]once|a repeat|twice|harmless|jobId/i.test(
            text,
          );
        const base = rel.split('/').pop()!;
        expect(
          own || AUDIT.includes(base),
          `${rel} is neither explained in the file nor listed in the audit; see docs/adr/0029-idempotency.md`,
        ).toBe(true);
      });
    },
  );
});
