/** The slice of a BullMQ `Worker` the guard uses. Structural, so it is testable without Redis. */
export interface GuardableWorker {
  /** The queue name. */
  name: string;
  on(event: 'error', listener: (err: Error) => void): unknown;
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): Promise<void> | void;
}

interface GuardLog {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const OOM = /OOM command not allowed/;

/**
 * A full Redis (`maxmemory` reached, `noeviction`) refuses the script a worker uses to take its next job. BullMQ treats that as a
 * script error, not a connection error, so it asks again at once: measured, about 2,000 error lines and 0.7 of a CPU core a second for
 * ONE idle worker, and this process runs one worker per queue. The loop never ends until memory is freed, and nothing frees it because
 * trimming finished jobs needs a worker to finish one.
 *
 * On that one error the worker is paused for `pauseMs` and then resumed (and paused again if the server is still full): a few polls a
 * minute instead of thousands a second, the logs stay readable, and the workers pick up by themselves once memory is back. Every other
 * error is logged here, because having a listener stops BullMQ printing it.
 */
export function guardWorkerAgainstOom(
  worker: GuardableWorker,
  opts: { pauseMs?: number; log: GuardLog },
): void {
  const pauseMs = opts.pauseMs ?? 5_000;
  let paused = false;
  worker.on('error', (err) => {
    if (!OOM.test(String(err?.message))) {
      opts.log.error({ err, queue: worker.name }, 'queue worker error');
      return;
    }
    if (paused) return; // one pause per burst: BullMQ emits the error thousands of times a second
    paused = true;
    opts.log.warn(
      { queue: worker.name, pauseMs },
      'Redis is at maxmemory: queue worker paused until memory is freed',
    );
    void worker
      .pause(true)
      .catch(() => undefined)
      .then(() => {
        setTimeout(() => {
          paused = false;
          void Promise.resolve(worker.resume()).catch(() => undefined);
        }, pauseMs).unref();
      });
  });
}
