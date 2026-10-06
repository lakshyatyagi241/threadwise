/**
 * Pure rules of Pinnacle's partner API: what a request carries and how to read an answer. No network here so a test can pin them.
 * Shapes follow the partner API as Geta's production onboarding uses it (`create-user-account`, `client-embedded-detail-receiver`,
 * `share-creditline-api`, all keyed by the partner key in an `apikey` header).
 */

export interface PinnacleAccountInput {
  /** From Meta: `message_template_namespace` of the WABA. */
  templateNamespace: string;
  wabaId: string;
  /** The display number of the WABA's phone, as Meta reports it. */
  wabaNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  /** The owner's mobile number; Pinnacle wants one on the account. */
  mobileNo: string;
}

export function accountPayload(i: PinnacleAccountInput): Record<string, unknown> {
  const full = `${i.firstName} ${i.lastName}`.trim();
  return {
    template_namespace: i.templateNamespace,
    waba_id: i.wabaId,
    mobileno: i.mobileNo,
    firstname: i.firstName,
    lastname: i.lastName,
    billingname: full,
    waba_number: [i.wabaNumber],
    email: i.email,
  };
}

export interface PinnacleEmbeddedInput {
  wabaId: string;
  phoneNumberId: string;
  configId: string;
  /** The business-integration token Embedded Signup produced. */
  accessToken: string;
  solutionId: string;
  businessId: string | null;
}

export function embeddedPayload(i: PinnacleEmbeddedInput): Record<string, unknown> {
  return {
    waba_id: i.wabaId,
    phone_numberid: i.phoneNumberId,
    config_id: i.configId,
    access_token: i.accessToken,
    mmlite: 1,
    solution_id: i.solutionId,
    business_id: i.businessId,
  };
}

export function creditLinePayload(i: {
  businessId: string;
  wabaId: string;
  currency?: string;
}): Record<string, unknown> {
  return { business_id: i.businessId, waba_currency: i.currency ?? 'INR', waba_id: i.wabaId };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pinnacle answers 200 with `code: 200` or `status: "success"` on success; anything else is a refusal whose message is its own words. */
export function isPinnacleSuccess(body: unknown): boolean {
  if (!isObj(body)) return false;
  if (body.code === 200) return true;
  return typeof body.status === 'string' && body.status.toLowerCase() === 'success';
}

/** The reason Pinnacle gave, with nothing else of the body. Never contains a secret: those are only ever read from `data` on success. */
export function pinnacleReason(body: unknown): string {
  if (isObj(body)) {
    for (const k of ['message', 'msg', 'error', 'detail']) {
      const v = body[k];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 300);
    }
  }
  return 'Pinnacle refused the request';
}

export interface PinnacleClientAccount {
  /** The client's own key: every send for this number carries it. */
  apiKey: string;
  username: string | null;
  password: string | null;
}

/** Reads a `create-user-account` answer. Null when it was not a success or carried no apikey (a refusal, or an account without a key). */
export function readAccount(body: unknown): PinnacleClientAccount | null {
  if (!isPinnacleSuccess(body) || !isObj(body)) return null;
  const data = isObj(body.data) ? body.data : null;
  const key = data && typeof data.apikey === 'string' ? data.apikey.trim() : '';
  if (!key) return null;
  return {
    apiKey: key,
    username: data && typeof data.username === 'string' ? data.username : null,
    password: data && typeof data.password === 'string' ? data.password : null,
  };
}

/** Pinnacle does the credit-line share a few minutes after the embedded details arrive (Geta waits 200 s), so the job is delayed. */
export const PINNACLE_CREDIT_LINE_DELAY_MS = 200_000;
