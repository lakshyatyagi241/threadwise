import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Paths a probe or the platform calls every few seconds: they do not count as work to wait for. */
export const PROBE_PATH = /^\/(health|ready|metrics)(\/|$|\?)/;

/**
 * Traefik asks `/ready` every 10 s and waits up to 3 s for the answer (deploy/hostinger/traefik-desk.yml.template), so a container that
 * has started to leave is still sent traffic for up to this long after it begins answering 503.
 */
export const PROBE_GRACE_MS = 13_000;
/** The longest a shutdown waits for running requests. Under the 30 s `stop_grace_period` of the API containers, which kills it. */
export const DRAIN_MAX_MS = 25_000;
const POLL_MS = 100;

/**
 * How many requests this process is serving, and whether it has begun to leave. Installed by `main.ts` only (`middleware()` marks it
 * installed), so a test application that never installs it shuts down at once.
 */
export class InflightTracker {
  active = 0;
  draining = false;
  installed = false;

  /** Counts every request that is not a probe; released on `close`, which fires after a finished response and after an aborted one. */
  middleware(): RequestHandler {
    this.installed = true;
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!PROBE_PATH.test(req.url)) {
        this.active++;
        res.once('close', () => {
          this.active--;
        });
      }
      next();
    };
  }
}

export const inflight = new InflightTracker();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lets running HTTP requests finish before the database goes away. Nest destroys every open connection while it closes the HTTP
 * server and closes the database pools right after, so a handler still running at that moment (a WhatsApp webhook, say) lost its
 * client and then failed with "Cannot use a pool after calling end on the pool": the provider saw a failed delivery and the message
 * depended on its retry. `onModuleDestroy` runs before both, so the wait goes here, the same place `WorkerDrainService` drains jobs.
 *
 * Two steps: answer 503 on `/ready` so the proxy stops sending new requests, keep serving until it has had time to notice, then wait
 * for what is still running, up to a cap.
 */
@Injectable()
export class HttpDrainService implements OnModuleDestroy {
  private readonly logger = new Logger(HttpDrainService.name);

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  /** Returns how many requests were still running when it stopped waiting (0 = all finished). */
  async drain(
    tracker: InflightTracker = inflight,
    o: { graceMs?: number; maxMs?: number; pollMs?: number } = {},
  ): Promise<number> {
    if (!tracker.installed) return 0;
    const { graceMs = PROBE_GRACE_MS, maxMs = DRAIN_MAX_MS, pollMs = POLL_MS } = o;
    tracker.draining = true;
    const started = Date.now();
    await sleep(Math.min(graceMs, maxMs));
    while (tracker.active > 0 && Date.now() - started < maxMs) await sleep(pollMs);
    const left = tracker.active;
    if (left > 0) this.logger.warn({ left, waitedMs: Date.now() - started }, 'http drain gave up');
    else
      this.logger.log({ waitedMs: Date.now() - started }, 'http requests drained before shutdown');
    return left;
  }
}
