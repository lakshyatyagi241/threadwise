import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * SMS senders (TW-SMS-001 to 008). SMS is send-only: a sender is a Twilio number or id, or an MSG91 account. Secrets are
 * never returned; the response only says whether they are saved.
 */

export const SMS_PROVIDERS = ['twilio', 'msg91'] as const;
export const smsProviderSchema = z.enum(SMS_PROVIDERS, {
  errorMap: () => ({ message: 'The selected sms provider is invalid.' }),
});
export type SmsProvider = z.infer<typeof smsProviderSchema>;

export const SMS_PROVIDER_LABEL: Record<SmsProvider, string> = {
  twilio: 'SMS · Twilio',
  msg91: 'SMS · MSG91',
};

const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const connectSmsSenderSchema = z.object({
  provider: smsProviderSchema.default('twilio'),
  /** The From number or sender id exactly as typed (trimmed). */
  fromNumber: z.string().trim().min(1, 'The from number field is required.').max(32),
  /** Twilio Account SID. Blank reuses the workspace's Twilio WhatsApp keys. */
  accountSid: z.preprocess(blankToUndef, z.string().trim().max(64).optional()),
  /** Twilio Auth Token, or the MSG91 auth key. */
  authToken: z.preprocess(blankToUndef, z.string().trim().max(255).optional()),
  /** MSG91 only: the DLT-registered sender id. */
  senderId: z.string().trim().max(16).default(''),
  /** MSG91 only: the approved DLT template id. Present selects the flow route. */
  dltTemplateId: z.string().trim().max(64).default(''),
  ratePerSegment: z.preprocess(blankToUndef, z.coerce.number().min(0).optional()),
  currency: z.preprocess(blankToUndef, z.string().trim().max(8).optional()),
});
export type ConnectSmsSenderInput = z.infer<typeof connectSmsSenderSchema>;

export const smsSenderResponseSchema = z.object({
  id: uuidSchema,
  /** The key a broadcast or campaign picker uses: `sms:<uuid>`. */
  senderKey: z.string(),
  provider: smsProviderSchema,
  label: z.string(),
  fromNumber: z.string(),
  /** True when the From value has a letter: one-way, no replies, not every country accepts it. */
  alphanumeric: z.boolean(),
  active: z.boolean(),
  senderId: z.string(),
  dltTemplateId: z.string(),
  ratePerSegment: z.string().nullable(),
  currency: z.string(),
  /** Why the provider refused this sender's key at send time; the sender is then switched off. Null when all is well. */
  lastError: z.string().nullable(),
  /** MSG91 only: the address for THIS sender's delivery reports (it carries a secret, so each sender has its own). Null for Twilio, which is told per message. */
  deliveryReportUrl: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
});
export type SmsSenderResponse = z.infer<typeof smsSenderResponseSchema>;

export const smsSenderListResponseSchema = z.object({
  data: z.array(smsSenderResponseSchema),
  /** Twilio's delivery-report address (Twilio is given it per message; shown for reference). MSG91 senders carry their own. */
  deliveryReportUrl: z.string(),
  /** The platform switch `sms_enabled`. Off hides every entry point; it never blocks a sender that already exists. */
  platformEnabled: z.boolean(),
});
export type SmsSenderListResponse = z.infer<typeof smsSenderListResponseSchema>;

export const toggleSmsSenderSchema = z.object({
  active: z.boolean(),
  rowVersion: z.number().int(),
});
export type ToggleSmsSenderInput = z.infer<typeof toggleSmsSenderSchema>;

export const lookupSmsNumberSchema = z.object({ number: z.string().trim().min(5).max(32) });
export type LookupSmsNumberInput = z.infer<typeof lookupSmsNumberSchema>;

export const smsLookupResponseSchema = z.object({
  digits: z.string(),
  kind: z.enum(['mobile', 'landline', 'voip', 'invalid', 'unknown']),
  carrier: z.string().nullable(),
  /** A plain sentence for the operator. */
  message: z.string(),
});
export type SmsLookupResponse = z.infer<typeof smsLookupResponseSchema>;
