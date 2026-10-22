import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '@crm/db';
import { AppError } from '../../../src/common/errors/app-error';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ContactFilesService } from '../../../src/modules/crm/contact-files/contact-files.service';

const CONTACT = '8f0c2b8e-6c1a-4f0e-9d1a-2b7f4f0c9a11';
const FILE = '3b9d1f2e-2a4c-4e7b-8f10-5d6c7e8f9a22';
const STORED_KEY = 'chat/7/2026/10/4c1d9e0f.pdf';

const ctx = {
  requestId: 'req-1',
  orgId: 7,
  actorType: 'user' as const,
  actorId: 3,
  userId: 3,
  grants: new Map(),
};

function build(opts: { insertFails?: boolean } = {}) {
  const tx = {} as Tx;
  const db = { tx: vi.fn(async (fn: (t: Tx) => Promise<unknown>) => fn(tx)) };
  const contactsRepo = {
    resolveContactRef: vi.fn().mockResolvedValue({ id: 11, ownerId: null, createdBy: null }),
    bumpLastActivity: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    insert: opts.insertFails
      ? vi.fn().mockRejectedValue(new Error('connection reset'))
      : vi.fn().mockResolvedValue({ id: 21, uuid: FILE }),
    findById: vi.fn().mockResolvedValue({
      uuid: FILE,
      contactUuid: CONTACT,
      fileName: 'Quote.pdf',
      fileSizeBytes: 12,
      storageKey: STORED_KEY,
      mimeType: 'application/pdf',
      uploadedByUuid: null,
      createdAt: new Date('2026-10-15T09:00:00Z'),
    }),
  };
  const media = {
    store: vi.fn().mockResolvedValue({
      key: STORED_KEY,
      mime: 'application/pdf',
      size: 12,
      name: 'Quote.pdf',
      sha256: 'ab12',
      kind: 'document',
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const outbox = { emit: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const rbac = { can: vi.fn().mockReturnValue({ scope: 'all' }) };
  const svc = new ContactFilesService(
    db as never,
    repo as never,
    contactsRepo as never,
    media as never,
    outbox as never,
    audit as never,
    rbac as never,
  );
  return { svc, media, repo, outbox, audit };
}

const pdf = { originalname: 'Quote.pdf', buffer: Buffer.from('%PDF-1.4 test'), size: 12 };

describe('ContactFilesService.upload', () => {
  it('refuses a request without a file before any bytes are stored', async () => {
    const { svc, media } = build();
    await expect(
      RequestContextStore.run(ctx, () => svc.upload(CONTACT, undefined)),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      RequestContextStore.run(ctx, () => svc.upload(CONTACT, { ...pdf, size: 0 })),
    ).rejects.toBeInstanceOf(AppError);
    expect(media.store).not.toHaveBeenCalled();
  });

  it('stores the bytes as a contact file and records the type and size the server read', async () => {
    const { svc, media, repo, outbox, audit } = build();
    const out = await RequestContextStore.run(ctx, () => svc.upload(CONTACT, pdf));

    expect(media.store).toHaveBeenCalledWith({
      orgId: 7,
      filename: 'Quote.pdf',
      buffer: pdf.buffer,
      category: 'contact_file',
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.objectContaining({
        contactId: 11,
        fileName: 'Quote.pdf',
        fileSizeBytes: 12,
        storageKey: STORED_KEY,
        mimeType: 'application/pdf',
        uploadedBy: 3,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'insert' }),
    );
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'contact_file.created' }),
    );
    expect(media.remove).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      id: FILE,
      contactId: CONTACT,
      fileName: 'Quote.pdf',
      storageKey: STORED_KEY,
    });
  });

  it('removes the stored bytes when the record cannot be written', async () => {
    const { svc, media } = build({ insertFails: true });
    await expect(RequestContextStore.run(ctx, () => svc.upload(CONTACT, pdf))).rejects.toThrow(
      'connection reset',
    );
    expect(media.remove).toHaveBeenCalledWith(7, STORED_KEY);
  });
});
