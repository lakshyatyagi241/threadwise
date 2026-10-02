import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_MAX_JOINED_ROOMS,
  REALTIME_NAMESPACE,
  REALTIME_SYSTEM_EVENTS,
  realtimeRoomKey,
  realtimeRoomSpecSchema,
  type RealtimeReady,
  type RealtimeRoomAck,
} from '@crm/contracts';
import { RealtimeAuthService, type SocketIdentity } from './realtime-auth.service';
import { RealtimeEmitter } from './realtime-emitter.service';
import { RoomAccessService } from './room-access.service';
import { refFromSpec, roomKeyFor, roomName, type RoomRef } from './rooms';

/** How often the live sockets are checked against ended sessions. */
const SESSION_SWEEP_MS = 30_000;
const SESSION_SWEEP_CHUNK = 500;

interface SocketData {
  identity: SocketIdentity;
  /** Server names of the explicit rooms this socket joined (not the two it is put in at connect). */
  joined: Set<string>;
}

/**
 * Realtime fan-out: the socket side. Events are PUBLISHED through `RealtimeEmitter` (any process, over Redis); this gateway only
 * authenticates connections, authorises room joins and delivers.
 *
 * Handshake: `io(url, { auth: { ticket } })`, the ticket from `POST /v2/realtime/ticket` (or `auth.token` for a client that can
 * hold an access token). A refused handshake is a `connect_error` with the message `unauthorized` and nothing else.
 *
 * Rooms: `org` and `user` (the caller's own) on connect; `conv:<uuid>` and `inbox:<scope>` only through `room:join`, which
 * answers with an acknowledgement and checks the same visibility rule as the REST read. A socket that auto-joined every room
 * would leak every conversation in the tenant to any signed-in user, which is what Reference's workspace channel did.
 *
 * Scaling needs the Redis adapter (wired in main.ts): without it an event published on one pod never reaches a socket held by
 * another.
 */
@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private sweep?: NodeJS.Timeout;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly access: RoomAccessService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  afterInit(server: Namespace): void {
    // A middleware, not handleConnection: a refused socket never connects, and an accepted one is in its rooms before the client
    // sees `connect`, so no event can slip past between the two.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });

    this.sweep = setInterval(() => void this.dropRevoked(), SESSION_SWEEP_MS);
    this.sweep.unref();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  async handleConnection(client: Socket): Promise<void> {
    const { identity } = client.data as SocketData;
    const own = this.defaultRooms(identity);
    const rooms: RealtimeReady['rooms'] = await Promise.all(
      own.map(async (ref) => ({
        room: roomKeyFor(ref),
        seq: await this.emitter.currentSeq(identity.orgId, ref),
      })),
    );
    client.emit(REALTIME_SYSTEM_EVENTS.ready, {
      v: 1,
      rooms,
      serverTime: new Date().toISOString(),
    } satisfies RealtimeReady);
    this.logger.debug(
      { orgId: identity.orgId, actorId: identity.actorId },
      'realtime client connected',
    );
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(
      { actorId: (client.data as Partial<SocketData>).identity?.actorId },
      'realtime client disconnected',
    );
  }

  @SubscribeMessage(REALTIME_CLIENT_EVENTS.join)
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<RealtimeRoomAck> {
    const spec = realtimeRoomSpecSchema.safeParse(body);
    if (!spec.success) return { ok: false, code: 'INVALID' };

    const data = client.data as SocketData;
    const ref = refFromSpec(spec.data);
    const name = roomName(data.identity.orgId, ref);
    const room = realtimeRoomKey(spec.data);

    // Already in: answer with where the room stands, without asking the database again. "Already in" means the socket really is in
    // the room: an eviction (RealtimeEmitter.evict) takes it out without touching `joined`, so a stale entry must not count.
    if (data.joined.has(name) && !client.rooms.has(name)) data.joined.delete(name);
    if (!data.joined.has(name)) {
      if (data.joined.size >= REALTIME_MAX_JOINED_ROOMS) return { ok: false, code: 'LIMIT' };
      try {
        if (!(await this.access.canJoin(data.identity, spec.data))) {
          return { ok: false, code: 'FORBIDDEN' };
        }
      } catch (err) {
        this.logger.warn({ err }, 'room access check failed');
        return { ok: false, code: 'UNAVAILABLE' };
      }
      await client.join(name);
      data.joined.add(name);
    }

    // Read the counter AFTER joining: every event from now on reaches this socket, and any with a number at or below this one is
    // already accounted for.
    return { ok: true, room, seq: await this.emitter.currentSeq(data.identity.orgId, ref) };
  }

  @SubscribeMessage(REALTIME_CLIENT_EVENTS.leave)
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<RealtimeRoomAck> {
    const spec = realtimeRoomSpecSchema.safeParse(body);
    if (!spec.success) return { ok: false, code: 'INVALID' };

    const data = client.data as SocketData;
    const ref = refFromSpec(spec.data);
    const name = roomName(data.identity.orgId, ref);
    await client.leave(name);
    data.joined.delete(name);
    return { ok: true, room: realtimeRoomKey(spec.data), seq: 0 };
  }

  private async authenticate(socket: Socket): Promise<void> {
    const identity = await this.auth.authenticate(
      socket.handshake.auth,
      socket.handshake.headers.authorization,
    );
    const data: SocketData = { identity, joined: new Set() };
    socket.data = data;
    await socket.join(this.defaultRooms(identity).map((ref) => roomName(identity.orgId, ref)));
  }

  private defaultRooms(identity: SocketIdentity): RoomRef[] {
    const rooms: RoomRef[] = [{ kind: 'org' }];
    if (identity.actorType === 'user') rooms.push({ kind: 'user', userId: identity.actorId });
    return rooms;
  }

  /** Disconnects sockets whose session ended since they connected: a signed-out or revoked session must stop receiving. */
  private async dropRevoked(): Promise<void> {
    const sockets = [...(this.server?.sockets.values() ?? [])].filter(
      (s) => (s.data as Partial<SocketData>).identity?.sid,
    );
    for (let i = 0; i < sockets.length; i += SESSION_SWEEP_CHUNK) {
      const chunk = sockets.slice(i, i + SESSION_SWEEP_CHUNK);
      const revoked = new Set(
        await this.auth.revoked(chunk.map((s) => (s.data as SocketData).identity)),
      );
      for (const socket of chunk) {
        if (revoked.has((socket.data as SocketData).identity)) socket.disconnect(true);
      }
    }
  }
}
