import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * A local server that misbehaves on purpose, for testing what a client does when the network or the other side fails.
 * Only ever listens on 127.0.0.1.
 */
export type Fault =
  | 'ok' // 200 {"ok":true}
  | 'status500'
  | 'status503-retry-after'
  | 'badjson' // 200 with a body that is not JSON
  | 'empty200' // 200 with no body
  | 'reset' // accepts, then drops the connection without a response
  | 'hang' // accepts, never answers
  | 'headers-then-hang' // 200 and part of a body, then silence
  | 'truncated' // promises 1000 bytes, sends 11, closes
  | 'drip' // 200 then one byte every 50 ms for a long time (slow-loris response)
  | 'huge'; // streams far more than any cap, fast

export interface FaultServer {
  url: string;
  port: number;
  close(): Promise<void>;
  /** Sockets still open right now (a leak check). */
  open(): number;
  hits(): number;
}

export async function startFaultServer(fault: Fault): Promise<FaultServer> {
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits++;
    req.resume();
    switch (fault) {
      case 'ok':
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      case 'status500':
        res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}');
        return;
      case 'status503-retry-after':
        res.writeHead(503, { 'retry-after': '7' }).end('busy');
        return;
      case 'badjson':
        res.writeHead(200, { 'content-type': 'application/json' }).end('<html>not json');
        return;
      case 'empty200':
        res.writeHead(200).end();
        return;
      case 'reset':
        req.socket.destroy();
        return;
      case 'hang':
        return;
      case 'headers-then-hang':
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
        res.write('{"partial":');
        return;
      case 'truncated':
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
        res.write('{"partial":');
        setTimeout(() => req.socket.destroy(), 20);
        return;
      case 'drip': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const t = setInterval(() => {
          if (res.destroyed) return clearInterval(t);
          res.write('x');
        }, 50);
        timers.add(t);
        res.on('close', () => clearInterval(t));
        return;
      }
      case 'huge': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        const chunk = Buffer.alloc(64 * 1024, 120);
        let sent = 0;
        const pump = () => {
          while (!res.destroyed && sent < 512 * 1024 * 1024) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once('drain', pump);
          }
          if (!res.destroyed) res.end();
        };
        pump();
        return;
      }
    }
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    open: () => sockets.size,
    hits: () => hits,
    close: () =>
      new Promise<void>((ok) => {
        for (const t of timers) clearInterval(t);
        for (const s of sockets) s.destroy();
        server.close(() => ok());
      }),
  };
}

/** A port that nothing listens on: connecting is refused straight away. */
export async function closedPortUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return `http://127.0.0.1:${port}/`;
}

/** Runs `fn` and says how long it took and whether it threw. */
export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value?: T; error?: unknown }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - t0, value };
  } catch (error) {
    return { ms: performance.now() - t0, error };
  }
}

/** Resolves true as soon as `cond` is true, or false after `ms`. */
export async function until(cond: () => boolean, ms = 1500): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}
