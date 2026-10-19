import { createServer, connect, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A TCP proxy that sits in front of a real service (Postgres, Redis) or in front of nothing, and fails on command. It is how the
 * dependency-outage tests break a connection without touching the shared containers: the client under test is pointed at the proxy,
 * never at the service. Only ever listens on 127.0.0.1.
 *
 *   pass      forwards bytes both ways (needs an upstream)
 *   refuse    the listening socket is closed: connecting is refused straight away
 *   reset     accepts, then destroys the connection with no byte exchanged
 *   blackhole accepts and swallows everything, never answers (a firewall that drops packets); existing connections go silent like stall
 *   stall     keeps connections open but stops forwarding, holding the bytes (a half-dead link); new connections open but never finish
 *
 * `setMode` applies to connections that already exist too: switching to `reset` or `refuse` kills them, `blackhole` and `stall`
 * freeze them, `pass` lets frozen ones flow again.
 */
export type ProxyMode = 'pass' | 'refuse' | 'reset' | 'blackhole' | 'stall';

export interface TcpFaultProxy {
  readonly port: number;
  readonly host: '127.0.0.1';
  setMode(mode: ProxyMode): Promise<void>;
  /** Client-side sockets open right now (a leak check). */
  open(): number;
  /** Connections accepted since the start. */
  accepted(): number;
  close(): Promise<void>;
}

export async function startTcpFaultProxy(
  upstream?: { host: string; port: number },
  initial: ProxyMode = 'pass',
  fixedPort?: number,
): Promise<TcpFaultProxy> {
  let mode: ProxyMode = initial;
  let accepted = 0;
  const pairs = new Set<{
    client: Socket;
    up: Socket | null;
    heldUp: Buffer[];
    heldDown: Buffer[];
  }>();
  let server: Server | null = null;
  let port = fixedPort ?? 0;

  const onConnection = (client: Socket) => {
    accepted++;
    if (mode === 'reset') return void client.destroy();
    const pair = {
      client,
      up: null as Socket | null,
      heldUp: [] as Buffer[],
      heldDown: [] as Buffer[],
    };
    pairs.add(pair);
    client.on('error', () => undefined);
    client.on('close', () => {
      pairs.delete(pair);
      pair.up?.destroy();
    });
    if (mode === 'blackhole') return void client.resume();
    if (!upstream) return void client.resume();
    const up = connect(upstream.port, upstream.host);
    pair.up = up;
    up.on('error', () => client.destroy());
    up.on('close', () => client.destroy());
    // Bytes that arrive while the link is stalled or black-holed are held, not dropped: TCP never loses bytes on a live connection, it
    // delivers them late or breaks the connection, and a client's reply matching depends on that.
    client.on('data', (b: Buffer) => (mode === 'pass' ? up.write(b) : pair.heldUp.push(b)));
    up.on('data', (b: Buffer) => (mode === 'pass' ? client.write(b) : pair.heldDown.push(b)));
  };

  const listen = async () => {
    const s = createServer(onConnection);
    await new Promise<void>((ok, bad) => {
      s.once('error', bad);
      s.listen(port, '127.0.0.1', ok);
    });
    port = (s.address() as AddressInfo).port;
    server = s;
  };
  const unlisten = async () => {
    const s = server;
    server = null;
    if (s) await new Promise<void>((ok) => s.close(() => ok()));
  };
  const killAll = () => {
    for (const p of pairs) {
      p.client.destroy();
      p.up?.destroy();
    }
    pairs.clear();
  };
  const thaw = () => {
    for (const p of pairs) {
      for (const b of p.heldUp.splice(0)) p.up?.write(b);
      for (const b of p.heldDown.splice(0)) p.client.write(b);
    }
  };

  if (initial !== 'refuse') await listen();
  else {
    // Reserve a free port, then give it back: connecting to it is refused.
    await listen();
    await unlisten();
  }

  return {
    get port() {
      return port;
    },
    host: '127.0.0.1',
    open: () => pairs.size,
    accepted: () => accepted,
    async setMode(next) {
      mode = next;
      if (next === 'refuse') {
        // Connections first: server.close() waits for them, so closing the listener first would never return.
        killAll();
        await unlisten();
        return;
      }
      if (!server) await listen();
      if (next === 'reset') killAll();
      if (next === 'pass') thaw();
    },
    async close() {
      killAll();
      await unlisten();
    },
  };
}
