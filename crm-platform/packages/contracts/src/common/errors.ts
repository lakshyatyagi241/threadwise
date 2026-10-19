import { z } from 'zod';

/**
 * Machine-readable application error codes. The frontend switches on `code`,
 * never on the human-readable message — messages get reworded, codes do not.
 */
import { CPN_ERROR_CODES } from '../coupons-credits-referral-currency/errors';
import { PAYGW_ERROR_CODES } from '../platform-payment-gateways/errors';
import { RBAC_ERROR_CODES } from '../roles-permissions/errors';
import { WEBHOOK_FANOUT_ERROR_CODES } from '../webhook-fanout/errors';
import { WABOO_MIGRATION_ERROR_CODES } from '../waboo-migration/errors';
import { WABA_ERROR_CODES } from '../whatsapp-cloud-api-waba/errors';
import { TPL_ERROR_CODES } from '../message-templates/errors';
import { CHANNEL_ERROR_CODES } from '../chat-conversations/channel-errors';
import { CONVERSATION_ERROR_CODES } from '../chat-conversations/conversation-errors';
import { INBOX_ERROR_CODES } from '../team-inbox-conversations/errors';
import { WSP_ERROR_CODES } from '../workspaces-teams-tenancy/errors';
import { WAP_ERROR_CODES } from '../whatsapp-providers/errors';
import { WALLET_ERROR_CODES } from '../wallet-message-billing/errors';
import { CALL_ERROR_CODES } from '../calling-voice/errors';
import { FLR_ERROR_CODES } from '../flow-runtime-engine/errors';
import { MKT_ERROR_CODES } from '../marketplace/errors';
import { LEAD_ERROR_CODES } from '../leads/errors';
import { MLA_ERROR_CODES } from '../meta-lead-ads/errors';
import { FLB_ERROR_CODES } from '../flow-builder-editor/errors';
import { CHK_ERROR_CODES } from '../checkout-orders-merchant-payments/errors';
import { FORMS_ERROR_CODES } from '../forms-builder/errors';
import { WADEV_ERROR_CODES } from '../whatsapp-devices-baileys/errors';
import { AIAG_ERROR_CODES } from '../ai-agents-training/errors';
import { GOOGLE_ERROR_CODES } from '../google-account/errors';
import { ALIB_ERROR_CODES } from '../api-library/errors';
import { FAQ_ERROR_CODES } from '../faq-knowledge/errors';
import { LSC_ERROR_CODES } from '../lead-scoring/errors';
import { CONSENT_ERROR_CODES } from '../contact-consent/errors';
import { PRIVACY_ERROR_CODES } from '../privacy/errors';
import { COMPLIANCE_ERROR_CODES } from '../compliance/errors';
import { GROWTH_ERROR_CODES } from '../growth';
import { AUDIT_LOG_ERROR_CODES } from '../notifications-activity-audit/audit-log';
import { REVENUE_ERROR_CODES } from '../crm/revenue-report';
import { PQL_ERROR_CODES } from '../contacts-attributes-tags/pql-errors';
import { WFL_ERROR_CODES } from '../forms-links-groups/errors';
import { AICRM_ERROR_CODES } from '../ai-copilot-lead-finder/errors';
import { STORAGE_ERROR_CODES } from '../storage-quota/errors';
import { CONF_ERROR_CODES } from '../meeting-conferencing/errors';

