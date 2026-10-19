import { describe, expect, it, vi } from 'vitest';
import { AiCrmCopilotService } from '../../../src/modules/ai-copilot-lead-finder/ai-crm-copilot.service';
import { CompanyBriefsService } from '../../../src/modules/company-briefs/company-briefs.service';

/**
 * Both services pick an AI vendor by trying the workspace's own key first and the platform's second, over the same list of vendors. They
 * used to resolve every vendor twice, once per pass (QA task 43). Each vendor is now resolved at most once per call. The order of preference
 * is unchanged: a workspace key on any vendor beats a platform key, earlier vendors beat later ones.
 */
type Resolved = {
  key: string | null;
  source: 'workspace' | 'admin' | 'none';
  model?: string | null;
};
type Keys = Record<string, Resolved>;

function resolver(keys: Keys) {
  return vi.fn(
    async (_org: number, provider: string): Promise<Resolved> =>
      keys[provider] ?? { key: null, source: 'none' },
  );
}

const copilot = (resolve: ReturnType<typeof resolver>) => {
  const s = Object.create(AiCrmCopilotService.prototype) as AiCrmCopilotService;
  Object.assign(s, { keys: { resolve } });
  return () =>
    (s as unknown as { resolveProvider: (org: number) => Promise<unknown> }).resolveProvider(7);
};
const briefs = (resolve: ReturnType<typeof resolver>) => {
  const s = Object.create(CompanyBriefsService.prototype) as CompanyBriefsService;
  Object.assign(s, { keys: { resolve } });
  return () => (s as unknown as { resolveAi: (org: number) => Promise<unknown> }).resolveAi(7);
};

describe.each([
  ['AI copilot', copilot, 3],
  ['company briefs', briefs, 6],
] as const)('%s picks a vendor', (_name, make, vendors) => {
  it('with no key anywhere it reads each vendor once, not twice, and finds nothing', async () => {
    const resolve = resolver({});
    expect(await make(resolve)()).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(vendors);
  });

  it('stops at the first vendor that has a workspace key', async () => {
    const resolve = resolver({ anthropic: { key: 'ws-key', source: 'workspace', model: 'm1' } });
    expect(await make(resolve)()).toMatchObject({
      provider: 'anthropic',
      key: 'ws-key',
      source: 'workspace',
      model: 'm1',
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a workspace key on a later vendor beats a platform key on an earlier one', async () => {
    const resolve = resolver({
      anthropic: { key: 'platform', source: 'admin' },
      openai: { key: 'mine', source: 'workspace' },
    });
    expect(await make(resolve)()).toMatchObject({
      provider: 'openai',
      key: 'mine',
      source: 'workspace',
    });
  });

  it('with only platform keys it takes the first vendor that has one', async () => {
    const resolve = resolver({ openai: { key: 'platform', source: 'admin' } });
    expect(await make(resolve)()).toMatchObject({
      provider: 'openai',
      key: 'platform',
      source: 'admin',
    });
    expect(new Set(resolve.mock.calls.map((c) => c[1])).size).toBe(resolve.mock.calls.length);
  });

  it('never reads the same vendor twice in one call, whatever the keys are', async () => {
    const resolve = resolver({ gemini: { key: 'platform', source: 'admin' } });
    await make(resolve)();
    expect(new Set(resolve.mock.calls.map((c) => c[1])).size).toBe(resolve.mock.calls.length);
  });
});
