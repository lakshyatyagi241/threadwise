import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { GoogleAccountError } from '../../../src/infra/providers/flow-runtime-engine/google-workspace.port';
import {
  GoogleFilesService,
  toApiError,
} from '../../../src/modules/google-account/google-files.service';
import { WorkspaceGoogleAccessTokens } from '../../../src/modules/google-account/workspace-google-tokens.service';
import { CalendarNotConnectedError } from '../../../src/modules/appointments-booking/google-calendar-tokens.service';

/** The thin layers between the flow nodes, the builder pickers and the workspace's Google grant. */
const run = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'r', orgId: 5, actorType: 'user', actorId: 1, userId: 1 },
    fn,
  );

describe('WorkspaceGoogleAccessTokens', () => {
  const tokensThatThrow = (err: unknown) =>
    ({ withToken: vi.fn().mockRejectedValue(err), connection: vi.fn() }) as never;

  it.each([
    ['none', 'GOOGLE_ACCOUNT_NOT_CONNECTED'],
    ['needs_reconnect', 'GOOGLE_ACCOUNT_NEEDS_RECONNECT'],
    ['not_configured', 'GOOGLE_ACCOUNT_NOT_CONFIGURED'],
    ['scope_missing', 'GOOGLE_SCOPE_MISSING'],
  ] as const)('turns a grant that cannot be used (%s) into %s', async (reason, code) => {
    const t = new WorkspaceGoogleAccessTokens(
      tokensThatThrow(new CalendarNotConnectedError(reason, 'sheets')),
    );
    const err = await t.withToken(1, 'sheets', async () => 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleAccountError);
    expect(err).toMatchObject({ code, capability: 'sheets' });
  });

  it('names the capability the grant lacks, whichever the caller asked for', async () => {
    const t = new WorkspaceGoogleAccessTokens(
      tokensThatThrow(new CalendarNotConnectedError('scope_missing', 'docs')),
    );
    await expect(t.withToken(1, 'sheets', async () => 1)).rejects.toMatchObject({
      code: 'GOOGLE_SCOPE_MISSING',
      capability: 'docs',
    });
  });

  it("lets Google's own failures through for the adapter to classify, and hands the token to the callback", async () => {
    const boom = new Error('from google');
    const bad = new WorkspaceGoogleAccessTokens(tokensThatThrow(boom));
    await expect(bad.withToken(1, 'sheets', async () => 1)).rejects.toBe(boom);

    const withToken = vi.fn(
      async (_org: number, fn: (t: string) => Promise<string>, _opts?: unknown) => fn('tok'),
    );
    const ok = new WorkspaceGoogleAccessTokens({ withToken } as never);
    expect(await ok.withToken(1, 'forms', async (t) => `used ${t}`)).toBe('used tok');
    expect(withToken.mock.calls[0]![2]).toEqual({ capability: 'forms' });
  });

  it('answers the workspace calendar, or primary when nothing is connected', async () => {
    const some = new WorkspaceGoogleAccessTokens({
      connection: vi.fn().mockResolvedValue({ calendarId: 'team@x.co' }),
    } as never);
    expect(await some.calendarId(1)).toBe('team@x.co');
    const none = new WorkspaceGoogleAccessTokens({
      connection: vi.fn().mockResolvedValue(null),
    } as never);
    expect(await none.calendarId(1)).toBe('primary');
  });
});

describe('GoogleFilesService', () => {
  const account = (status: string, granted: string[] = []) => ({
    status,
    capabilities: ['calendar', 'sheets', 'docs', 'forms', 'drive_listing'].map((key) => ({
      key,
      granted: granted.includes(key),
      restricted: false,
    })),
  });
  const make = (status: string, listFiles = vi.fn(), granted: string[] = []) =>
    new GoogleFilesService(
      { listFiles } as never,
      { account: async () => account(status, granted) } as never,
    );

  it('lists nothing and says 503 integration-disabled while the platform has no Google client', async () => {
    const listFiles = vi.fn();
    const svc = make('unavailable', listFiles);
    await expect(run(() => svc.list('sheets'))).rejects.toMatchObject({
      code: 'FLB_INTEGRATION_DISABLED',
    });
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('lists the workspace files through the port, for the caller org only', async () => {
    const listFiles = vi.fn().mockResolvedValue([{ id: 'a', name: 'Leads' }]);
    const svc = make('connected', listFiles);
    expect(await run(() => svc.list('sheets'))).toEqual({ data: [{ id: 'a', name: 'Leads' }] });
    expect(listFiles).toHaveBeenCalledWith(5, 'sheets');
  });

  it('turns an account failure into an API error carrying the GOOGLE_ code, never Google wording', async () => {
    const svc = make(
      'connected',
      vi
        .fn()
        .mockRejectedValue(new GoogleAccountError('GOOGLE_SCOPE_MISSING', 'secret google text')),
    );
    const err = (await run(() => svc.list('docs')).catch((e: unknown) => e)) as {
      code: string;
      getStatus(): number;
      message: string;
    };
    expect(err.code).toBe('GOOGLE_SCOPE_MISSING');
    expect(err.getStatus()).toBe(409);
    expect(JSON.stringify(err)).not.toContain('secret google text');
  });

  it('summarises state and granted capabilities only (no account details)', async () => {
    const svc = make('connected', vi.fn(), ['sheets', 'forms']);
    expect(await run(() => svc.summary())).toEqual({
      status: 'connected',
      granted: ['sheets', 'forms'],
    });
  });

  it('maps every code to a status: 409 for what the workspace can fix, 422 or 503 for the platform setup, 429 and 502 for Google', () => {
    const status = (code: GoogleAccountError['code']) =>
      toApiError(new GoogleAccountError(code, 'x')).getStatus();
    expect(status('GOOGLE_ACCOUNT_NOT_CONNECTED')).toBe(409);
    expect(status('GOOGLE_ACCOUNT_NEEDS_RECONNECT')).toBe(409);
    expect(status('GOOGLE_SCOPE_MISSING')).toBe(409);
    expect(status('GOOGLE_ACCOUNT_NOT_CONFIGURED')).toBe(422);
    expect(status('GOOGLE_API_NOT_ENABLED')).toBe(503);
    expect(status('GOOGLE_RATE_LIMITED')).toBe(429);
    for (const c of [
      'GOOGLE_NOT_FOUND',
      'GOOGLE_ACCESS_DENIED',
      'GOOGLE_BAD_REQUEST',
      'GOOGLE_UNAVAILABLE',
    ] as const) {
      expect(status(c)).toBe(502);
    }
  });
});
