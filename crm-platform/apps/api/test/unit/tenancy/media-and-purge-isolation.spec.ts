import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { StoragePurgeService } from '../../../src/modules/workspaces-teams-tenancy/lifecycle/storage-purge.service';

/**
 * MT-064 (temporary files and links), MT-059/061 (a foreign key never resolves) and MT-071 (retention deletes only the
 * erased workspace's own objects). No database, bucket or disk: the collaborators are recorded.
 */
function mediaStore() {
  const gateway = {
    destination: vi.fn(async () => ({ disk: 'cloud' })),
    url: vi.fn(async () => 'https://bucket.example/signed'),
    remove: vi.fn(async () => undefined),
  };
  const local = {
    stat: vi.fn(async () => null),
    open: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
  };
  const store = new ChatMediaStore(gateway as never, {} as never, local as never, {} as never);
  return { store, gateway, local };
}

describe('MT-064/061: a key of another workspace never resolves, mints a link or deletes', () => {
  const foreign = 'chat/9/abcd1234.pdf';

  it('ownsKey is a strict workspace prefix and refuses traversal', () => {
    const { store } = mediaStore();
    expect(store.ownsKey(7, 'chat/7/abcd.pdf')).toBe(true);
    expect(store.ownsKey(7, foreign)).toBe(false);
    expect(store.ownsKey(7, 'chat/70/abcd.pdf')).toBe(false);
    expect(store.ownsKey(7, 'chat/7/../9/abcd.pdf')).toBe(false);
    expect(store.ownsKey(7, 'storage/chat/9/abcd.pdf')).toBe(false);
  });

  it('open() of a foreign key returns nothing and touches neither disk nor bucket', async () => {
    const { store, gateway, local } = mediaStore();
    expect(await store.open(7, foreign)).toBeNull();
    expect(local.stat).not.toHaveBeenCalled();
    expect(gateway.destination).not.toHaveBeenCalled();
  });

  it('a temporary public link is never minted for a foreign key, and is for an own key', async () => {
    const { store, gateway } = mediaStore();
    expect(await store.temporaryPublicLink(7, foreign, 300)).toBeNull();
    expect(gateway.url).not.toHaveBeenCalled();
    const own = await store.temporaryPublicLink(7, 'chat/7/abcd.pdf', 300);
    expect(own?.url).toBe('https://bucket.example/signed');
    expect(own!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(own!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300_000 + 1000);
  });

  it('remove() of a foreign key deletes nothing', async () => {
    const { store, gateway, local } = mediaStore();
    await store.remove(7, foreign);
    expect(local.remove).not.toHaveBeenCalled();
    expect(gateway.remove).not.toHaveBeenCalled();
  });
});

describe("MT-071 / TI-022: the erase purge deletes only the erased workspace's objects", () => {
  function purge(rows: Array<{ id: number; org_id: number; storage_key: string }>) {
    const updates: string[] = [];
    const tx = {
      execute: vi.fn(async (q: SQL) => {
        const text = new PgDialect().sqlToQuery(q).sql;
        if (text.includes('SELECT id, org_id, storage_key')) return { rows };
        updates.push(text);
        return { rows: [] };
      }),
    };
    const db = { privileged: async (fn: (t: unknown) => Promise<number>) => fn(tx) };
    const media = { remove: vi.fn(async () => undefined) };
    const chat = { remove: vi.fn(async () => undefined) };
    const svc = new StoragePurgeService(db as never, media as never, chat as never);
    return { svc, media, chat, updates };
  }

  it('deletes a key under the workspace prefix through both doors', async () => {
    const { svc, media, chat } = purge([{ id: 1, org_id: 7, storage_key: 'chat/7/a.png' }]);
    await svc.pass();
    expect(chat.remove).toHaveBeenCalledWith(7, 'chat/7/a.png');
    expect(media.remove).toHaveBeenCalledWith('chat/7/a.png');
  });

  it("never deletes another workspace's object, however the key is dressed", async () => {
    const dressed = [
      'chat/9/a.png',
      'storage/chat/9/a.png',
      '/chat/9/a.png',
      '  storage/chat/9/a.png',
      'chat/7/../9/a.png',
      'uploads/a.png',
    ];
    const { svc, media, chat, updates } = purge(
      dressed.map((k, i) => ({ id: i + 1, org_id: 7, storage_key: k })),
    );
    const n = await svc.pass();
    expect(n).toBe(dressed.length);
    expect(media.remove).not.toHaveBeenCalled();
    expect(chat.remove).not.toHaveBeenCalled();
    // each refused row is parked with the reason (not retried like a transient failure) and never marked purged
    expect(updates.filter((u) => u.includes('not under this workspace')).length).toBe(
      dressed.length,
    );
    expect(updates.some((u) => u.includes('attempts = attempts + 1'))).toBe(false);
    expect(updates.some((u) => u.includes('purged_at = now()'))).toBe(false);
  });
});
