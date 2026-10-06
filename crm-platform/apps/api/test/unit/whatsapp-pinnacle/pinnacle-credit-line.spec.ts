import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { PinnacleError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.client';
import type { WabaRegistryProvider } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { PinnacleCreditLineProcessor } from '../../../src/modules/whatsapp-cloud-api-waba/pinnacle-credit-line.processor';
import type { PinnacleCreditLineJob } from '../../../src/modules/whatsapp-cloud-api-waba/pinnacle-onboarding.service';

const provider = {
  key: 'pinnacle',
  baseUrl: 'https://partners.example-bsp.com',
  providerToken: 'partner-key',
} as WabaRegistryProvider;

const jobOf = (attemptsMade = 0) =>
  ({
    data: { orgId: 7, rowId: 9, providerKey: 'pinnacle', wabaId: '100', businessId: '300' },
    attemptsMade,
  }) as unknown as Job<PinnacleCreditLineJob>;

function setup(registry: WabaRegistryProvider | undefined = provider) {
  const updates: Array<Record<string, unknown>> = [];
  const db = { txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const repo = {
    update: vi.fn(
      async (_tx: unknown, _o: number, _id: number, p: { metaPatch: Record<string, unknown> }) => {
        updates.push(p.metaPatch);
        return null;
      },
    ),
  };
  const routes = { get: () => registry };
  const pinnacle = { shareCreditLine: vi.fn(async () => undefined) };
  const proc = new PinnacleCreditLineProcessor(
    db as never,
    repo as never,
    routes as never,
    pinnacle as never,
  );
  return { proc, pinnacle, updates };
}

describe('PinnacleCreditLineProcessor', () => {
  it('shares the credit line and records it on the number', async () => {
    const { proc, pinnacle, updates } = setup();
    await expect(proc.process(jobOf())).resolves.toEqual({ shared: true });
    expect(pinnacle.shareCreditLine).toHaveBeenCalledWith(
      { baseUrl: 'https://partners.example-bsp.com', partnerKey: 'partner-key' },
      { businessId: '300', wabaId: '100' },
    );
    expect(updates[0]).toMatchObject({ credit_line_assigned: true, credit_line_error: null });
  });

  it('gives up without retrying when the provider is gone', async () => {
    const { proc, updates } = setup(null as never);
    await expect(proc.process(jobOf())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(updates[0]).toMatchObject({ credit_line_error: 'Pinnacle provider is not available' });
  });

  it('records a refusal and does not retry it', async () => {
    const { proc, pinnacle, updates } = setup();
    pinnacle.shareCreditLine.mockRejectedValueOnce(new PinnacleError('not eligible', false));
    await expect(proc.process(jobOf())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(updates[0]).toEqual({ credit_line_error: 'not eligible' });
  });

  it('lets a transient failure retry and records nothing yet', async () => {
    const { proc, pinnacle, updates } = setup();
    pinnacle.shareCreditLine.mockRejectedValueOnce(new PinnacleError('maintenance', true));
    await expect(proc.process(jobOf(1))).rejects.toBeInstanceOf(PinnacleError);
    expect(updates).toHaveLength(0);
  });
});
