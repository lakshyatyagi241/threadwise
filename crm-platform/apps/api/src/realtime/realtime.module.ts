import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * WebSocket transport.
 *
 * The gateway is the only place allowed to touch socket.io. Domain services
 * emit by calling it, so swapping the transport (SSE, a hosted pub/sub) is one
 * file rather than a search-and-replace across modules.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
