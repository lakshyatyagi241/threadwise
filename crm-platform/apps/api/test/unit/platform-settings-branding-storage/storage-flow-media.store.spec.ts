import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import type { StorageMeter } from '../../../src/common/storage-meter/storage-meter.port';
import { MediaStorageService } from '../../../src/modules/platform-settings-branding-storage/media-storage.service';
import { StorageFlowMediaStore } from '../../../src/modules/platform-settings-branding-storage/storage-flow-media.store';

const NAME = '1234567_0123456789abcdef01234567.png';
const config = { get: () => 'https://desk.example.test/' } as unknown as ConfigService;
/** The controller calls the store with the workspace's uuid inside its request, so the store reads the numeric id from the context. */
const inOrg = <T>(orgId: number, fn: () => Promise<T>): Promise<T> =>
  RequestContextStore.run({ orgId } as never, fn);

function bucket(over: Partial<Record<'put' | 'read', unknown>> = {}) {
  return {
    put: vi.fn(async () => ({ key: 'x' })),
    read: vi.fn(async () => null),
    ...over,
  } as unknown as MediaStorageService & {
    put: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
  };
}

describe('flow media in the workspace bucket', () => {
  it('writes the file to the bucket under the org folder and links it through the app', async () => {
    const storage = bucket();
    const store = new StorageFlowMediaStore(storage, config);
    const out = await inOrg(15, () => store.put('15', NAME, Buffer.from('png')));
    expect(storage.put).toHaveBeenCalledWith(
      `flow-media/15/${NAME}`,
      expect.any(Buffer),
      'image/png',
      { orgId: 15, category: 'campaign_media' },
    );
    expect(out.url).toBe(`https://desk.example.test/v2/flow-media/15/${NAME}`);
  });

  it('reads the bucket copy back with its content type, so a release does not lose it', async () => {
    const storage = bucket({ read: vi.fn(async () => Buffer.from('png')) });
    const store = new StorageFlowMediaStore(storage, config);
    expect(await store.get('15', NAME)).toEqual({ data: Buffer.from('png'), mime: 'image/png' });
    expect(storage.read).toHaveBeenCalledWith(`flow-media/15/${NAME}`);
  });

  it('refuses a name outside the upload pattern before anything is written', async () => {
    const storage = bucket();
    const store = new StorageFlowMediaStore(storage, config);
    await expect(
      inOrg(15, () => store.put('15', '../etc/passwd', Buffer.from('x'))),
    ).rejects.toThrow('unsafe media path');
    expect(storage.put).not.toHaveBeenCalled();
    expect(await store.get('15', '../etc/passwd')).toBeNull();
  });
});

describe('flow media without a bucket (local development)', () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flow-media-test-'));
    previous = process.env.FLB_MEDIA_DIR;
    process.env.FLB_MEDIA_DIR = dir;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.FLB_MEDIA_DIR;
    else process.env.FLB_MEDIA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the file on the local disk and reads it back there', async () => {
    // Local media: the bucket takes nothing (put and read both give null), so the store works on its own disk.
    const storage = bucket({ put: vi.fn(async () => null) });
    const store = new StorageFlowMediaStore(storage, config);
    const out = await inOrg(15, () => store.put('15', NAME, Buffer.from('local')));
    expect(out.url).toBe(`https://desk.example.test/v2/flow-media/15/${NAME}`);
    expect(await store.get('15', NAME)).toEqual({ data: Buffer.from('local'), mime: 'image/png' });
  });
});

describe('flow media is metered like the other workspace files', () => {
  /** The real put path of MediaStorageService with a meter and a bucket that takes the write (the destination is stubbed). */
  function meteredBucket() {
    const reservation = {
      commit: vi.fn(async (_input: unknown) => undefined),
      release: vi.fn(async () => undefined),
    };
    const meter = {
      reserve: vi.fn(async () => reservation),
      recordRemoved: vi.fn(async () => undefined),
    } as unknown as StorageMeter & { reserve: ReturnType<typeof vi.fn> };
    const svc = Object.assign(Object.create(MediaStorageService.prototype), {
      meter,
      destination: async () => ({ disk: 'cloud', target: { prefix: '', bucket: 'crm-media' } }),
      putObject: vi.fn(async (key: string) => ({ key })),
    }) as unknown as MediaStorageService;
    return { svc, meter, reservation };
  }

  it('reserves the bytes for the workspace and commits them once the bucket took the write', async () => {
    const { svc, meter, reservation } = meteredBucket();
    const store = new StorageFlowMediaStore(svc, config);
    // The controller passes the workspace uuid in the path; the numeric id comes from the request, not from the key.
    await inOrg(15, () =>
      store.put('6f1c2e3a-0000-4000-8000-000000000001', NAME, Buffer.from('png')),
    );
    expect(meter.reserve).toHaveBeenCalledWith({ orgId: 15, bytes: 3, category: 'campaign_media' });
    expect(reservation.commit.mock.calls[0]?.[0]).toEqual({
      key: `flow-media/6f1c2e3a-0000-4000-8000-000000000001/${NAME}`,
    });
    expect(reservation.release).not.toHaveBeenCalled();
  });

  it('gives the reservation back when the bucket refuses the write', async () => {
    const { svc, meter, reservation } = meteredBucket();
    (svc as unknown as { putObject: () => Promise<never> }).putObject = vi.fn(async () => {
      throw new Error('bucket refused');
    });
    const store = new StorageFlowMediaStore(svc, config);
    await expect(
      inOrg(15, () => store.put('6f1c2e3a-0000-4000-8000-000000000001', NAME, Buffer.from('png'))),
    ).rejects.toThrow('bucket refused');
    expect(meter.reserve).toHaveBeenCalledTimes(1);
    expect(reservation.release).toHaveBeenCalledTimes(1);
    expect(reservation.commit).not.toHaveBeenCalled();
  });
});
