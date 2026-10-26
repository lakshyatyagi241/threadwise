import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { TranslationUsageService } from '../../../src/modules/localization-translation/translation-usage.service';

interface Setup {
  /** What the wallet's gate does for a paid provider. */
  gate?: 'ok' | 'empty' | 'broken';
  /** The outbox write fails (the whole accounting transaction then rolls back). */
  outboxFails?: boolean;
}

function build(s: Setup = {}) {
  const events: Array<{
    aggregateModule: string;
    aggregateId: number;
    orgId?: number;
    payload: Record<string, unknown>;
  }> = [];
  const statements: string[] = [];
  const gated: Array<[number, string]> = [];
  const tx = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      statements.push(JSON.stringify(q.queryChunks ?? []));
      return { rows: [{ id: 77 }] };
    },
  };
  const db = { txAs: async (_ctx: unknown, fn: (t: typeof tx) => unknown) => fn(tx) };
  const outbox = {
    emit: async (_tx: unknown, e: (typeof events)[number]) => {
      if (s.outboxFails) throw new Error('outbox down');
      events.push(e);
    },
  };
  const billing = {
    assertCanAfford: async (orgId: number, kind: string) => {
      gated.push([orgId, kind]);
      if (s.gate === 'empty') throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
      if (s.gate === 'broken') throw new Error('lookup failed');
    },
  };
  const svc = new TranslationUsageService(
    db as never,
    {} as never,
    outbox as never,
    billing as never,
  );
  return { svc, events, gated, statements };
}

const entry = (providerSlug: string, over: Record<string, unknown> = {}) => ({
  providerSlug,
  sourceLang: 'es',
  targetLang: 'en',
  charsIn: 100,
  charsOut: 90,
  wasFallback: false,
  textHash: 'abcdef',
  ...over,
});

describe('TranslationUsageService.canUse (the gate before a paid provider)', () => {
  it('lets a free provider and a call with no workspace through without asking the wallet', async () => {
    const { svc, gated } = build({ gate: 'empty' });
    expect(await svc.canUse(7, 'mymemory')).toBe(true);
    expect(await svc.canUse(7, 'google_gtx')).toBe(true);
    expect(await svc.canUse(null, 'deepl')).toBe(true);
    expect(gated).toHaveLength(0);
  });

  it('asks the wallet for translation before DeepL or Google Cloud', async () => {
    const { svc, gated } = build();
    expect(await svc.canUse(7, 'deepl')).toBe(true);
    expect(await svc.canUse(7, 'google_cloud')).toBe(true);
    expect(gated).toEqual([
      [7, 'translation'],
      [7, 'translation'],
    ]);
  });

  it('says no only for an empty wallet; a failed lookup lets the call through', async () => {
    expect(await build({ gate: 'empty' }).svc.canUse(7, 'deepl')).toBe(false);
    expect(await build({ gate: 'broken' }).svc.canUse(7, 'deepl')).toBe(true);
  });
});

describe('TranslationUsageService.record (the bill of a paid call)', () => {
  it('reports a paid call as one translation usage at its vendor cost, in the same transaction as the ledger row', async () => {
    const { svc, events, statements } = build();
    await svc.record(7, entry('deepl'));
    expect(statements).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ aggregateModule: 'translation', aggregateId: 77, orgId: 7 });
    // 100 characters at 20 millionths of a dollar each.
    expect(events[0]!.payload).toMatchObject({
      kind: 'translation',
      provider: 'deepl',
      source: 'translation',
      label: 'Translation',
      vendorCostUsd: 0.002,
    });
    expect(events[0]!.payload.usageId).toMatch(/^deepl:[0-9a-f]{32}$/);
  });

  it('names the same text the same way, so a repeat the cache missed is not billed twice', async () => {
    const { svc, events } = build();
    await svc.record(7, entry('deepl'));
    await svc.record(7, entry('deepl'));
    await svc.record(7, entry('deepl', { textHash: 'another' }));
    expect(events[0]!.payload.usageId).toBe(events[1]!.payload.usageId);
    expect(events[2]!.payload.usageId).not.toBe(events[0]!.payload.usageId);
  });

  it('reports nothing for a free provider, but still writes the ledger row', async () => {
    const { svc, events, statements } = build();
    await svc.record(7, entry('mymemory'));
    await svc.record(7, entry('google_gtx'));
    expect(statements).toHaveLength(2);
    expect(events).toHaveLength(0);
  });

  it('writes and reports nothing without a workspace', async () => {
    const { svc, events, statements } = build();
    await svc.record(null, entry('deepl'));
    expect(statements).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('never throws: a failing outbox is logged and the translation is still delivered', async () => {
    const { svc } = build({ outboxFails: true });
    await expect(svc.record(7, entry('deepl'))).resolves.toBeUndefined();
  });
});
