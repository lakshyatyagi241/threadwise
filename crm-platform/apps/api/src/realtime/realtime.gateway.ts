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
import { sql } from 'drizzle-orm';
import type { Namespace, Socket } from 'socket.io';
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_MAX_JOINED_ROOMS,
  REALTIME_NAMESPACE,
  REALTIME_SYSTEM_EVENTS,
  realtimeRoomKey,
  realtimeRoomSpecSchema,
  realtimeVisibilitySchema,
  type RealtimeReady,
  type RealtimeRoomAck,
  type RealtimeRoomSpec,
} from '@crm/contracts';
import { DatabaseService } from '../infra/db/database.service';
import { RealtimeAuthService, type SocketIdentity } from './realtime-auth.service';
import { RESTRICTED_EVENT_PERMISSION, RealtimeEmitter } from './realtime-emitter.service';
import { RoomAccessService } from './room-access.service';
import { VisibilityPresence } from './visibility-presence.service';
import { refFromSpec, roomKeyFor, roomName, type RoomRef } from './rooms';

/** How often the live sockets are checked against ended sessions. */
const SESSION_SWEEP_MS = 30_000;
const SESSION_SWEEP_CHUNK = 500;
/** How often the workspaces' roles versions are compared with what each socket was last authorised under (AZ-017). */
const GRANT_WATCH_MS = 1_000;
/** Sockets re-authorised at the same time (each may read grants and a conversation row). */
const REAUTHORIZE_PARALLEL = 25;
/** The permissions that have a room of their own: a restricted event goes only to the sockets whose member holds it (AZ-016). */
const PERMISSION_ROOMS = [...new Set(Object.values(RESTRICTED_EVENT_PERMISSION))];

interface SocketData {
  identity: SocketIdentity;
  /** Server names of the explicit rooms this socket joined (not the two it is put in at connect). */
  joined: Set<string>;
  /** What each explicit room was joined as, so the room can be checked again when grants change. */
  specs: Map<string, RealtimeRoomSpec>;
  /** The workspace's roles version this socket's rooms were last authorised under. */
  rv: number;
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
  private grantWatch?: NodeJS.Timeout;
  private watching = false;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly access: RoomAccessService,
    private readonly emitter: RealtimeEmitter,
    private readonly presence: VisibilityPresence,
    private readonly db: DatabaseService,
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

