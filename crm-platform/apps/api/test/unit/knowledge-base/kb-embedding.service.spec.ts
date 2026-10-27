import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { fingerprint } from '../../../src/common/stable-usage-id';
import type { KbAiPort } from '../../../src/infra/providers/knowledge-base/kb-ai.port';
import { KbAiError } from '../../../src/infra/providers/knowledge-base/kb-ai.port';
import {
  KbEmbeddingService,
  KbUnavailableError,
} from '../../../src/modules/knowledge-base/kb-embedding.service';
import { embedBatchKey } from '../../../src/modules/knowledge-base/kb.rules';
import { AiChargeService } from '../../../src/modules/wallet-message-billing/ai-charge.service';

interface Setup {
  source?: 'admin' | 'workspace' | 'none';
  walletEmpty?: boolean;
  /** The vendor's own cost for the call, when it reports one. */
  cost?: number;
  vendorFails?: boolean;
  /** A vector for the query is already cached. */
  cached?: boolean;
  /** The prompt tokens the vendor reports (default 1000). */
  tokens?: number;
}

/** The real AiChargeService over a fake billing service: the rules under test (who pays, when) are the real ones. */
function build(s: Setup = {}) {
  const settled: Array<Record<string, unknown>> = [];
  const asked: Array<[number, string]> = [];
  const held: number[] = [];
  const usage = {
    assertCanAfford: async (orgId: number, kind: string) => {
      asked.push([orgId, kind]);
      if (s.walletEmpty) throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
    },
    holdAiCall: async (orgId: number) => {
      held.push(orgId);
      if (s.walletEmpty) throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', 422);
    },
    settle: async (input: Record<string, unknown>) => {
      settled.push(input);
      return { status: 'charged', chargedMinor: 1, shortfallMinor: 0, balanceAfterMinor: 99 };
    },
  };
  const calls: unknown[] = [];
  const ai: KbAiPort = {
    embed: async (req) => {
      calls.push(req);
      if (s.vendorFails) throw new KbAiError('provider', 'down');
      return {
        vectors: req.inputs.map(() => [1, 0, 0, 0]),
        promptTokens: s.tokens ?? 1000,
        ...(s.cost === undefined ? {} : { costUsd: s.cost }),
      };
    },
  };
  const config = {
    getFresh: async () => ({ embeddingModel: 'openai/text-embedding-3-large' }),
    get: async () => ({ embeddingModel: 'openai/text-embedding-3-large' }),
    dimensionsOf: () => 4,
  };
  const keys = {
    resolve: async () => ({ key: s.source === 'none' ? null : 'sk', source: s.source ?? 'admin' }),
  };
  const meterRecorded: unknown[] = [];
  const meter = {
    guard: async () => undefined,
    record: async (_org: number, u: unknown) => void meterRecorded.push(u),
  };
  const cachedVector = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
  const redis = {
    getBuffer: async () => (s.cached ? cachedVector : null),
    set: async () => 'OK',
  };
  const svc = new KbEmbeddingService(
    config as never,
    keys as never,
    meter as never,
    new AiChargeService(usage as never),
    ai,
    redis as never,
  );
  return { svc, settled, asked, calls, meterRecorded, held };
}

