import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_SYSTEM_EVENTS,
  realtimeEnvelopeSchema,
  realtimeReadySchema,
  realtimeRoomAckSchema,
  realtimeRoomKey,
  type RealtimeEnvelope,
  type RealtimeRoomKey,
  type RealtimeRoomSpec,
} from '@crm/contracts';

export type RealtimeStatus =
  /** Not started (server render, or no realtime URL). */
  | 'idle'
  /** The first connection is being made. */
  | 'connecting'
  | 'connected'
  /** The connection dropped; the client is retrying with a fresh ticket. */
  | 'reconnecting'
  /** The session cannot get a ticket (signed out, expired): the client stopped trying. */
  | 'unauthorized'
  | 'stopped';

export type RoomState = 'idle' | 'joining' | 'joined' | 'denied';

/** Why a room's state should be fetched again. */
export type ResyncReason =
  /** The first connection: whatever the page loaded before the socket was up may be older than it. */
  | 'connect'
  /** A room was just joined: events before the join were not delivered. */
  | 'join'
  /** The connection came back after a drop. */
  | 'reconnect'
  /** An event's sequence number skipped one (or went backwards because the counter restarted). */
  | 'gap'
  /** The tab became visible again after being hidden for a while. */
  | 'foreground'
  /** The server asked for it (permissions changed). */
  | 'server';

export interface ResyncRequest {
  reason: ResyncReason;
  /** `user`, `org`, `conv:<uuid>` or `inbox:<scope>`. */
  room: RealtimeRoomKey;
}

