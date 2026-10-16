import { describe, expect, it } from 'vitest';
import type { LeadPullProvider } from '../../../src/modules/leads/lead-pull.port';
import { LeadPullRegistry } from '../../../src/modules/leads/lead-pull.registry';

const source = { id: 1, uuid: 's', kind: 'connector', providerKey: null, externalRef: 'x' };
const caps = { sync: true, backfill: false, minIntervalSeconds: 0, maxBackfillSeconds: 0 };
const provider = (name: string, answer: unknown): LeadPullProvider => ({
  name,
  capabilities: async () => {
    if (answer instanceof Error) throw answer;
    return answer as never;
  },
  pull: async () => ({
    status: 'ok',
    progress: {
      fetched: 0,
      accepted: 0,
      duplicates: 0,
      failed: 0,
      windowsDone: 0,
      windowsTotal: 0,
    },
  }),
});

describe('LeadPullRegistry', () => {
  it('has no source it can pull without a provider', async () => {
    expect(await new LeadPullRegistry().resolve(1, source)).toBeUndefined();
  });

  it('gives a source to the first provider that recognises it', async () => {
    const r = new LeadPullRegistry();
    r.register(provider('a', null));
    r.register(provider('b', caps));
    r.register(provider('c', { ...caps, backfill: true }));
    const found = await r.resolve(1, source);
    expect(found?.provider.name).toBe('b');
    expect(found?.capabilities).toEqual(caps);
  });

  it('a provider that can neither sync nor backfill does not own the source', async () => {
    const r = new LeadPullRegistry();
    r.register(provider('idle', { ...caps, sync: false }));
    expect(await r.resolve(1, source)).toBeUndefined();
  });

  it('a provider that fails does not hide the sources of the others', async () => {
    const r = new LeadPullRegistry();
    r.register(provider('broken', new Error('bad reference')));
    r.register(provider('good', caps));
    expect((await r.resolve(1, source))?.provider.name).toBe('good');
  });

  it('registers a provider once', async () => {
    const r = new LeadPullRegistry();
    r.register(provider('same', null));
    r.register(provider('same', caps));
    expect(await r.resolve(1, source)).toBeUndefined();
  });
});
