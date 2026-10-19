import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * The hardest outage for a client is the one where the connection WORKED and then the other side went silent (a dropped route, a
 * frozen host, a firewall that drops packets): no error ever arrives, so only a client-side deadline ends the wait. These two fakes
 * speak just enough of the Postgres and Redis protocols to get a client connected and ready, then never answer another request.
 * They need no database or Redis, so the tests that use them run anywhere. Only ever listen on 127.0.0.1.
 */
export interface FrozenBackend {
  port: number;
  /** Connections open right now. */
  open(): number;
  /** Requests received after the handshake (what the client sent into the void). */
  swallowed(): number;
  close(): Promise<void>;
}

async function listen(
  onConn: (s: Socket) => void,
): Promise<{ server: Server; sockets: Set<Socket>; port: number }> {
  const sockets = new Set<Socket>();
  const server = createServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => undefined);
    onConn(s);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, sockets, port: (server.address() as AddressInfo).port };
}

const closer = (server: Server, sockets: Set<Socket>) => () =>
  new Promise<void>((ok) => {
    for (const s of sockets) s.destroy();
    server.close(() => ok());
  });

/**
 * Postgres: answers the startup message (no password asked) and then, by default, ignores every query. With `onQuery: 'reset'` it
 * drops the connection at the first query instead: a server that was restarted under a pooled connection.
 */
export async function startFrozenPostgres(
  onQuery: 'swallow' | 'reset' = 'swallow',
): Promise<FrozenBackend> {
  let swallowed = 0;
  const { server, sockets, port } = await listen((s) => {
    let started = false;
    s.on('data', (b: Buffer) => {
      if (!started) {
        // SSLRequest (code 80877103): "no SSL", the client then sends the real startup message.
        if (b.length === 8 && b.readInt32BE(4) === 80877103) return void s.write('N');
        started = true;
        // AuthenticationOk, then ReadyForQuery (idle).
        s.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
        return;
      }
      swallowed++;
      if (onQuery === 'reset') s.destroy();
    });
  });
  return {
    port,
    open: () => sockets.size,
    swallowed: () => swallowed,
    close: closer(server, sockets),
  };
}

/** Redis: answers the handshake commands (INFO for the ready check, SELECT, CLIENT) and then ignores everything else. */
export async function startFrozenRedis(): Promise<FrozenBackend> {
  let swallowed = 0;
  const { server, sockets, port } = await listen((s) => {
    s.on('data', (b: Buffer) => {
      // One chunk can carry several pipelined commands; each gets its own reply.
      for (const m of b.toString('latin1').matchAll(/\*\d+\r\n\$\d+\r\n([A-Za-z]+)\r\n/g)) {
        const name = m[1]!.toUpperCase();
        if (name === 'INFO') {
          const body = '# Server\r\nredis_version:7.2.0\r\nloading:0\r\nrole:master\r\n';
          s.write(`$${body.length}\r\n${body}\r\n`);
        } else if (['SELECT', 'CLIENT', 'AUTH', 'HELLO'].includes(name)) s.write('+OK\r\n');
        else swallowed++;
      }
    });
  });
  return {
    port,
    open: () => sockets.size,
    swallowed: () => swallowed,
    close: closer(server, sockets),
  };
}
