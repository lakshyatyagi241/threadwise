import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { KEYS as CAMP_KEYS } from '@/features/campaigns/api/campaigns';
import { KEYS as WIZARD_KEYS } from '@/features/campaigns/wizard/api/wizard';
import { invalidateSenderLists, SENDER_LIST_KEYS } from './sender-lists';

describe('the campaign sender lists follow the numbers', () => {
  it('names exactly the two lists the campaign screens read', () => {
    expect(SENDER_LIST_KEYS).toEqual([WIZARD_KEYS.senders, CAMP_KEYS.builder]);
  });

  it('marks both lists stale (also the SMS card) and leaves other queries alone', async () => {
    const qc = new QueryClient();
    qc.setQueryData(WIZARD_KEYS.senders, { data: [], hidden: [] });
    qc.setQueryData(CAMP_KEYS.builder, { senders: [] });
    qc.setQueryData([...CAMP_KEYS.builder, 'sms'], { senders: [] });
    qc.setQueryData(CAMP_KEYS.list, { data: [] });
    await invalidateSenderLists(qc);
    expect(qc.getQueryState(WIZARD_KEYS.senders)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(CAMP_KEYS.builder)?.isInvalidated).toBe(true);
    expect(qc.getQueryState([...CAMP_KEYS.builder, 'sms'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(CAMP_KEYS.list)?.isInvalidated).toBe(false);
  });
});
