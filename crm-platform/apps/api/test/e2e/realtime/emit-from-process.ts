/**
 * A stand-in for the worker: a separate OS process that hosts no socket and talks only to Redis and Postgres, the way the ingest
 * and dispatch jobs will. The e2e spec starts it and expects the API's sockets to receive what it publishes.
 *
 *   node --import tsx emit-from-process.ts '<json>'
 *
 * Input: { orgId, conversation: { uuid, assigneeUserId, assigneeTeamId }, excludeUserIds? }. It announces a new message to the
 * conversation room, then to the audience the resolver computes, prints each emit report as one JSON line and exits.
 */
import 'reflect-metadata';
import { Redis } from 'ioredis';
import { REALTIME_EVENT } from '@crm/contracts';
import { createDbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { AudienceResolver } from '../../../src/realtime/audience/audience.resolver';
import { MemberDirectory } from '../../../src/realtime/audience/member-directory.service';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';

interface Input {
  orgId: number;
  conversation: {
    uuid: string;
    assigneeUserId: number | null;
    assigneeTeamId: number | null;
    channelOwnerUserId: number | null;
  };
  excludeUserIds?: number[];
  messageId: string;
}

const print = (line: unknown): void => void process.stdout.write(`${JSON.stringify(line)}\n`);

async function main(): Promise<void> {
  const input = JSON.parse(process.argv[2] ?? '{}') as Input;

  const redis = new Redis(process.env.REDIS_URL!);
  const clients = createDbClientPair({ url: process.env.DATABASE_URL!, poolMax: 2 });
  const db = new DatabaseService(clients);
  const emitter = new RealtimeEmitter(redis);
  const resolver = new AudienceResolver(new MemberDirectory(db, new RbacService(db, redis)));

  const message = { id: input.messageId, seq: 1 };
  const toRoom = await emitter.emit(
    input.orgId,
    [{ kind: 'conv', id: input.conversation.uuid }],
    REALTIME_EVENT.messageNew,
    { conversationId: input.conversation.uuid, message },
  );
  print({ step: 'room', report: toRoom });

  const audience = await resolver.forConversation(input.orgId, input.conversation, {
    excludeUserIds: input.excludeUserIds,
  });
  const toUsers = await emitter.emitToUsers(input.orgId, audience, REALTIME_EVENT.unread, {
    conversationId: input.conversation.uuid,
    unread: 1,
  });
  print({ step: 'audience', audience, report: toUsers });

  await clients.close();
  redis.disconnect();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
