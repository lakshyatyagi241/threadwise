import { describe, expect, it } from 'vitest';
import type { WabaConnection } from '@crm/contracts';
import { connectionLabel, summarizeSync, syncTargets, usableConnections } from './sync';

const conn = (over: Partial<WabaConnection>) =>
  ({
    id: 'a',
    status: 'connected',
    hasToken: true,
    displayLabel: null,
    phoneNumber: null,
    verifiedName: null,
    ...over,
  }) as WabaConnection;

describe('sync', () => {
  it('adds up the numbers that worked and counts the ones that failed', () => {
    expect(
      summarizeSync([
        { created: 2, updated: 1, missing: 0, total: 3 },
        null,
        { created: 1, updated: 0, missing: 4, total: 5 },
      ]),
    ).toEqual({ created: 3, updated: 1, missing: 4, total: 8, failed: 1, succeeded: 2 });
  });

  it('syncs the chosen number, or every connected one', () => {
    const list = [
      conn({ id: 'a' }),
      conn({ id: 'b' }),
      conn({ id: 'c', status: 'disconnected' }),
      conn({ id: 'd', hasToken: false }),
    ];
    expect(syncTargets(list, 'b')).toEqual(['b']);
    expect(syncTargets(list, 'zzz')).toEqual([]);
    expect(syncTargets(list, undefined)).toEqual(['a', 'b']);
    expect(usableConnections(list).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('names a number by label, then phone, then verified name', () => {
    expect(
      connectionLabel({ displayLabel: 'Sales', phoneNumber: '+1', verifiedName: 'Acme' }),
    ).toBe('Sales');
    expect(connectionLabel({ displayLabel: null, phoneNumber: '+1', verifiedName: 'Acme' })).toBe(
      '+1',
    );
    expect(connectionLabel({ displayLabel: null, phoneNumber: null, verifiedName: 'Acme' })).toBe(
      'Acme',
    );
  });
});
