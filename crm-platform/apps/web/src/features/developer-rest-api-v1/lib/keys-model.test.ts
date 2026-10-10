import { describe, expect, it } from 'vitest';
import {
  API_KEY_NAME_MAX,
  API_SCOPES,
  API_SCOPE_RESOURCES,
  ERROR_CODES,
  type ApiKeyResponse,
  type ApiScope,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  activeKeys,
  afterRevoke,
  baseUrlOf,
  SCOPE_ROWS,
  checkName,
  checkScopes,
  dateLabel,
  errorKind,
  isFullAccess,
  isReadImplied,
  nameFieldError,
  quickstartCurl,
  relativeTime,
  toggleScope,
} from './keys-model';

const key = (over: Partial<ApiKeyResponse> = {}): ApiKeyResponse => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Prod',
  prefix: 'wsk_abcdefgh',
  status: 'active',
  scopes: [],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  ...over,
});

describe('activeKeys', () => {
  it('keeps live keys and drops revoked ones', () => {
    const live = key();
    const gone = key({
      id: '00000000-0000-4000-8000-000000000002',
      status: 'revoked',
      revokedAt: '2026-10-07T00:00:00.000Z',
    });
    expect(activeKeys([gone, live])).toEqual([live]);
    expect(activeKeys([gone])).toEqual([]);
  });
  it('counts an expired but unrevoked key as active, like WaDesk', () => {
    expect(activeKeys([key({ expiresAt: '2020-01-01T00:00:00.000Z' })])).toHaveLength(1);
  });
});

describe('checkName', () => {
  it('requires a name', () => {
    expect(checkName('')).toEqual({ ok: false, error: 'required' });
    expect(checkName('   ')).toEqual({ ok: false, error: 'required' });
  });
  it('accepts 1 and 120 characters and trims', () => {
    expect(checkName('a')).toEqual({ ok: true, name: 'a' });
    expect(checkName(`  ${'x'.repeat(API_KEY_NAME_MAX)}  `)).toEqual({
      ok: true,
      name: 'x'.repeat(120),
    });
  });
  it('rejects 121 characters', () => {
    expect(checkName('x'.repeat(API_KEY_NAME_MAX + 1))).toEqual({ ok: false, error: 'tooLong' });
  });
});

describe('quickstart and base url', () => {
  it('builds the base url without a double slash', () => {
    expect(baseUrlOf('https://api.example.com/')).toBe('https://api.example.com/api/v1');
  });
  it('uses the placeholder unless a key was just created', () => {
    expect(quickstartCurl('https://x/api/v1', 'Acme')).toContain('Bearer YOUR_API_KEY');
    const c = quickstartCurl('https://x/api/v1', 'Acme', 'wsk_real');
    expect(c).toContain('Bearer wsk_real');
    expect(c).toContain("POST 'https://x/api/v1/messages'");
    expect(c).toContain('"text":"Hello from Acme"');
  });
  it('keeps a quote in the brand shell-safe', () => {
    expect(quickstartCurl('https://x/api/v1', "O'Neil")).toContain(`O'\\''Neil`);
  });
});

describe('the one-time key', () => {
  it('goes away when that key is revoked, stays for another', () => {
    const shown = { keyId: 'a', secret: 'wsk_secret' };
    expect(afterRevoke(shown, 'a')).toBeNull();
    expect(afterRevoke(shown, 'b')).toBe(shown);
    expect(afterRevoke(null, 'a')).toBeNull();
  });
  it('is never part of what the list endpoint returns', () => {
    expect(Object.keys(key())).not.toContain('secret');
  });
});

