import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshGoogleAccount } from './google-account';

describe('refreshGoogleAccount', () => {
  it('marks the account page and the flow builder Google answers stale, and nothing else', async () => {
    const qc = new QueryClient();
    const keys = [
      ['google-account'],
      ['google-account', 'calendars'],
      ['flb', 'google', 'status'],
      ['flb', 'google', 'sheets'],
      ['flb', 'flows'],
    ];
    for (const k of keys) qc.setQueryData(k, 1);
    await refreshGoogleAccount(qc);
    const stale = keys.map((k) => qc.getQueryState(k)!.isInvalidated);
    expect(stale).toEqual([true, true, true, true, false]);
  });
});
