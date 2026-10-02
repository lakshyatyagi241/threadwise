import { z } from 'zod';

/**
 * Machine-readable application error codes. The frontend switches on `code`,
 * never on the human-readable message — messages get reworded, codes do not.
 */
import { PAYGW_ERROR_CODES } from '../platform-payment-gateways/errors';
import { RBAC_ERROR_CODES } from '../roles-permissions/errors';
import { CHANNEL_ERROR_CODES } from '../chat-conversations/channel-errors';
import { CONVERSATION_ERROR_CODES } from '../chat-conversations/conversation-errors';
import { INBOX_ERROR_CODES } from '../team-inbox-conversations/errors';

export const ERROR_CODES = {
  ...PAYGW_ERROR_CODES,
  ...RBAC_ERROR_CODES,
  ...CHANNEL_ERROR_CODES,
  ...CONVERSATION_ERROR_CODES,
  ...INBOX_ERROR_CODES,
  // generic
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
  AUTH_ACCOUNT_SUSPENDED: 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_CAPTCHA_FAILED: 'AUTH_CAPTCHA_FAILED',
  AUTH_SIGNUP_CLOSED: 'AUTH_SIGNUP_CLOSED',
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
  AUTH_MFA_SETUP_EXPIRED: 'AUTH_MFA_SETUP_EXPIRED',
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

  // plans, entitlements and the plan catalogue (WD-PLAN-005, 017)
  PLAN_FEATURE_LOCKED: 'PLAN_FEATURE_LOCKED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  PLAN_IN_USE: 'PLAN_IN_USE',
  PLAN_DEFAULT_PROTECTED: 'PLAN_DEFAULT_PROTECTED',

  // contacts, contact groups, tags and attributes (WD-CON)
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

  // segments (product extension)
  /** Another segment in the workspace has this name (any case). */
  SEG_NAME_TAKEN: 'SEG_NAME_TAKEN',
  /** The rules point at something that does not exist (a tag, group, stage, status, user or property) or use an operator the property's type does not have. */
  SEG_RULES_INVALID: 'SEG_RULES_INVALID',

  // broadcasts (WD-BCAST)
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

  // deals and pipelines (WD-DEAL)
  /** The stage belongs to a different pipeline than the deal (WaDesk ignored it, defaulted it, or 422'd by path). */
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

  // website chatbot widget (WD-WGT)
  /** Mode `ai` or `both` saved without a smart agent. */
  WGT_ASSISTANT_REQUIRED: 'WGT_ASSISTANT_REQUIRED',
  /** The smart agent is not one of this workspace's. */
  WGT_ASSISTANT_NOT_IN_WORKSPACE: 'WGT_ASSISTANT_NOT_IN_WORKSPACE',

  // tasks (WD-TASK)
  /** The assignee is not an active member of this workspace (WaDesk silently replaced or dropped it). */
  TASK_ASSIGNEE_INVALID: 'TASK_ASSIGNEE_INVALID',
  // platform settings, branding and storage (WD-SET)
  SET_MAINTENANCE: 'SET_MAINTENANCE',
  // localization and translation (WD-I18N)
  I18N_LANGUAGE_NOT_AVAILABLE: 'I18N_LANGUAGE_NOT_AVAILABLE',
  I18N_LANGUAGE_IS_DEFAULT: 'I18N_LANGUAGE_IS_DEFAULT',
  I18N_LANGUAGE_INACTIVE: 'I18N_LANGUAGE_INACTIVE',
  I18N_ADD_LANGUAGE_DISABLED: 'I18N_ADD_LANGUAGE_DISABLED',
  I18N_PROVIDER_CREDENTIALS_MISSING: 'I18N_PROVIDER_CREDENTIALS_MISSING',
  I18N_PROVIDER_INACTIVE: 'I18N_PROVIDER_INACTIVE',
  I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER: 'I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER',
  // first-run setup and the demo guard (WD-INST-001, 015, 029)
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
  // add-ons, extensions and the module registry (WD-ADD)
  ADD_PACKAGE_INVALID: 'ADD_PACKAGE_INVALID',
  ADD_PACKAGE_TOO_LARGE: 'ADD_PACKAGE_TOO_LARGE',
  ADD_CORE_TOO_OLD: 'ADD_CORE_TOO_OLD',
  ADD_ENGINE_CONFLICT: 'ADD_ENGINE_CONFLICT',
  ADD_PACK_IN_USE: 'ADD_PACK_IN_USE',
  ADD_MODULE_DISABLED: 'ADD_MODULE_DISABLED',
  // AI provider keys and token metering (WD-AIADM)
  /** Activating a provider that has no readable key. */
  AIADM_KEY_REQUIRED: 'AIADM_KEY_REQUIRED',
  /** No key (own or platform) is available for the provider a call asked for. */
  AIADM_NO_KEY_AVAILABLE: 'AIADM_NO_KEY_AVAILABLE',
  // marketing site, blog, legal pages and guidebook (WD-CMS)
  CMS_SLUG_TAKEN: 'CMS_SLUG_TAKEN',

  // reseller billing (WD-BSP)
  /** The platform's Meta connection (business id and token) is not set up. */
  BSP_NOT_CONFIGURED: 'BSP_NOT_CONFIGURED',
  /** Meta accepts only AUD, EUR, GBP, IDR, INR and USD for a credit line, and the choice is locked once attached. */
  BSP_CURRENCY_UNSUPPORTED: 'BSP_CURRENCY_UNSUPPORTED',
  /** The WABA is not a connected WhatsApp Business number of that workspace (WaDesk attached any string). */
  BSP_WABA_NOT_FOUND: 'BSP_WABA_NOT_FOUND',
  /** Meta refused or did not answer; the message is Meta's, shown to the operator. */
  BSP_META_REJECTED: 'BSP_META_REJECTED',
  BSP_ALLOCATION_NOT_ATTACHED: 'BSP_ALLOCATION_NOT_ATTACHED',
  /** "Bill me through us" is chosen before the platform's credit line exists. */
  BSP_RESELLER_UNAVAILABLE: 'BSP_RESELLER_UNAVAILABLE',

  // team chat (WD-TCHAT)
  TCHAT_CHANNEL_NAME_TAKEN: 'TCHAT_CHANNEL_NAME_TAKEN',
  /** #general cannot be deleted. */
  TCHAT_CHANNEL_PROTECTED: 'TCHAT_CHANNEL_PROTECTED',
  TCHAT_NOT_CHANNEL_MEMBER: 'TCHAT_NOT_CHANNEL_MEMBER',
  TCHAT_EMPTY_MESSAGE: 'TCHAT_EMPTY_MESSAGE',
  /** The message being replied to is not in this channel (WaDesk: `parent_other_channel`). */
  TCHAT_REPLY_OTHER_CHANNEL: 'TCHAT_REPLY_OTHER_CHANNEL',
  TCHAT_EDIT_WINDOW_EXPIRED: 'TCHAT_EDIT_WINDOW_EXPIRED',
  TCHAT_NOT_MESSAGE_AUTHOR: 'TCHAT_NOT_MESSAGE_AUTHOR',
  TCHAT_ALREADY_MEMBER: 'TCHAT_ALREADY_MEMBER',
  TCHAT_INVITATION_DECIDED: 'TCHAT_INVITATION_DECIDED',
  TCHAT_ATTACHMENT_REJECTED: 'TCHAT_ATTACHMENT_REJECTED',
  /** The operation does not apply to this kind of channel (members of a public channel, a direct message with yourself). */
  TCHAT_CHANNEL_KIND_INVALID: 'TCHAT_CHANNEL_KIND_INVALID',

  // proposals and estimates (WD-PROP / WD-EST)
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

  // invoices, payments and tax rates (WD-INV / WD-PAY)
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

  // appointments and booking (WD-APPT)
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
