import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { ContactBulkService } from '../../../src/modules/crm/contact-bulk/contact-bulk.service';

const A = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e0a';
const B = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e0b';

type ConsentEvent = { channel: string; action: string };

/**
 * The bulk consent action with the database, the repository and the consent ledger faked. The filter resolves to contacts A and B,
 * through `resolve` and `repo.uuids`, which the test counts.
 */
function bulk(recordOne: (uuid: string, event: ConsentEvent) => Promise<boolean>) {
  const ledger = { recordOne: vi.fn(recordOne) };
  const repo = { uuids: vi.fn(async () => [A, B]) };
  const db = { tx: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  const service = new ContactBulkService(
    db as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ledger as never,
  );
  const resolve = vi
    .spyOn(service as unknown as { resolve: () => Promise<unknown> }, 'resolve')
    .mockResolvedValue({ where: {}, idsMode: false, matched: 2, foundUuids: [], requested: [] });
  return { service, ledger, repo, resolve };
}

const withdrawal = { filter: {}, channels: ['whatsapp', 'sms'], action: 'withdrawn' } as never;
const scope = {} as never;

describe('bulk marketing consent on a filter selection', () => {
  it('resolves the filter once and applies every channel to that same set', async () => {
    const { service, ledger, repo, resolve } = bulk(async () => true);

    await service.consent(withdrawal, scope);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(repo.uuids).toHaveBeenCalledTimes(1);
    expect(ledger.recordOne.mock.calls.map(([uuid, event]) => [uuid, event.channel])).toEqual([
      [A, 'whatsapp'],
      [A, 'sms'],
      [B, 'whatsapp'],
      [B, 'sms'],
    ]);
  });

  it('counts the contacts changed, not the events recorded', async () => {
    const { service } = bulk(async (uuid, event) => uuid === A && event.channel === 'whatsapp');

    const out = await service.consent(withdrawal, scope);

    expect(out).toMatchObject({ matched: 2, changed: 1, failedCount: 0 });
  });

  it('lists a contact a channel refuses, stops that contact and runs the rest', async () => {
    const refused = new AppError(
      ERROR_CODES.CONSENT_CONTACT_NOT_FOUND,
      'Contact not found',
      HttpStatus.NOT_FOUND,
    );
    const { service, ledger } = bulk(async (uuid, event) => {
      if (uuid === B && event.channel === 'whatsapp') throw refused;
      return true;
    });

    const out = await service.consent(withdrawal, scope);

    expect(out.failed).toEqual([
      expect.objectContaining({ id: B, code: ERROR_CODES.CONSENT_CONTACT_NOT_FOUND }),
    ]);
    expect(out).toMatchObject({ matched: 2, changed: 1, failedCount: 1 });
    expect(ledger.recordOne.mock.calls.map(([uuid, event]) => [uuid, event.channel])).toEqual([
      [A, 'whatsapp'],
      [A, 'sms'],
      [B, 'whatsapp'],
    ]);
  });
});
