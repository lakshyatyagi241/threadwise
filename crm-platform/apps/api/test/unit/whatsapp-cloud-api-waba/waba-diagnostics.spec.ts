import { describe, expect, it, vi } from 'vitest';
import { WabaDiagnosticsService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-diagnostics.service';
import { GROUP_FIELDS } from '../../../src/modules/whatsapp-cloud-api-waba/waba-group-rules';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';

const KEY = Buffer.alloc(32, 7).toString('base64');
const config = {
  get: (k: string) =>
    ({ CREDENTIALS_ENCRYPTION_KEY: KEY, APP_URL: 'https://app.test', WHATSAPP_VERIFY_TOKEN: 'vt' })[
      k
    ],
};
const build = (
  admin: Record<string, unknown>,
  env: Record<string, unknown> = { META_APP_ID: 'A1', META_APP_SECRET: 'S1' },
) =>
  new WabaDiagnosticsService(
    {} as never,
    { refresh: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
    env as never,
    admin as never,
  );
const GROUPS = [
  'group_lifecycle_update',
  'group_participants_update',
  'group_settings_update',
  'group_status_update',
];
const COEXISTENCE = ['messages', 'smb_message_echoes', 'smb_app_state_sync', 'history'];
const fail = (status: number, message: string) =>
  WabaApiError.fromResponse(status, { error: { message } });

describe('the platform app webhook check (TW-WABA-002)', () => {
  it('asks for the app id and secret and makes no call without them', async () => {
    const getAppSubscription = vi.fn();
    const r = await build({ getAppSubscription }, {}).webhookStatus();
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('App ID') });
    expect(getAppSubscription).not.toHaveBeenCalled();
  });
  it('lists what is subscribed and what is missing; ok only with the four coexistence and the four Groups fields', async () => {
    const s = build({
      getAppSubscription: async () => ({
        hasWabaObject: true,
        fields: ['messages'],
        callbackUrl: 'https://x',
      }),
    });
    expect(await s.webhookStatus()).toMatchObject({
      ok: false,
      subscribed: ['messages'],
      missing: ['smb_message_echoes', 'smb_app_state_sync', 'history', ...GROUPS],
    });
    const all = build({
      getAppSubscription: async () => ({
        hasWabaObject: true,
        fields: [...COEXISTENCE, ...GROUPS, 'x'],
        callbackUrl: null,
      }),
    });
    expect(await all.webhookStatus()).toMatchObject({ ok: true, missing: [] });
  });
  it('is not ok when only the four coexistence fields are subscribed: the four Groups fields are reported missing', async () => {
    const s = build({
      getAppSubscription: async () => ({
        hasWabaObject: true,
        fields: COEXISTENCE,
        callbackUrl: 'https://x',
      }),
    });
    expect(await s.webhookStatus()).toMatchObject({
      ok: false,
      subscribed: COEXISTENCE,
      missing: GROUPS,
    });
  });
  it('subscribes exactly the Groups fields the ingest handles', () => {
    expect(GROUPS).toEqual([...GROUP_FIELDS]);
  });
  it('asks for all eight fields when the app is not configured (the empty result lists them)', async () => {
    const r = await build({ getAppSubscription: vi.fn() }, {}).webhookStatus();
    expect(r.missing).toEqual([...COEXISTENCE, ...GROUPS]);
  });
  it('says so when Meta has no WhatsApp subscription, rejects, or cannot be reached', async () => {
    expect(
      (
        await build({
          getAppSubscription: async () => ({ hasWabaObject: false, fields: [], callbackUrl: null }),
        }).webhookStatus()
      ).error,
    ).toMatch(/callback in the app dashboard/);
    expect(
      (
        await build({
          getAppSubscription: async () => {
            throw fail(400, 'Invalid app');
          },
        }).webhookStatus()
      ).error,
    ).toMatch(/Meta rejected the check: Invalid app/);
    expect(
      (
        await build({
          getAppSubscription: async () => {
            throw WabaApiError.network(new Error('ECONNRESET'));
          },
        }).webhookStatus()
      ).error,
    ).toMatch(/Could not reach Meta/);
  });
});

describe('one-click subscribe (TW-WABA-003)', () => {
  it('sends the union of existing and required fields to the callback Meta already has, then re-reads', async () => {
    let fields = ['messages', 'message_template_status_update'];
    const set = vi.fn(async (_a: unknown, i: { fields: string[] }) => {
      fields = i.fields;
    });
    const s = build({
      getAppSubscription: async () => ({
        hasWabaObject: true,
        fields,
        callbackUrl: 'https://old.example/hook',
      }),
      setAppSubscription: set,
    });
    const r = await s.subscribeFields();
    expect(set).toHaveBeenCalledWith(
      { id: 'A1', secret: 'S1' },
      expect.objectContaining({
        callbackUrl: 'https://old.example/hook',
        fields: [
          'messages',
          'message_template_status_update',
          'smb_message_echoes',
          'smb_app_state_sync',
          'history',
          ...GROUPS,
        ],
      }),
    );
    expect(r).toMatchObject({ ok: true, subscribedNow: true });
  });
  it("falls back to this platform's own callback, and reports Meta's refusal with the reachability hint", async () => {
    const set = vi.fn(async (_a: unknown, _i: unknown) => {
      throw fail(400, 'Callback verification failed');
    });
    const s = build({
      getAppSubscription: async () => ({
        hasWabaObject: true,
        fields: ['messages'],
        callbackUrl: null,
      }),
      setAppSubscription: set,
    });
    await expect(s.subscribeFields()).rejects.toThrow(/Meta rejected the subscribe.*verify token/);
    expect(set.mock.calls[0]![1]).toMatchObject({
      callbackUrl: expect.stringContaining('https://app.test/v2/public/webhooks/whatsapp'),
    });
  });
  it('refuses without the app id and secret, and makes no Meta call when the read itself failed', async () => {
    await expect(build({}, {}).subscribeFields()).rejects.toThrow(/App ID/);
    const set = vi.fn();
    await expect(
      build({
        getAppSubscription: async () => {
          throw fail(400, 'bad');
        },
        setAppSubscription: set,
      }).subscribeFields(),
    ).rejects.toThrow(/Meta rejected the check/);
    expect(set).not.toHaveBeenCalled();
  });
});
