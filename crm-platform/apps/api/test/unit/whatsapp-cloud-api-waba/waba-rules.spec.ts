import { describe, expect, it } from 'vitest';
import {
  authenticateWebhook,
  inboundUrlKey,
  cleanPin,
  deriveHealth,
  generatePin,
  isCoexistence,
  isOnPremise,
  maskToken,
  splitWebhook,
  tierLimit,
  verifyTokenFor,
  webhookUrl,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = new Date('2026-10-02T10:00:00Z');
const healthy = {
  status: 'connected',
  hasToken: true,
  tokenExpiresAt: null,
  platformType: 'CLOUD_API',
  qualityRating: 'GREEN',
  nameStatus: 'APPROVED',
  codeVerificationStatus: 'VERIFIED',
  inboundWired: true,
  liveReadFailed: false,
  liveReadError: null,
};

describe('webhook url and verify token', () => {
  it('joins the public origin and the fixed path without a doubled slash', () => {
    expect(webhookUrl('https://hooks.example.com/')).toBe(
      'https://hooks.example.com/v2/public/webhooks/whatsapp',
    );
    expect(webhookUrl(undefined)).toBeNull();
  });

  it('puts the platform secret in the registered URL, derived from the credentials key', () => {
    const k = inboundUrlKey(KEY);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(inboundUrlKey(KEY)).toBe(k);
    expect(webhookUrl('https://h.example.com', k)).toBe(
      `https://h.example.com/v2/public/webhooks/whatsapp?k=${k}`,
    );
  });

  it('uses the configured token, else derives a stable one from the credentials key', () => {
    expect(verifyTokenFor(' abc ', KEY)).toBe('abc');
    const a = verifyTokenFor(undefined, KEY);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(verifyTokenFor('', KEY)).toBe(a);
    expect(verifyTokenFor(undefined, Buffer.alloc(32, 8).toString('base64'))).not.toBe(a);
  });
});

describe('PIN and platform helpers', () => {
  it('generates six digits and cleans a typed PIN', () => {
    for (let i = 0; i < 50; i++) expect(generatePin()).toMatch(/^\d{6}$/);
    expect(cleanPin('12 34-56')).toBe('123456');
    expect(cleanPin('12345')).toBeNull();
    expect(cleanPin(undefined)).toBeNull();
  });

  it('recognises On-Premises and coexistence numbers', () => {
    expect(isOnPremise('on_premise')).toBe(true);
    expect(isOnPremise('CLOUD_API')).toBe(false);
    expect(isCoexistence('SMB_APP')).toBe(true);
    expect(isCoexistence('COEXISTENCE')).toBe(true);
    expect(isCoexistence(null)).toBe(false);
  });

  it('maps tiers to daily limits and defaults unknown to the smallest', () => {
    expect(tierLimit('TIER_1K')).toBe(1000);
    expect(tierLimit('TIER_UNLIMITED')).toBe(1_000_000);
    expect(tierLimit('???')).toBe(250);
    expect(tierLimit(null)).toBe(250);
  });

  it('never shows more than the last four characters of a token', () => {
    expect(maskToken('EAAGm0PX4ZCpsBAxyz1234')).toBe('••••1234');
    expect(maskToken('short')).toBe('••••');
    expect(maskToken(null)).toBeNull();
  });
});

describe('deriveHealth', () => {
  it('is ok when nothing is wrong', () => {
    expect(deriveHealth(healthy, NOW)).toEqual({ overall: 'ok', issues: [] });
  });

  it('puts errors before warnings and reports the worst as overall', () => {
    const r = deriveHealth(
      { ...healthy, qualityRating: 'YELLOW', platformType: 'ON_PREMISE', inboundWired: false },
      NOW,
    );
    expect(r.overall).toBe('error');
    expect(r.issues.map((i) => i.key)).toEqual([
      'on_premise',
      'quality_yellow',
      'inbound_not_wired',
    ]);
  });

  it('warns a week before the token expires and errors once it has', () => {
    expect(
      deriveHealth({ ...healthy, tokenExpiresAt: new Date('2026-10-05T00:00:00Z') }, NOW).issues[0]
        ?.key,
    ).toBe('token_expiring');
    expect(
      deriveHealth({ ...healthy, tokenExpiresAt: new Date('2026-10-20T00:00:00Z') }, NOW).issues,
    ).toEqual([]);
    expect(
      deriveHealth({ ...healthy, tokenExpiresAt: new Date('2026-10-01T00:00:00Z') }, NOW).issues[0]
        ?.key,
    ).toBe('token_expired');
  });

  it('asks for a token on a connected number that has none, and a reconnect on a disconnected one', () => {
    expect(deriveHealth({ ...healthy, hasToken: false }, NOW).issues[0]?.key).toBe('no_token');
    const d = deriveHealth({ ...healthy, status: 'disconnected', hasToken: false }, NOW);
    expect(d.issues.map((i) => i.key)).toEqual(['disconnected']);
  });

  it('does not call an unproven inbound (null) a problem', () => {
    expect(deriveHealth({ ...healthy, inboundWired: null }, NOW).issues).toEqual([]);
  });

  it("surfaces a rejected live read with Meta's words", () => {
    const r = deriveHealth(
      { ...healthy, liveReadFailed: true, liveReadError: 'Token expired (code 190/463)' },
      NOW,
    );
    expect(r.issues[0]).toMatchObject({
      key: 'meta_unreachable',
      title: 'Token expired (code 190/463)',
    });
  });
});

describe('splitWebhook', () => {
  it('returns one item per change with the ids that route it', () => {
    const items = splitWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W1',
          time: 1700000000,
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: 'P1' }, messages: [{ id: 'wamid.1' }] },
            },
            { field: 'message_template_status_update', value: { event: 'APPROVED' } },
          ],
        },
        {
          id: 'W2',
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: 'P9' }, statuses: [] } },
          ],
        },
      ],
    });
    expect(items.map((i) => [i.wabaId, i.phoneNumberId, i.field])).toEqual([
      ['W1', 'P1', 'messages'],
      ['W1', null, 'message_template_status_update'],
      ['W2', 'P9', 'messages'],
    ]);
    expect(items[0]!.time).toBe(1700000000);
  });

  it('ignores anything that is not a WhatsApp Business Account envelope', () => {
    expect(splitWebhook(null)).toEqual([]);
    expect(splitWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(splitWebhook({ object: 'whatsapp_business_account' })).toEqual([]);
    expect(
      splitWebhook({
        object: 'whatsapp_business_account',
        entry: [{ changes: [] }, { id: 'W', changes: [{ field: 'x' }] }],
      }),
    ).toEqual([]);
  });
});