describe('errorKind', () => {
  const err = (
    status: number,
    code: string,
    fieldErrors: Array<{ path: string; message: string }> = [],
  ) => new ApiError(status, code, 'detail', 'req-1', fieldErrors);
  it('branches on the code', () => {
    expect(errorKind(err(422, ERROR_CODES.PLAN_LIMIT_REACHED))).toBe('planLimit');
    expect(errorKind(err(402, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('planLocked');
    expect(errorKind(err(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(errorKind(err(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
  });
  it('falls back on the status', () => {
    expect(errorKind(err(403, 'SOMETHING'))).toBe('forbidden');
    expect(errorKind(err(404, 'NOT_FOUND'))).toBe('notFound');
    expect(errorKind(err(500, 'INTERNAL'))).toBe('unexpected');
  });
  it('treats a non-API failure as a network problem', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
  it('reads the server message for the name field', () => {
    expect(
      nameFieldError(err(422, 'VALIDATION_FAILED', [{ path: 'name', message: 'Too long' }])),
    ).toBe('Too long');
    expect(nameFieldError(err(422, 'VALIDATION_FAILED'))).toBeNull();
  });
});

describe('time labels', () => {
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  it('is null for a key never used', () => expect(relativeTime(null, 'en', now)).toBeNull());
  it('reads minutes, hours and days ago', () => {
    expect(relativeTime('2026-10-06T11:57:00.000Z', 'en', now)).toBe('3 minutes ago');
    expect(relativeTime('2026-10-06T09:00:00.000Z', 'en', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-03T12:00:00.000Z', 'en', now)).toBe('3 days ago');
  });
  it('formats the created date', () => {
    expect(dateLabel('2026-10-06T10:00:00.000Z', 'en')).toBe('Oct 6, 2026');
  });
});

describe('isFullAccess', () => {
  it('is true for a key with no scopes, as in WaDesk, and false once it has any', () => {
    expect(isFullAccess(key())).toBe(true);
    expect(isFullAccess(key({ scopes: ['contacts:read'] }))).toBe(false);
  });
});

describe('scope picker rows', () => {
  it('has one row per resource and together they are every scope the API accepts, read before write', () => {
    expect(SCOPE_ROWS.map((r) => r.resource)).toEqual([...API_SCOPE_RESOURCES]);
    expect(SCOPE_ROWS.flatMap((r) => [r.read, r.write])).toEqual([...API_SCOPES]);
  });

  it('shows read as implied only while its write is ticked', () => {
    const contacts = SCOPE_ROWS.find((r) => r.resource === 'contacts')!;
    expect(isReadImplied([], contacts)).toBe(false);
    expect(isReadImplied(['contacts:read'], contacts)).toBe(false);
    expect(isReadImplied(['contacts:write'], contacts)).toBe(true);
    expect(isReadImplied(['deals:write'], contacts)).toBe(false);
  });

  it('toggles a scope on and off without touching the others', () => {
    const one = toggleScope([], 'contacts:read');
    expect(one).toEqual(['contacts:read']);
    const two = toggleScope(one, 'deals:write');
    expect(two).toEqual(['contacts:read', 'deals:write']);
    expect(toggleScope(two, 'contacts:read')).toEqual(['deals:write']);
    expect(one).toEqual(['contacts:read']);
  });
});

describe('checkScopes', () => {
  it('sends no scopes when the key is not restricted, whatever was ticked before', () => {
    expect(checkScopes(false, [])).toEqual({ ok: true, scopes: [] });
    expect(checkScopes(false, ['contacts:read'])).toEqual({ ok: true, scopes: [] });
  });

  it('refuses a restricted key with nothing ticked: an empty list would be full access', () => {
    expect(checkScopes(true, [])).toEqual({ ok: false, error: 'noScopes' });
  });

  it('sends the ticked scopes in picker order', () => {
    const picked: ApiScope[] = ['messages:write', 'contacts:read', 'account:read'];
    expect(checkScopes(true, picked)).toEqual({
      ok: true,
      scopes: ['account:read', 'contacts:read', 'messages:write'],
    });
  });

  it('leaves out a read that its write already implies, and keeps a read on its own', () => {
    expect(checkScopes(true, ['contacts:read', 'contacts:write', 'deals:read'])).toEqual({
      ok: true,
      scopes: ['contacts:write', 'deals:read'],
    });
  });

  it('every scope ticked is sent as ticked, nothing invented', () => {
    const all = checkScopes(true, [...API_SCOPES]);
    expect(all.ok && all.scopes).toEqual(API_SCOPES.filter((s) => !s.endsWith(':read')));
  });
});
