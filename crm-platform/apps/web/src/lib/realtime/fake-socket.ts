import type { RealtimeEnvelope } from '@crm/contracts';
import type { SocketFactory, SocketLike, SocketOptions } from './realtime-client';

type Handler = (...args: unknown[]) => void;

/**
 * A socket for tests that behaves like socket.io-client's where the client depends on it: `auth` is a function called on every
 * connection attempt, a handshake the server refuses leaves the socket inactive (no automatic retry), and acknowledgements arrive
 * when the test says so. The test plays the server through `accept`, `refuse`, `drop` and `serverEmit`.
 */
export class FakeSocket implements SocketLike {
  connected = false;
  active = true;
  readonly emitted: Array<{ event: string; args: unknown[] }> = [];
  /** What each connection attempt put in the handshake, in order. */
  readonly handshakes: Array<Record<string, unknown>> = [];
  connectCalls = 0;

  private readonly handlers = new Map<string, Handler[]>();
  private readonly anyHandlers: Array<(event: string, ...args: unknown[]) => void> = [];
  /** Pending `room:join` and `room:leave` acknowledgements, oldest first. */
  private readonly acks: Array<{
    event: string;
    payload: unknown;
    ack: (answer: unknown) => void;
  }> = [];

  constructor(
    readonly url: string,
    private readonly options: SocketOptions,
  ) {}

  on(event: string, handler: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  onAny(handler: (event: string, ...args: unknown[]) => void): void {
    this.anyHandlers.push(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
    const ack = args.at(-1);
    if (typeof ack === 'function') {
      this.acks.push({ event, payload: args[0], ack: ack as (answer: unknown) => void });
    }
  }

  connect(): void {
    this.connectCalls += 1;
    this.options.auth((data) => this.handshakes.push(data));
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.fire('disconnect', 'io client disconnect');
  }

  // --- the test plays the server ------------------------------------------------------------------------------------------

  /** The server accepted the last handshake. */
  accept(): void {
    this.connected = true;
    this.active = true;
    this.fire('connect');
  }

  /** The server's middleware refused the handshake: `connect_error`, and the socket will not retry by itself. */
  refuse(): void {
    this.connected = false;
    this.active = false;
    this.fire('connect_error', new Error('unauthorized'));
  }

  /** The connection was lost. `serverSide` is a disconnect by the server (the socket does not retry); otherwise a transport drop. */
  drop(serverSide = false): void {
    this.connected = false;
    this.active = !serverSide;
    this.fire('disconnect', serverSide ? 'io server disconnect' : 'transport close');
  }

  /** A transport-level connection failure while socket.io is still retrying by itself. */
  transportError(): void {
    this.connected = false;
    this.active = true;
    this.fire('connect_error', new Error('websocket error'));
  }

  serverEmit(event: string, data?: unknown): void {
    for (const h of this.anyHandlers) h(event, data);
    this.fire(event, data);
  }

  /** The server pushes a room event. */
  push(env: Pick<RealtimeEnvelope, 'type' | 'room' | 'seq'> & Partial<RealtimeEnvelope>): void {
    this.serverEmit(env.type, {
      v: 1,
      id: crypto.randomUUID(),
      at: new Date(0).toISOString(),
      payload: {},
      ...env,
    });
  }

  /** Answers the oldest unanswered `room:join` / `room:leave`. */
  answer(response: unknown): void {
    this.acks.shift()?.ack(response);
  }

  /** Every `room:join` the client sent, with its payload. */
  joins(): unknown[] {
    return this.emitted.filter((e) => e.event === 'room:join').map((e) => e.args[0]);
  }
  leaves(): unknown[] {
    return this.emitted.filter((e) => e.event === 'room:leave').map((e) => e.args[0]);
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
}

/** A factory that records every socket it makes. */
export function fakeSocketFactory(): {
  factory: SocketFactory;
  sockets: FakeSocket[];
  last: () => FakeSocket;
} {
  const sockets: FakeSocket[] = [];
  return {
    factory: (url, options) => {
      const socket = new FakeSocket(url, options);
      sockets.push(socket);
      return socket;
    },
    sockets,
    last: () => sockets.at(-1)!,
  };
}
