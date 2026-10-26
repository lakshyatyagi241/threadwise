import { listContacts } from './api';
import { CALLER_MAX_CONTACTS, loadCallerEntries } from './caller-directory';

jest.mock('./api');
const listCall = jest.mocked(listContacts);

type Page = Awaited<ReturnType<typeof listContacts>>;
const contact = (id: string, name: string | null, phone: string | null) => ({ id, name, phone });
const page = (rows: ReturnType<typeof contact>[], next: string | null): Page =>
  ({ data: rows, page: { hasMore: next !== null, nextCursor: next } }) as unknown as Page;

beforeEach(() => jest.resetAllMocks());

describe('loadCallerEntries', () => {
  it('reads page after page and keeps each contact that has a number, named by its number when it has no name', async () => {
    listCall
      .mockResolvedValueOnce(
        page([contact('a', 'Asha', '+919800000001'), contact('b', 'No number', null)], 'p2'),
      )
      .mockResolvedValueOnce(
        page([contact('c', null, ' 9800000003 '), contact('d', '  ', '')], null),
      );
    await expect(loadCallerEntries()).resolves.toEqual([
      { id: 'a', name: 'Asha', phone: '+919800000001' },
      { id: 'c', name: '9800000003', phone: '9800000003' },
    ]);
    expect(listCall).toHaveBeenCalledTimes(2);
    expect(listCall).toHaveBeenNthCalledWith(1, { limit: 200, cursor: undefined }, undefined);
    expect(listCall).toHaveBeenNthCalledWith(2, { limit: 200, cursor: 'p2' }, undefined);
  });

  it('stops at the most contacts the phone is given', async () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      contact(`id${i}`, `N${i}`, `98000${String(i).padStart(5, '0')}`),
    );
    listCall.mockResolvedValue(page(rows, 'more'));
    const entries = await loadCallerEntries();
    expect(entries).toHaveLength(CALLER_MAX_CONTACTS);
    expect(listCall).toHaveBeenCalledTimes(CALLER_MAX_CONTACTS / 200);
  });

  it('lets a failed read fail, so the phone keeps the list it has', async () => {
    listCall.mockRejectedValue(new Error('offline'));
    await expect(loadCallerEntries()).rejects.toThrow('offline');
  });
});
