import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SetupRunRequest } from '@crm/contracts';
import { SetupService } from '../../../src/modules/install-update-licensing/setup.service';

/**
 * The first workspace's app URL comes from the validated config, not from a raw process.env read: with WEB_APP_URL unset
 * the schema default must be stored, never null.
 */
const DEFAULT_WEB_APP_URL = 'http://localhost:3001';

function build(app: { url: string } | undefined) {
  const linkProvisioned = vi.fn(async () => undefined);
  const tx = {};
  const repo = {
    state: vi.fn(async () => ({ firstOperatorId: null, foreignOperators: 0, completedAt: null })),
    lockRow: vi.fn(async () => ({ completedAt: null, firstOperatorId: null })),
    insertOperator: vi.fn(async () => ({ id: 7, uuid: 'op-uuid' })),
    linkProvisioned,
  };
  const provisionResult = { org: { id: 3, uuid: 'org-uuid' } };
  const tenants = {
    provisionOrganization: vi.fn(
      async (_input: unknown, inTx: (t: unknown, r: unknown) => Promise<void>) => {
        await inTx(tx, provisionResult);
        return provisionResult;
      },
    ),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'WEB_APP_URL' ? DEFAULT_WEB_APP_URL : undefined)),
  };
  const service = new SetupService(
    { tx: async (fn: (t: unknown) => unknown) => fn(tx) } as never,
    tenants as never,
    repo as never,
    {} as never,
    { info: { version: '1.0.0' } } as never,
    { hash: async () => 'hash' } as never,
    { record: vi.fn(async () => undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
  );
  const input = {
    organization: { name: 'Acme', slug: 'acme', locale: 'en', timezone: 'UTC' },
    operator: { email: 'owner@acme.test', fullName: 'Owner', password: 'x'.repeat(16) },
    app,
  } as unknown as SetupRunRequest;
  const account = (
    service as unknown as { account(i: SetupRunRequest): Promise<void> }
  ).account.bind(service);
  return { account, input, linkProvisioned, config };
}

describe('SetupService.account app URL', () => {
  const saved = process.env.WEB_APP_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.WEB_APP_URL;
    else process.env.WEB_APP_URL = saved;
  });

  it('stores the validated default when the form omits the URL and WEB_APP_URL is unset', async () => {
    delete process.env.WEB_APP_URL;
    const { account, input, linkProvisioned } = build(undefined);

    await account(input);

    expect(linkProvisioned).toHaveBeenCalledTimes(1);
    expect(linkProvisioned.mock.calls[0]?.[1]).toMatchObject({ appUrl: DEFAULT_WEB_APP_URL });
  });

  it('prefers the URL the setup form sends over the configured default', async () => {
    delete process.env.WEB_APP_URL;
    const { account, input, linkProvisioned } = build({ url: 'https://crm.acme.test' });

    await account(input);

    expect(linkProvisioned.mock.calls[0]?.[1]).toMatchObject({ appUrl: 'https://crm.acme.test' });
  });
});
