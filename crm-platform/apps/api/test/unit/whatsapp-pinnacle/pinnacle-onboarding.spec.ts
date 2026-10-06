import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { PinnacleError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.client';
import type { WabaRegistryProvider } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import {
  PinnacleOnboardingService,
  pinnacleRouteOf,
} from '../../../src/modules/whatsapp-cloud-api-waba/pinnacle-onboarding.service';

const registry = (over: Partial<WabaRegistryProvider> = {}): WabaRegistryProvider => ({
  key: 'pinnacle',
  builtin: null,
  status: 'active',
  baseUrl: 'https://partners.example-bsp.com/',
  apiVersion: 'v3',
  authScheme: 'custom_headers',
  headerTemplates: { apikey: '{{channelToken}}' },
  credentialMode: 'channel_token',
  webhookMode: 'number_level_override',
  signatureScheme: 'meta_app_secret_sha256',
  signatureHeaderName: null,
  capabilities: { mediaUpload: false },
  partnerProgram: 'pinnacle',
  partnerSolutionId: '1829345157783527',
  onboardingConfigId: '707200291383635',
  providerToken: 'partner-key',
  ...over,
});

const ctx = { requestId: 'r', orgId: 7, actorType: 'user' as const, actorId: 3, userId: 3 };

function setup(over: { registry?: WabaRegistryProvider; namespace?: string | null } = {}) {
  const db = {
    tx: async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: async () => ({
          rows: [{ email: 'a@b.co', full_name: 'Asha Rao', phone: null }],
        }),
      }),
  };
  const http = {
    graph: vi.fn(async () =>
      over.namespace === null ? {} : { message_template_namespace: over.namespace ?? 'ns_1' },
    ),
  };
  const pinnacle = {
    createAccount: vi.fn(async () => ({ apiKey: 'client-key', username: 'u', password: 'p' })),
    sendEmbeddedDetails: vi.fn(async () => undefined),
    shareCreditLine: vi.fn(),
  };
  const queue = { add: vi.fn(async () => undefined) };
  const svc = new PinnacleOnboardingService(
    db as never,
    http as never,
    pinnacle as never,
    readWabaEnv({ META_SYSTEM_USER_TOKEN: 'sys-token' }),
    queue as never,
  );
  const input = {
    registry: over.registry ?? registry(),
    wabaId: '100',
    phoneNumberId: '200',
    displayPhoneNumber: '+91 73857 11141',
    businessId: '300',
    accessToken: 'meta-token',
  };
  return { svc, http, pinnacle, queue, input };
}

describe('PinnacleOnboardingService', () => {
  it('applies only to a provider with the pinnacle program', () => {
    expect(PinnacleOnboardingService.applies(registry())).toBe(true);
    expect(PinnacleOnboardingService.applies(registry({ partnerProgram: null }))).toBe(false);
    expect(PinnacleOnboardingService.applies(null)).toBe(false);
  });

  it('reads the route from the registry row and trims the slash', () => {
    expect(pinnacleRouteOf(registry())).toEqual({
      baseUrl: 'https://partners.example-bsp.com',
      partnerKey: 'partner-key',
    });
    expect(pinnacleRouteOf(registry({ providerToken: undefined }))).toBeNull();
  });

  it('creates the account, sends the embedded details, and hands back the client key', async () => {
    const { svc, http, pinnacle, input } = setup();
    const out = await RequestContextStore.run(ctx, () => svc.onboard(input));
    expect(out).toEqual({ channelToken: 'client-key', username: 'u', password: 'p' });
    // the platform's system user reads the namespace, not the client's token
    expect(http.graph).toHaveBeenCalledWith('sys-token', expect.objectContaining({ path: '/100' }));
    expect(pinnacle.createAccount).toHaveBeenCalledWith(
      { baseUrl: 'https://partners.example-bsp.com', partnerKey: 'partner-key' },
      expect.objectContaining({
        templateNamespace: 'ns_1',
        wabaId: '100',
        email: 'a@b.co',
        firstName: 'Asha',
        lastName: 'Rao',
        // no phone on the user: the WABA's own number stands in
        mobileNo: '+91 73857 11141',
      }),
    );
    expect(pinnacle.sendEmbeddedDetails).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        configId: '707200291383635',
        solutionId: '1829345157783527',
        accessToken: 'meta-token',
        businessId: '300',
      }),
    );
  });

  it.each([
    ['partner key', { providerToken: undefined }],
    ['solution id', { partnerSolutionId: null }],
  ])('names a missing %s and calls nothing', async (_n, over) => {
    const { svc, pinnacle, input } = setup({ registry: registry(over) });
    const err = await RequestContextStore.run(ctx, () => svc.onboard(input)).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('WAP_PARTNER_NOT_CONFIGURED');
    expect(pinnacle.createAccount).not.toHaveBeenCalled();
  });

  it('stops when Meta gives no template namespace', async () => {
    const { svc, pinnacle, input } = setup({ namespace: null });
    const err = await RequestContextStore.run(ctx, () => svc.onboard(input)).catch((e) => e);
    expect((err as AppError).code).toBe('WAP_PARTNER_REFUSED');
    expect(pinnacle.createAccount).not.toHaveBeenCalled();
  });

  it("shows Pinnacle's own refusal as 422, and a transient one as 502", async () => {
    const a = setup();
    a.pinnacle.createAccount.mockRejectedValueOnce(
      new PinnacleError('WABA already onboarded', false),
    );
    const refused = await RequestContextStore.run(ctx, () => a.svc.onboard(a.input)).catch(
      (e) => e,
    );
    expect((refused as AppError).code).toBe('WAP_PARTNER_REFUSED');
    expect((refused as AppError).status).toBe(422);
    expect((refused as AppError).message).toContain('WABA already onboarded');
    expect(a.pinnacle.sendEmbeddedDetails).not.toHaveBeenCalled();

    const b = setup();
    b.pinnacle.sendEmbeddedDetails.mockRejectedValueOnce(new PinnacleError('maintenance', true));
    const down = await RequestContextStore.run(ctx, () => b.svc.onboard(b.input)).catch((e) => e);
    expect((down as AppError).status).toBe(502);
  });

  it('schedules the credit-line share delayed, once per number', async () => {
    const { svc, queue } = setup();
    await svc.scheduleCreditLine({
      orgId: 7,
      rowId: 9,
      providerKey: 'pinnacle',
      wabaId: '100',
      businessId: '300',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'share',
      expect.objectContaining({ rowId: 9 }),
      expect.objectContaining({ jobId: 'pinnacle-credit-9', delay: 200_000, attempts: 6 }),
    );
  });

  it('does not fail the connect when the queue is down', async () => {
    const { svc, queue } = setup();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      svc.scheduleCreditLine({
        orgId: 7,
        rowId: 9,
        providerKey: 'pinnacle',
        wabaId: '100',
        businessId: '300',
      }),
    ).resolves.toBeUndefined();
  });
});
