import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { factsHash, type BriefFacts } from '../../../src/modules/company-briefs/brief-rules';
import { CompanyBriefsService } from '../../../src/modules/company-briefs/company-briefs.service';
import type { BriefRow } from '../../../src/modules/company-briefs/company-briefs.repository';

const FACTS: BriefFacts = {
  company: { name: 'Acme', industry: null, size: null, createdOn: '2026-01-01', hasOwner: false },
  properties: [],
  contacts: { total: 1, byStage: { lead: 1 }, lastActivityOn: null },
  deals: null,
  tasks: null,
  conversations: null,
};
const GOOD = JSON.stringify({
  summary: 'Acme is a small account.',
  sections: [{ key: 'nextSteps', bullets: ['Call them'] }],
});

const ctx = {
  orgId: 1,
  userId: 9,
  actorType: 'user',
  actorId: 9,
  requestId: 'r',
  grants: new Map(),
} as never;

function make(opts: {
  existing?: Partial<BriefRow>;
  key?: { provider?: string; source: 'workspace' | 'admin' | 'none' };
  text?: string;
  fail?: boolean;
  facts?: BriefFacts;
}) {
  let stored: BriefRow | undefined = opts.existing
    ? ({
        uuid: 'b-1',
        inputHash: factsHash(opts.facts ?? FACTS),
        content: { summary: 'old', sections: [] },
        provider: 'openai',
        model: 'gpt-4o-mini',
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        ...opts.existing,
      } as BriefRow)
    : undefined;
  const db = { tx: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const repo = {
    find: vi.fn(async () => stored),
    upsert: vi.fn(
      async (
        _tx: unknown,
        _org: number,
        v: { content: BriefRow['content']; inputHash: string; provider: string; model: string },
      ) => {
        const replaced = stored !== undefined;
        stored = {
          uuid: 'b-1',
          inputHash: v.inputHash,
          content: v.content,
          provider: v.provider,
          model: v.model,
          updatedAt: new Date(),
        };
        return { row: stored, replaced };
      },
    ),
  };
  const facts = {
    gather: vi.fn(async () => ({ companyId: 5, companyName: 'Acme', facts: opts.facts ?? FACTS })),
  };
  const keys = {
    resolve: vi.fn(async (_org: number, provider: string) =>
      opts.key && opts.key.source !== 'none' && provider === (opts.key.provider ?? 'openai')
        ? { key: 'k', source: opts.key.source, model: null }
        : { key: null, source: 'none', model: null },
    ),
    capMaxTokens: vi.fn(async (_p: string, n: number) => n),
  };
  const meter = {
    guard: vi.fn(async (..._args: unknown[]) => undefined),
    record: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const audit = { record: vi.fn(async (..._args: unknown[]) => undefined) };
  const ai = {
    complete: vi.fn(async (..._args: unknown[]) => {
      if (opts.fail) throw new Error('boom');
      return { text: opts.text ?? GOOD, promptTokens: 120, completionTokens: 60 };
    }),
  };
  const svc = new CompanyBriefsService(
    db as never,
    repo as never,
    facts as never,
    keys as never,
    meter as never,
    audit as never,
    ai as never,
  );
  return { svc, repo, facts, keys, meter, audit, ai };
}
const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
};

describe('Generate brief (BL-194)', () => {
  it('writes a brief with the workspace key, meters it, stores it and audits it without the facts', async () => {
    const t = make({ key: { source: 'workspace' } });
    const out = await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    expect(out.cached).toBe(false);
    expect(out.brief.content.summary).toBe('Acme is a small account.');
    expect(out.brief.stale).toBe(false);
    expect(out.brief.model).toBe('gpt-4o-mini');
    expect(t.ai.complete).toHaveBeenCalledTimes(1);
    expect(t.meter.guard).not.toHaveBeenCalled();
    expect(t.meter.record).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        billedAgainst: 'workspace',
        promptTokens: 120,
        completionTokens: 60,
      }),
    );
    const audit = t.audit.record.mock.calls[0]![1] as {
      module: string;
      action: string;
      delta: unknown;
    };
    expect(audit.module).toBe('company_briefs');
    expect(audit.action).toBe('insert');
    expect(JSON.stringify(audit.delta)).not.toContain('Acme');
  });

  it('what is sent to the model is the facts and nothing else of the company', async () => {
    const t = make({ key: { source: 'workspace' } });
    await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    const req = t.ai.complete.mock.calls[0]![0] as unknown as {
      userPrompt: string;
      json: boolean;
      apiKey: string;
    };
    expect(req.json).toBe(true);
    expect(JSON.parse(req.userPrompt.replace('Facts (JSON):\n', ''))).toEqual(FACTS);
  });

  it('asks the monthly allowance first when the platform key pays', async () => {
    const t = make({ key: { source: 'admin' } });
    await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    expect(t.meter.guard).toHaveBeenCalledWith(1);
    expect(t.meter.record).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ billedAgainst: 'admin' }),
    );
  });

  it('prefers the workspace own key over the platform key of an earlier vendor', async () => {
    const t = make({ key: { source: 'workspace', provider: 'gemini' } });
    await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    expect((t.ai.complete.mock.calls[0]![0] as unknown as { provider: string }).provider).toBe(
      'gemini',
    );
  });

  it('returns the stored brief for the same facts within a day and calls nothing', async () => {
    const t = make({ key: { source: 'workspace' }, existing: {} });
    const out = await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    expect(out.cached).toBe(true);
    expect(out.brief.content.summary).toBe('old');
    expect(t.ai.complete).not.toHaveBeenCalled();
    expect(t.meter.record).not.toHaveBeenCalled();
  });

  it('regenerate writes again and replaces the stored brief', async () => {
    const t = make({ key: { source: 'workspace' }, existing: {} });
    const out = await run(() => t.svc.generate('c-1', 'all', { regenerate: true }));
    expect(out.cached).toBe(false);
    expect(t.ai.complete).toHaveBeenCalledTimes(1);
    expect((t.audit.record.mock.calls[0]![1] as { action: string }).action).toBe('update');
  });

  it('writes again when the CRM changed since (different facts), even without regenerate', async () => {
    const t = make({
      key: { source: 'workspace' },
      existing: { inputHash: 'something-else' },
    });
    const out = await run(() => t.svc.generate('c-1', 'all', { regenerate: false }));
    expect(out.cached).toBe(false);
    expect(t.ai.complete).toHaveBeenCalledTimes(1);
  });

  it('a second generation within 30 seconds is refused, and costs nothing', async () => {
    const t = make({ key: { source: 'workspace' }, existing: { updatedAt: new Date() } });
    expect(await code(run(() => t.svc.generate('c-1', 'all', { regenerate: true })))).toBe(
      ERROR_CODES.COMPANY_BRIEF_RATE_LIMITED,
    );
    expect(t.ai.complete).not.toHaveBeenCalled();
  });

  it('with no key anywhere it says so, and sends nothing', async () => {
    const t = make({ key: { source: 'none' } });
    expect(await code(run(() => t.svc.generate('c-1', 'all', { regenerate: false })))).toBe(
      ERROR_CODES.COMPANY_BRIEF_AI_UNAVAILABLE,
    );
    expect(t.ai.complete).not.toHaveBeenCalled();
  });

  it('a failing provider is a 502 and the stored brief is kept', async () => {
    const t = make({ key: { source: 'workspace' }, existing: { inputHash: 'old' }, fail: true });
    expect(await code(run(() => t.svc.generate('c-1', 'all', { regenerate: false })))).toBe(
      ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED,
    );
    expect(t.repo.upsert).not.toHaveBeenCalled();
  });

  it('an answer that is not a brief is a 502 too (but the tokens it used are recorded)', async () => {
    const t = make({ key: { source: 'workspace' }, text: 'Sure! Here is a brief.' });
    expect(await code(run(() => t.svc.generate('c-1', 'all', { regenerate: false })))).toBe(
      ERROR_CODES.COMPANY_BRIEF_PROVIDER_FAILED,
    );
    expect(t.meter.record).toHaveBeenCalledTimes(1);
    expect(t.repo.upsert).not.toHaveBeenCalled();
  });

  it('state: tells whether a brief can be written and whether the stored one is out of date, calling no model', async () => {
    const stale = make({ key: { source: 'workspace' }, existing: { inputHash: 'old' } });
    const a = await run(() => stale.svc.state('c-1', 'all'));
    expect(a.available).toBe(true);
    expect(a.brief?.stale).toBe(true);
    expect(a.sources.contacts).toBe(true);
    expect(a.sources.deals).toBe(false);
    const fresh = make({ key: { source: 'none' }, existing: {} });
    const b = await run(() => fresh.svc.state('c-1', 'all'));
    expect(b.available).toBe(false);
    expect(b.brief?.stale).toBe(false);
    expect(stale.ai.complete).not.toHaveBeenCalled();
    expect(fresh.ai.complete).not.toHaveBeenCalled();
  });
});
