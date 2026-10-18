import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export interface MetricsServerOptions {
  port: number;
  host: string;
  /** When set, `GET /metrics` needs `Authorization: Bearer <token>`. */
  token?: string;
  render: () => string;
  log?: (line: Record<string, unknown>) => void;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer /i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * The scrape endpoint, on its own listener and port rather than an API route: it exists in the worker too (which has no HTTP
 * server), it never passes through the API's guards, throttle or tenant context, and it is not reachable through the public
 * ingress. Only `GET /metrics` answers; everything else is 404. A bind failure is logged and ignored.
 */
export function startMetricsServer(opts: MetricsServerOptions): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    if (opts.token && !tokenMatches(req.headers.authorization, opts.token)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
      return;
    }
    try {
      res
        .writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
        .end(opts.render());
    } catch {
      res.writeHead(500).end();
    }
  });
  server.on('error', (err) =>
    opts.log?.({ level: 40, msg: 'metrics server error', err: err.message }),
  );
  server.listen(opts.port, opts.host);
  server.unref();
  return server;
}
