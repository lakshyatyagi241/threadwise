import type { WabaApiError } from './waba-errors';
import type { WabaAuth, WabaProviderKind, WabaRegistryAuth } from './waba-http';
import type { MediaUpload } from './waba-template.port';

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
  /** The provider registry key the number is on (`meta_json.provider_key`); absent on rows that predate the registry. */
  providerKey?: string;
  /**
   * Set only when the number is on a provider of the registry that is not one of the two built-in routes: the route resolved for this
   * number (address, version, rendered headers). `provider` is then the legacy family (`meta`) and means nothing for routing.
   */
  registry?: WabaRegistryAuth;
}

export interface PhoneInfo {
  id: string;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  /** The number exactly as Meta displays it ("+91 91122 90122"), spaces and all. Only a partner that wants Meta's own formatting reads it. */
  displayPhoneNumberRaw?: string | null;
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

/** Meta's business compliance record. `entityType` is the Meta value (`PRIVATE_COMPANY`), never the form's wording. */
export interface BusinessComplianceInfo {
  entityName: string | null;
  entityType: string | null;
  entityTypeCustom: string | null;
  isRegistered: boolean | null;
  customerCare: {
    email: string | null;
    mobileNumber: string | null;
    landlineNumber: string | null;
  };
  grievanceOfficer: {
    name: string | null;
    email: string | null;
    mobileNumber: string | null;
    landlineNumber: string | null;
  };
}

/** The WhatsApp Business Account node (TW-WABA-021). Every field is optional: Meta fails the whole read for one unreadable field. */
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

export interface AppSubscriptionState {
  /** Meta has a webhook subscription for the app's WhatsApp Business Account object. */
  hasWabaObject: boolean;
  fields: string[];
  callbackUrl: string | null;
}

export interface SubscriptionDetail {
  name: string | null;
  callbackUrl: string | null;
}

export interface QrCodeInfo {
  code: string;
  prefilledMessage: string;
  deepLinkUrl: string | null;
  qrImageUrl: string | null;
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
  /** Asks Meta to send the number its 6-digit ownership code by SMS or voice call. */
  requestVerificationCode(
    conn: WabaConnection,
    method: 'SMS' | 'VOICE',
    language: string,
  ): Promise<void>;
  /** Confirms the number with the code Meta sent. */
  verifyCode(conn: WabaConnection, code: string): Promise<void>;
  /** Stops delivery to this app for the WABA. */
  unsubscribe(conn: WabaConnection): Promise<void>;
  /**
   * Is Meta delivering this WABA's events to `expectedUrl`? True when the subscription's callback override equals it; null
   * when it cannot be proven (a number on the customer's own app never exposes its default callback). Never false: a definite
   * failure is only visible through the subscribe call (TW-WABA-013).
   */
  verifyInboundWired(conn: WabaConnection, expectedUrl: string): Promise<boolean | null>;

  getBusinessProfile(conn: WabaConnection): Promise<BusinessProfile>;
  /** The WABA node, rich field set first and a safe subset if Meta rejects it. */
  getWabaDetails(conn: WabaConnection): Promise<WabaDetails>;
  /** Names of the apps subscribed to this WABA's webhooks. */
  getSubscribedApps(conn: WabaConnection): Promise<string[]>;
  /** The platform Meta app's own webhook subscription, read with the app access token (TW-WABA-002). */
  getAppSubscription(app: { id: string; secret: string }): Promise<AppSubscriptionState>;
  /** Subscribes the app's WhatsApp object to `fields` at `callbackUrl`; Meta verifies the callback during the call (TW-WABA-003). */
  setAppSubscription(
    app: { id: string; secret: string },
    input: { callbackUrl: string; verifyToken: string; fields: string[] },
  ): Promise<void>;
  /** Which apps a WABA is subscribed to and where each delivers (TW-WABA-015). */
  getSubscriptionDetails(conn: WabaConnection): Promise<SubscriptionDetail[]>;
  /**
   * Button clicks Meta counted for these templates in the window (unix seconds), summed over every day and button (TW-WABA-053).
   * Meta sends no click webhook, so this is the only source.
   */
  getTemplateClicks(
    conn: WabaConnection,
    templateIds: string[],
    startSeconds: number,
    endSeconds: number,
  ): Promise<number>;
  /** Turns template insights on for the WABA; Meta answers an analytics call with an error until it is. */
  enableTemplateInsights(conn: WabaConnection): Promise<void>;
  /** Conversation analytics rows for the window (unix seconds), by conversation type; the free-allowance card (TW-WABA-023). */
  getConversationAnalytics(
    conn: WabaConnection,
    startSeconds: number,
    endSeconds: number,
  ): Promise<Array<{ conversation_type?: string; conversation?: number; cost?: number }>>;
  /** The handle Meta has reserved for this number, when it names one (`GET /{pnid}?fields=username`). */
  getReservedUsername(conn: WabaConnection): Promise<string | null>;
  /** Claims a business username; resolves with the status Meta reports (unknown values become `reserved`). */
  claimUsername(conn: WabaConnection, username: string): Promise<'reserved' | 'approved'>;
  releaseUsername(conn: WabaConnection): Promise<void>;
  listQrCodes(conn: WabaConnection): Promise<QrCodeInfo[]>;
  createQrCode(conn: WabaConnection, prefilledMessage: string): Promise<QrCodeInfo>;
  deleteQrCode(conn: WabaConnection, code: string): Promise<void>;
  updateBusinessProfile(
    conn: WabaConnection,
    patch: Partial<BusinessProfile> & { profilePictureHandle?: string },
  ): Promise<void>;
  /** Uploads a profile picture and returns the handle `updateBusinessProfile` takes as `profilePictureHandle`. */
  uploadProfilePicture(conn: WabaConnection, media: MediaUpload): Promise<string>;
  /** Meta's compliance record for the number (India): the entity, the registration answer and the two contact sides. */
  getBusinessComplianceInfo(conn: WabaConnection): Promise<BusinessComplianceInfo>;
  /** Saves the whole compliance record in one call (Meta takes the same fields as one POST). */
  updateBusinessComplianceInfo(conn: WabaConnection, info: BusinessComplianceInfo): Promise<void>;
}

export const WABA_ADMIN = Symbol('WABA_ADMIN');

export function authOf(conn: WabaConnection): WabaAuth {
  if (conn.registry) return conn.registry;
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