describe('KbEmbeddingService and the wallet', () => {
  it('charges one batch as ONE usage, however many passages it holds', async () => {
    const { svc, settled } = build();
    await svc.embedMany(5, ['a', 'b', 'c', 'd'], 'batch-1');
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      orgId: 5,
      kind: 'ai',
      status: 'used',
      label: 'AI knowledge base indexing',
      source: 'kb_embedding',
      provider: 'openrouter',
    });
    // Priced from the model (embedding rate) when the vendor gave no figure: 1000 tokens at $0.10 per million.
    expect(settled[0]!.vendorCostUsd).toBeCloseTo(0.0001, 8);
  });

  it('prices a batch from its text, 4 characters a token, when the vendor reported no tokens', async () => {
    const { svc, settled } = build({ tokens: 0 });
    await svc.embedMany(5, ['x'.repeat(400)], 'k');
    // 100 estimated tokens at $0.10 per million.
    expect(settled[0]!.vendorCostUsd).toBeCloseTo(0.00001, 9);
  });

  it('uses the vendor cost when the answer carried one', async () => {
    const { svc, settled } = build({ cost: 0.0042 });
    await svc.embedMany(5, ['a'], 'batch-1');
    expect(settled[0]!.vendorCostUsd).toBe(0.0042);
  });

  it('names the same batch the same way every time, so a retry after a failed write bills once', async () => {
    const { svc, settled } = build();
    const batch = [
      { id: 1, text: 'one' },
      { id: 2, text: 'two' },
    ];
    const key = embedBatchKey(batch);
    await svc.embedMany(5, ['one', 'two'], key);
    await svc.embedMany(5, ['one', 'two'], key);
    expect(settled[0]!.usageId).toBe(settled[1]!.usageId);
    expect(String(settled[0]!.usageId)).toContain(key);
    // Another batch is another bill.
    await svc.embedMany(5, ['one', 'THREE'], embedBatchKey([batch[0]!, { id: 3, text: 'THREE' }]));
    expect(settled[2]!.usageId).not.toBe(settled[0]!.usageId);
  });

  it('names a batch by its texts when the caller gives no key', async () => {
    const { svc, settled } = build();
    await svc.embedMany(5, ['x', 'y']);
    await svc.embedMany(5, ['x', 'y']);
    expect(settled[0]!.usageId).toBe(settled[1]!.usageId);
    expect(String(settled[0]!.usageId)).toContain(fingerprint('x\u0000y'));
  });

  it('never charges a workspace on its own key, and never asks its wallet', async () => {
    const { svc, settled, asked } = build({ source: 'workspace', walletEmpty: true });
    const out = await svc.embedMany(5, ['a'], 'k');
    expect(out.vectors).toHaveLength(1);
    expect(settled).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it('holds the price of a platform-key call before the vendor, and never holds for a workspace key', async () => {
    const platform = build({ source: 'admin' });
    await platform.svc.embedMany(5, ['a'], 'k');
    expect(platform.held).toEqual([5]);
    const workspace = build({ source: 'workspace' });
    await workspace.svc.embedMany(5, ['a'], 'k');
    expect(workspace.held).toEqual([]);
  });

  it('refuses before the vendor when the wallet is empty, as a customer-safe unavailable error', async () => {
    const { svc, settled, calls, meterRecorded } = build({ walletEmpty: true });
    await expect(svc.embedMany(5, ['a'], 'k')).rejects.toMatchObject({
      name: 'KbUnavailableError',
      kind: 'wallet',
    });
    expect(calls).toHaveLength(0);
    expect(meterRecorded).toHaveLength(0);
    expect(settled).toHaveLength(0);
  });

  it('does not charge a failed vendor call', async () => {
    const { svc, settled } = build({ vendorFails: true });
    await expect(svc.embedMany(5, ['a'], 'k')).rejects.toBeInstanceOf(KbUnavailableError);
    expect(settled).toHaveLength(0);
  });

  it('charges a search once under the message that asked, as the search line', async () => {
    const { svc, settled } = build();
    const out = await svc.embedQuery(5, 'where is my order', 'widget:42');
    expect(out.cached).toBe(false);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      usageId: 'kb_query:widget:42',
      label: 'AI knowledge base search',
      source: 'kb_embedding',
    });
  });

  it('serves a cached query vector for free: no vendor call, no charge, no wallet question', async () => {
    const { svc, settled, calls, asked } = build({ cached: true, walletEmpty: true });
    const out = await svc.embedQuery(5, 'where is my order', 'widget:42');
    expect(out.cached).toBe(true);
    expect(calls).toHaveLength(0);
    expect(settled).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it('bills a search with no caller id under a fresh id each time', async () => {
    const { svc, settled } = build();
    await svc.embedQuery(5, 'one question');
    await svc.embedQuery(5, 'one question');
    expect(settled[0]!.usageId).not.toBe(settled[1]!.usageId);
  });
});
