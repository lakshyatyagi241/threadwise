import { describe, expect, it } from 'vitest';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaConnection } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaHealthDetailsService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-health-details.service';
import {
  deriveHealth,
  type HealthFacts,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';

const conn: WabaConnection = {
  provider: 'meta',
  wabaId: '1',
  phoneNumberId: '2',
  accessToken: 't',
};
const phone = { accountMode: 'LIVE', isOfficialBusinessAccount: false, isPinEnabled: true };
const metaErr = (code: number) =>
  new WabaApiError('boom', 400, code, null, null, null, null, false, {
    error: { message: 'boom', code },
  });

const waba = {
  name: 'Acme',
  currency: 'INR',
  timezoneId: '1',
  accountReviewStatus: 'APPROVED',
  businessVerificationStatus: 'verified',
  ownerBusinessName: 'Acme Ltd',
  ownershipType: null,
};
const make = (over: Record<string, unknown> = {}) =>
  new WabaHealthDetailsService(
    {
      getWabaDetails: async () => waba,
      getSubscribedApps: async () => ['My app'],
      inspectToken: async () => ({
        isValid: true,
        userId: 'u',
        appId: 'a',
        scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
        wabaIds: ['1'],
        expiresAt: null,
      }),
      ...over,
    } as never,
    {
      list: async () => ({
        items: [{ status: 'APPROVED' }, { status: 'APPROVED' }, { status: 'REJECTED' }],
        next: null,
      }),
      ...(over.templates as object),
    } as never,
  );

const base: HealthFacts = {
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

describe('health details collection (WD-WABA-021)', () => {
  it('gathers the WABA node, token, subscribed apps and a status tally', async () => {
    const { details, facts } = await make().collect(conn, phone);
    expect(details.waba?.name).toBe('Acme');
    expect(details.token).toMatchObject({ valid: true, appId: 'a' });
    expect(details.webhook?.subscribedApps).toEqual(['My app']);
    expect(details.templates).toEqual({ sampled: 3, byStatus: { APPROVED: 2, REJECTED: 1 } });
    expect(details.errors).toEqual([]);
    expect(facts.subscribedApps).toBe(1);
  });

  it('one failing read never blanks the rest and is listed in errors', async () => {
    const { details, facts } = await make({
      getWabaDetails: async () => {
        throw metaErr(10);
      },
    }).collect(conn, phone);
    expect(details.waba).toBeNull();
    expect(details.webhook).not.toBeNull();
    expect(details.errors.join()).toContain('WhatsApp Business Account');
    expect(facts.accountReviewStatus).toBeNull();
  });

  it('an unconfigured token inspector is "unknown", not an error', async () => {
    const { details, facts } = await make({
      inspectToken: async () => {
        throw new Error('META_APP_ID and META_APP_SECRET are not configured');
      },
    }).collect(conn, phone);
    expect(details.token.valid).toBeNull();
    expect(details.errors).toEqual([]);
    expect(facts.tokenScopes).toBeNull();
  });

  it('carries the template error code so the rules can explain it', async () => {
    const svc = make({
      templates: {
        list: async () => {
          throw metaErr(3);
        },
      },
    });
    const { facts } = await svc.collect(conn, phone);
    expect(facts.templatesErrorCode).toBe(3);
  });
});

describe('health rules added for the live reads (WD-WABA-022)', () => {
  const issue = (over: Partial<HealthFacts>, key: string) =>
    deriveHealth({ ...base, ...over }, new Date()).issues.find((i) => i.key === key);
  it('account review: pending warns, rejected blocks, approved is quiet', () => {
    expect(issue({ accountReviewStatus: 'PENDING' }, 'account_review')?.severity).toBe('warning');
    expect(issue({ accountReviewStatus: 'REJECTED' }, 'account_review')?.severity).toBe('error');
    expect(issue({ accountReviewStatus: 'APPROVED' }, 'account_review')).toBeUndefined();
  });
  it('an unverified business warns', () => {
    expect(
      issue({ businessVerificationStatus: 'not_verified' }, 'business_unverified')?.severity,
    ).toBe('warning');
    expect(
      issue({ businessVerificationStatus: 'verified' }, 'business_unverified'),
    ).toBeUndefined();
  });
  it('missing messaging scope blocks, missing management scope only warns', () => {
    expect(
      issue({ tokenScopes: ['whatsapp_business_management'] }, 'scope_messaging')?.severity,
    ).toBe('error');
    const only = deriveHealth(
      { ...base, tokenScopes: ['whatsapp_business_messaging'] },
      new Date(),
    );
    expect(only.overall).toBe('warning');
    expect(only.issues.find((i) => i.key === 'scope_management')).toBeTruthy();
  });
  it('unknown scopes raise nothing; no subscribed app blocks', () => {
    expect(deriveHealth({ ...base, tokenScopes: null }, new Date()).issues).toEqual([]);
    expect(issue({ subscribedApps: 0 }, 'no_subscribed_app')?.severity).toBe('error');
    expect(issue({ subscribedApps: null }, 'no_subscribed_app')).toBeUndefined();
  });
  it('template read errors 3 and 10 warn with different advice', () => {
    expect(issue({ templatesErrorCode: 3 }, 'templates_unreadable')?.solution).toContain(
      'Advanced Access',
    );
    expect(issue({ templatesErrorCode: 10 }, 'templates_unreadable')?.solution).toContain(
      'un-shared',
    );
  });
});
