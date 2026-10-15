import { describe, expect, it } from 'vitest';
import type { CallingCheck, CallingCheckKey } from '@crm/contracts';
import { CALLING_CHECK_KEYS } from '@crm/contracts';
import {
  blockers,
  buildChecks,
  deriveStatus,
  nextCheckAt,
  readyForAutoEnable,
  tierValue,
  turnCheck,
  type ReadinessFacts,
} from '../../../src/modules/calling-voice/calling-readiness.rules';

const NOW = new Date('2026-12-06T10:00:00Z');

/** Facts of a number that is fully ready and has calling on; each test breaks one thing. */
const ready = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  planEnabled: true,
  connection: 'ok',
  coexistenceLocal: false,
  phone: {
    status: 'CONNECTED',
    codeVerificationStatus: 'VERIFIED',
    platformType: 'CLOUD_API',
    accountMode: 'LIVE',
    qualityRating: 'GREEN',
    messagingLimitTier: 'TIER_10K',
  },
  token: {
    kind: 'inspected',
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    expiresAt: null,
    appId: '1111',
  },
  subscribedApps: 1,
  callsField: 'present',
  calling: { status: 'ENABLED', callIconVisibility: 'DEFAULT' },
  ice: {
    configured: true,
    servers: [{ urls: 'turn:t.example.org:3478', username: 'u', credential: 'p' }],
  },
  diallers: 3,
  recording: { enabled: false, hasNotice: false },
  ...over,
});

const row = (checks: CallingCheck[], key: CallingCheckKey) => checks.find((c) => c.key === key)!;
const run = (over: Partial<ReadinessFacts> = {}, _enabled = true) => buildChecks(ready(over), NOW);

