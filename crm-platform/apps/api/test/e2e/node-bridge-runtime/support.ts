import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { DeviceAuthStore } from '../../../src/infra/providers/node-bridge-runtime/device-auth-store';
import type { GroupSnapshot } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import type { HistoryBatch } from '../../../src/infra/providers/node-bridge-runtime/history.port';
import type {
  MessageAction,
  SendCommand,
  SendContext,
  SendOutcome,
} from '../../../src/infra/providers/node-bridge-runtime/outbound.port';
import type {
  GroupAction,
  GroupResult,
  SocketEvent,
  SocketTarget,
  WaSocket,
  WaSocketFactory,
} from '../../../src/infra/providers/node-bridge-runtime/socket.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { DeviceControlService } from '../../../src/modules/node-bridge-runtime';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import {
  InboundRouter,
  ReceiptRouter,
} from '../../../src/modules/node-bridge-runtime/runtime/routers';
import { DeviceLease } from '../../../src/modules/node-bridge-runtime/runtime/wa-redis';
import type { Harness } from '../contacts-attributes-tags/support';

/** A personal-number group as the socket reports it; override what the test is about. */
export function fakeGroupSnapshot(over: Partial<GroupSnapshot> = {}): GroupSnapshot {
  const groupId = over.groupId ?? '120363000000000001';
  return {
    jid: `${groupId}@g.us`,
    groupId,
    subject: 'Team',
    description: null,
    size: 2,
    isAdmin: true,
    announce: false,
    restrict: false,
    joinApproval: false,
    memberAddMode: 'all_member_add',
    owner: null,
    creation: '2026-01-01T00:00:00.000Z',
    addressingMode: 'pn',
    inviteCode: null,
    participants: [
      {
        jid: '919000000001@s.whatsapp.net',
        phone: '919000000001',
        lid: null,
        name: 'Me',
        admin: 'superadmin',
      },
      {
        jid: '919000000002@s.whatsapp.net',
        phone: '919000000002',
        lid: null,
        name: 'Asha',
        admin: null,
      },
    ],
    ...over,
  };
}

/** A WhatsApp socket that does what the test says: records sends and actions, emits what it is told. */
export class FakeSocket implements WaSocket {
  listener: ((e: SocketEvent) => void) | null = null;
  ended = false;
  loggedOut = false;
  pairingFor: string | null = null;
  sends: Array<{ command: SendCommand; context: SendContext }> = [];
  actions: MessageAction[] = [];
  groupCalls: GroupAction[] = [];
  /** What the next send does. */
  onSend: (n: number) => string | Error = (n) => `wamid.fake.${n}`;
  groupResult: GroupResult = { ok: true };
  /**
   * What the next group action of a type answers, before the `groupResult` fallback: a result, a function of the action, or an Error to
   * throw (a Boom-like one, e.g. `Object.assign(new Error('forbidden'), { isBoom: true, data: 403 })`, reads as WhatsApp's refusal).
   */
  groupReplies: Partial<
    Record<GroupAction['type'], GroupResult | Error | ((a: GroupAction) => GroupResult)>
  > = {};
  historyHandler: ((b: HistoryBatch) => Promise<void>) | null = null;
  subscribe(l: (e: SocketEvent) => void) {
    this.listener = l;
  }
  subscribeHistory(h: (b: HistoryBatch) => Promise<void>) {
    this.historyHandler = h;
  }
  /** WhatsApp pushes one slice of the first link's history; resolves when the importer has taken it. */
  async emitHistory(b: HistoryBatch) {
    await this.historyHandler?.(b);
  }
  async requestPairingCode(digits: string) {
    this.pairingFor = digits;
    return 'ZX81KQ7M';
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
  async send(command: SendCommand, context: SendContext): Promise<SendOutcome> {
    this.sends.push({ command, context });
    const out = this.onSend(this.sends.length);
    if (out instanceof Error) throw out;
    return { providerMessageId: out };
  }
  async act(action: MessageAction) {
    this.actions.push(action);
  }
  async groups(action: GroupAction): Promise<GroupResult> {
    this.groupCalls.push(action);
    const reply = this.groupReplies[action.type];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(action);
    return reply ?? this.groupResult;
  }
  emit(e: SocketEvent) {
    this.listener?.(e);
  }
}

export class FakeFactory implements WaSocketFactory {
  sockets: FakeSocket[] = [];
  targets: SocketTarget[] = [];
  /** What each new socket does on its own: by default it connects and opens as the right phone. */
  script: (s: FakeSocket, t: SocketTarget) => void = (s, t) => {
    setImmediate(() => {
      s.emit({ type: 'connecting' });
      s.emit({ type: 'open', linkedId: `${t.phoneDigits}:1@s.whatsapp.net` });
    });
  };
  constructor(private readonly auth: DeviceAuthStore) {}
  async create(target: SocketTarget) {
    this.targets.push(target);
    const s = new FakeSocket();
    this.sockets.push(s);
    this.script(s, target);
    return s;
  }
  async deleteSession(orgId: number, deviceId: number) {
    await this.auth.deleteAll(orgId, deviceId);
  }
  get last() {
    return this.sockets[this.sockets.length - 1]!;
  }
}

export interface Rig {
  db: DatabaseService;
  redis: Redis;
  store: DeviceAuthStore;
  control: DeviceControlService;
  inbound: InboundRouter;
  receipts: ReceiptRouter;
}

export function rig(h: Harness): Rig {
  const db = h.app.get(DatabaseService);
  return {
    db,
    redis: h.app.get<Redis>(REDIS_CLIENT),
    store: new DeviceAuthStore(db, h.app.get(CryptoService, { strict: false })),
    control: h.app.get(DeviceControlService),
    inbound: new InboundRouter(h.app.get<Redis>(REDIS_CLIENT)),
    receipts: new ReceiptRouter(),
  };
}

/** One worker: a runtime with its own fake factory, subscribed to commands, as a separate process would be. */
export async function worker(
  h: Harness,
  r: Rig,
  opts: { inbound?: InboundRouter; receipts?: ReceiptRouter } = {},
) {
  const factory = new FakeFactory(r.store);
  const rt = new DeviceRuntimeService(
    r.db,
    h.app.get(CryptoService, { strict: false }),
    new DeviceLease(r.redis),
    h.app.get(OutboxService, { strict: false }),
    r.store,
    r.redis,
    factory,
    opts.inbound ?? r.inbound,
    opts.receipts ?? r.receipts,
    r.control,
    h.app.get(UNOFFICIAL_WHATSAPP_GATE),
  );
  rt.staggerMs = 0;
  await rt.onApplicationBootstrap();
  return { rt, factory };
}
