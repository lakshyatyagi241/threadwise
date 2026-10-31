import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PublicApiService } from '../../../src/modules/public-api/public-api.service';

/**
 * `created` on a lead submit comes from the write that decided the match (email or phone), not from a replica read taken before it.
 */
describe('PublicApiService.submitLead: created', () => {
  const input = {
    name: 'Asha',
    email: 'asha@example.com',
    mobile: '+919811100001',
    consent: { granted: true },
    source: 'site',
    collegeTag: null,
    custom: {},
  } as never;

  function build(createOrMatch: () => Promise<{ contact: { id: string }; created: boolean }>) {
    // The replica has not seen a lead written a moment ago, so its email-only read finds nothing.
    const db = { txReplica: vi.fn(async () => ({ rows: [] })) };
    const contacts = {
      create: vi.fn(async () => ({ id: 'unused' })),
      createOrMatch: vi.fn(createOrMatch),
    };
    const svc = new PublicApiService(db as never, contacts as never);
    return { svc, contacts };
  }

  const ctx = { requestId: 't', orgId: 1, actorType: 'api_key', actorId: 9, userId: null } as const;

  it('is false when the write matched an existing contact by phone', async () => {
    const t = build(async () => ({ contact: { id: 'c-1' }, created: false }));
    const out = await RequestContextStore.run(ctx as never, () => t.svc.submitLead(input));
    expect(out).toEqual({ id: 'c-1', created: false });
    expect(t.contacts.createOrMatch).toHaveBeenCalledTimes(1);
  });

  it('is true when the write made a new contact', async () => {
    const t = build(async () => ({ contact: { id: 'c-2' }, created: true }));
    const out = await RequestContextStore.run(ctx as never, () => t.svc.submitLead(input));
    expect(out).toEqual({ id: 'c-2', created: true });
  });
});