    this.grantWatch = setInterval(() => void this.watchGrants(), GRANT_WATCH_MS);
    this.grantWatch.unref();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
    if (this.grantWatch) clearInterval(this.grantWatch);
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
    const identity = (client.data as Partial<SocketData>).identity;
    if (identity?.actorType === 'user') {
      void this.presence.clear(identity.orgId, identity.actorId, client.id);
    }
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
      data.specs.set(name, spec.data);
    }

    // Read the counter AFTER joining: every event from now on reaches this socket, and any with a number at or below this one is
    // already accounted for.
    return { ok: true, room, seq: await this.emitter.currentSeq(data.identity.orgId, ref) };
  }

  /** A tab says whether it is in front (BL-097): the closed-tab browser push skips a person who can see the app. Fire and forget. */
  @SubscribeMessage(REALTIME_CLIENT_EVENTS.visibility)
  async onVisibility(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const parsed = realtimeVisibilitySchema.safeParse(body);
    const identity = (client.data as Partial<SocketData>).identity;
    if (!parsed.success || identity?.actorType !== 'user') return;
    await this.presence.report(identity.orgId, identity.actorId, client.id, parsed.data.visible);
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
    data.specs.delete(name);
    return { ok: true, room: realtimeRoomKey(spec.data), seq: 0 };
  }

  private async authenticate(socket: Socket): Promise<void> {
    const identity = await this.auth.authenticate(
      socket.handshake.auth,
      socket.handshake.headers.authorization,
    );
    // The version is read BEFORE the grants, so a change in between is seen as newer by the next watch pass.
    const rv = await this.rolesVersion(identity.orgId).catch(() => 0);
    const data: SocketData = { identity, joined: new Set(), specs: new Map(), rv };
    socket.data = data;
    await socket.join(this.defaultRooms(identity).map((ref) => roomName(identity.orgId, ref)));
    // Permission rooms: only a member who holds the permission is put in; a failed check leaves the socket out (closed).
    await this.syncPermissionRooms(socket, false);
  }

  private async rolesVersion(orgId: number): Promise<number> {
    const res = await this.db.privileged(async (tx) =>
      tx.execute(sql`SELECT roles_version FROM organizations WHERE id = ${orgId}`),
    );
    return Number(
      (res.rows[0] as { roles_version?: number | string } | undefined)?.roles_version ?? 0,
    );
  }

  /** Joins or leaves each permission room to match the member's live grants. With `strict`, a failed check throws (retry later). */
  private async syncPermissionRooms(socket: Socket, strict: boolean): Promise<void> {
    const { identity } = socket.data as SocketData;
    if (identity.actorType !== 'user') return;
    for (const permission of PERMISSION_ROOMS) {
      const name = roomName(identity.orgId, { kind: 'perm', permission });
      let holds = false;
      try {
        holds = await this.access.holds(identity, permission);
      } catch (err) {
        if (strict) throw err;
        this.logger.warn({ err }, 'permission room check failed');
      }
      if (holds) await socket.join(name);
      else await socket.leave(name);
    }
  }

  /**
   * Checks a socket's rooms against the member's grants as they are now and takes it out of every room it may no longer be in
   * (a conversation after a role change, the balance room after `wallet.balance.read` was withdrawn). A check that fails
   * leaves the rooms untouched and throws, so the caller tries again on its next pass.
   */
  private async reauthorize(socket: Socket): Promise<void> {
    const data = socket.data as Partial<SocketData>;
    if (!data.identity || data.identity.actorType !== 'user') return;
    const rv = await this.rolesVersion(data.identity.orgId);
    for (const [name, spec] of [...(data.specs ?? [])]) {
      if (!(await this.access.canJoin(data.identity, spec))) {
        await socket.leave(name);
        data.joined?.delete(name);
        data.specs?.delete(name);
      }
    }
    await this.syncPermissionRooms(socket, true);
    data.rv = rv;
  }

  private async reauthorizeAll(sockets: Socket[]): Promise<void> {
    for (let i = 0; i < sockets.length; i += REAUTHORIZE_PARALLEL) {
      await Promise.all(
        sockets.slice(i, i + REAUTHORIZE_PARALLEL).map((s) =>
          this.reauthorize(s).catch((err: unknown) => {
            this.logger.warn({ err }, 'realtime re-authorisation failed; retried on the next pass');
          }),
        ),
      );
    }
  }

  /** A role, grant or membership change bumps the workspace's roles version: sockets authorised under an older one are checked again. */
  private async watchGrants(): Promise<void> {
    if (this.watching) return;
    this.watching = true;
    try {
      const sockets = [...(this.server?.sockets.values() ?? [])].filter((s) => {
        const d = s.data as Partial<SocketData>;
        return d.identity?.actorType === 'user';
      });
      if (sockets.length === 0) return;
      const orgIds = [...new Set(sockets.map((s) => (s.data as SocketData).identity.orgId))];
      const res = await this.db.privileged(async (tx) =>
        tx.execute(
          sql`SELECT id, roles_version FROM organizations WHERE id IN (${sql.join(
            orgIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
      const current = new Map(
        (res.rows as Array<{ id: number | string; roles_version: number | string }>).map((r) => [
          Number(r.id),
          Number(r.roles_version),
        ]),
      );
      const stale = sockets.filter((s) => {
        const d = s.data as SocketData;
        const now = current.get(d.identity.orgId);
        return now !== undefined && now !== d.rv;
      });
      await this.reauthorizeAll(stale);
    } catch (err) {
      this.logger.warn({ err }, 'realtime grant watch failed');
    } finally {
      this.watching = false;
    }
  }

  private defaultRooms(identity: SocketIdentity): RoomRef[] {
    const rooms: RoomRef[] = [{ kind: 'org' }];
    if (identity.actorType === 'user') rooms.push({ kind: 'user', userId: identity.actorId });
    return rooms;
  }

  /** Disconnects sockets whose session ended since they connected: a signed-out or revoked session must stop receiving. */
  private async dropRevoked(): Promise<void> {
    const sockets = [...(this.server?.sockets.values() ?? [])].filter(
      (s) => (s.data as Partial<SocketData>).identity,
    );
    for (let i = 0; i < sockets.length; i += SESSION_SWEEP_CHUNK) {
      const chunk = sockets.slice(i, i + SESSION_SWEEP_CHUNK);
      const identities = chunk.map((s) => (s.data as SocketData).identity);
      // Revoked sessions and members of a suspended workspace (ADR-0019) are dropped the same way.
      const dropped = new Set([
        ...(await this.auth.revoked(identities)),
        ...(await this.auth.suspended(identities)),
      ]);
      const alive: Socket[] = [];
      for (const socket of chunk) {
        if (dropped.has((socket.data as SocketData).identity)) socket.disconnect(true);
        else alive.push(socket);
      }
      // Backstop for the grant watch: every surviving socket's rooms are checked against its member's grants.
      await this.reauthorizeAll(alive);
    }
  }
}
