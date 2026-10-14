import { describe, expect, it } from 'vitest';
import { readFormIds, writeFormIds } from './summary-forms-store';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('the remembered forms', () => {
  it('remembers the choice per person', () => {
    const m = memory();
    writeFormIds('u1', [A, B], m);
    expect(readFormIds('u1', m)).toEqual([A, B]);
    expect(readFormIds('u2', m)).toEqual([]);
  });

  it('forgets an empty choice (all forms)', () => {
    const m = memory();
    writeFormIds('u1', [A], m);
    writeFormIds('u1', [], m);
    expect(m.data.size).toBe(0);
  });

  it('ignores damaged storage', () => {
    const m = memory();
    m.setItem('campaigns.summary.forms.u1', '{not json');
    expect(readFormIds('u1', m)).toEqual([]);
    m.setItem('campaigns.summary.forms.u1', JSON.stringify([A, '<img src=x>', 4]));
    expect(readFormIds('u1', m)).toEqual([A]);
  });

  it('works when storage is missing or throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readFormIds('u1', broken)).toEqual([]);
    expect(() => writeFormIds('u1', [A], broken)).not.toThrow();
    expect(readFormIds('u1', null)).toEqual([]);
    expect(() => writeFormIds('u1', [A], null)).not.toThrow();
  });
});
