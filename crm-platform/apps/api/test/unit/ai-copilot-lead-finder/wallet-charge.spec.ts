import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AiCrmCopilotService } from '../../../src/modules/ai-copilot-lead-finder/ai-crm-copilot.service';
import type {
  AiCrmTurnInput,
  AiCrmTurnOutcome,
} from '../../../src/infra/providers/ai-copilot-lead-finder/ai-crm-provider.port';

/**
 * A copilot turn is up to five vendor calls and is paid for from the wallet ONCE, with the tokens of every call, when the platform's key
 * answered. A turn that dies on a later step is still charged for the steps the vendor did answer.
 */
const ctx = { requestId: 'r', orgId: 7, actorType: 'user' as const, actorId: 3, userId: 3 };
const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);

const OUTCOME: AiCrmTurnOutcome = {
  reply: 'Found 3 contacts.',
  actions: [],
  pendingWrite: null,
  promptTokens: 900,
  completionTokens: 120,
};

function make(opts: {
  source?: 'workspace' | 'admin';
  turn?: (input: AiCrmTurnInput) => Promise<AiCrmTurnOutcome>;
}) {
  const source = opts.source ?? 'admin';
  const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const keys = {
    resolve: vi.fn(async (_org: number, provider: string) =>
      provider === 'openai'
        ? { key: 'k', source, model: 'gpt-4o-mini' }
        : { key: null, source: 'none' as const },
    ),
  };
  const meter = { record: vi.fn(async () => undefined) };
  const actions = { log: vi.fn(async () => undefined) };
  const toolkit = {
    definitions: () => [],
    kindOf: () => 'read' as const,
    execute: vi.fn(),
  };
  const wallet = {
    guardCall: vi.fn(async () => undefined),
    chargeCall: vi.fn(async () => 0),
  };
  const provider = {
    runTurn: vi.fn(async (_p: string, input: AiCrmTurnInput) =>
      opts.turn ? opts.turn(input) : OUTCOME,
    ),
  };
  const redis = {
    get: vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  };
  const svc = new AiCrmCopilotService(
    db as never,
    keys as never,
    meter as never,
    actions as never,
    {} as never,
    toolkit as never,
    wallet as never,
    provider as never,
    redis as never,
  );
  return { svc, wallet, provider, meter };
}

describe('AI CRM Copilot: the wallet', () => {
  it('asks the wallet before the first vendor call and charges the turn once, with its tokens', async () => {
    const { svc, wallet, provider } = make({});
    await run(() => svc.ask('who owes me money?'));
    expect(wallet.guardCall).toHaveBeenCalledWith(7, 'admin');
    expect(wallet.guardCall.mock.invocationCallOrder[0]!).toBeLessThan(
      provider.runTurn.mock.invocationCallOrder[0]!,
    );
    expect(wallet.chargeCall).toHaveBeenCalledTimes(1);
    const charge = (wallet.chargeCall.mock.calls[0] as unknown[])[0];
    expect(charge).toMatchObject({
      orgId: 7,
      keySource: 'admin',
      label: 'AI copilot',
      source: 'ai_copilot',
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 900,
      completionTokens: 120,
    });
    expect((charge as { usageId: string }).usageId).toMatch(/^ai_copilot:7:/);
  });

  it('gives every turn its own id, so two questions are two charges', async () => {
    const { svc, wallet } = make({});
    await run(() => svc.ask('one'));
    await run(() => svc.ask('two'));
    const ids = wallet.chargeCall.mock.calls.map((c) => (c as unknown[])[0] as { usageId: string });
    expect(new Set(ids.map((i) => i.usageId)).size).toBe(2);
  });

  it("passes a workspace's own key through: the wallet takes nothing for it", async () => {
    const { svc, wallet } = make({ source: 'workspace' });
    await run(() => svc.ask('hello'));
    expect(wallet.guardCall).toHaveBeenCalledWith(7, 'workspace');
    expect(wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ keySource: 'workspace' }),
    );
  });

  it('refuses before any vendor call when the wallet cannot pay for the platform key', async () => {
    const { svc, wallet, provider } = make({});
    wallet.guardCall.mockRejectedValueOnce(
      Object.assign(new Error('empty'), { code: 'WALLET_EMPTY', status: 422 }),
    );
    await expect(run(() => svc.ask('hi'))).rejects.toMatchObject({ code: 'WALLET_EMPTY' });
    expect(provider.runTurn).not.toHaveBeenCalled();
    expect(wallet.chargeCall).not.toHaveBeenCalled();
  });

  it('still charges the steps the vendor answered when a later step throws', async () => {
    const { svc, wallet, meter } = make({
      turn: async (input) => {
        input.onUsage?.({ promptTokens: 400, completionTokens: 50 });
        input.onUsage?.({ promptTokens: 950, completionTokens: 90 });
        throw new Error('AI provider answered 502');
      },
    });
    await expect(run(() => svc.ask('hi'))).rejects.toMatchObject({
      code: 'AICRM_PROVIDER_FAILED',
    });
    expect(wallet.chargeCall).toHaveBeenCalledTimes(1);
    expect(wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 950, completionTokens: 90 }),
    );
    // The token ledger keeps its own behaviour: a turn that threw is not recorded there.
    expect(meter.record).not.toHaveBeenCalled();
  });

  it('reports zero tokens for a turn whose first vendor call failed (a zero-token call costs nothing)', async () => {
    const { svc, wallet } = make({
      turn: async () => {
        throw new Error('AI provider answered 401');
      },
    });
    await expect(run(() => svc.ask('hi'))).rejects.toMatchObject({ code: 'AICRM_PROVIDER_FAILED' });
    expect(wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 0, completionTokens: 0 }),
    );
  });
});
