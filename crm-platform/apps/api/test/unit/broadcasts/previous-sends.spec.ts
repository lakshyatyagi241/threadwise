import { describe, expect, it, vi } from 'vitest';
import type { PreviousSendsAudience } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  PreviousSendsService,
  previousSendContactsSql,
} from '../../../src/modules/broadcasts/previous-sends';

const ID = '11111111-1111-4111-8111-111111111111';
const text = (q: unknown): string =>
  JSON.stringify((q as { queryChunks: unknown }).queryChunks).replace(/\\n\s*/g, ' ');

describe('the contacts of previous sends', () => {
  const p = (over: Partial<PreviousSendsAudience>): PreviousSendsAudience => ({
    sends: [{ kind: 'campaign', id: ID }],
    outcome: 'all',
    ...over,
  });

  it('is nothing when no send is named', () => {
    expect(previousSendContactsSql(1, null)).toBeNull();
    expect(previousSendContactsSql(1, undefined)).toBeNull();
    expect(previousSendContactsSql(1, p({ sends: [] }))).toBeNull();
  });

  it('reads the campaign rows for a campaign, the broadcast rows for a broadcast, and both joined for a mix', () => {
    expect(text(previousSendContactsSql(1, p({})))).toContain('wp_campaign_contacts');
    expect(text(previousSendContactsSql(1, p({})))).not.toContain('broadcast_contacts');
    const b = text(previousSendContactsSql(1, p({ sends: [{ kind: 'broadcast', id: ID }] })));
    expect(b).toContain('broadcast_contacts');
    expect(b).not.toContain('wp_campaign_contacts');
    const both = text(
      previousSendContactsSql(
        1,
        p({
          sends: [
            { kind: 'broadcast', id: ID },
            { kind: 'campaign', id: ID },
          ],
        }),
      ),
    );
    expect(both).toContain('UNION');
  });

  it('puts the outcome in the condition, and a broadcast outcome it does not record matches nobody', () => {
    expect(text(previousSendContactsSql(1, p({ outcome: 'clicked' })))).toContain('r.clicked');
    expect(text(previousSendContactsSql(1, p({ outcome: 'not_read' })))).toContain(
      'read_at IS NULL',
    );
    const b = text(
      previousSendContactsSql(1, p({ sends: [{ kind: 'broadcast', id: ID }], outcome: 'replied' })),
    );
    expect(b).toContain('false');
  });
});

describe('the picker of previous sends', () => {
  const run = async (allowed: boolean) => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const rbac = { can: vi.fn().mockReturnValue({ allowed }) };
    const svc = new PreviousSendsService(rbac as never);
    await RequestContextStore.run(
      { requestId: 'r', orgId: 1, actorType: 'user', actorId: 1, userId: 1, grants: new Map() },
      () => svc.options({ execute } as never, 1),
    );
    return { execute, rbac };
  };

  it('lists broadcasts only to a person who may read broadcasts; campaigns to everyone here', async () => {
    const yes = await run(true);
    expect(yes.execute).toHaveBeenCalledTimes(2);
    expect(yes.rbac.can).toHaveBeenCalledWith(expect.anything(), 'bcast.broadcasts.read');
    const no = await run(false);
    expect(no.execute).toHaveBeenCalledTimes(1);
  });
});