describe('authenticateWebhook', () => {
  const base = {
    signatureHeader: undefined,
    signatureValid: false,
    queryKey: undefined,
    expectedKey: 'secret',
    requireSignature: false,
  };

  it('accepts a valid body signature', () => {
    expect(
      authenticateWebhook({ ...base, signatureHeader: 'sha256=ab', signatureValid: true }),
    ).toEqual({ ok: true, via: 'signature' });
  });

  it('accepts the URL key when there is no signature (a BSP that does not sign)', () => {
    expect(authenticateWebhook({ ...base, queryKey: 'secret' })).toEqual({
      ok: true,
      via: 'url_key',
    });
  });

  it('accepts the URL key when a BSP re-signs with an app secret we do not hold', () => {
    expect(
      authenticateWebhook({
        ...base,
        signatureHeader: 'sha256=zz',
        signatureValid: false,
        queryKey: 'secret',
      }),
    ).toEqual({ ok: true, via: 'url_key' });
  });

  it('rejects a wrong or missing key and says why', () => {
    expect(authenticateWebhook({ ...base, queryKey: 'nope' })).toEqual({
      ok: false,
      reason: 'missing signature',
    });
    expect(authenticateWebhook({ ...base })).toEqual({ ok: false, reason: 'missing signature' });
    expect(authenticateWebhook({ ...base, signatureHeader: 'sha256=zz' })).toEqual({
      ok: false,
      reason: 'invalid signature',
    });
  });

  it('does not let a key of another length throw', () => {
    expect(authenticateWebhook({ ...base, queryKey: 's' }).ok).toBe(false);
  });

  it('requireSignature closes the URL-key door', () => {
    expect(authenticateWebhook({ ...base, queryKey: 'secret', requireSignature: true })).toEqual({
      ok: false,
      reason: 'missing signature',
    });
    expect(
      authenticateWebhook({
        ...base,
        signatureHeader: 'x',
        signatureValid: true,
        requireSignature: true,
      }).ok,
    ).toBe(true);
  });
});