describe('the checklist', () => {
  it('has one row per key, in order, and all ok for a ready number', () => {
    const checks = run();
    expect(checks.map((c) => c.key)).toEqual([...CALLING_CHECK_KEYS]);
    expect(checks.every((c) => c.state === 'ok')).toBe(true);
    expect(deriveStatus(checks)).toBe('ready');
  });

  it('without the plan feature fails the plan row and asks Meta about nothing', () => {
    const checks = run({ planEnabled: false });
    expect(row(checks, 'plan_feature')).toMatchObject({ state: 'fail', code: 'plan_missing' });
    expect(
      checks.filter((c) => c.key !== 'plan_feature').every((c) => c.code === 'not_checked'),
    ).toBe(true);
    expect(deriveStatus(checks)).toBe('blocked');
  });

  it.each([
    ['not_connected', 'not_connected'],
    ['no_credentials', 'no_credentials'],
  ] as const)('a number that is %s skips the rows that need Meta', (connection, code) => {
    const checks = run({ connection });
    expect(row(checks, 'connection')).toMatchObject({ state: 'fail', code });
    for (const k of [
      'number_registered',
      'messaging_limit',
      'token_scopes',
      'webhook_subscribed',
      'calls_field',
      'calling_enabled',
    ] as const) {
      expect(row(checks, k).code).toBe('not_checked');
    }
    // What does not need Meta is still answered.
    expect(row(checks, 'turn').state).toBe('ok');
    expect(deriveStatus(checks)).toBe('blocked');
  });

  it('refuses a coexistence number, from the local record or from Meta', () => {
    expect(row(run({ coexistenceLocal: true }), 'not_coexistence')).toMatchObject({
      state: 'fail',
      code: 'coexistence',
    });
    const live = ready().phone!;
    expect(row(run({ phone: { ...live, platformType: 'SMB_APP' } }), 'not_coexistence').code).toBe(
      'coexistence',
    );
    expect(
      row(run({ phone: { ...live, platformType: 'ON_PREMISE' } }), 'not_coexistence').code,
    ).toBe('on_premise');
  });

  it('does not call a number Cloud-API-only without having read it', () => {
    expect(row(run({ phone: null }), 'not_coexistence')).toMatchObject({
      state: 'warn',
      code: 'meta_unreadable',
    });
    expect(row(run({ connection: 'not_connected' }), 'not_coexistence').code).toBe('not_checked');
    // The local record alone is enough to refuse, read or not.
    expect(row(run({ phone: null, coexistenceLocal: true }), 'not_coexistence').code).toBe(
      'coexistence',
    );
  });

  it('reads the number: not verified, not live, unreadable', () => {
    const live = ready().phone!;
    expect(
      row(run({ phone: { ...live, codeVerificationStatus: 'NOT_VERIFIED' } }), 'number_registered')
        .code,
    ).toBe('number_not_verified');
    expect(row(run({ phone: { ...live, status: 'PENDING' } }), 'number_registered')).toMatchObject({
      state: 'fail',
      code: 'number_not_live',
      params: { status: 'PENDING' },
    });
    expect(row(run({ phone: null }), 'number_registered')).toMatchObject({
      state: 'warn',
      code: 'meta_unreadable',
    });
    expect(row(run({ phone: null }), 'messaging_limit')).toMatchObject({
      state: 'warn',
      code: 'meta_unreadable',
    });
  });

  it('wants a messaging limit of 2,000 or more, except on a test number', () => {
    const live = ready().phone!;
    expect(
      row(run({ phone: { ...live, messagingLimitTier: 'TIER_1K' } }), 'messaging_limit'),
    ).toMatchObject({
      state: 'fail',
      code: 'limit_low',
      params: { tier: 'TIER_1K', needed: 2000 },
    });
    expect(
      row(run({ phone: { ...live, messagingLimitTier: 'TIER_2K' } }), 'messaging_limit').state,
    ).toBe('ok');
    expect(
      row(run({ phone: { ...live, messagingLimitTier: 'TIER_UNLIMITED' } }), 'messaging_limit')
        .state,
    ).toBe('ok');
    expect(
      row(
        run({ phone: { ...live, messagingLimitTier: 'TIER_50', accountMode: 'SANDBOX' } }),
        'messaging_limit',
      ).code,
    ).toBe('limit_test_number');
    expect(
      row(run({ phone: { ...live, messagingLimitTier: 'TIER_NEW_ONE' } }), 'messaging_limit'),
    ).toMatchObject({ state: 'warn', code: 'limit_unknown' });
    expect(row(run({ phone: { ...live, qualityRating: 'RED' } }), 'messaging_limit')).toMatchObject(
      { state: 'warn', code: 'quality_low' },
    );
  });

  it('checks both permissions of the token, its validity and its expiry', () => {
    const t = (over: object) => ({
      kind: 'inspected' as const,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      expiresAt: null,
      appId: null,
      ...over,
    });
    expect(
      row(run({ token: t({ scopes: ['whatsapp_business_messaging'] }) }), 'token_scopes'),
    ).toMatchObject({
      state: 'fail',
      code: 'scope_missing',
      params: { missing: 'whatsapp_business_management' },
    });
    expect(row(run({ token: t({ scopes: [] }) }), 'token_scopes').params).toEqual({
      missing: 'whatsapp_business_management, whatsapp_business_messaging',
    });
    expect(row(run({ token: { kind: 'invalid' } }), 'token_scopes')).toMatchObject({
      state: 'fail',
      code: 'token_invalid',
    });
    expect(
      row(run({ token: t({ expiresAt: new Date(NOW.getTime() - 1000) }) }), 'token_scopes').code,
    ).toBe('token_invalid');
    expect(
      row(
        run({ token: t({ expiresAt: new Date(NOW.getTime() + 3 * 86_400_000) }) }),
        'token_scopes',
      ),
    ).toMatchObject({ state: 'warn', code: 'token_expiring', params: { days: 3 } });
    expect(
      row(
        run({ token: t({ expiresAt: new Date(NOW.getTime() + 60 * 86_400_000) }) }),
        'token_scopes',
      ).state,
    ).toBe('ok');
    expect(row(run({ token: { kind: 'unverifiable' } }), 'token_scopes')).toMatchObject({
      state: 'warn',
      code: 'scopes_unverifiable',
    });
    expect(row(run({ token: { kind: 'none' } }), 'token_scopes').state).toBe('warn');
  });

  it('wants the WABA subscribed and the calls field delivered', () => {
    expect(row(run({ subscribedApps: 0 }), 'webhook_subscribed')).toMatchObject({
      state: 'fail',
      code: 'waba_not_subscribed',
    });
    expect(row(run({ subscribedApps: null }), 'webhook_subscribed')).toMatchObject({
      state: 'warn',
      code: 'meta_unreadable',
    });
    expect(row(run({ callsField: 'missing' }), 'calls_field')).toMatchObject({
      state: 'fail',
      code: 'calls_field_missing',
    });
    expect(row(run({ callsField: 'added' }), 'calls_field')).toMatchObject({
      state: 'ok',
      code: 'calls_field_added',
    });
    expect(row(run({ callsField: 'unverifiable' }), 'calls_field')).toMatchObject({
      state: 'warn',
      code: 'calls_field_unverifiable',
    });
  });

  it('reads the calling switch from Meta only: no status in the answer is never a pass', () => {
    expect(
      row(
        run({ calling: { status: 'DISABLED', callIconVisibility: null } }, false),
        'calling_enabled',
      ),
    ).toMatchObject({ state: 'fail', code: 'calling_off' });
    for (const local of [true, false]) {
      expect(
        row(run({ calling: { status: null, callIconVisibility: null } }, local), 'calling_enabled'),
      ).toMatchObject({ state: 'warn', code: 'meta_unreadable' });
    }
    expect(
      deriveStatus(run({ calling: { status: null, callIconVisibility: null } }, true)),
    ).not.toBe('ready');
    expect(
      row(
        run({ calling: { status: 'ENABLED', callIconVisibility: 'DISABLE_ALL' } }),
        'calling_enabled',
      ),
    ).toMatchObject({ state: 'warn', code: 'icon_hidden' });
    expect(row(run({ calling: null }), 'calling_enabled')).toMatchObject({
      state: 'warn',
      code: 'meta_unreadable',
    });
  });

  it('says why a switch-on was turned down', () => {
    const checks = buildChecks(
      ready({ calling: { status: 'DISABLED', callIconVisibility: null } }),
      NOW,
      'prerequisites',
    );
    expect(row(checks, 'calling_enabled').params).toEqual({ refused: 'prerequisites' });
  });

  it('counts the people who can dial and the recording rules', () => {
    expect(row(run({ diallers: 0 }), 'dialler_permissions')).toMatchObject({
      state: 'fail',
      code: 'dialler_none',
    });
    expect(row(run({ diallers: 2 }), 'dialler_permissions').params).toEqual({ people: 2 });
    expect(
      row(run({ recording: { enabled: true, hasNotice: true } }), 'recording_consent').code,
    ).toBe('recording_configured');
    expect(
      row(run({ recording: { enabled: true, hasNotice: false } }), 'recording_consent'),
    ).toMatchObject({ state: 'warn', code: 'recording_notice_missing' });
    expect(row(run(), 'recording_consent').code).toBe('recording_off');
  });
});

