import {
  testWhatsappProviderSchema,
  type ProviderTestResult,
  type WhatsappProvider,
} from '@crm/contracts';

/** What the Test connection panel says about a result, so the operator knows what to fix first. */
export type TestHint =
  | 'ok'
  | 'addressRefused'
  | 'credentialsMissing'
  | 'unauthorized'
  | 'notFound'
  | 'rateLimited'
  | 'providerError'
  | 'unreachable'
  | 'other';

export function testHint(r: Pick<ProviderTestResult, 'ok' | 'httpStatus' | 'errorCode'>): TestHint {
  if (r.ok) return 'ok';
  if (r.errorCode === 'WAP_BASE_URL_REFUSED') return 'addressRefused';
  if (r.errorCode === 'WAP_CREDENTIALS_MISSING') return 'credentialsMissing';
  const status = r.httpStatus;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (status !== null && status >= 500) return 'providerError';
  if (status === null) return 'unreachable';
  return 'other';
}

export interface TestForm {
  path: string;
  wabaId: string;
  phoneNumberId: string;
  channelToken: string;
}

export const emptyTestForm = (): TestForm => ({
  path: '/me',
  wabaId: '',
  phoneNumberId: '',
  channelToken: '',
});

export type TestRequestResult =
  | {
      ok: true;
      body: { path: string; wabaId?: string; phoneNumberId?: string; channelToken?: string };
    }
  | { ok: false; field: keyof TestForm };

/** The test request from the form, checked with the contract's own schema. Blank optional fields are left out. */
export function buildTestRequest(f: TestForm): TestRequestResult {
  const candidate = {
    path: f.path.trim() === '' ? '/me' : f.path.trim(),
    ...(f.wabaId.trim() ? { wabaId: f.wabaId.trim() } : {}),
    ...(f.phoneNumberId.trim() ? { phoneNumberId: f.phoneNumberId.trim() } : {}),
    ...(f.channelToken.trim() ? { channelToken: f.channelToken.trim() } : {}),
  };
  const parsed = testWhatsappProviderSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, body: candidate };
  const field = parsed.error.issues[0]?.path[0];
  return {
    ok: false,
    field: (typeof field === 'string' && field in f ? field : 'path') as keyof TestForm,
  };
}

/** A test token only makes sense for a provider whose numbers hold their own token, or whose headers use it. */
export const takesChannelToken = (
  p: Pick<WhatsappProvider, 'credentialMode' | 'headerTemplates'>,
): boolean =>
  p.credentialMode === 'channel_token' ||
  Object.values(p.headerTemplates).some((v) => v.includes('channelToken'));
