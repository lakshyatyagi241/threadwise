import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService } from '../modules/auth/token.service';

/**
 * Realtime fan-out for the inbox.
 *
 * Room layout:
 *   org:{orgId}        broadcast to a whole tenant (rare — org-wide notices)
 *   user:{userId}      assignments, mentions, personal notifications
 *   conv:{convId}      an open conversation thread
 *
 * Joining a conversation room is explicit and checked, not implicit on
 * connect: a socket that auto-joined every room would leak every conversation
 * in the tenant to any authenticated user.
 *
 * Horizontal scale needs the Redis adapter (wired in main.ts). Without it, a
 * message emitted on pod A never reaches a socket held by pod B.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly tokens: TokenService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const claims = await this.tokens.verifyAccess(token);
      client.data.orgId = claims.org;
      client.data.actorId = claims.sub;
      client.data.actorType = claims.typ;

      await client.join(`org:${claims.org}`);
      if (claims.typ === 'user') {
        await client.join(`user:${claims.org}:${claims.sub}`);
      }

      this.logger.debug({ orgId: claims.org, actorId: claims.sub }, 'realtime client connected');
    } catch {
      // Never explain the failure over the wire.
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug({ actorId: client.data?.actorId }, 'realtime client disconnected');
  }

  /** Emit to every socket of one staff user. */
  emitToUser(orgId: number, userId: number, event: string, payload: unknown): void {
    this.server?.to(`user:${orgId}:${userId}`).emit(event, payload);
  }

  /** Emit to everyone watching a conversation. */
  emitToConversation(orgId: number, conversationId: number, event: string, payload: unknown): void {
    this.server?.to(`conv:${orgId}:${conversationId}`).emit(event, payload);
  }
}