describe('TURN', () => {
  it('is ok with a relay that has credentials, and says what is wrong otherwise', () => {
    expect(
      turnCheck({
        configured: true,
        servers: [{ urls: ['stun:s', 'turns:t:5349'], username: 'u', credential: 'p' }],
      }),
    ).toMatchObject({ state: 'ok', code: 'turn_ok' });
    expect(turnCheck({ configured: false, servers: [] })).toMatchObject({
      state: 'warn',
      code: 'turn_missing',
    });
    expect(turnCheck({ configured: true, servers: [{ urls: 'stun:s' }] }).code).toBe(
      'turn_missing',
    );
    expect(turnCheck({ configured: true, servers: [{ urls: 'turn:t' }] }).code).toBe(
      'turn_incomplete',
    );
    expect(turnCheck({ configured: true, servers: [] }).code).toBe('ice_invalid');
  });
});

describe('the verdict', () => {
  const ok = (key: CallingCheckKey): CallingCheck => ({ key, state: 'ok', code: 'plan_ok' });

  it('is never_checked with no rows, ready_to_enable when only the switch is off, attention on a warning', () => {
    expect(deriveStatus([])).toBe('never_checked');
    const off = run({ calling: { status: 'DISABLED', callIconVisibility: null } }, false);
    expect(deriveStatus(off)).toBe('ready_to_enable');
    expect(blockers(off)).toEqual([]);
    expect(deriveStatus(run({ ice: { configured: false, servers: [] } }))).toBe('attention');
    expect(deriveStatus([ok('plan_feature')])).toBe('ready');
  });

  it('is blocked by any other fail even when the switch is off, and the blockers are listed', () => {
    const checks = run(
      {
        phone: { ...ready().phone!, messagingLimitTier: 'TIER_250' },
        calling: { status: 'DISABLED', callIconVisibility: null },
      },
      false,
    );
    expect(deriveStatus(checks)).toBe('blocked');
    expect(blockers(checks).map((c) => c.code)).toEqual(['limit_low']);
  });

  it('lets a number be switched on by itself only when nothing failed and nothing was left unread', () => {
    const off = { calling: { status: 'DISABLED' as const, callIconVisibility: null } };
    expect(readyForAutoEnable(run(off, false))).toBe(true);
    expect(readyForAutoEnable(run({ ...off, phone: null }, false))).toBe(false);
    expect(readyForAutoEnable(run({ ...off, subscribedApps: null }, false))).toBe(false);
    expect(readyForAutoEnable(run({ ...off, connection: 'not_connected' }, false))).toBe(false);
    expect(readyForAutoEnable(run({ ...off, planEnabled: false }, false))).toBe(false);
    expect(readyForAutoEnable(run({ ...off, callsField: 'missing' }, false))).toBe(false);
    // A warning that is about something else (no TURN) does not hold it back.
    expect(
      readyForAutoEnable(run({ ...off, ice: { configured: false, servers: [] } }, false)),
    ).toBe(true);
  });

  it('looks again sooner at a number that is not ready', () => {
    const m = (s: Parameters<typeof nextCheckAt>[0]) =>
      (nextCheckAt(s, NOW).getTime() - NOW.getTime()) / 60_000;
    expect(m('never_checked')).toBe(15);
    expect(m('blocked')).toBe(30);
    expect(m('ready')).toBe(360);
    expect(m('blocked')).toBeLessThan(m('ready'));
  });

  it('reads tiers', () => {
    expect(tierValue('tier_2k')).toBe(2000);
    expect(tierValue(null)).toBeNull();
    expect(tierValue('TIER_UNLIMITED')).toBe(Number.POSITIVE_INFINITY);
  });
});