/** The part of a socket.io-client `Socket` the client uses, so tests can stand in a fake. */
export interface SocketLike {
  connected: boolean;
  /** socket.io: whether it will reconnect by itself. False after a refusal by the server's middleware or a server-side disconnect. */
  active: boolean;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  onAny(handler: (event: string, ...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export interface SocketOptions {
  /** Called by the socket on EVERY connection attempt, reconnects included, so each one carries a new ticket. */
  auth: (cb: (data: Record<string, unknown>) => void) => void;
}
export type SocketFactory = (url: string, options: SocketOptions) => SocketLike;

export interface RealtimeClientOptions {
  url: string;
  /** Asks the API for a one-time ticket (through the same-origin proxy). Rejects with an error carrying `status` when refused. */
  mintTicket: () => Promise<string>;
  createSocket: SocketFactory;
  /** Backoff after a failed or dropped connection: from 1 s, doubling, to this cap. */
  maxRetryDelayMs?: number;
}

type Listener = () => void;

interface RoomEntry {
  spec: RealtimeRoomSpec;
  key: RealtimeRoomKey;
  holders: number;
  state: RoomState;
  /** Whether this room was joined before on this client: a re-join is a `reconnect`, the first one a `join`. */
  joinedBefore: boolean;
  retry?: ReturnType<typeof setTimeout>;
}

const SEEN_IDS = 500;

/**
 * The browser's side of realtime, with no framework in it: connection with a ticket, reconnect with a new one, rooms that are
 * joined and re-joined as components come and go, event subscription, and the signal to fetch again when something may have been
 * missed. `RealtimeProvider` is a thin wrapper that owns one of these per signed-in session.
 *
 * Events are a hint, not the truth: the server's database is. So the client never tries to reconstruct a stream; whenever it
 * cannot be sure it saw everything (a reconnect, a join, a skipped sequence number, a server request) it asks its consumers to
 * fetch again through REST, where the permission checks live.
 */
export class RealtimeClient {
  private status: RealtimeStatus = 'idle';
  private socket?: SocketLike;
  private started = false;
  private connectedOnce = false;
  private readySeen = false;
  private retryAttempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private ticketRefused = false;
  /** Server clock minus this tab's clock, from the last `rt.ready`: lets an event's age be measured against the server's time. */
  private clockOffsetMs = 0;
  /** The worst event age seen since the last delivery report, and how many events that covers. */
  private lagMaxMs = 0;
  private lagEvents = 0;

  private readonly rooms = new Map<RealtimeRoomKey, RoomEntry>();
  private readonly lastSeq = new Map<string, number>();
  private readonly seen = new Set<string>();
  private readonly statusListeners = new Set<Listener>();
  private readonly roomListeners = new Map<RealtimeRoomKey, Set<Listener>>();
  private readonly eventHandlers = new Map<string, Set<(e: RealtimeEnvelope) => void>>();
  private readonly resyncHandlers = new Set<(r: ResyncRequest) => void>();

  constructor(private readonly options: RealtimeClientOptions) {}

  // --- connection ------------------------------------------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.ticketRefused = false;
    this.setStatus('connecting');

    const socket = this.options.createSocket(this.options.url, {
      auth: (cb) => this.authenticate(cb),
    });
    this.socket = socket;

    socket.on('connect', () => this.onConnect());
    socket.on('disconnect', () => this.onDisconnect());
    socket.on('connect_error', () => this.onConnectError());
    socket.on(REALTIME_SYSTEM_EVENTS.ready, (data: unknown) => this.onReady(data));
    socket.on(REALTIME_SYSTEM_EVENTS.resync, (data: unknown) => this.onServerResync(data));
    socket.onAny((name, data) => this.onEvent(name, data));
    socket.connect();
  }

  stop(): void {
    this.started = false;
    clearTimeout(this.retryTimer);
    for (const room of this.rooms.values()) clearTimeout(room.retry);
    this.socket?.disconnect();
    this.socket = undefined;
    this.setStatus('stopped');
  }

  /** The page came back to the foreground (or the network returned): reconnect now if down, otherwise check nothing was missed. */
  notifyForeground(): void {
    if (!this.started) return;
    if (
      this.status === 'reconnecting' ||
      (this.status === 'connecting' && !this.socket?.connected)
    ) {
      clearTimeout(this.retryTimer);
      this.retryAttempt = 0;
      this.socket?.connect();
      return;
    }
    if (this.status === 'connected') this.resyncAll('foreground');
  }

  /**
   * Tells the server whether this tab is in front (BL-097): a person with a visible tab gets no closed-tab browser push, because the
   * bell and toast already cover them. Fire and forget, only while connected; the server forgets a silent tab after 35 s, so a visible
   * tab repeats the report (see `useVisibilityReport`).
   */
  reportVisible(visible: boolean): void {
    if (this.status !== 'connected' || !this.socket?.connected) return;
    this.socket.emit(REALTIME_CLIENT_EVENTS.visibility, { visible });
  }

  /**
   * Tells the server how late events have been reaching this tab since the last report (the worst case and how many events): the one
   * number the server cannot see for itself. Fire and forget, only while connected and only if events arrived.
   */
  reportDelivery(): void {
    if (this.status !== 'connected' || !this.socket?.connected || this.lagEvents === 0) return;
    this.socket.emit(REALTIME_CLIENT_EVENTS.deliveryLag, {
      lagMs: Math.min(300_000, Math.round(this.lagMaxMs)),
      events: this.lagEvents,
    });
    this.lagMaxMs = 0;
    this.lagEvents = 0;
  }

  /** An event's age on arrival, against the server's clock. A clock set in the future gives a negative age, which counts as zero. */
  private trackLag(env: RealtimeEnvelope): void {
    const age = Date.now() + this.clockOffsetMs - Date.parse(env.at);
    if (!Number.isFinite(age)) return;
    this.lagMaxMs = Math.max(this.lagMaxMs, Math.max(0, age));
    this.lagEvents += 1;
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  onStatus(listener: Listener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // --- rooms -----------------------------------------------------------------------------------------------------------------

  /**
   * Holds a room open (joined as soon as there is a connection, re-joined after every reconnect) until the returned function is
   * called. Two holders of the same room share one join. The server decides whether the caller may enter; see `getRoomState`.
   */
  join(spec: RealtimeRoomSpec): () => void {
    const key = realtimeRoomKey(spec);
    let entry = this.rooms.get(key);
    if (!entry) {
      entry = { spec, key, holders: 0, state: 'idle', joinedBefore: false };
      this.rooms.set(key, entry);
    }
    entry.holders += 1;
    if (entry.holders === 1) this.requestJoin(entry);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.rooms.get(key);
      if (!current) return;
      current.holders -= 1;
      if (current.holders > 0) return;
      clearTimeout(current.retry);
      this.rooms.delete(key);
      this.lastSeq.delete(key);
      if (this.socket?.connected)
        this.socket.emit(REALTIME_CLIENT_EVENTS.leave, current.spec, () => undefined);
      this.notifyRoom(key);
    };
  }

  getRoomState(key: RealtimeRoomKey): RoomState {
    return this.rooms.get(key)?.state ?? 'idle';
  }

  onRoomState(key: RealtimeRoomKey, listener: Listener): () => void {
    let set = this.roomListeners.get(key);
    if (!set) this.roomListeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.roomListeners.delete(key);
    };
  }

  // --- events ----------------------------------------------------------------------------------------------------------------

  /** Calls `handler` for every event of this type (`'*'` for all). Handlers must tolerate a repeat: delivery is at least once. */
  subscribe(type: string, handler: (event: RealtimeEnvelope) => void): () => void {
    let set = this.eventHandlers.get(type);
    if (!set) this.eventHandlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  /** Calls `handler` whenever something a consumer holds may be stale and should be fetched again. */
  onResync(handler: (request: ResyncRequest) => void): () => void {
    this.resyncHandlers.add(handler);
    return () => this.resyncHandlers.delete(handler);
  }

  // --- socket callbacks ------------------------------------------------------------------------------------------------------

  private authenticate(cb: (data: Record<string, unknown>) => void): void {
    this.options.mintTicket().then(
      (ticket) => cb({ ticket }),
      (err: unknown) => {
        const status = (err as { status?: number } | undefined)?.status;
        // A refused session will not get better by asking again; anything else (network, server restart) will.
        if (status === 401 || status === 403) this.ticketRefused = true;
        // An empty handshake is refused by the server, which is how the failure reaches `connect_error`.
        cb({});
      },
    );
  }

  private onConnect(): void {
    this.retryAttempt = 0;
    this.connectedOnce = true;
    clearTimeout(this.retryTimer);
    this.setStatus('connected');
    // Rooms are re-joined on every connection: the server forgets them when the socket goes.
    for (const room of this.rooms.values()) this.requestJoin(room);
  }

  private onDisconnect(): void {
    if (!this.started) return;
    this.setStatus('reconnecting');
    for (const room of this.rooms.values()) {
      clearTimeout(room.retry);
      if (room.state !== 'denied') room.state = 'joining';
      this.notifyRoom(room.key);
    }
    // socket.io reconnects by itself after a transport drop; after a server-side disconnect it does not.
    if (this.socket && !this.socket.active) this.scheduleRetry();
  }

  private onConnectError(): void {
    if (!this.started) return;
    if (this.ticketRefused) {
      this.setStatus('unauthorized');
      this.socket?.disconnect();
      return;
    }
    this.setStatus(this.connectedOnce ? 'reconnecting' : 'connecting');
    // A refusal by the server's middleware leaves the socket inactive: it will not retry on its own.
    if (this.socket && !this.socket.active) this.scheduleRetry();
  }

  private onReady(data: unknown): void {
    const ready = realtimeReadySchema.safeParse(data);
    if (!ready.success) return;
    const offset = Date.parse(ready.data.serverTime) - Date.now();
    if (Number.isFinite(offset)) this.clockOffsetMs = offset;
    for (const { room, seq } of ready.data.rooms) this.lastSeq.set(room, seq);
    const reason: ResyncReason = this.readySeen ? 'reconnect' : 'connect';
    this.readySeen = true;
    // The two rooms the server puts every socket in: whatever the page holds from them may predate the connection.
    for (const room of ['user', 'org'] as const) this.emitResync({ reason, room });
  }

  private onServerResync(data: unknown): void {
    const env = realtimeEnvelopeSchema.safeParse(data);
    if (env.success) this.emitResync({ reason: 'server', room: env.data.room as RealtimeRoomKey });
  }

  private onEvent(name: string, data: unknown): void {
    if (name === REALTIME_SYSTEM_EVENTS.ready || name === REALTIME_SYSTEM_EVENTS.resync) return;
    const parsed = realtimeEnvelopeSchema.safeParse(data);
    if (!parsed.success) return;
    const env = parsed.data as RealtimeEnvelope;

    if (this.seen.has(env.id)) return; // delivered twice (a re-join racing an emit): handlers see it once
    this.seen.add(env.id);
    if (this.seen.size > SEEN_IDS) this.seen.delete(this.seen.values().next().value as string);

    this.trackSequence(env);
    this.trackLag(env);

    for (const handler of [
      ...(this.eventHandlers.get(env.type) ?? []),
      ...(this.eventHandlers.get('*') ?? []),
    ]) {
      try {
        handler(env);
      } catch (err) {
        console.error('realtime handler failed', err);
      }
    }
  }

  /**
   * Counts a room's events. The next number is the last plus one; a jump means events were missed, and a 1 after a higher number
   * means the server's counter restarted (Redis lost it), which is the same thing for a client: fetch again.
   */
  private trackSequence(env: RealtimeEnvelope): void {
    const last = this.lastSeq.get(env.room);
    if (last === undefined) {
      this.lastSeq.set(env.room, env.seq);
      return;
    }
    if (env.seq === last + 1) {
      this.lastSeq.set(env.room, env.seq);
    } else if (env.seq > last + 1 || (env.seq === 1 && last > 1)) {
      this.lastSeq.set(env.room, env.seq);
      this.emitResync({ reason: 'gap', room: env.room as RealtimeRoomKey });
    }
    // A number at or below the last is a late or repeated packet: nothing was missed, so nothing to fetch.
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  private requestJoin(room: RoomEntry): void {
    clearTimeout(room.retry);
    if (!this.socket?.connected) {
      this.setRoomState(room, 'joining');
      return; // joined by `onConnect`
    }
    this.setRoomState(room, 'joining');
    this.socket.emit(REALTIME_CLIENT_EVENTS.join, room.spec, (answer: unknown) =>
      this.onJoinAnswer(room, answer),
    );
  }

  private onJoinAnswer(room: RoomEntry, answer: unknown): void {
    if (this.rooms.get(room.key) !== room) return; // left while the answer was on its way
    const ack = realtimeRoomAckSchema.safeParse(answer);
    if (ack.success && ack.data.ok) {
      // Events up to this number were published before the join and are not coming; the next one will be `seq + 1`.
      this.lastSeq.set(room.key, Math.max(this.lastSeq.get(room.key) ?? 0, ack.data.seq));
      this.setRoomState(room, 'joined');
      const reason: ResyncReason = room.joinedBefore ? 'reconnect' : 'join';
      room.joinedBefore = true;
      this.emitResync({ reason, room: room.key });
      return;
    }
    const code = ack.success && !ack.data.ok ? ack.data.code : 'UNAVAILABLE';
    this.setRoomState(room, code === 'UNAVAILABLE' ? 'joining' : 'denied');
    // The server could not decide (database blip): ask again shortly. A refusal is final until the caller asks for the room again.
    if (code === 'UNAVAILABLE') room.retry = setTimeout(() => this.requestJoin(room), 3000);
  }

  private resyncAll(reason: ResyncReason): void {
    this.emitResync({ reason, room: 'user' });
    for (const room of this.rooms.values())
      if (room.state === 'joined') this.emitResync({ reason, room: room.key });
  }

  private emitResync(request: ResyncRequest): void {
    for (const handler of [...this.resyncHandlers]) {
      try {
        handler(request);
      } catch (err) {
        console.error('realtime resync handler failed', err);
      }
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    const cap = this.options.maxRetryDelayMs ?? 30_000;
    const delay = Math.min(cap, 1000 * 2 ** this.retryAttempt);
    this.retryAttempt += 1;
    // Jitter, so a restarted API is not hit by every tab in the same second.
    this.retryTimer = setTimeout(() => this.socket?.connect(), delay * (0.5 + Math.random() * 0.5));
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of [...this.statusListeners]) l();
  }

  private setRoomState(room: RoomEntry, next: RoomState): void {
    if (room.state === next) return;
    room.state = next;
    this.notifyRoom(room.key);
  }

  private notifyRoom(key: RealtimeRoomKey): void {
    for (const l of [...(this.roomListeners.get(key) ?? [])]) l();
  }
}
