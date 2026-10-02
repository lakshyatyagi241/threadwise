import type { WabaApiError } from './waba-errors';
import type { WabaAuth, WabaProviderKind } from './waba-http';

/**
 * Account-level operations on a WhatsApp Business Account: everything between "the customer finished Embedded Signup" and
 * "messages flow" (connect, verify, subscribe, register, profile). Sending and templates have their own ports.
 *
 * Written against the port so a second BSP (Pinnacle) is one more adapter and a `provider` value on the connection row.
 */

/** What is stored per connected number, decrypted. `accessToken` is the Meta business token; `authKey` the Interakt partner key. */
export interface WabaConnection {
  provider: WabaProviderKind;
  wabaId: string;
  phoneNumberId: string;
  accessToken?: string;
  authKey?: string;
}

export interface PhoneInfo {
  id: string;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  accountMode: string | null;
  throughput: unknown;
  platformType: string | null;
  isOfficialBusinessAccount: boolean | null;
  isPinEnabled: boolean | null;
  lastOnboardedTime: string | null;
  status: string | null;
}

export interface TokenExchange {
  accessToken: string;
  /** Seconds; null when Meta sent none or 0 (a non-expiring token). */
  expiresInSeconds: number | null;
}

export interface TokenInspection {
  isValid: boolean;
  userId: string | null;
  appId: string | null;
  scopes: string[];
  /** WABA ids the token was granted (granular scope `whatsapp_business_management`). */
  wabaIds: string[];
  expiresAt: Date | null;
}

export interface SubscribeResult {
  ok: boolean;
  /** The WABA's callback now points at this platform. False with ok=true means subscribed to the app's default callback only. */
  overrideApplied: boolean;
  error?: WabaApiError;
}

export interface BusinessProfile {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  profilePictureUrl: string | null;
  websites: string[];
  vertical: string | null;
}

/** The WhatsApp Business Account node (WD-WABA-021). Every field is optional: Meta fails the whole read for one unreadable field. */
export interface WabaDetails {
  name: string | null;
  currency: string | null;
  timezoneId: string | null;
  accountReviewStatus: string | null;
  businessVerificationStatus: string | null;
  ownerBusinessName: string | null;
  ownershipType: string | null;
}

export interface PlatformReadiness {
  /** App id, secret and (for Embedded Signup) config id are set. */
  embeddedSignupReady: boolean;
  appId: string | null;
  configId: string | null;
  /** Interakt `extras.setup.solutionID`, when the Interakt route is the default. */
  solutionId: string | null;
  graphVersion: string;
  coexistence: boolean;
  defaultProvider: WabaProviderKind;
  /** Public so the browser SDK can init; the secret never leaves the server. */
  missing: string[];
}

export interface WabaAdminPort {
  readiness(): PlatformReadiness;

  /** One-time Embedded Signup `code` to a business token. Never sends a redirect_uri (popup codes are in-window). */
  exchangeCode(code: string): Promise<TokenExchange>;
  /** Short-lived to long-lived (manual connect). Resolves with the input token when the app cannot extend it. */
  extendToken(token: string, app?: { id: string; secret: string }): Promise<TokenExchange>;
  inspectToken(token: string): Promise<TokenInspection>;

  /** First WABA the token can use: `granular_scopes` first, then the platform business's client WABAs. */
  discoverWabaId(token: string): Promise<string | null>;
  listPhoneNumbers(token: string, wabaId: string): Promise<PhoneInfo[]>;
  getPhone(auth: WabaAuth, phoneNumberId: string): Promise<PhoneInfo>;
  getOwnerBusiness(
    token: string,
    wabaId: string,
  ): Promise<{ id: string; name: string | null } | null>;
  isBusinessVerified(token: string, businessId: string): Promise<boolean>;

  /** Delivers this WABA's webhooks to `callback` (atomic subscribe + override, with fallbacks). */
  subscribe(
    conn: WabaConnection,
    callback: { url: string; verifyToken: string },
  ): Promise<SubscribeResult>;
  /** Interakt only: tell the BSP about the new WABA. Best effort; returns whether Interakt accepted it. */
  registerWithInterakt(wabaId: string, phone: string | null): Promise<boolean>;
  /** Adds the platform system user to the WABA so the platform can manage it. Best effort. */
  assignSystemUser(wabaId: string, token: string): Promise<boolean>;
  registerPhone(conn: WabaConnection, pin: string): Promise<void>;
  /** Stops delivery to this app for the WABA. */
  unsubscribe(conn: WabaConnection): Promise<void>;
  /**
   * Is Meta delivering this WABA's events to `expectedUrl`? True when the subscription's callback override equals it; null
   * when it cannot be proven (a number on the customer's own app never exposes its default callback). Never false: a definite
   * failure is only visible through the subscribe call (WD-WABA-013).
   */
  verifyInboundWired(conn: WabaConnection, expectedUrl: string): Promise<boolean | null>;

  getBusinessProfile(conn: WabaConnection): Promise<BusinessProfile>;
  /** The WABA node, rich field set first and a safe subset if Meta rejects it. */
  getWabaDetails(conn: WabaConnection): Promise<WabaDetails>;
  /** Names of the apps subscribed to this WABA's webhooks. */
  getSubscribedApps(conn: WabaConnection): Promise<string[]>;
  updateBusinessProfile(
    conn: WabaConnection,
    patch: Partial<BusinessProfile> & { profilePictureHandle?: string },
  ): Promise<void>;
}

export const WABA_ADMIN = Symbol('WABA_ADMIN');

export function authOf(conn: WabaConnection): WabaAuth {
  if (conn.provider === 'interakt') {
    if (!conn.authKey) throw new Error('Interakt connection without an auth key');
    return {
      provider: 'interakt',
      authKey: conn.authKey,
      wabaId: conn.wabaId,
      phoneNumberId: conn.phoneNumberId,
    };
  }
  if (!conn.accessToken) throw new Error('Meta connection without an access token');
  return { provider: 'meta', accessToken: conn.accessToken };
}