export const ERROR_CODES = {
  ...STORAGE_ERROR_CODES,
  ...CONF_ERROR_CODES,
  ...FAQ_ERROR_CODES,
  ...LSC_ERROR_CODES,
  ...GROWTH_ERROR_CODES,
  ...CONSENT_ERROR_CODES,
  ...PRIVACY_ERROR_CODES,
  ...COMPLIANCE_ERROR_CODES,
  ...AUDIT_LOG_ERROR_CODES,
  ...REVENUE_ERROR_CODES,
  ...PQL_ERROR_CODES,
  ...WFL_ERROR_CODES,
  ...AICRM_ERROR_CODES,
  ...ALIB_ERROR_CODES,
  ...GOOGLE_ERROR_CODES,
  ...CPN_ERROR_CODES,
  ...PAYGW_ERROR_CODES,
  ...RBAC_ERROR_CODES,
  ...WABA_ERROR_CODES,
  ...WEBHOOK_FANOUT_ERROR_CODES,
  ...WABOO_MIGRATION_ERROR_CODES,
  ...TPL_ERROR_CODES,
  ...CHANNEL_ERROR_CODES,
  ...CONVERSATION_ERROR_CODES,
  ...INBOX_ERROR_CODES,
  ...WSP_ERROR_CODES,
  ...WAP_ERROR_CODES,
  ...WALLET_ERROR_CODES,
  ...CALL_ERROR_CODES,
  ...FLR_ERROR_CODES,
  ...MKT_ERROR_CODES,
  ...LEAD_ERROR_CODES,
  ...MLA_ERROR_CODES,
  ...FLB_ERROR_CODES,
  ...CHK_ERROR_CODES,
  ...FORMS_ERROR_CODES,
  ...WADEV_ERROR_CODES,
  ...AIAG_ERROR_CODES,
  // generic
  /**
   * An action targeted the unofficial WhatsApp engine (personal numbers over Baileys) while the platform switch is off.
   * 422: the request is well formed but policy refuses it. Owner decision 2026-10-05.
   */
  WA_UNOFFICIAL_DISABLED: 'WA_UNOFFICIAL_DISABLED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  /** The request body is larger than the server accepts (body-parser limit). */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL',

  // platform invariants
  ROW_VERSION_CONFLICT: 'ROW_VERSION_CONFLICT',
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  // billing — hard blocks, surfaced verbatim to the user
  WALLET_INSUFFICIENT_FUNDS: 'WALLET_INSUFFICIENT_FUNDS',
  WALLET_INACTIVE: 'WALLET_INACTIVE',
  RATE_CARD_MISSING: 'RATE_CARD_MISSING',

  // messaging
  CONSENT_OPTED_OUT: 'CONSENT_OPTED_OUT',
  SERVICE_WINDOW_CLOSED: 'SERVICE_WINDOW_CLOSED',
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',

  // exams
  SLOT_CAPACITY_FULL: 'SLOT_CAPACITY_FULL',
  APPLICATION_WINDOW_CLOSED: 'APPLICATION_WINDOW_CLOSED',

  // public / partner API
  API_KEY_INVALID: 'API_KEY_INVALID',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',

  // field metadata (Settings > Data Management)
  FIELD_KEY_TAKEN: 'FIELD_KEY_TAKEN',
  FIELD_IS_SYSTEM: 'FIELD_IS_SYSTEM',
  DEPENDENCY_CYCLE_DETECTED: 'DEPENDENCY_CYCLE_DETECTED',
  /** A status option still held by contacts: repeat the delete with `moveTo`. */
  STATUS_OPTION_IN_USE: 'STATUS_OPTION_IN_USE',
  /** won/lost flags on a group other than contacts' lifecycle stages, or both flags at once. */
  STATUS_OPTION_FLAG_INVALID: 'STATUS_OPTION_FLAG_INVALID',
  /** A status scoped to something that is not a lifecycle stage of the workspace, or a group that cannot be scoped. */
  STATUS_OPTION_STAGE_INVALID: 'STATUS_OPTION_STAGE_INVALID',

  // auth, registration and account security
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  /**
   * A dependency the sign-in checks rely on (the Redis revocation/throttle store) is down and the platform is configured to
   * refuse rather than guess. 503 + Retry-After; nothing about the credential was decided.
   */
  AUTH_SERVICE_DEGRADED: 'AUTH_SERVICE_DEGRADED',
  /** Repeated failures against one account from many addresses: this one must solve the captcha / is not a known network. */
  AUTH_CHALLENGE_REQUIRED: 'AUTH_CHALLENGE_REQUIRED',
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_CAPTCHA_FAILED: 'AUTH_CAPTCHA_FAILED',
  AUTH_SIGNUP_CLOSED: 'AUTH_SIGNUP_CLOSED',
  AUTH_IDENTITY_EXISTS: 'AUTH_IDENTITY_EXISTS',
  /** Three-step sign-up: the set-password step was reached before the emailed code was confirmed. 403. */
  AUTH_EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  AUTH_SLUG_TAKEN: 'AUTH_SLUG_TAKEN',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  AUTH_PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  AUTH_CURRENT_PASSWORD_WRONG: 'AUTH_CURRENT_PASSWORD_WRONG',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_EMAIL_UNVERIFIED: 'AUTH_EMAIL_UNVERIFIED',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'AUTH_PASSWORD_CHANGE_REQUIRED',
  AUTH_MFA_INVALID_CODE: 'AUTH_MFA_INVALID_CODE',
  AUTH_MFA_CHALLENGE_EXPIRED: 'AUTH_MFA_CHALLENGE_EXPIRED',
  AUTH_MFA_ENROLMENT_REQUIRED: 'AUTH_MFA_ENROLMENT_REQUIRED',
  /** A sensitive change (turning two-factor on) needs the password again: the session is older than the re-authentication window. 403, not 401. */
  AUTH_REAUTH_REQUIRED: 'AUTH_REAUTH_REQUIRED',
  AUTH_MFA_SETUP_EXPIRED: 'AUTH_MFA_SETUP_EXPIRED',
  /** A passkey registration or sign-in assertion did not verify (wrong origin, challenge, signature, counter). */
  AUTH_PASSKEY_INVALID: 'AUTH_PASSKEY_INVALID',
  AUTH_PASSKEY_LIMIT: 'AUTH_PASSKEY_LIMIT',
  /** Passkeys are a second factor next to an authenticator app: turn two-factor on first. */
  AUTH_PASSKEY_NEEDS_MFA: 'AUTH_PASSKEY_NEEDS_MFA',
  AUTH_OTP_INVALID: 'AUTH_OTP_INVALID',
  AUTH_OTP_EXPIRED: 'AUTH_OTP_EXPIRED',
  AUTH_SIGNUP_EXPIRED: 'AUTH_SIGNUP_EXPIRED',
  AUTH_OTP_TOO_MANY_ATTEMPTS: 'AUTH_OTP_TOO_MANY_ATTEMPTS',
  AUTH_OTP_RESEND_COOLDOWN: 'AUTH_OTP_RESEND_COOLDOWN',
  AUTH_OTP_SEND_FAILED: 'AUTH_OTP_SEND_FAILED',
  AUTH_OTP_TEMPLATE_FAILED: 'AUTH_OTP_TEMPLATE_FAILED',
  AUTH_SOCIAL_UNAVAILABLE: 'AUTH_SOCIAL_UNAVAILABLE',
  AUTH_SOCIAL_STATE_INVALID: 'AUTH_SOCIAL_STATE_INVALID',
  AUTH_SOCIAL_FAILED: 'AUTH_SOCIAL_FAILED',
  AUTH_SOCIAL_NO_EMAIL: 'AUTH_SOCIAL_NO_EMAIL',
  AUTH_SOCIAL_NO_ACCOUNT: 'AUTH_SOCIAL_NO_ACCOUNT',
  AUTH_SESSION_NOT_FOUND: 'AUTH_SESSION_NOT_FOUND',
  AUTH_CANNOT_REVOKE_CURRENT: 'AUTH_CANNOT_REVOKE_CURRENT',
  AUTH_WORKSPACE_NOT_AVAILABLE: 'AUTH_WORKSPACE_NOT_AVAILABLE',
  /** The email belongs to more than one workspace and the request named none. */
  AUTH_WORKSPACE_REQUIRED: 'AUTH_WORKSPACE_REQUIRED',
  AUTH_DELETE_BLOCKED: 'AUTH_DELETE_BLOCKED',
  AUTH_CONFIRMATION_MISMATCH: 'AUTH_CONFIRMATION_MISMATCH',
  AUTH_IP_BLOCKED: 'AUTH_IP_BLOCKED',
  AUTH_OPERATOR_ROLE_REQUIRED: 'AUTH_OPERATOR_ROLE_REQUIRED',
  AUTH_UPLOAD_REJECTED: 'AUTH_UPLOAD_REJECTED',
  AUTH_SEND_HALTED: 'AUTH_SEND_HALTED',
  AUTH_SEND_BLOCKED: 'AUTH_SEND_BLOCKED',

  // plans, entitlements and the plan catalogue (TW-PLAN-005, 017)
  PLAN_FEATURE_LOCKED: 'PLAN_FEATURE_LOCKED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  PLAN_IN_USE: 'PLAN_IN_USE',
  PLAN_DEFAULT_PROTECTED: 'PLAN_DEFAULT_PROTECTED',
  PLAN_TRIAL_EXPIRED: 'PLAN_TRIAL_EXPIRED',
  PLAN_CHECKOUT_REQUIRED: 'PLAN_CHECKOUT_REQUIRED',
  PLAN_CHANGE_NOT_ALLOWED: 'PLAN_CHANGE_NOT_ALLOWED',
  PLAN_NO_SUBSCRIPTION: 'PLAN_NO_SUBSCRIPTION',

  // contacts, contact groups, tags and attributes (TW-CON)
  CON_GROUP_NAME_TAKEN: 'CON_GROUP_NAME_TAKEN',
  CON_TAG_REQUIRED: 'CON_TAG_REQUIRED',
  CON_TAG_NAME_TAKEN: 'CON_TAG_NAME_TAKEN',
  CON_SELECTION_INVALID: 'CON_SELECTION_INVALID',
  CON_SELECTION_TOO_LARGE: 'CON_SELECTION_TOO_LARGE',
  CON_IMPORT_FILE_INVALID: 'CON_IMPORT_FILE_INVALID',
  CON_IMPORT_TOO_LARGE: 'CON_IMPORT_TOO_LARGE',
  CON_EXPORT_TOO_LARGE: 'CON_EXPORT_TOO_LARGE',
  CON_ATTRIBUTE_KEY_RESERVED: 'CON_ATTRIBUTE_KEY_RESERVED',
  CON_ATTRIBUTE_IN_USE: 'CON_ATTRIBUTE_IN_USE',
  CON_MERGE_SCOPE_REQUIRED: 'CON_MERGE_SCOPE_REQUIRED',
  /** A property marked required in the registry has no value (details: one `customFields.<key>` per property). */
  CON_REQUIRED_PROPERTY_MISSING: 'CON_REQUIRED_PROPERTY_MISSING',
  /** The contact is moving to a lost lifecycle stage without a lost reason. */
  CON_LOST_REASON_REQUIRED: 'CON_LOST_REASON_REQUIRED',
  /** A status that belongs to another lifecycle stage was set on a contact (details: path `status`, names the stage). */
  CON_STATUS_STAGE_MISMATCH: 'CON_STATUS_STAGE_MISMATCH',
  /** A bulk update named a property that is not an active, editable custom property of the workspace (details: one `customFields.<key>` per key). */
  CON_PROPERTY_NOT_EDITABLE: 'CON_PROPERTY_NOT_EDITABLE',

  // segments (product extension)
  /** Another segment in the workspace has this name (any case). */
  SEG_NAME_TAKEN: 'SEG_NAME_TAKEN',
  /** The rules point at something that does not exist (a tag, group, stage, status, user or property) or use an operator the property's type does not have. */
  SEG_RULES_INVALID: 'SEG_RULES_INVALID',
  /** `specific` visibility with nobody chosen (details: path `sharedWith`). */
  SEG_SHARE_EMPTY: 'SEG_SHARE_EMPTY',
  /** A chosen person is not a member of this workspace (details: one `sharedWith.userIds.<n>` per unknown id). */
  SEG_SHARE_USER_NOT_FOUND: 'SEG_SHARE_USER_NOT_FOUND',
  /** A chosen team does not exist in this workspace (details: one `sharedWith.teamIds.<n>` per unknown id). */
  SEG_SHARE_TEAM_NOT_FOUND: 'SEG_SHARE_TEAM_NOT_FOUND',

  // broadcasts (TW-BCAST)
  BCAST_NO_RECIPIENTS: 'BCAST_NO_RECIPIENTS',
  BCAST_TEMPLATE_NOT_FOUND: 'BCAST_TEMPLATE_NOT_FOUND',
  BCAST_TEMPLATE_NOT_ALLOWED: 'BCAST_TEMPLATE_NOT_ALLOWED',
  BCAST_SEND_BLOCKED: 'BCAST_SEND_BLOCKED',
  BCAST_WARMER_HOLD: 'BCAST_WARMER_HOLD',
  BCAST_NOT_DELETABLE: 'BCAST_NOT_DELETABLE',
  BCAST_NOT_RETRYABLE: 'BCAST_NOT_RETRYABLE',
  BCAST_NO_FAILED_RECIPIENTS: 'BCAST_NO_FAILED_RECIPIENTS',
  BCAST_LINK_EXPIRED: 'BCAST_LINK_EXPIRED',
  BCAST_NOT_RESUMABLE: 'BCAST_NOT_RESUMABLE',

  // Telegram channel (TW-TG)
  /** Telegram refused the token (getMe failed). */
  TG_TOKEN_REJECTED: 'TG_TOKEN_REJECTED',
  /** A broadcast needs a message, a file, or both. */
  TG_BROADCAST_EMPTY: 'TG_BROADCAST_EMPTY',
  /** None of the picked chats belong to the bot. */
  TG_NO_RECIPIENTS: 'TG_NO_RECIPIENTS',
  /** The bot is not connected or is paused. */
  TG_BOT_UNAVAILABLE: 'TG_BOT_UNAVAILABLE',
  /** Start: nobody is pending. */
  TG_NOTHING_TO_SEND: 'TG_NOTHING_TO_SEND',
  /** Retry: nobody failed. */
  TG_NOTHING_TO_RETRY: 'TG_NOTHING_TO_RETRY',

  // LINE channel (LINE)
  /** LINE refused the channel access token (the bot info call failed). */
  LINE_TOKEN_REJECTED: 'LINE_TOKEN_REJECTED',
  /** A broadcast needs a message, a file, or both. */
  LINE_BROADCAST_EMPTY: 'LINE_BROADCAST_EMPTY',
  /** None of the picked people belong to the channel. */
  LINE_NO_RECIPIENTS: 'LINE_NO_RECIPIENTS',
  /** The channel is not connected or is paused. */
  LINE_CHANNEL_UNAVAILABLE: 'LINE_CHANNEL_UNAVAILABLE',
  /** Start: nobody is pending. */
  LINE_NOTHING_TO_SEND: 'LINE_NOTHING_TO_SEND',
  /** Retry: nobody failed. */
  LINE_NOTHING_TO_RETRY: 'LINE_NOTHING_TO_RETRY',
  /** Token rotation could not be set up: the Channel ID is missing, the key does not sign, or LINE refused the assertion. */
  LINE_ROTATION_FAILED: 'LINE_ROTATION_FAILED',
  // Viber channel (TW-VIB)
  /** Viber refused the auth token (get_account_info failed). */
  VIB_TOKEN_REJECTED: 'VIB_TOKEN_REJECTED',
  VIB_BROADCAST_EMPTY: 'VIB_BROADCAST_EMPTY',
  /** None of the picked users belong to the channel. */
  VIB_NO_RECIPIENTS: 'VIB_NO_RECIPIENTS',
  VIB_CHANNEL_UNAVAILABLE: 'VIB_CHANNEL_UNAVAILABLE',
  VIB_NOTHING_TO_SEND: 'VIB_NOTHING_TO_SEND',
  VIB_NOTHING_TO_RETRY: 'VIB_NOTHING_TO_RETRY',
  // WeChat channel (WECH)
  /** WeChat refused the AppID and AppSecret (no access token). */
  WECH_CREDENTIALS_REJECTED: 'WECH_CREDENTIALS_REJECTED',
  /** An OpenID broadcast needs at least two recipients that belong to the channel. */
  WECH_TOO_FEW_RECIPIENTS: 'WECH_TOO_FEW_RECIPIENTS',
  WECH_CHANNEL_UNAVAILABLE: 'WECH_CHANNEL_UNAVAILABLE',
  /** The broadcast was already sent: a mass send cannot be repeated. */
  WECH_ALREADY_SENT: 'WECH_ALREADY_SENT',
  /** Retry: the broadcast did not fail. */
  WECH_NOT_RETRYABLE: 'WECH_NOT_RETRYABLE',

  // Help assistant (docs/specs/help-agent-assistant.md)
  /** The workspace switch is off, or the person may not use the assistant here (a disabled screen, a missing permission). */
  HELP_AGENT_DISABLED: 'HELP_AGENT_DISABLED',
  /** Too many tasks started for this person or workspace today, or too fast. */
  HELP_AGENT_TASK_LIMIT: 'HELP_AGENT_TASK_LIMIT',
  /** The task used its step budget, its time or its token allowance. */
  HELP_AGENT_STEP_LIMIT: 'HELP_AGENT_STEP_LIMIT',
  /** The task already finished or expired: start a new one. */
  HELP_AGENT_TASK_CLOSED: 'HELP_AGENT_TASK_CLOSED',
  /** No AI provider key is configured, or the provider failed. */
  HELP_AGENT_PROVIDER_UNAVAILABLE: 'HELP_AGENT_PROVIDER_UNAVAILABLE',
  /** The model request is not one the assistant sends (an unknown field, a stream, too large). */
  HELP_AGENT_REQUEST_INVALID: 'HELP_AGENT_REQUEST_INVALID',
  // Email channel (TW-MAIL)
  /** The platform operator has not entered the Google credentials. */
  MAIL_NOT_CONFIGURED: 'MAIL_NOT_CONFIGURED',
  /** The workspace is at its mailbox limit. */
  MAIL_MAILBOX_LIMIT: 'MAIL_MAILBOX_LIMIT',
  /** The mailbox is disconnected or needs reconnecting, so it cannot send or sync. */
  MAIL_MAILBOX_UNAVAILABLE: 'MAIL_MAILBOX_UNAVAILABLE',
  /** Google refused a send (address, size, quota). */
  MAIL_SEND_REFUSED: 'MAIL_SEND_REFUSED',
  /** The signed-in Google account is not the mailbox being reconnected. */
  MAIL_WRONG_ACCOUNT: 'MAIL_WRONG_ACCOUNT',
  /** The provider is unknown, or its platform setup is missing (Microsoft client, Pub/Sub). */
  MAIL_PROVIDER_UNSUPPORTED: 'MAIL_PROVIDER_UNSUPPORTED',
  /** IMAP refused the user name or password (connect, or a later sync). */
  MAIL_IMAP_AUTH_FAILED: 'MAIL_IMAP_AUTH_FAILED',
  /** SMTP refused the user name or password. */
  MAIL_SMTP_AUTH_FAILED: 'MAIL_SMTP_AUTH_FAILED',
  /** The IMAP or SMTP server could not be reached or its TLS failed. */
  MAIL_IMAP_CONNECT_FAILED: 'MAIL_IMAP_CONNECT_FAILED',
  /** The workspace has not enabled personal mailboxes. */
  MAIL_PERSONAL_DISABLED: 'MAIL_PERSONAL_DISABLED',
  /** Personal mailboxes are on, but the caller may not connect one (policy 'admins', or the mailbox is someone else's). */
  MAIL_PERSONAL_NOT_ALLOWED: 'MAIL_PERSONAL_NOT_ALLOWED',
  /** The mailbox hit its per-hour send limit. */
  MAIL_RATE_LIMITED: 'MAIL_RATE_LIMITED',
  /** An outbound attachment is over the per-file or the total size cap. */
  MAIL_ATTACHMENT_TOO_LARGE: 'MAIL_ATTACHMENT_TOO_LARGE',
  /** More than the allowed number of attachments on one reply. */
  MAIL_TOO_MANY_ATTACHMENTS: 'MAIL_TOO_MANY_ATTACHMENTS',
  /** A staged attachment id does not exist, expired, or is not the caller's. */
  MAIL_ATTACHMENT_NOT_FOUND: 'MAIL_ATTACHMENT_NOT_FOUND',
  /** The signature does not exist or is not one the caller may use. */
  MAIL_SIGNATURE_NOT_FOUND: 'MAIL_SIGNATURE_NOT_FOUND',
  /** The email template does not exist or is a colleague's personal one. */
  EMAIL_TEMPLATE_NOT_FOUND: 'EMAIL_TEMPLATE_NOT_FOUND',
  /** Another template of the same owner (the workspace, or you) already has this name. */
  EMAIL_TEMPLATE_NAME_TAKEN: 'EMAIL_TEMPLATE_NAME_TAKEN',
  /** Only people who manage email templates can create or change a shared one. */
  EMAIL_TEMPLATE_NOT_EDITABLE: 'EMAIL_TEMPLATE_NOT_EDITABLE',
  /** The template is archived and cannot be used in a reply. */
  EMAIL_TEMPLATE_ARCHIVED: 'EMAIL_TEMPLATE_ARCHIVED',

  // SMS channel (TW-SMS)
  /** The provider refused the credentials at connect time. */
  SMS_CREDENTIALS_REJECTED: 'SMS_CREDENTIALS_REJECTED',
  /** The sender is disconnected or its credentials are missing. */
  SMS_SENDER_UNAVAILABLE: 'SMS_SENDER_UNAVAILABLE',
  /** The workspace plan does not include SMS, or the platform switch is off. */
  SMS_NOT_AVAILABLE: 'SMS_NOT_AVAILABLE',
  /** The monthly SMS quota is used up. */
  SMS_QUOTA_EXCEEDED: 'SMS_QUOTA_EXCEEDED',

  // Facebook channel (TW-FB)
  /** No Meta app is configured on this install, so a Page cannot be connected. */
  FB_NOT_CONFIGURED: 'FB_NOT_CONFIGURED',
  /** The OAuth state did not round-trip: a forged or stale callback (login-CSRF guard). */
  FB_STATE_INVALID: 'FB_STATE_INVALID',
  /** Meta refused the code. */
  FB_CODE_REJECTED: 'FB_CODE_REJECTED',
  /** The account manages no Page we could store. */
  FB_NO_PAGES: 'FB_NO_PAGES',
  /** A pasted token did not resolve to a Page. */
  FB_TOKEN_NOT_A_PAGE: 'FB_TOKEN_NOT_A_PAGE',
  /** Refresh: Meta did not answer for the Page (its token may need re-auth). */
  FB_REFRESH_FAILED: 'FB_REFRESH_FAILED',
  /** A broadcast needs a message. */
  FB_BROADCAST_EMPTY: 'FB_BROADCAST_EMPTY',
  /** None of the picked people are inside the 24 hour window of that Page. */
  FB_NO_RECIPIENTS: 'FB_NO_RECIPIENTS',
  /** The Page is not connected, or Meta revoked its token. */
  FB_PAGE_UNAVAILABLE: 'FB_PAGE_UNAVAILABLE',
  /** Start: nobody is pending. */
  FB_NOTHING_TO_SEND: 'FB_NOTHING_TO_SEND',
  /** Retry: nobody failed. */
  FB_NOTHING_TO_RETRY: 'FB_NOTHING_TO_RETRY',
  /** Meta refused a Messenger profile change; the message carries its reason. */
  FB_SETUP_REJECTED: 'FB_SETUP_REJECTED',
  /** Meta's Graph version no longer accepts the field (the welcome greeting). */
  FB_SETUP_UNSUPPORTED: 'FB_SETUP_UNSUPPORTED',
  /** A post cannot be made as written (nothing in it, photos and a link together, a video address that is not HTTPS). */
  FB_POST_INVALID: 'FB_POST_INVALID',
  /** The schedule is outside Meta's window (10 minutes to 75 days ahead). */
  FB_SCHEDULE_INVALID: 'FB_SCHEDULE_INVALID',

  // Instagram channel (TW-IG)
  /** The Instagram engine is not connected on this install. */
  IG_NOT_CONNECTED: 'IG_NOT_CONNECTED',
  /** The engine does not list that account to this workspace or person. */
  IG_ACCOUNT_NOT_FOUND: 'IG_ACCOUNT_NOT_FOUND',
  /** The engine did not give a sign-in address for a new account. */
  IG_CONNECT_FAILED: 'IG_CONNECT_FAILED',
  /** Run a flow: the thread is not an Instagram thread. */
  IG_NOT_AN_INSTAGRAM_THREAD: 'IG_NOT_AN_INSTAGRAM_THREAD',
  /** Run a flow: the thread has no engine conversation id (its key is not `ig:...`). */
  IG_THREAD_NO_ENGINE_ID: 'IG_THREAD_NO_ENGINE_ID',
  /** The engine refused to start the flow. */
  IG_FLOW_RUN_FAILED: 'IG_FLOW_RUN_FAILED',

  // Shopify and WooCommerce integrations (TW-ECOM)
  /** The Shopify app is off on this install, or has no client id. */
  ECOM_NOT_CONFIGURED: 'ECOM_NOT_CONFIGURED',
  /** The WooCommerce integration is switched off by the platform. */
  ECOM_DISABLED: 'ECOM_DISABLED',
  /** The Shopify domain is not `<handle>.myshopify.com`. */
  ECOM_SHOP_INVALID: 'ECOM_SHOP_INVALID',
  /** An embedded-app session token is malformed, badly signed, expired, for another app, or for another shop (TW-ECOM-038). */
  ECOM_SESSION_TOKEN_INVALID: 'ECOM_SESSION_TOKEN_INVALID',
  /** The WooCommerce store address has no host. */
  ECOM_STORE_INVALID: 'ECOM_STORE_INVALID',
  /** The WooCommerce store did not accept the keys, or could not be reached. */
  ECOM_STORE_UNREACHABLE: 'ECOM_STORE_UNREACHABLE',

  // campaigns (TW-CAMP)
  /** Nobody on the audience can be messaged. */
  CAMP_NO_RECIPIENTS: 'CAMP_NO_RECIPIENTS',
  /** Edit: only draft, scheduled or paused campaigns can change. */
  CAMP_NOT_EDITABLE: 'CAMP_NOT_EDITABLE',
  /** Resend: only a finished campaign can be sent again. */
  CAMP_NOT_RESENDABLE: 'CAMP_NOT_RESENDABLE',
  /** Resend: nobody matches the scope. */
  CAMP_NOTHING_TO_RESEND: 'CAMP_NOTHING_TO_RESEND',
  /** A recurring broadcast that already sent messages keeps its history: it can be cancelled, not deleted. */
  CAMP_SERIES_HAS_HISTORY: 'CAMP_SERIES_HAS_HISTORY',
  /** The template cannot be used for a campaign (not approved, OTP, quality, media). */
  CAMP_TEMPLATE_NOT_ALLOWED: 'CAMP_TEMPLATE_NOT_ALLOWED',
  /** The auto-end date is not after the send date. */
  CAMP_EXPIRY_BEFORE_SEND: 'CAMP_EXPIRY_BEFORE_SEND',
  /** "Build with AI": neither the workspace nor the platform has an active key for the vendor. */
  CAMP_AI_NO_KEY: 'CAMP_AI_NO_KEY',
  /** "Build with AI": the workspace used its monthly allowance on the platform's key. */
  CAMP_AI_LIMIT_REACHED: 'CAMP_AI_LIMIT_REACHED',
  /** "Build with AI": the vendor failed, timed out or returned nothing. */
  CAMP_AI_PROVIDER_FAILED: 'CAMP_AI_PROVIDER_FAILED',
  /** "Build with AI": the model's answer was not the JSON the builder expects. */
  CAMP_AI_BAD_JSON: 'CAMP_AI_BAD_JSON',
  /** "Build with AI" picture: the vendor's safety system refused the prompt, or it returned no image. */
  CAMP_AI_IMAGE_REFUSED: 'CAMP_AI_IMAGE_REFUSED',
  /** The campaign cannot be started or resumed in its current status. */
  CAMP_NOT_STARTABLE: 'CAMP_NOT_STARTABLE',
  /** The broadcast wizard's draft is incomplete or invalid at launch (`errors[]` names each step's problem). */
  CAMP_WIZARD_INCOMPLETE: 'CAMP_WIZARD_INCOMPLETE',
  /** The wizard draft was already launched, so it can no longer be edited or launched again. */
  CAMP_WIZARD_LAUNCHED: 'CAMP_WIZARD_LAUNCHED',
  /** A test send needs at least one valid E.164 number and at most ten. */
  CAMP_TEST_RECIPIENTS_INVALID: 'CAMP_TEST_RECIPIENTS_INVALID',
  /** Pause, resume or cancel asked of a broadcast whose status does not allow it. */
  CAMP_BROADCAST_NOT_CONTROLLABLE: 'CAMP_BROADCAST_NOT_CONTROLLABLE',

  // deals and pipelines (TW-DEAL)
  /** The stage belongs to a different pipeline than the deal (Reference ignored it, defaulted it, or 422'd by path). */
  DEAL_STAGE_MISMATCH: 'DEAL_STAGE_MISMATCH',
  DEAL_NO_WON_STAGE: 'DEAL_NO_WON_STAGE',
  DEAL_NO_LOST_STAGE: 'DEAL_NO_LOST_STAGE',
  DEAL_NO_OPEN_STAGE: 'DEAL_NO_OPEN_STAGE',
  DEAL_LOST_REASON_REQUIRED: 'DEAL_LOST_REASON_REQUIRED',
  /** The owner or task assignee is not an active member of this workspace. */
  DEAL_OWNER_INVALID: 'DEAL_OWNER_INVALID',
  DEAL_VALUE_INVALID: 'DEAL_VALUE_INVALID',
  DEAL_POSITION_INVALID: 'DEAL_POSITION_INVALID',
  DEAL_TASK_NOT_FOUND: 'DEAL_TASK_NOT_FOUND',
  DEAL_PIPELINE_NAME_TAKEN: 'DEAL_PIPELINE_NAME_TAKEN',
  DEAL_PIPELINE_DEFAULT_PROTECTED: 'DEAL_PIPELINE_DEFAULT_PROTECTED',
  DEAL_PIPELINE_HAS_DEALS: 'DEAL_PIPELINE_HAS_DEALS',
  DEAL_PIPELINE_TARGET_INVALID: 'DEAL_PIPELINE_TARGET_INVALID',
  DEAL_STAGE_NAME_TAKEN: 'DEAL_STAGE_NAME_TAKEN',
  DEAL_STAGE_KIND_TAKEN: 'DEAL_STAGE_KIND_TAKEN',
  DEAL_STAGE_HAS_DEALS: 'DEAL_STAGE_HAS_DEALS',
  DEAL_STAGE_LAST: 'DEAL_STAGE_LAST',
  DEAL_ORDER_INVALID: 'DEAL_ORDER_INVALID',
  DEAL_LOST_REASON_NAME_TAKEN: 'DEAL_LOST_REASON_NAME_TAKEN',

  // website chatbot widget (TW-WGT)
  /** Mode `ai` or `both` saved without a smart agent. */
  WGT_ASSISTANT_REQUIRED: 'WGT_ASSISTANT_REQUIRED',
  /** The smart agent is not one of this workspace's. */
  WGT_ASSISTANT_NOT_IN_WORKSPACE: 'WGT_ASSISTANT_NOT_IN_WORKSPACE',

  // tasks (TW-TASK)
  /** The assignee is not an active member of this workspace (Reference silently replaced or dropped it). */
  TASK_ASSIGNEE_INVALID: 'TASK_ASSIGNEE_INVALID',

  // companies (TW-CTP)
  /** The owner is not an active member of this workspace (Reference never let the owner be set at all). */
  COMPANY_OWNER_INVALID: 'COMPANY_OWNER_INVALID',
  /** A custom value names a company property that is not editable here (not defined, inactive, hidden, read-only or computed). */
  COMPANY_PROPERTY_NOT_EDITABLE: 'COMPANY_PROPERTY_NOT_EDITABLE',
  /** A custom value does not fit its property's type (not a number, not one of the options, not a date, ...). */
  COMPANY_PROPERTY_INVALID: 'COMPANY_PROPERTY_INVALID',
  /** A property the workspace marked required has no value (honouring its "show only when" rule). */
  COMPANY_REQUIRED_PROPERTY_MISSING: 'COMPANY_REQUIRED_PROPERTY_MISSING',
  /** A condition or order on the companies list names a property that does not exist, is inactive, is computed or does not suit the operator. */
  COMPANY_FILTER_INVALID: 'COMPANY_FILTER_INVALID',
  /** The CSV of a company import cannot be read at all (no header, no name column, too many rows). Row-level problems are reported per row. */
  COMPANY_IMPORT_INVALID: 'COMPANY_IMPORT_INVALID',
  /** A company export would hold more rows than one file may (COMPANY_EXPORT_MAX): narrow it with the filters. */
  COMPANY_EXPORT_TOO_LARGE: 'COMPANY_EXPORT_TOO_LARGE',
  /** "Generate brief": no AI key is available to this workspace (its own, or the platform's), so nothing was sent anywhere. */
  COMPANY_BRIEF_AI_UNAVAILABLE: 'COMPANY_BRIEF_AI_UNAVAILABLE',
  /** "Generate brief": the AI provider refused the key or failed; the previous brief, if any, is kept. */
  COMPANY_BRIEF_PROVIDER_FAILED: 'COMPANY_BRIEF_PROVIDER_FAILED',
  /** "Generate brief": the company was asked for a brief again too soon. */
  COMPANY_BRIEF_RATE_LIMITED: 'COMPANY_BRIEF_RATE_LIMITED',
  // platform settings, branding and storage (TW-SET)
  SET_MAINTENANCE: 'SET_MAINTENANCE',
  // localization and translation (TW-I18N)
  I18N_LANGUAGE_NOT_AVAILABLE: 'I18N_LANGUAGE_NOT_AVAILABLE',
  I18N_LANGUAGE_IS_DEFAULT: 'I18N_LANGUAGE_IS_DEFAULT',
  I18N_LANGUAGE_INACTIVE: 'I18N_LANGUAGE_INACTIVE',
  I18N_ADD_LANGUAGE_DISABLED: 'I18N_ADD_LANGUAGE_DISABLED',
  I18N_PROVIDER_CREDENTIALS_MISSING: 'I18N_PROVIDER_CREDENTIALS_MISSING',
  I18N_PROVIDER_INACTIVE: 'I18N_PROVIDER_INACTIVE',
  I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER: 'I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER',
  // first-run setup and the demo guard (TW-INST-001, 015, 029)
  SETUP_ALREADY_COMPLETED: 'SETUP_ALREADY_COMPLETED',
  SETUP_DISABLED: 'SETUP_DISABLED',
  SETUP_TOKEN_INVALID: 'SETUP_TOKEN_INVALID',
  SETUP_PREREQUISITES_FAILED: 'SETUP_PREREQUISITES_FAILED',
  SETUP_STEP_OUT_OF_ORDER: 'SETUP_STEP_OUT_OF_ORDER',
  SETUP_STEP_FAILED: 'SETUP_STEP_FAILED',
  SETUP_LICENCE_INVALID: 'SETUP_LICENCE_INVALID',
  SETUP_DATABASE_TEST_FAILED: 'SETUP_DATABASE_TEST_FAILED',
  LICENCE_NOT_ENABLED: 'LICENCE_NOT_ENABLED',
  DEMO_MODE_BLOCKED: 'DEMO_MODE_BLOCKED',
  // add-ons, extensions and the module registry (TW-ADD)
  ADD_PACKAGE_INVALID: 'ADD_PACKAGE_INVALID',
  ADD_PACKAGE_TOO_LARGE: 'ADD_PACKAGE_TOO_LARGE',
  ADD_CORE_TOO_OLD: 'ADD_CORE_TOO_OLD',
  ADD_ENGINE_CONFLICT: 'ADD_ENGINE_CONFLICT',
  ADD_PACK_IN_USE: 'ADD_PACK_IN_USE',
  ADD_MODULE_DISABLED: 'ADD_MODULE_DISABLED',
  // AI provider keys and token metering (TW-AIADM)
  /** Activating a provider that has no readable key. */
  AIADM_KEY_REQUIRED: 'AIADM_KEY_REQUIRED',
  /** No key (own or platform) is available for the provider a call asked for. */
  AIADM_NO_KEY_AVAILABLE: 'AIADM_NO_KEY_AVAILABLE',
  // marketing site, blog and legal pages (TW-CMS)
  CMS_SLUG_TAKEN: 'CMS_SLUG_TAKEN',

  // reseller billing (TW-BSP)
  /** The platform's Meta connection (business id and token) is not set up. */
  BSP_NOT_CONFIGURED: 'BSP_NOT_CONFIGURED',
  /** Meta accepts only AUD, EUR, GBP, IDR, INR and USD for a credit line, and the choice is locked once attached. */
  BSP_CURRENCY_UNSUPPORTED: 'BSP_CURRENCY_UNSUPPORTED',
  /** The WABA is not a connected WhatsApp Business number of that workspace (Reference attached any string). */
  BSP_WABA_NOT_FOUND: 'BSP_WABA_NOT_FOUND',
  /** Meta refused or did not answer; the message is Meta's, shown to the operator. */
  BSP_META_REJECTED: 'BSP_META_REJECTED',
  BSP_ALLOCATION_NOT_ATTACHED: 'BSP_ALLOCATION_NOT_ATTACHED',
  /** "Bill me through us" is chosen before the platform's credit line exists. */
  BSP_RESELLER_UNAVAILABLE: 'BSP_RESELLER_UNAVAILABLE',

  // team chat (TW-TCHAT)
  TCHAT_CHANNEL_NAME_TAKEN: 'TCHAT_CHANNEL_NAME_TAKEN',
  /** #general cannot be deleted. */
  TCHAT_CHANNEL_PROTECTED: 'TCHAT_CHANNEL_PROTECTED',
  TCHAT_NOT_CHANNEL_MEMBER: 'TCHAT_NOT_CHANNEL_MEMBER',
  TCHAT_EMPTY_MESSAGE: 'TCHAT_EMPTY_MESSAGE',
  /** The message being replied to is not in this channel (Reference: `parent_other_channel`). */
  TCHAT_REPLY_OTHER_CHANNEL: 'TCHAT_REPLY_OTHER_CHANNEL',
  TCHAT_EDIT_WINDOW_EXPIRED: 'TCHAT_EDIT_WINDOW_EXPIRED',
  TCHAT_NOT_MESSAGE_AUTHOR: 'TCHAT_NOT_MESSAGE_AUTHOR',
  TCHAT_ALREADY_MEMBER: 'TCHAT_ALREADY_MEMBER',
  TCHAT_INVITATION_DECIDED: 'TCHAT_INVITATION_DECIDED',
  TCHAT_ATTACHMENT_REJECTED: 'TCHAT_ATTACHMENT_REJECTED',
  /** The operation does not apply to this kind of channel (members of a public channel, a direct message with yourself). */
  TCHAT_CHANNEL_KIND_INVALID: 'TCHAT_CHANNEL_KIND_INVALID',

  // proposals and estimates (TW-PROP / TW-EST)
  /** The move is not allowed from the document's status (details: `from`, `to`). */
  SALESDOC_INVALID_TRANSITION: 'SALESDOC_INVALID_TRANSITION',
  /** Only a draft is edited in place; a sent document is revised first. */
  SALESDOC_NOT_EDITABLE: 'SALESDOC_NOT_EDITABLE',
  /** The valid-until date has passed: the buyer can no longer decide. */
  SALESDOC_EXPIRED: 'SALESDOC_EXPIRED',
  /** The document was decided the other way already (the same decision twice is a replay, not this). */
  SALESDOC_ALREADY_DECIDED: 'SALESDOC_ALREADY_DECIDED',
  SALESDOC_ALREADY_CONVERTED: 'SALESDOC_ALREADY_CONVERTED',
  SALESDOC_ALREADY_LINKED_DEAL: 'SALESDOC_ALREADY_LINKED_DEAL',
  /** Accepted and converted documents are evidence and cannot be deleted. */
  SALESDOC_NOT_DELETABLE: 'SALESDOC_NOT_DELETABLE',
  /** The public link was revoked or has expired (an unknown token is a plain 404). */
  SALESDOC_LINK_UNAVAILABLE: 'SALESDOC_LINK_UNAVAILABLE',
  /** The owner is not an active member of this workspace. */
  SALESDOC_OWNER_INVALID: 'SALESDOC_OWNER_INVALID',
  /** An amount, quantity or rate the math cannot represent (details: one path per field). */
  SALESDOC_AMOUNT_INVALID: 'SALESDOC_AMOUNT_INVALID',
  /** The channel has nowhere to deliver: no buyer email or phone. */
  SALESDOC_NO_RECIPIENT: 'SALESDOC_NO_RECIPIENT',
  SALESDOC_SEND_FAILED: 'SALESDOC_SEND_FAILED',
  /** No invoicing module is bound to the sales-docs port in this deployment. */
  SALESDOC_INVOICING_UNAVAILABLE: 'SALESDOC_INVOICING_UNAVAILABLE',
  SALESDOC_TEMPLATE_NAME_TAKEN: 'SALESDOC_TEMPLATE_NAME_TAKEN',

  // invoices, payments and tax rates (TW-INV / TW-PAY)
  /** The invoice is no longer a draft: its lines, amounts, buyer name and numbering are frozen. */
  INV_NOT_DRAFT: 'INV_NOT_DRAFT',
  /** The action needs an issued invoice (a draft has no number to pay or send, a void one cannot be paid). */
  INV_NOT_ISSUED: 'INV_NOT_ISSUED',
  INV_ALREADY_VOID: 'INV_ALREADY_VOID',
  /** An amount, quantity or rate the math cannot represent (details: one path per field). */
  INV_AMOUNT_INVALID: 'INV_AMOUNT_INVALID',
  /** A void invoice may not carry a net payment: refund it first. */
  INV_HAS_PAYMENTS: 'INV_HAS_PAYMENTS',
  /** Only a draft is deleted; an issued invoice is voided (its number stays on record). */
  INV_NOT_DELETABLE: 'INV_NOT_DELETABLE',
  INV_OWNER_INVALID: 'INV_OWNER_INVALID',
  INV_TAX_RATE_INVALID: 'INV_TAX_RATE_INVALID',
  /** The public link was revoked or has expired (an unknown token is a plain 404). */
  INV_LINK_UNAVAILABLE: 'INV_LINK_UNAVAILABLE',
  /** The invoice has no buyer email or phone for that delivery channel. */
  INV_NO_RECIPIENT: 'INV_NO_RECIPIENT',
  /** The source document was already turned into an invoice (the existing one is returned by the conversion port). */
  INV_ALREADY_CONVERTED: 'INV_ALREADY_CONVERTED',
  INV_RECURRING_INVALID: 'INV_RECURRING_INVALID',
  TAX_RATE_NAME_TAKEN: 'TAX_RATE_NAME_TAKEN',
  TAX_RATE_INVALID: 'TAX_RATE_INVALID',
  /** The payment is more than the open balance and `allowOverpayment` was not set (details: balance, amount). */
  PAY_OVERPAYMENT: 'PAY_OVERPAYMENT',
  PAY_CURRENCY_MISMATCH: 'PAY_CURRENCY_MISMATCH',
  PAY_FUTURE_DATE: 'PAY_FUTURE_DATE',
  /** A refund is more than what is left of the payment (details: refundable, amount). */
  PAY_REFUND_EXCEEDS: 'PAY_REFUND_EXCEEDS',
  /** Only a payment can be refunded, and a refund cannot be refunded. */
  PAY_NOT_REFUNDABLE: 'PAY_NOT_REFUNDABLE',
  PAY_NOTHING_TO_PAY: 'PAY_NOTHING_TO_PAY',
  PAY_GATEWAY_NOT_CONFIGURED: 'PAY_GATEWAY_NOT_CONFIGURED',
  /** The webhook signature is missing or wrong (the endpoint does not say which, or whether the endpoint exists). */
  PAY_SIGNATURE_INVALID: 'PAY_SIGNATURE_INVALID',
  PAY_AMOUNT_MISMATCH: 'PAY_AMOUNT_MISMATCH',
  /** The credit notes of an invoice would add up to more than the invoice (details: creditable). */
  CN_EXCEEDS_INVOICE: 'CN_EXCEEDS_INVOICE',
  /** A credit note is edited and deleted only while it is a draft. */
  CN_NOT_DRAFT: 'CN_NOT_DRAFT',
  CN_ALREADY_VOID: 'CN_ALREADY_VOID',
  /** Cash was returned for this credit note: the refund stands in the payment ledger, so it cannot be voided. */
  CN_HAS_REFUND: 'CN_HAS_REFUND',
  /** Nothing is left to credit on the invoice (or on the chosen line). */
  CN_NOTHING_TO_CREDIT: 'CN_NOTHING_TO_CREDIT',
  CN_LINE_INVALID: 'CN_LINE_INVALID',
  /** A sales order is edited only while it is a draft. */
  SO_NOT_DRAFT: 'SO_NOT_DRAFT',
  SO_NOT_CONFIRMED: 'SO_NOT_CONFIRMED',
  SO_CANCELLED: 'SO_CANCELLED',
  /** The proposal or estimate is not accepted yet. */
  SO_QUOTE_NOT_ACCEPTED: 'SO_QUOTE_NOT_ACCEPTED',
  /** The accepted offer already has a live sales order. */
  SO_QUOTE_TAKEN: 'SO_QUOTE_TAKEN',
  /** More than the unbilled or undelivered quantity (details: line, remaining). */
  SO_QUANTITY_EXCEEDS: 'SO_QUANTITY_EXCEEDS',
  SO_NOTHING_TO_INVOICE: 'SO_NOTHING_TO_INVOICE',
  /** An invoice made from the order is still live: void or delete it first. */
  SO_HAS_INVOICES: 'SO_HAS_INVOICES',
  /** The schedule is ended (nothing left to run) or not in the state the action needs. */
  /** An invoice with issued credit notes cannot be voided (void the credit notes first). */
  INV_HAS_CREDITS: 'INV_HAS_CREDITS',
  /** The lines of an invoice made from a sales order are fixed (they hold the order's billed quantities). */
  INV_ORDER_LINKED: 'INV_ORDER_LINKED',
  REC_NOT_ACTIVE: 'REC_NOT_ACTIVE',
  REC_ENDED: 'REC_ENDED',
  /** The start date is further back than the catch-up window allows. */
  REC_START_TOO_OLD: 'REC_START_TOO_OLD',

  // appointments and booking (TW-APPT)
  /** The slot has no free seat any more (another booking won it). */
  APPT_SLOT_TAKEN: 'APPT_SLOT_TAKEN',
  /** The time is not one the booking type offers (outside the hours, inside the notice, past the horizon, on a closed date). */
  APPT_SLOT_UNAVAILABLE: 'APPT_SLOT_UNAVAILABLE',
  /** The move is not allowed from the appointment's status (details: `from`, `to`). */
  APPT_INVALID_TRANSITION: 'APPT_INVALID_TRANSITION',
  /** Complete, no-show and check-in need the appointment to have started. */
  APPT_NOT_STARTED: 'APPT_NOT_STARTED',
  /** The appointment has started: it can no longer be moved or cancelled by the customer. */
  APPT_ALREADY_STARTED: 'APPT_ALREADY_STARTED',
  /** Only an appointment in a final status is deleted. */
  APPT_NOT_DELETABLE: 'APPT_NOT_DELETABLE',
  /** The booking type was deleted or paused: the booking cannot move. */
  APPT_TYPE_UNAVAILABLE: 'APPT_TYPE_UNAVAILABLE',
  /** An answer is missing, of the wrong type, or not one of the choices (details: one path per question). */
  APPT_ANSWERS_INVALID: 'APPT_ANSWERS_INVALID',
  /** The host is not an active member of this workspace. */
  APPT_HOST_INVALID: 'APPT_HOST_INVALID',
  /** An amount the currency cannot represent, or a payment the booking does not need. */
  APPT_AMOUNT_INVALID: 'APPT_AMOUNT_INVALID',
  /** The manage link belongs to a booking that is over (cancelled, completed, ...). */
  APPT_LINK_UNAVAILABLE: 'APPT_LINK_UNAVAILABLE',
  /** Online booking is off for this workspace (plan flag, plan cap) or the service is not bookable. */
  APPT_BOOKING_UNAVAILABLE: 'APPT_BOOKING_UNAVAILABLE',
  /** A booking type with pending or confirmed bookings still to come is not deleted. */
  BOOKING_TYPE_HAS_UPCOMING: 'BOOKING_TYPE_HAS_UPCOMING',
  /** The platform operator has not set up a Google OAuth client (or turned it off): a workspace cannot connect Google Calendar. */
  APPT_CALENDAR_NOT_CONFIGURED: 'APPT_CALENDAR_NOT_CONFIGURED',
  /** No Google Calendar is connected (or it needs reconnecting): there is nothing to list, pick or write to. */
  APPT_CALENDAR_NOT_CONNECTED: 'APPT_CALENDAR_NOT_CONNECTED',
  /** Google did not answer or refused the request (details are logged, not returned). */
  APPT_CALENDAR_PROVIDER_FAILED: 'APPT_CALENDAR_PROVIDER_FAILED',
  /** Confirming a calendar connection that someone else started (a forwarded link), or in another workspace. Nothing was requested from the provider. */
  APPT_CALENDAR_CONFIRM_NOT_YOURS: 'APPT_CALENDAR_CONFIRM_NOT_YOURS',
  /** The calendar connection ticket is malformed, expired or already used: press Connect again. */
  APPT_CALENDAR_CONFIRM_INVALID: 'APPT_CALENDAR_CONFIRM_INVALID',
  /** The iCal feed address is not an address we can read (not http/https/webcal, credentials in it, too long). */
  APPT_ICS_FEED_INVALID: 'APPT_ICS_FEED_INVALID',
  /** The feed address was fetched and is not a usable calendar (details: one path `url` with the reason code: unreachable, not_a_calendar, too_large, ...). */
  APPT_ICS_FEED_UNREADABLE: 'APPT_ICS_FEED_UNREADABLE',
  /** The workspace already subscribes to that address. */
  APPT_ICS_FEED_DUPLICATE: 'APPT_ICS_FEED_DUPLICATE',
  /** The workspace is at its limit of iCal feeds. */
  APPT_ICS_FEED_LIMIT: 'APPT_ICS_FEED_LIMIT',

  // catalog and products (TW-CAT)
  /** The workspace has no Meta catalog connected (sync, import, commerce settings and sends need one). */
  CAT_NOT_CONNECTED: 'CAT_NOT_CONNECTED',
  /** Meta refused the catalog id or token while connecting; the problem carries Meta's code and a hint. */
  CAT_META_REJECTED: 'CAT_META_REJECTED',
  CAT_NO_WABA: 'CAT_NO_WABA',
  CAT_WABA_TOKEN_MISSING: 'CAT_WABA_TOKEN_MISSING',
  CAT_NO_CATALOG_LINKED: 'CAT_NO_CATALOG_LINKED',
  CAT_NO_RECIPIENTS: 'CAT_NO_RECIPIENTS',
  CAT_TOO_MANY_RECIPIENTS: 'CAT_TOO_MANY_RECIPIENTS',
  CAT_NO_PRODUCTS: 'CAT_NO_PRODUCTS',
  CAT_NO_SENDER: 'CAT_NO_SENDER',
  CAT_SEND_FAILED: 'CAT_SEND_FAILED',
  CAT_COLLECTION_PRODUCTS_INVALID: 'CAT_COLLECTION_PRODUCTS_INVALID',
  CAT_PROVIDER_FAILED: 'CAT_PROVIDER_FAILED',
  /** Creating a catalog needs the workspace to have none connected yet; remove or disconnect the current one first. */
  CAT_ALREADY_CONNECTED: 'CAT_ALREADY_CONNECTED',
  /** Deleting the catalog on Meta needs the catalog id typed back exactly. */
  CAT_CONFIRM_MISMATCH: 'CAT_CONFIRM_MISMATCH',
  /** The product set could not be pushed: it has no product with a retailer id on Meta, or no catalog is connected. */
  CAT_SET_NOT_SYNCABLE: 'CAT_SET_NOT_SYNCABLE',
  /** The catalog has no phone number id: commerce settings and Meta sends need one (TW-CAT-005, 034). */
  CAT_NO_PHONE_NUMBER: 'CAT_NO_PHONE_NUMBER',
  /** A catalog link without a Meta catalog sends the shop link, and the workspace has no shop (TW-CAT-015). */
  CAT_NO_SHOP: 'CAT_NO_SHOP',

  // storefront builder and public shop (TW-STORE)
  STORE_SLUG_TAKEN: 'STORE_SLUG_TAKEN',
  STORE_NO_SHOP: 'STORE_NO_SHOP',
  STORE_NOT_AVAILABLE: 'STORE_NOT_AVAILABLE',
  STORE_ITEMS_UNAVAILABLE: 'STORE_ITEMS_UNAVAILABLE',
  STORE_COUPON_INVALID: 'STORE_COUPON_INVALID',
  STORE_DEVICE_INVALID: 'STORE_DEVICE_INVALID',
  STORE_RESET_NOT_CONFIRMED: 'STORE_RESET_NOT_CONFIRMED',
  STORE_DOMAIN_NOT_SET: 'STORE_DOMAIN_NOT_SET',
  STORE_WEBHOOK_REJECTED: 'STORE_WEBHOOK_REJECTED',
  /** A shop is saved with no connected WhatsApp number in the workspace ("Connect WhatsApp first", TW-STORE-004). */
  STORE_NO_SENDER: 'STORE_NO_SENDER',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * RFC 9457 problem+json, plus two additions of ours:
 *   `code`      — the stable application code above
 *   `requestId` — correlates the response with the server log line
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  requestId: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .describe('Field-level validation failures'),
});
export type Problem = z.infer<typeof problemSchema>;
