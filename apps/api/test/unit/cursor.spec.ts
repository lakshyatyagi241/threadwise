import { describe, expect, it } from 'vitest';
import { buildPage, decodeCursor, encodeCursor } from '../../src/common/pagination/cursor';

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: new Date('2026-09-16T10:30:00.000Z'), id: 4242 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a malformed cursor instead of silently returning page one', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(() => decodeCursor(Buffer.from('no-separator').toString('base64url'))).toThrow();
  });

  it('reports hasMore only when an extra row came back', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }));

    const page = buildPage(rows, 10);
    expect(page.items).toHaveLength(10);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();
  });

  it('closes the page when the result fits exactly', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }));

    const page = buildPage(rows, 10);
    expect(page.items).toHaveLength(10);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });

  it('points the next cursor at the last returned row, not the peeked one', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }));

    const page = buildPage(rows, 3);
    // The extra row (id 4) exists only to answer hasMore. Resuming from it
    // would skip row 4 entirely on the next page.
    expect(decodeCursor(page.page.nextCursor!).id).toBe(3);
  });
});
