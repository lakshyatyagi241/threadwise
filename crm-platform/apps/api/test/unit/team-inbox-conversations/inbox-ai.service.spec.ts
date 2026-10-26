import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type InboxRewriteInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { InboxAiService } from '../../../src/modules/team-inbox-conversations/inbox-ai.service';

/** The composer's AI button is paid from the wallet when the platform's key answers, and only then. */
const ctx = {
  orgId: 1,
  userId: 9,
  actorType: 'user',
  actorId: 9,
  requestId: 'r',
  grants: new Map(),
} as never;
const input: InboxRewriteInput = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  action: 'fix',
  text: 'helo wrold',
};

function make(opts: {
  source?: 'workspace' | 'admin' | 'none';
  reply?: string | null;
  fail?: boolean;
  walletEmpty?: boolean;
}) {
  const source = opts.source ?? 'admin';
  const keys = {
    resolve: vi.fn(async () => ({ key: source === 'none' ? null : 'k', source, model: null })),
    capMaxTokens: vi.fn(async (_p: string, n: number) => n),
  };
  const meter = {
    guard: vi.fn(async (..._a: unknown[]) => undefined),
    record: vi.fn(async (..._a: unknown[]) => undefined),
  };
  const wallet = {
    guardCall: vi.fn(async (..._a: unknown[]) => {
      if (opts.walletEmpty) {
        throw new AppError(ERROR_CODES.WALLET_EMPTY, 'empty', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }),
    chargeCall: vi.fn(async (..._a: unknown[]) => 0),
  };
  const ai = {
    generate: vi.fn(async (..._a: unknown[]) => {
      if (opts.fail) throw new Error('boom');
      return opts.reply === undefined ? 'hello world' : opts.reply;
    }),
  };
  const svc = new InboxAiService(keys as never, meter as never, wallet as never, ai as never);
  return { svc, keys, meter, wallet, ai };
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

describe('the composer AI button and the wallet', () => {
  it('asks the allowance, then the wallet, then the vendor, and charges the estimated tokens once afterwards', async () => {
    const t = make({});
    const out = await run(() => t.svc.rewrite(input));
    expect(out.text).toBe('hello world');
    const first = (f: { mock: { invocationCallOrder: number[] } }) =>
      f.mock.invocationCallOrder[0]!;
    expect(first(t.meter.guard)).toBeLessThan(first(t.wallet.guardCall));
    expect(first(t.wallet.guardCall)).toBeLessThan(first(t.ai.generate));
    expect(first(t.ai.generate)).toBeLessThan(first(t.meter.record));
    expect(first(t.meter.record)).toBeLessThan(first(t.wallet.chargeCall));
    expect(t.wallet.guardCall).toHaveBeenCalledWith(1, 'admin');
    const charge = t.wallet.chargeCall.mock.calls[0]![0] as Record<string, unknown>;
    const recorded = t.meter.record.mock.calls[0]![1] as Record<string, unknown>;
    expect(charge).toMatchObject({
      orgId: 1,
      keySource: 'admin',
      label: 'AI reply assistant',
      source: 'inbox_ai',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    // The wallet is charged for the same estimated tokens the ledger got, never for something else.
    expect(charge.promptTokens).toBe(recorded.promptTokens);
    expect(charge.completionTokens).toBe(recorded.completionTokens);
    expect(charge.promptTokens as number).toBeGreaterThan(0);
    expect(typeof charge.usageId).toBe('string');
    expect(charge.usageId).not.toBe('r');
  });

  it('a workspace on its own key is handed to the wallet as workspace-paid (which takes nothing)', async () => {
    const t = make({ source: 'workspace' });
    await run(() => t.svc.rewrite(input));
    expect(t.meter.guard).not.toHaveBeenCalled();
    expect(t.wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ keySource: 'workspace' }),
    );
  });

  it('an empty wallet on the platform key is 422 WALLET_EMPTY and the vendor is never called', async () => {
    const t = make({ walletEmpty: true });
    expect(await code(run(() => t.svc.rewrite(input)))).toBe(ERROR_CODES.WALLET_EMPTY);
    expect(t.ai.generate).not.toHaveBeenCalled();
    expect(t.wallet.chargeCall).not.toHaveBeenCalled();
  });

  it('a vendor that fails is not charged, and neither is a missing key', async () => {
    const failed = make({ fail: true });
    expect(await code(run(() => failed.svc.rewrite(input)))).toBe(
      ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
    );
    expect(failed.wallet.chargeCall).not.toHaveBeenCalled();
    const none = make({ source: 'none' });
    expect(await code(run(() => none.svc.rewrite(input)))).toBe(ERROR_CODES.CAMP_AI_NO_KEY);
    expect(none.wallet.guardCall).not.toHaveBeenCalled();
    expect(none.wallet.chargeCall).not.toHaveBeenCalled();
  });

  it('a spent monthly allowance stops before the wallet is asked', async () => {
    const t = make({});
    t.meter.guard.mockRejectedValue(new Error('used'));
    expect(await code(run(() => t.svc.rewrite(input)))).toBe(ERROR_CODES.CAMP_AI_LIMIT_REACHED);
    expect(t.wallet.guardCall).not.toHaveBeenCalled();
    expect(t.ai.generate).not.toHaveBeenCalled();
  });
});
