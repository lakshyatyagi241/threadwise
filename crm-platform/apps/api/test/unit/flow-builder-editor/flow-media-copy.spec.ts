import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { UploadPolicyService } from '../../../src/modules/auth';
import { AppError } from '../../../src/common/errors/app-error';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { FlowMediaStore } from '../../../src/infra/providers/flow-builder-editor/flow-media.port';
import {
  UnsafeMediaUrlError,
  type FetchedMedia,
  type SafeFetch,
} from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import {
  FLOW_MEDIA_COPY_MAX_BYTES,
  FlowMediaService,
} from '../../../src/modules/flow-builder-editor/flow-media.service';
import { gifOfSize, jpegOfSize, pngOfSize, webpOfSize } from '../../support/images';

const ADDRESS = 'https://photos.example.test/My Photos/IMG_1234.JPG';

/** A service over the real upload guard, a memory store and a fetcher the test answers. */
function setup(answer: FetchedMedia | Error) {
  const fetchMedia = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const store: FlowMediaStore = {
    put: vi.fn(async (org: string, name: string) => ({
      url: `https://app.example.test/v2/flow-media/${org}/${name}`,
    })),
    get: vi.fn(async () => null),
  };
  const service = new FlowMediaService({} as DatabaseService, new UploadPolicyService(), store, {
    fetchMedia,
  } as unknown as SafeFetch);
  return { service, fetchMedia, store };
}

const picture = (mimetype: string, buffer: Buffer): FetchedMedia => ({
  buffer,
  mimetype,
  extension: '.bin',
  finalUrl: ADDRESS,
});

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('FlowMediaService.importFromUrl', () => {
  it('keeps a JPG as this server copy, typed as an image', async () => {
    const { service, store } = setup(picture('image/jpeg', jpegOfSize(40)));
    const copy = await service.importFromUrl(ADDRESS, 'org-uuid');
    expect(copy.type).toBe('image');
    expect(copy.mimeType).toBe('image/jpeg');
    expect(copy.filename).toMatch(/^\d{6,}_[a-f0-9]{24}\.jpg$/);
    expect(copy.url).toBe(`https://app.example.test/v2/flow-media/org-uuid/${copy.filename}`);
    expect(store.put).toHaveBeenCalledWith(
      'org-uuid',
      copy.filename,
      expect.any(Buffer),
      'image/jpeg',
    );
  });

  it('keeps a JPEG whose host names it .jpeg, stored under the .jpg extension it sniffs as', async () => {
    const { service } = setup(picture('image/jpeg', jpegOfSize(40)));
    const copy = await service.importFromUrl('https://photos.example.test/a.jpeg', 'org-uuid');
    expect(copy.filename.endsWith('.jpg')).toBe(true);
  });

  it('keeps PNG, WebP and GIF pictures too', async () => {
    for (const [mime, buffer, ext] of [
      ['image/png', pngOfSize(67), 'png'],
      ['image/webp', webpOfSize(), 'webp'],
      ['image/gif', gifOfSize(14), 'gif'],
    ] as const) {
      const { service } = setup(picture(mime, buffer));
      const copy = await service.importFromUrl(ADDRESS, 'org-uuid');
      expect(copy.mimeType).toBe(mime);
      expect(copy.filename.endsWith(`.${ext}`)).toBe(true);
    }
  });

  it('asks the fetcher for at most the copy cap and a bounded wait', async () => {
    const { service, fetchMedia } = setup(picture('image/jpeg', jpegOfSize(40)));
    await service.importFromUrl(ADDRESS, 'org-uuid');
    expect(fetchMedia).toHaveBeenCalledWith(ADDRESS, {
      maxBytes: FLOW_MEDIA_COPY_MAX_BYTES,
      timeoutMs: 15_000,
    });
    expect(FLOW_MEDIA_COPY_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('refuses a host that answers with a page, not a picture', async () => {
    const { service, store } = setup(picture('text/html', Buffer.from('<html>nope</html>')));
    const err = await refusal(service.importFromUrl(ADDRESS, 'org-uuid'));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/does not point to a JPG, PNG, WebP or GIF picture/);
    expect(err.details).toEqual([{ path: 'url', message: err.message }]);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not the picture type the host named', async () => {
    const { service, store } = setup(picture('image/jpeg', Buffer.from('<!doctype html><p>x</p>')));
    const err = await refusal(service.importFromUrl(ADDRESS, 'org-uuid'));
    expect(err.message).toMatch(/does not point to a JPG, PNG, WebP or GIF picture/);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses a JPEG with markup hidden after its end marker', async () => {
    const withTail = Buffer.concat([jpegOfSize(40), Buffer.from('<script>alert(1)</script>')]);
    const { service, store } = setup(picture('image/jpeg', withTail));
    const err = await refusal(service.importFromUrl(ADDRESS, 'org-uuid'));
    expect(err.message).toMatch(/does not point to a JPG, PNG, WebP or GIF picture/);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses an address that points at an internal host', async () => {
    const { service } = setup(new UnsafeMediaUrlError('Blocked internal media host'));
    const err = await refusal(service.importFromUrl('http://10.0.0.5/a.jpg', 'org-uuid'));
    expect(err.message).toBe('That address cannot be used. Paste a public web address.');
    expect(err.getStatus()).toBe(422);
  });

  it('says the picture could not be fetched when the host refuses or does not answer', async () => {
    for (const cause of [
      new Error('Media host answered HTTP 403.'),
      new Error('Media is larger than 5 MB.'),
      new Error('Too many redirects (more than 3).'),
      new Error('socket hang up'),
    ]) {
      const { service } = setup(cause);
      const err = await refusal(service.importFromUrl(ADDRESS, 'org-uuid'));
      expect(err.message).toMatch(/could not be fetched from that address/);
      expect(err.getStatus()).toBe(422);
    }
  });

  it('reports storage as unavailable when the copy cannot be written', async () => {
    const { service, store } = setup(picture('image/jpeg', jpegOfSize(40)));
    vi.mocked(store.put).mockRejectedValueOnce(new Error('disk full'));
    const err = await refusal(service.importFromUrl(ADDRESS, 'org-uuid'));
    expect(err.code).toBe(ERROR_CODES.FLB_STORAGE_UNAVAILABLE);
    expect(err.getStatus()).toBe(503);
  });
});
