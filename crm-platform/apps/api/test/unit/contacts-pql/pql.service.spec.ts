import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PqlService } from '../../../src/modules/contacts-pql/pql.service';
import { LeadScoringAiError } from '../../../src/infra/providers/lead-scoring/lead-scoring-ai.port';

const TAG = '11111111-1111-4111-8111-111111111111';
const BAD = '22222222-2222-4222-8222-222222222222';
const ctx = { requestId: 'r', orgId: 1, actorType: 'user' as const, actorId: 1, userId: 7 };

function make(opts: {
  key?: string | null;
  source?: 'admin' | 'workspace' | 'none';
  text?: string;
  error?: Error;
}) {
  const db = {
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
                then: (r: (v: unknown[]) => void) => r([]),
              }),
            }),
          }),
        }),
      }),
  };
  const keys = {
    resolve: vi.fn(async () => ({
      key: opts.key ?? 'k',
      source: opts.source ?? 'admin',
      model: null,
    })),
    capMaxTokens: vi.fn(async (_p: string, n: number) => n),
  };
  const meter = { guard: vi.fn(async () => undefined), record: vi.fn(async () => undefined) };
  const ai = {
    complete: vi.fn(async () => {
      if (opts.error) throw opts.error;
      return { text: opts.text ?? '', promptTokens: 10, completionTokens: 5, costUsd: null };
    }),
  };
  const svc = new PqlService(db as never, keys as never, meter as never, ai as never);
  return { svc, keys, meter, ai };
}
const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);

describe('PqlService.translate', () => {
  it('refuses with PQL_NO_KEY when no key resolves', async () => {
    const { svc, ai } = make({ key: null, source: 'none' });
    await expect(run(() => svc.translate({ query: 'vip' }))).rejects.toMatchObject({
      code: 'PQL_NO_KEY',
    });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('guards and records tokens when the platform key pays', async () => {
    const text = JSON.stringify({ rules: null, summary: '', ignored: ['x'] });
    const { svc, meter } = make({ text });
    await run(() => svc.translate({ query: 'asdf' }));
    expect(meter.guard).toHaveBeenCalledWith(1);
    expect(meter.record).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ billedAgainst: 'admin', provider: 'openrouter' }),
    );
  });

  it('maps a refused key to 422 and a busy vendor to 502', async () => {
    const auth = make({ error: new LeadScoringAiError('auth', 'x') });
    await expect(run(() => auth.svc.translate({ query: 'a' }))).rejects.toMatchObject({
      code: 'PQL_PROVIDER_FAILED',
      status: 422,
    });
    const busy = make({ error: new LeadScoringAiError('timeout', 'x') });
    await expect(run(() => busy.svc.translate({ query: 'a' }))).rejects.toMatchObject({
      code: 'PQL_PROVIDER_FAILED',
      status: 502,
    });
  });

  it('blanks the summary and reports what was dropped when the model invents a tag', async () => {
    const rules = {
      type: 'group',
      combinator: 'and',
      children: [
        { type: 'condition', field: 'tags', operator: 'has_any', value: [BAD] },
        { type: 'condition', field: 'name', operator: 'contains', value: 'a' },
      ],
    };
    const { svc } = make({
      text: JSON.stringify({ rules, summary: `tagged ${TAG}`, ignored: [] }),
    });
    const r = await run(() => svc.translate({ query: 'tagged x named a' }));
    expect(r.summary).toBe('');
    expect(r.ignored).toContain('unknown tags');
    expect(r.rules?.children).toHaveLength(1);
  });

  it('limits one user to 30 searches a minute', async () => {
    const { svc } = make({ text: JSON.stringify({ rules: null, summary: '', ignored: [] }) });
    for (let i = 0; i < 30; i++) await run(() => svc.translate({ query: 'a' }));
    await expect(run(() => svc.translate({ query: 'a' }))).rejects.toMatchObject({ status: 429 });
  });
});
