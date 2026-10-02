import { Global, Module } from '@nestjs/common';
import { AudienceResolver } from './audience/audience.resolver';
import { MemberDirectory } from './audience/member-directory.service';
import { RealtimeEmitter } from './realtime-emitter.service';

/**
 * Publishing side of realtime, with no sockets in it: imported by the HTTP app (through `RealtimeModule`) AND by the worker, so
 * the ingest and dispatch jobs can announce what they did. It needs only Redis, the database (to resolve audiences) and the
 * kernel's RBAC, all of which both processes already have.
 */
@Global()
@Module({
  providers: [RealtimeEmitter, MemberDirectory, AudienceResolver],
  exports: [RealtimeEmitter, MemberDirectory, AudienceResolver],
})
export class RealtimeEmitterModule {}
