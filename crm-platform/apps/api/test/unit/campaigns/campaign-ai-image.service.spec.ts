import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CampaignAiImageInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { CampaignAiImageRefusedError } from '../../../src/infra/providers/campaigns/campaign-ai-image.port';
import { CampaignAiImageService } from '../../../src/modules/campaigns/campaign-ai-image.service';
import { AI_IMAGE_TOKEN_EQUIVALENT } from '../../../src/modules/campaigns/campaign-ai-rules';

/** The campaign picture is paid from the wallet by the picture (not by the token) when the platform's key drew it, and only then. */
const ctx = {
  orgId: 1,
  userId: 9,
  actorType: 'user',
  actorId: 9,
  requestId: 'r',
  grants: new Map(),
} as never;
const input: CampaignAiImageInput = {
  provider: 'openai',
  model: 'gpt-image-1',
  businessName: 'Bloomly Florals',
  size: '1024x1024',
};

function make(opts: {
  source?: 'workspace' | 'admin' | 'none';
  fail?: 'vendor' | 'refused';
  walletEmpty?: boolean;
  canStore?: boolean;
}) {
  const source = opts.source ?? 'admin';
  const keys = {
    resolve: vi.fn(async () => ({ key: source === 'none' ? null : 'k', source, model: null })),
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
  const media = {
    canStore: vi.fn(async () => opts.canStore ?? true),
    upload: vi.fn(async (..._a: unknown[]) => ({ id: 'img-1' })),
  };
  const images = {
    generate: vi.fn(async (..._a: unknown[]) => {
      if (opts.fail === 'refused') throw new CampaignAiImageRefusedError('safety');
      if (opts.fail === 'vendor') throw new Error('boom');
      return { bytes: Buffer.from('png'), mime: 'image/png' };
    }),
  };
  const svc = new CampaignAiImageService(
    keys as never,
    meter as never,
    wallet as never,
    media as never,
    images as never,
  );
  return { svc, keys, meter, wallet, media, images };
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

describe('the campaign picture and the wallet', () => {
  it('asks the allowance, then the wallet, then the vendor, and charges the price of the picture once afterwards', async () => {
    const t = make({});
    await run(() => t.svc.generate(input));
    const first = (f: { mock: { invocationCallOrder: number[] } }) =>
      f.mock.invocationCallOrder[0]!;
    expect(first(t.meter.guard)).toBeLessThan(first(t.wallet.guardCall));
    expect(first(t.wallet.guardCall)).toBeLessThan(first(t.images.generate));
    expect(first(t.images.generate)).toBeLessThan(first(t.meter.record));
    expect(first(t.meter.record)).toBeLessThan(first(t.wallet.chargeCall));
    expect(t.wallet.guardCall).toHaveBeenCalledWith(1, 'admin');
    expect(t.wallet.chargeCall).toHaveBeenCalledTimes(1);
    // Tokens mean nothing for a picture: the wallet gets the per-picture price, the allowance keeps its flat token-equivalent.
    expect(t.wallet.chargeCall).toHaveBeenCalledWith({
      orgId: 1,
      keySource: 'admin',
      label: 'AI campaign image',
      source: 'campaign_ai_image',
      usageId: expect.any(String),
      provider: 'openai',
      model: 'gpt-image-1',
      promptTokens: 0,
      completionTokens: 0,
      reportedCostUsd: 0.167,
    });
    expect(t.meter.record).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ completionTokens: AI_IMAGE_TOKEN_EQUIVALENT }),
    );
  });

  it('the price follows the size asked for', async () => {
    const t = make({});
    await run(() => t.svc.generate({ ...input, size: '1536x1024' }));
    expect(t.wallet.chargeCall).toHaveBeenCalledWith(
      expect.objectContaining({ reportedCostUsd: 0.25 }),
    );
  });

  it('each picture is its own charge, and the usage id is never the request id', async () => {
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

  it('an empty wallet on the platform key is 422 WALLET_EMPTY and nothing is drawn', async () => {
    const t = make({ walletEmpty: true });
    expect(await code(run(() => t.svc.generate(input)))).toBe(ERROR_CODES.WALLET_EMPTY);
    expect(t.images.generate).not.toHaveBeenCalled();
    expect(t.wallet.chargeCall).not.toHaveBeenCalled();
  });

  it('a refused prompt, a vendor failure and local storage charge nothing', async () => {
    const refused = make({ fail: 'refused' });
    expect(await code(run(() => refused.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_IMAGE_REFUSED,
    );
    expect(refused.wallet.chargeCall).not.toHaveBeenCalled();
    const failed = make({ fail: 'vendor' });
    expect(await code(run(() => failed.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_PROVIDER_FAILED,
    );
    expect(failed.wallet.chargeCall).not.toHaveBeenCalled();
    const local = make({ canStore: false });
    expect(await code(run(() => local.svc.generate(input)))).toBe(
      ERROR_CODES.CAMP_AI_STORAGE_REQUIRED,
    );
    expect(local.images.generate).not.toHaveBeenCalled();
    expect(local.wallet.chargeCall).not.toHaveBeenCalled();
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
    expect(spent.images.generate).not.toHaveBeenCalled();
  });
});
