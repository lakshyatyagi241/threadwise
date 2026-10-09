import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFlash, peekFlash, setFlash } from './flash';

describe('save flash', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is read by the template it was left for until it is cleared', () => {
    setFlash('a', { metaError: 'Bad parameter', warnings: [] });
    expect(peekFlash('b')).toBeNull();
    expect(peekFlash('a')).toEqual({ metaError: 'Bad parameter', warnings: [] });
    expect(peekFlash('a')).not.toBeNull();
    clearFlash('a');
    expect(peekFlash('a')).toBeNull();
  });

  it('survives blocked storage and junk', () => {
    store.set('tpl-flash:x', '{not json');
    expect(peekFlash('x')).toBeNull();
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    });
    expect(() => setFlash('y', { metaError: null, warnings: [] })).not.toThrow();
    expect(peekFlash('y')).toBeNull();
  });
});
