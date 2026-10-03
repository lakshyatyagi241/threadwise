import { PayloadTooLargeException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  FLOW_MEDIA_TOO_LARGE,
  FlowMediaTooLargeInterceptor,
} from '../../../src/modules/flow-builder-editor/flow-media-too-large.interceptor';
import { FlowMediaService } from '../../../src/modules/flow-builder-editor/flow-media.service';
import { LocalFlowMediaAdapter } from '../../../src/infra/providers/flow-builder-editor/local-flow-media.adapter';

const ctx = {} as never;
const run = (err: unknown) =>
  lastValueFrom(new FlowMediaTooLargeInterceptor().intercept(ctx, { handle: () => throwError(() => err) }));

describe('flow media upload (WD-FLB-027)', () => {
  it('a file over 50 MB is the WaDesk validation message, 422, with the field named', async () => {
    expect(FLOW_MEDIA_TOO_LARGE).toBe('The file may not be greater than 51200 kilobytes.');
    const e = (await run(new PayloadTooLargeException()).catch((x: unknown) => x)) as AppError;
    expect(e).toBeInstanceOf(AppError);
    expect(e.getStatus()).toBe(422);
    expect(e.message).toBe(FLOW_MEDIA_TOO_LARGE);
  });

  it('any other transport error passes through untouched; a good upload is not touched', async () => {
    const boom = new Error('boom');
    expect(await run(boom).catch((x: unknown) => x)).toBe(boom);
    expect(await lastValueFrom(new FlowMediaTooLargeInterceptor().intercept(ctx, { handle: () => of('ok') }))).toBe('ok');
  });

  const policy = {
    validate: () => ({ storedName: '1700000000_aaaaaaaaaaaaaaaaaaaaaaaa.png', mime: 'image/png' }),
  };

  it('a storage that is not available is a 503 with a message the builder can show after "Upload failed:"', async () => {
    const store = { put: () => Promise.reject(new Error('ECONNREFUSED minio:9000')), get: () => Promise.resolve(null) };
    const svc = new FlowMediaService({} as never, policy as never, store);
    const e = (await svc
      .upload({ originalname: 'a.png', buffer: Buffer.from('x') }, 'image', 'org-1')
      .catch((x: unknown) => x)) as AppError;
    expect(e).toBeInstanceOf(AppError);
    expect(e.getStatus()).toBe(503);
    expect(e.message).toMatch(/not available/i);
    expect(e.message.startsWith('Upload failed')).toBe(false);
    expect(e.message).not.toContain('minio');
    expect(JSON.stringify(e.getResponse())).toContain(ERROR_CODES.FLB_STORAGE_UNAVAILABLE);
  });

  it('answers the stored URL, the server name (a WaDesk quirk) and the type the node asked for, not the real kind', async () => {
    const store = {
      put: (_o: string, name: string) => Promise.resolve({ url: `http://x/${name}` }),
      get: () => Promise.resolve(null),
    };
    const svc = new FlowMediaService({} as never, policy as never, store);
    expect(await svc.upload({ originalname: 'clip.mp4', buffer: Buffer.from('x') }, 'video', 'org-1')).toEqual({
      url: 'http://x/1700000000_aaaaaaaaaaaaaaaaaaaaaaaa.png',
      filename: '1700000000_aaaaaaaaaaaaaaaaaaaaaaaa.png',
      type: 'video',
      mimeType: 'image/png',
    });
  });

  it('the local store writes and reads only server-shaped names and refuses anything that could leave its folder', async () => {
    process.env.FLB_MEDIA_DIR = `${process.env.TMPDIR ?? '/tmp'}/flb-media-spec-${Date.now()}`;
    const store = new LocalFlowMediaAdapter({ get: () => 'http://localhost:3999' } as never);
    const name = '1700000001_bbbbbbbbbbbbbbbbbbbbbbbb.png';
    const put = await store.put('org-1', name, Buffer.from('hi'));
    expect(put.url).toBe(`http://localhost:3999/v2/flow-media/org-1/${name}`);
    expect((await store.get('org-1', name))!.data.toString()).toBe('hi');
    expect((await store.get('org-1', name))!.mime).toBe('image/png');
    await expect(store.put('..', name, Buffer.from('x'))).rejects.toThrow('unsafe');
    await expect(store.put('org-1', '../../etc/passwd', Buffer.from('x'))).rejects.toThrow('unsafe');
    expect(await store.get('org-1', '../x.png')).toBeNull();
    expect(await store.get('org-1', '1700000002_cccccccccccccccccccccccc.png')).toBeNull();
  });
});
