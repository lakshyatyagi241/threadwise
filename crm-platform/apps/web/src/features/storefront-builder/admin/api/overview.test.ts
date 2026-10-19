import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const wizard = vi.fn();
const overview = vi.fn();
vi.mock('./service', () => ({ storeApi: { wizard: (s?: AbortSignal) => wizard(s), overview: (...a: unknown[]) => overview(...a) } }));

import { overviewOrNoShop } from './hooks';
import { isNoShop } from '../lib/errors';

describe('overviewOrNoShop', () => {
  it('raises "no shop yet" from the shop list without asking for the overview', async () => {
    wizard.mockResolvedValue({ shops: [], devices: [], hasSender: false });
    overview.mockClear();
    const err = await overviewOrNoShop(new QueryClient(), undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isNoShop(err)).toBe(true);
    expect(overview).not.toHaveBeenCalled();
  });

  it('asks for the overview when there is a shop', async () => {
    wizard.mockResolvedValue({ shops: [{ id: 's1' }], devices: [], hasSender: true });
    overview.mockResolvedValue({ shop: { id: 's1' } });
    const out = await overviewOrNoShop(new QueryClient(), 's1');
    expect(out).toEqual({ shop: { id: 's1' } });
    expect(overview).toHaveBeenCalledWith('s1', undefined);
  });
});
