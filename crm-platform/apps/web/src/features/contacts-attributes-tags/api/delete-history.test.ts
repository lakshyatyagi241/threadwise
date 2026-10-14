import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ path: string; req: Record<string, unknown> }>);
vi.mock('@/lib/api/client', () => ({
  apiFetch: (path: string, req: Record<string, unknown> = {}) => {
    calls.push({ path, req });
    return Promise.resolve({ matched: 1, changed: 1, failedCount: 0 });
  },
}));

import { bulkDelete } from './bulk';
import { deleteContact } from './contacts';

beforeEach(() => {
  calls.length = 0;
});

describe('contact delete keeps or erases the conversation history', () => {
  it('sends nothing extra by default (history is erased) and eraseHistory=false when kept', async () => {
    await deleteContact('c1');
    await deleteContact('c1', { eraseHistory: true });
    await deleteContact('c1', { eraseHistory: false });
    expect(calls.map((c) => c.req.query)).toEqual([undefined, undefined, { eraseHistory: false }]);
    expect(calls.every((c) => c.path === '/contacts/c1' && c.req.method === 'DELETE')).toBe(true);
  });

  it('bulk delete adds eraseHistory:false to the body only when kept', async () => {
    await bulkDelete({ kind: 'ids', ids: ['a', 'b'] });
    await bulkDelete({ kind: 'ids', ids: ['a', 'b'] }, { eraseHistory: false });
    expect(calls[0]!.req.body).toEqual({ ids: ['a', 'b'] });
    expect(calls[1]!.req.body).toEqual({ ids: ['a', 'b'], eraseHistory: false });
    expect(calls[1]!.path).toBe('/contacts/bulk/delete');
  });
});
