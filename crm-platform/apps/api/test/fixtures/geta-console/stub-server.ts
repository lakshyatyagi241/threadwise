import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Geta console, for tests. It records every request exactly as it arrived (method, path, headers, the raw
 * body bytes) and answers from a programmable queue per route. Every value used with it is obviously fake: the real console is
 * never called by a test.
 */
export interface StubRequest {
  seq: number;
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  /** The body decoded as UTF-8 text. */
  body: string;
}

export interface StubAnswer {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  /** Hold the answer for this long (a slow console). */
  delayMs?: number;
}

export type Route = 'update' | 'publish';

const routeOf = (method: string, path: string): Route | null => {
  if (method === 'PUT' && /^\/api\/v1\/chatbot\/[^/]+\/configuration\/update\/$/.test(path))
    return 'update';
  if (method === 'POST' && path === '/api/v1/console/publish-bot') return 'publish';
  return null;
};

export class GetaConsoleStub {
  readonly requests: StubRequest[] = [];
  private readonly queues: Record<Route, StubAnswer[]> = { update: [], publish: [] };
  private readonly defaults: Record<Route, StubAnswer> = {
    update: { status: 200, body: '{"ok":true}' },
    publish: { status: 200, body: '{"ok":true}' },
  };
  private server: Server | null = null;
  private seq = 0;

  /** Answers the next call(s) of a route with these, then goes back to the default. */
  enqueue(route: Route, ...answers: StubAnswer[]): void {
    this.queues[route].push(...answers);
  }

  /** Changes what a route answers once its queue is empty. */
  setDefault(route: Route, answer: StubAnswer): void {
    this.defaults[route] = answer;
  }

  reset(): void {
    this.requests.length = 0;
    this.queues.update.length = 0;
    this.queues.publish.length = 0;
    this.defaults.update = { status: 200, body: '{"ok":true}' };
    this.defaults.publish = { status: 200, body: '{"ok":true}' };
  }

  calls(route: Route): StubRequest[] {
    return this.requests.filter((r) => routeOf(r.method, r.path) === route);
  }

  get url(): string {
    const port = (this.server!.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const method = req.method ?? '';
        const path = req.url ?? '';
        this.requests.push({
          seq: ++this.seq,
          method,
          path,
          headers: req.headers,
          rawBody,
          body: rawBody.toString('utf8'),
        });
        const route = routeOf(method, path);
        if (!route) {
          res
            .writeHead(404, { 'content-type': 'application/json' })
            .end('{"detail":"no such route"}');
          return;
        }
        const answer = this.queues[route].shift() ?? this.defaults[route];
        setTimeout(() => {
          res
            .writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers })
            .end(answer.body ?? '');
        }, answer.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return this;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }
}
