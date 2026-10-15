import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service';

/**
 * A bulk contact action used to run one SELECT per id before touching the row (up to BULK_IDS_MAX = 5000 sequential round trips).
 * It now resolves the whole batch in one query. The helper is private, so it is driven through a service with only the repo stubbed.
 */
function harness(known: Map<string, number>) {
  const idsByUuid = vi.fn(async (_tx: unknown, _org: number, uuids: string[]) => {
    return new Map(uuids.filter((u) => known.has(u)).map((u) => [u, known.get(u)!]));
  });
  const findByUuid = vi.fn();
  const service = Object.create(ContactsService.prototype) as ContactsService;
  Object.assign(service, { repo: { idsByUuid, findByUuid } });
  // a transaction whose savepoint just runs the callback, so a throw inside it fails only that row
  const tx = { transaction: async (fn: (rowTx: unknown) => Promise<unknown>) => fn(tx) };
  const run = (uuids: string[], fn: (rowTx: unknown, id: number, uuid: string) => Promise<void>) =>
    (
      service as unknown as {
        forEachRowIsolated: (
          tx: unknown,
          orgId: number,
          uuids: string[],
          fn: (rowTx: unknown, id: number, uuid: string) => Promise<void>,
        ) => Promise<{ succeeded: string[]; failed: Array<{ id: string; code: string }> }>;
      }
    ).forEachRowIsolated(tx, 7, uuids, fn);
  return { run, idsByUuid, findByUuid };
}

describe('bulk contact actions resolve ids in one query', () => {
  it('looks every id up once, however many rows the batch has', async () => {
    const uuids = Array.from({ length: 500 }, () => randomUUID());
    const { run, idsByUuid, findByUuid } = harness(new Map(uuids.map((u, i) => [u, i + 1])));
    const seen: number[] = [];
    const out = await run(uuids, async (_rowTx, id) => {
      seen.push(id);
    });
    expect(idsByUuid).toHaveBeenCalledTimes(1);
    expect(findByUuid).not.toHaveBeenCalled();
    expect(out.succeeded).toHaveLength(500);
    expect(seen).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
  });

  it('reports an unknown id as not found and carries on with the rest', async () => {
    const a = randomUUID();
    const missing = randomUUID();
    const { run } = harness(new Map([[a, 1]]));
    const out = await run([missing, a], async () => undefined);
    expect(out.succeeded).toEqual([a]);
    expect(out.failed).toEqual([
      { id: missing, code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
    ]);
  });

  it('isolates a failing row: the others still succeed and the failure carries its code', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const { run } = harness(
      new Map([
        [a, 1],
        [b, 2],
        [c, 3],
      ]),
    );
    const out = await run([a, b, c], async (_rowTx, id) => {
      if (id === 2) throw AppError.notFound('Contact');
    });
    expect(out.succeeded).toEqual([a, c]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toMatchObject({ id: b, code: ERROR_CODES.NOT_FOUND });
  });

  it('an empty batch does nothing but ask the repo once', async () => {
    const { run, idsByUuid } = harness(new Map());
    expect(await run([], async () => undefined)).toEqual({ succeeded: [], failed: [] });
    expect(idsByUuid).toHaveBeenCalledTimes(1);
  });
});
