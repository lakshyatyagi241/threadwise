import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { TemplatesService } from '../../../src/modules/message-templates/templates.service';

const ORG = 41;
const CONN = '00000000-0000-4000-8000-000000000001';

function build(storagePut: ReturnType<typeof vi.fn>) {
  const remote = { uploadHeaderMedia: vi.fn() };
  const waba = {
    resolveConnection: vi
      .fn()
      .mockResolvedValue({ id: 7, uuid: CONN, conn: { id: 7 }, status: 'connected' }),
  };
  const uploads = {
    validateScanned: vi
      .fn()
      .mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg', storedName: '1_abc.jpg' }),
  };
  const storage = { put: storagePut, url: vi.fn() };
  const rbac = { can: vi.fn().mockReturnValue({ allowed: true }) };
  const db = { tx: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const svc = new TemplatesService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    rbac as never,
    waba as never,
    uploads as never,
    {} as never,
    storage as never,
    remote as never,
  );
  return { svc, remote };
}

describe('template header upload: workspace without cloud object storage', () => {
  it('refuses the file under its own code, before the provider is called', async () => {
    const put = vi.fn().mockResolvedValue(null);
    const { svc, remote } = build(put);
    const run = () =>
      RequestContextStore.run(
        {
          requestId: 'r',
          orgId: ORG,
          actorType: 'user',
          actorId: 1,
          userId: 1,
          grants: {} as never,
        },
        () => svc.uploadMedia(CONN, { originalname: 'header.jpg', buffer: Buffer.from('x') }),
      );
    await expect(run()).rejects.toMatchObject({
      code: 'TPL_HEADER_STORAGE_REQUIRED',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(ERROR_CODES.TPL_HEADER_STORAGE_REQUIRED).toBe('TPL_HEADER_STORAGE_REQUIRED');
    expect(put).toHaveBeenCalledTimes(1);
    expect(remote.uploadHeaderMedia).not.toHaveBeenCalled();
  });
});
