import { Module } from '@nestjs/common';
import {
  CONVERSATION_RECORD_LOADER,
  DbConversationRecordLoader,
} from './audience/conversation-record.loader';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeEmitterModule } from './realtime-emitter.module';
import { RealtimeGateway } from './realtime.gateway';
import { RoomAccessService } from './room-access.service';
import { RealtimeTicketController } from './ticket/realtime-ticket.controller';
import { RealtimeTicketService } from './ticket/realtime-ticket.service';

/**
 * WebSocket transport (HTTP app only).
 *
 * The gateway is the only place allowed to host sockets. Everything that PUBLISHES goes through `RealtimeEmitter` (from
 * `RealtimeEmitterModule`, which the worker imports too), so swapping the transport is one file rather than a search across
 * modules, and a job that cannot host a socket can still announce an event.
 */
@Module({
  imports: [RealtimeEmitterModule],
  controllers: [RealtimeTicketController],
  providers: [
    RealtimeGateway,
    RealtimeAuthService,
    RealtimeTicketService,
    RoomAccessService,
    { provide: CONVERSATION_RECORD_LOADER, useClass: DbConversationRecordLoader },
  ],
  exports: [RealtimeGateway, RealtimeTicketService],
})
export class RealtimeModule {}
