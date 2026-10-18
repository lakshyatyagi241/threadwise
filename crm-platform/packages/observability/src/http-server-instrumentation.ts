import { Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeMonitor } from './runtime-monitor';

/**
 * Times every response of every `http.Server` in the process, for servers that have no middleware chain of their own to hang a timer
 * on (the Next.js server; the API uses an Express middleware instead). It wraps `Server.prototype.emit` and watches the `request` event:
 * the clock starts when the server emits the request and stops when the response finishes or the client goes away, so it measures what
 * the handler took, not time spent queued behind a blocked loop (the probe is the view that includes the queue).
 *
 * `routeOf` turns a request into the label `route`. It MUST return a low-cardinality template, never the raw URL (the histogram folds
 * past 500 series, so a flood of distinct URLs would push the real routes into "overflow"), or null to leave a request unmeasured (the
 * metrics listener's own requests).
 */
export type RouteOf = (req: { method: string; url: string }, statusCode: number) => string | null;

const INSTALLED = Symbol.for('@crm/observability.httpInstrumentation');

type Emit = (this: Server, event: string | symbol, ...args: unknown[]) => boolean;

/** Starts timing. Returns a function that puts `emit` back. A second install on the same process is a no-op returning a no-op. */
export function instrumentHttpRequests(monitor: RuntimeMonitor, routeOf: RouteOf): () => void {
  const proto = Server.prototype as unknown as { emit: Emit; [INSTALLED]?: true };
  if (proto[INSTALLED]) return () => undefined;
  const original = proto.emit;
  proto[INSTALLED] = true;
  proto.emit = function patched(this: Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'request') {
      try {
        const [req, res] = args as [IncomingMessage, ServerResponse];
        if (req && res && typeof res.once === 'function') time(monitor, routeOf, req, res);
      } catch {
        /* observability must never break a request */
      }
    }
    return original.call(this, event, ...args);
  };
  return () => {
    proto.emit = original;
    delete proto[INSTALLED];
  };
}

function time(
  monitor: RuntimeMonitor,
  routeOf: RouteOf,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const startedAt = process.hrtime.bigint();
  let recorded = false;
  // 'close' as well as 'finish': a client that gives up during a stall never gets 'finish', and those are the requests that matter most.
  const record = () => {
    if (recorded) return;
    recorded = true;
    try {
      const status = res.writableFinished ? res.statusCode : 499;
      const route = routeOf({ method: req.method ?? 'GET', url: req.url ?? '/' }, status);
      if (route === null) return;
      const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      monitor.observeHttp(req.method ?? 'GET', route, status, ms);
    } catch {
      /* swallowed on purpose */
    }
  };
  res.once('finish', record);
  res.once('close', record);
}
