import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type StorageCategory } from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { AppError } from '../../../src/common/errors/app-error';
import {
  NO_RESERVATION,
  meteredWrite,
  recordRemovedOn,
  reserveOn,
  type StorageMeter,
  type StorageReservation,
} from '../../../src/common/storage-meter/storage-meter.port';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { LocalDiskMediaStore } from '../../../src/infra/providers/chat-conversations/media/local-disk-media.store';
import { MediaTokenService } from '../../../src/infra/providers/chat-conversations/media/media-token.service';
import type { ChatMediaObjectGateway } from '../../../src/infra/providers/chat-conversations/media/media.ports';
import { LocalTrainingFileStore } from '../../../src/infra/providers/ai-agents-training/local-training-file-store.adapter';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';
import { MediaStorageService } from '../../../src/modules/platform-settings-branding-storage/media-storage.service';
import { StorageMeterService } from '../../../src/modules/storage-quota/storage-meter.service';
import type { StorageModeService } from '../../../src/modules/storage-quota/storage-mode.service';
import type { StorageQuotaRepository } from '../../../src/modules/storage-quota/storage-quota.repository';
import type { DatabaseService } from '../../../src/infra/db/database.service';

/**
 * OBSERVE MODE NEVER BLOCKS. Whatever the metering path does (throws on reserve, on commit, on release, on remove, a database that is
 * down, a meter that is simply wrong), the file write still succeeds. The cost is a logged error and a counter, never a failed upload.
 * This is the property that lets the guard ship dormant-by-default and stay switched on without a release gate.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

/** A meter whose every step throws a plain error (a database fault, a bug). */
function brokenMeter() {
  const reservation: StorageReservation = {
    commit: vi.fn(() => Promise.reject(new Error('commit exploded'))),
    release: vi.fn(() => Promise.reject(new Error('release exploded'))),
  };
  const meter: StorageMeter = {
    reserve: vi.fn(() => Promise.reject(new Error('reserve exploded'))),
    recordRemoved: vi.fn(() => Promise.reject(new Error('remove exploded'))),
  };
  return { meter, reservation };
}

/** A meter that reserves fine but whose commit and release throw. */
function reservingMeter() {
  const { reservation } = brokenMeter();
  const meter: StorageMeter = {
    reserve: vi.fn(() => Promise.resolve(reservation)),
    recordRemoved: vi.fn(() => Promise.reject(new Error('remove exploded'))),
  };
  return { meter, reservation };
}

