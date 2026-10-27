import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type TplAiGenerateInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { TemplateAiService } from '../../../src/modules/message-templates/template-ai.service';

/** "Build with AI" on the template form is paid from the wallet when the platform's key answers, and only then. */
const ctx = {
  orgId: 1,
  userId: 9,
  actorType: 'user',
  actorId: 9,
  requestId: 'r',
  grants: new Map(),
} as never;
const input: TplAiGenerateInput = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  metaCategory: 'UTILITY',
  language: 'en_US',
  businessName: 'Bloomly Florals',
};
const GOOD = JSON.stringify({
  template_name: 'order_update',
  body: 'Hi {{1}}, your order is on its way.',
});

function make(opts: {
  source?: 'workspace' | 'admin' | 'none';
  text?: string;
  fail?: boolean;
  walletEmpty?: boolean;
  /** The vendor's error on its first call only (a throttle, a refusal); later calls answer. */
  throttleFirst?: string;
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
  let calls = 0;
  const ai = {
    complete: vi.fn(async (..._a: unknown[]) => {
      calls += 1;
      if (opts.throttleFirst && calls === 1) throw new Error(opts.throttleFirst);
      if (opts.fail) throw new Error('boom');
      return { text: opts.text ?? GOOD, promptTokens: 300, completionTokens: 180 };
    }),
  };
  const svc = new TemplateAiService(keys as never, meter as never, wallet as never, ai as never);
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

describe('the template builder and the wallet', () => {
  it('asks the allowance, then the wallet, then the vendor, and charges the vendor tokens once afterwards', async () => {
    const t = make({});
    const out = await run(() => t.svc.generate(input));
    expect(out.template.name).toBe('order_update');
    const first = (f: { mock: { invocationCallOrder: number[] } }) =>
      f.mock.invocationCallOrder[0]!;
    expect(first(t.meter.guard)).toBeLessThan(first(t.wallet.guardCall));
    expect(first(t.wallet.guardCall)).toBeLessThan(first(t.ai.complete));
    expect(first(t.ai.complete)).toBeLessThan(first(t.meter.record));
    expect(first(t.meter.record)).toBeLessThan(first(t.wallet.chargeCall));
    expect(t.wallet.guardCall).toHaveBeenCalledWith(1, 'admin');
    expect(t.wallet.chargeCall).toHaveBeenCalledTimes(1);
    expect(t.wallet.chargeCall).toHaveBeenCalledWith({
      orgId: 1,
      keySource: 'admin',
      label: 'AI template builder',
      source: 'template_ai',
      usageId: expect.any(String),
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptTokens: 300,
      completionTokens: 180,
    });
  });

  it('each generation is its own charge, and the usage id is never the request id', async () => {
    const t = make({});
    await run(() => t.svc.generate(input));
    await run(() => t.svc.generate(input));
    const ids = t.wallet.chargeCall.mock.calls.map((c) => (c[0] as { usageId: string }).usageId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('r');
  });

  it('a workspace on its own key is handed to the wallet as workspace-paid (which takes nothing)', async () => {
    const t = make({ source: 'workspace' });
    await run(() => t.svc.generate(input));
    expect(t.meter.guard).not.toHaveBeenCalled();
    expect(t.wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ keySource: 'workspace' }),
    );
  });

  it('an empty wallet on the platform key is 422 WALLET_EMPTY and the vendor is never called', async () => {
    const t = make({ walletEmpty: true });
    expect(await code(run(() => t.svc.generate(input)))).toBe(ERROR_CODES.WALLET_EMPTY);
    expect(t.ai.complete).not.toHaveBeenCalled();
    expect(t.wallet.chargeCall).not.toHaveBeenCalled();
  });

  it('a vendor that fails is not charged; an answer that is not JSON is (the vendor did the work)', async () => {
    const failed = make({ fail: true });
    expect(await code(run(() => failed.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
    );
    expect(failed.wallet.chargeCall).not.toHaveBeenCalled();
    const prose = make({ text: 'Sure! Here is your template' });
    expect(await code(run(() => prose.svc.generate(input)))).toBe(ERROR_CODES.CAMP_AI_BAD_JSON);
    expect(prose.wallet.chargeCall).toHaveBeenCalledTimes(1);
  });

  it('a missing key and a spent allowance stop before the wallet is asked', async () => {
    const none = make({ source: 'none' });
    expect(await code(run(() => none.svc.generate(input)))).toBe(ERROR_CODES.CAMP_AI_NO_KEY);
    expect(none.wallet.guardCall).not.toHaveBeenCalled();
    const spent = make({});
    spent.meter.guard.mockRejectedValue(new Error('used'));
    expect(await code(run(() => spent.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_LIMIT_REACHED,
    );
    expect(spent.wallet.guardCall).not.toHaveBeenCalled();
    expect(spent.ai.complete).not.toHaveBeenCalled();
  });

  it('a throttled vendor is tried once more, and the draft comes back when that try answers', async () => {
    const throttled = make({ throttleFirst: 'AI provider answered 429' });
    const out = await run(() => throttled.svc.generate(input));
    expect(out.template.body).toContain('on its way');
    expect(throttled.ai.complete).toHaveBeenCalledTimes(2);
    expect(throttled.wallet.chargeCall).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('a timeout and a refusal are not tried again', async () => {
    const timedOut = make({ fail: true });
    expect(await code(run(() => timedOut.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
    );
    expect(timedOut.ai.complete).toHaveBeenCalledTimes(1);
    const refused = make({ throttleFirst: 'AI provider answered 401' });
    expect(await code(run(() => refused.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
    );
    expect(refused.ai.complete).toHaveBeenCalledTimes(1);
  });
});
