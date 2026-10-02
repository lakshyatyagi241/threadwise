import type { Redis } from 'ioredis';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { DeviceAuthStore } from '../../../src/infra/providers/node-bridge-runtime/device-auth-store';
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
  subscribe(l: (e: SocketEvent) => void) {
    this.listener = l;
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
  async groups(action: GroupAction) {
    this.groupCalls.push(action);
    return this.groupResult;
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
  );
  rt.staggerMs = 0;
  await rt.onApplicationBootstrap();
  return { rt, factory };
}
