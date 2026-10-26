import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '@crm/contracts';

/** Paths a probe or the platform calls: never shed, so a busy API still answers "alive" and "ready" (and is not restarted for being busy). */
const EXEMPT = /^\/(health|ready|metrics)(\/|$|\?)/;

/**
 * Load shedding (QA 54): at most `max` requests are in flight; the next one is refused at once with 503 and `Retry-After`, instead of joining
 * a queue that grows without bound. Measured on one box, an unguarded API held 160 requests/s at p95 470 ms, and at 240 requests/s every
 * request waited seconds and 248 of 3,600 failed as dropped connections: no answer, so a client cannot back off. A refused request costs
 * microseconds, keeps the event loop free for the ones already running, and tells the caller to retry (a provider webhook is retried by its
 * sender; a browser shows a busy message).
 *
 * The count is released once per request, on `close` (it fires after `finish` and after an aborted connection), so a client that hangs up
 * cannot leak a slot. 0 turns the guard off.
 */
export function overloadGuard(max: number): RequestHandler {
  let inFlight = 0;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (max <= 0 || EXEMPT.test(req.url)) return next();
    if (inFlight >= max) {
      res
        .status(503)
        .setHeader('Retry-After', '1')
        .type('application/problem+json')
        .send({
          type: `https://errors.crm.platform/${ERROR_CODES.SERVICE_UNAVAILABLE.toLowerCase()}`,
          title: 'Service Unavailable',
          status: 503,
          detail: 'The server is busy. Retry in a moment.',
          instance: req.originalUrl,
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
        });
      return;
    }
    inFlight++;
    let released = false;
    res.once('close', () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    });
    next();
  };
}
