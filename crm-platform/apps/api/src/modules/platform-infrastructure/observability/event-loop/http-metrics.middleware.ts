import type { NextFunction, Request, Response } from 'express';
import type { RuntimeMonitor } from '@crm/observability';

/**
 * Times every response and hands the monitor method, route TEMPLATE and status. The template (`/contacts/:id`) comes from
 * Express after routing; a request that matched no route is `unmatched`, so scanners probing random URLs cannot create series.
 * Add it before the routes so it sees every request, including those a guard rejects.
 */
export function httpMetricsMiddleware(monitor: RuntimeMonitor) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    // 'close' as well as 'finish': a client that gives up during a stall never gets 'finish', and those are the requests that matter most.
    const record = () => {
      if (recorded) return;
      recorded = true;
      const route = (req.route as { path?: unknown } | undefined)?.path;
      const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
      const template = typeof route === 'string' ? `${base}${route}` : 'unmatched';
      const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      // A response that never finished was abandoned by the client (nginx's 499): not a 2xx.
      monitor.observeHttp(req.method, template, res.writableFinished ? res.statusCode : 499, ms);
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  };
}