describe('the port helpers fail open', () => {
  it('reserveOn: no meter, a throwing meter and a throwing reservation never reject', async () => {
    const request = { orgId: 7, bytes: 10, category: 'inbox_media' as StorageCategory };
    expect(await reserveOn(undefined, request)).toBe(NO_RESERVATION);
    expect(await reserveOn(brokenMeter().meter, request)).toBe(NO_RESERVATION);
    const { meter } = reservingMeter();
    const r = await reserveOn(meter, request);
    await expect(r.commit({ key: 'k' })).resolves.toBeUndefined();
    await expect(r.release()).resolves.toBeUndefined();
  });

  it('recordRemovedOn never rejects', async () => {
    await expect(recordRemovedOn(brokenMeter().meter, 7, 'chat/7/x.png')).resolves.toBeUndefined();
    await expect(recordRemovedOn(undefined, 7, 'chat/7/x.png')).resolves.toBeUndefined();
  });

  it('meteredWrite runs the write and returns its result when reserve and commit both throw', async () => {
    const write = vi.fn(async () => 'stored');
    const out = await meteredWrite(
      reservingMeter().meter,
      { orgId: 7, bytes: 10, category: 'inbox_media' },
      write,
      () => ({ key: 'k' }),
    );
    expect(out).toBe('stored');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a failing write is rethrown as itself, even when release also throws', async () => {
    const boom = new Error('bucket refused');
    const err = await meteredWrite(
      reservingMeter().meter,
      { orgId: 7, bytes: 10, category: 'inbox_media' },
      async () => {
        throw boom;
      },
      () => ({ key: 'k' }),
    ).catch((e: unknown) => e);
    expect(err).toBe(boom);
  });

  it('a deliberate quota refusal (enforce mode, phase S2) is the one thing that propagates, and the write does not run', async () => {
    const refusal = new AppError(ERROR_CODES.STORAGE_QUOTA_EXCEEDED, 'full', 422);
    const meter: StorageMeter = {
      reserve: () => Promise.reject(refusal),
      recordRemoved: () => Promise.resolve(),
    };
    const write = vi.fn(async () => 1);
    await expect(
      meteredWrite(meter, { orgId: 7, bytes: 10, category: 'inbox_media' }, write, () => ({
        key: 'k',
      })),
    ).rejects.toBe(refusal);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('StorageMeterService is inert when its database is not', () => {
  const mode = (m: 'off' | 'observe') =>
    ({ current: async () => m }) as unknown as StorageModeService;
  const repo = {
    reserve: vi.fn(async () => '00000000-0000-4000-8000-000000000000'),
    commit: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    remove: vi.fn(async () => 0),
  } as unknown as StorageQuotaRepository;
  const dbThat = (impl: () => Promise<unknown>) =>
    ({ txAs: vi.fn(impl) }) as unknown as DatabaseService & { txAs: ReturnType<typeof vi.fn> };

  it('a database that is down turns reserve into no reservation and recordRemoved into a no-op', async () => {
    const db = dbThat(() => Promise.reject(new Error('connection refused')));
    const meter = new StorageMeterService(db, repo, mode('observe'));
    const r = await meter.reserve({ orgId: 7, bytes: 100, category: 'inbox_media' });
    expect(r).toBe(NO_RESERVATION);
    await expect(meter.recordRemoved(7, 'chat/7/x.png')).resolves.toBeUndefined();
  });

  it('a database that dies between reserve and commit does not fail the commit or the release', async () => {
    let calls = 0;
    const db = dbThat(async () => {
      calls += 1;
      if (calls === 1) return '00000000-0000-4000-8000-000000000000'; // the reserve
      throw new Error('connection reset');
    });
    const meter = new StorageMeterService(db, repo, mode('observe'));
    const r = await meter.reserve({ orgId: 7, bytes: 100, category: 'inbox_media' });
    expect(r).not.toBe(NO_RESERVATION);
    await expect(r.commit({ key: 'chat/7/x.png' })).resolves.toBeUndefined();
    await expect(r.release()).resolves.toBeUndefined();
  });

  it('mode off, a category that does not count, and an empty file touch no table at all', async () => {
    const db = dbThat(async () => 'x');
    const off = new StorageMeterService(db, repo, mode('off'));
    expect(await off.reserve({ orgId: 7, bytes: 100, category: 'inbox_media' })).toBe(
      NO_RESERVATION,
    );
    await off.recordRemoved(7, 'chat/7/x.png');
    const on = new StorageMeterService(db, repo, mode('observe'));
    expect(await on.reserve({ orgId: 7, bytes: 100, category: 'payment_proof' })).toBe(
      NO_RESERVATION,
    );
    expect(await on.reserve({ orgId: 7, bytes: 0, category: 'inbox_media' })).toBe(NO_RESERVATION);
    expect(await on.reserve({ orgId: 7, bytes: Number.NaN, category: 'inbox_media' })).toBe(
      NO_RESERVATION,
    );
    expect(db.txAs).not.toHaveBeenCalled();
  });
});

describe('the write doors store the file when metering throws', () => {
  let dir: string;
  let local: LocalDiskMediaStore;
  let tokens: MediaTokenService;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crm-storage-failopen-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    local = new LocalDiskMediaStore(await mkdtemp(join(dir, 'root-')));
    tokens = new MediaTokenService(
      new CryptoService(
        new ConfigService({
          CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
        }) as never,
      ),
    );
  });

  const localGateway = () =>
    ({
      destination: vi.fn(async () => ({ disk: 'local' as const })),
      put: vi.fn(async () => null),
      remove: vi.fn(async () => undefined),
      url: vi.fn(async () => 'http://127.0.0.1:1/never'),
    }) as unknown as ChatMediaObjectGateway;

  it.each([
    ['reserve throws', () => brokenMeter().meter],
    ['commit and release throw', () => reservingMeter().meter],
  ])('ChatMediaStore.store: %s', async (_name, makeMeter) => {
    const store = new ChatMediaStore(
      localGateway(),
      new UploadPolicyService(),
      local,
      tokens,
      makeMeter(),
    );
    const stored = await store.store({ orgId: 7, filename: 'a.png', buffer: PNG });
    expect(stored.size).toBe(PNG.length);
    const opened = await store.open(7, stored.key);
    expect(opened?.size).toBe(PNG.length);
  });

  it('ChatMediaStore.remove deletes the file when the meter throws on remove', async () => {
    const meter = reservingMeter().meter;
    const store = new ChatMediaStore(
      localGateway(),
      new UploadPolicyService(),
      local,
      tokens,
      meter,
    );
    const stored = await store.store({ orgId: 7, filename: 'a.png', buffer: PNG });
    await expect(store.remove(7, stored.key)).resolves.toBeUndefined();
    expect(await store.open(7, stored.key)).toBeNull();
    expect(meter.recordRemoved).toHaveBeenCalledWith(7, stored.key, undefined);
  });

  it('ChatMediaStore.storeInbound names the customer-media category and still stores when metering throws', async () => {
    const meter = reservingMeter().meter;
    const store = new ChatMediaStore(
      localGateway(),
      new UploadPolicyService(),
      local,
      tokens,
      meter,
    );
    const stored = await store.storeInbound({ orgId: 7, buffer: PNG, declaredMime: 'image/png' });
    expect(stored.size).toBe(PNG.length);
    expect(meter.reserve).toHaveBeenCalledWith({
      orgId: 7,
      bytes: PNG.length,
      category: 'inbox_media_inbound',
    });
  });

  it('ChatMediaStore.store without any meter (the process does not load the quota module) behaves as before', async () => {
    const store = new ChatMediaStore(localGateway(), new UploadPolicyService(), local, tokens);
    const stored = await store.store({ orgId: 7, filename: 'a.png', buffer: PNG });
    expect(stored.key.startsWith('chat/7/')).toBe(true);
  });

  it('MediaStorageService.put returns the stored key when the meter throws, and meters only workspace areas other than chat/', async () => {
    const { meter } = reservingMeter();
    const svc = new MediaStorageService({} as never, undefined, meter);
    vi.spyOn(svc, 'destination').mockResolvedValue({
      disk: 'cloud',
      target: {
        endpoint: 'http://127.0.0.1:9',
        region: 'us-east-1',
        bucket: 'b',
        accessKeyId: 'a',
        secret: 's',
        pathStyle: true,
        prefix: '',
      },
      visibility: 'private',
      cdnUrl: '',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    try {
      const out = await svc.put('scheduled/7/abc.png', PNG, 'image/png');
      expect(out).toEqual({ key: 'scheduled/7/abc.png' });
      expect(meter.reserve).toHaveBeenCalledWith({
        orgId: 7,
        bytes: PNG.length,
        category: 'scheduled_media',
      });

      // chat/ is metered by ChatMediaStore (which also covers local disk): counting it here too would double it
      (meter.reserve as ReturnType<typeof vi.fn>).mockClear();
      await svc.put('chat/7/2027/01/abc.png', PNG, 'image/png');
      // the platform marketing site has no workspace in its key
      await svc.put('site/abc.png', PNG, 'image/png');
      expect(meter.reserve).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('MediaStorageService.put does not commit when media is local (nothing was stored here)', async () => {
    const { meter, reservation } = reservingMeter();
    const svc = new MediaStorageService({} as never, undefined, meter);
    vi.spyOn(svc, 'destination').mockResolvedValue({
      disk: 'local',
      target: null,
      visibility: 'private',
      cdnUrl: '',
    });
    expect(await svc.put('telegram/7/abc.png', PNG, 'image/png')).toBeNull();
    expect(reservation.commit).not.toHaveBeenCalled();
    expect(reservation.release).toHaveBeenCalled();
  });

  it('LocalTrainingFileStore.put stores the file when the meter throws', async () => {
    const prev = process.env.MEDIA_LOCAL_DIR;
    process.env.MEDIA_LOCAL_DIR = await mkdtemp(join(dir, 'train-'));
    try {
      const store = new LocalTrainingFileStore(reservingMeter().meter);
      const key = await store.put(7, 'txt', Buffer.from('knowledge'));
      expect(key.startsWith('ai-training/7/')).toBe(true);
      await expect(store.remove(7, key)).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.MEDIA_LOCAL_DIR;
      else process.env.MEDIA_LOCAL_DIR = prev;
    }
  });
});
