/**
 * Analytics event types. These numbers are STORED (smallint in an_events): never renumber, never reuse. Add new types at the end of a
 * family's range. Families: messages 1-19, clicks and views 20-39, conversations 40-59, automation 60-79, calls 80-89, AI and usage 90-109,
 * billing 110-129, CRM and revenue 130-169, platform 170-199.
 */
export const ANALYTICS_EVENT = {
  MSG_QUEUED: 1,
  MSG_SENT: 2,
  MSG_DELIVERED: 3,
  MSG_READ: 4,
  MSG_FAILED: 5,
  MSG_RECEIVED: 6,
  CLICK_TRACKED: 20,
  CHATLINK_CLICK: 21,
  STOREFRONT_VIEW: 22,
  FORM_VIEW: 23,
  FORM_START: 24,
  FORM_SUBMIT: 25,
  FORM_COMPLETE: 26,
  CMP_OPTOUT: 27,
  CONV_OPENED: 40,
  CONV_ASSIGNED: 41,
  CONV_FIRST_REPLY: 42,
  CONV_RESOLVED: 43,
  CONV_CSAT: 44,
  CONV_SLA_BREACHED: 45,
  FLOW_RUN_STARTED: 60,
  FLOW_RUN_COMPLETED: 61,
  FLOW_RUN_FAILED: 62,
  FAQ_MATCH: 63,
  CALL_ENDED: 80,
  AI_TOKENS: 90,
  TRANSLATION_CALL: 91,
  LEADSCORE_RUN: 92,
  BILL_CHARGE: 110,
  BILL_REFUND: 111,
  WALLET_TOPUP: 112,
  CONTACT_CREATED: 130,
  CONTACT_IMPORTED: 131,
  DEAL_CREATED: 132,
  DEAL_WON: 133,
  DEAL_LOST: 134,
  TASK_COMPLETED: 135,
  INVOICE_ISSUED: 136,
  INVOICE_PAID: 137,
  APPOINTMENT_BOOKED: 138,
  ORG_SIGNUP: 170,
  PLAN_CHANGED: 171,
  ORDER_PAID: 172,
  SUPPORT_TICKET_OPENED: 173,
  SUPPORT_TICKET_RESOLVED: 174,
  SUPPORT_FIRST_RESPONSE: 175,
  REFERRAL_SIGNUP: 176,
} as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT)[keyof typeof ANALYTICS_EVENT];

/** Small-integer codes for the low-cardinality dimension columns. Also stored: append only. */
export const CHANNEL_KIND = {
  whatsapp_cloud: 1,
  whatsapp_baileys: 2,
  twilio: 3,
  email: 4,
  sms: 5,
  facebook: 6,
  instagram: 7,
  telegram: 8,
  line: 9,
  viber: 10,
  wechat: 11,
  widget: 12,
  tiktok: 13,
  other: 99,
} as const;

export const DIRECTION = { in: 1, out: 2 } as const;

export const SOURCE_KIND = {
  inbox: 1,
  campaign: 2,
  broadcast: 3,
  scheduled: 4,
  flow: 5,
  api: 6,
  system: 7,
} as const;

export type AnalyticsProps = Record<string, string | number | boolean | null>;

/** What a call site passes to `AnalyticsEvents.record`. Ids are internal bigint ids as numbers, like everywhere in the API layer. */
export interface AnalyticsEventInput {
  type: AnalyticsEventType;
  /** Defaults to the request's organization. */
  orgId?: number;
  /** Business time (for example the provider's delivered time). Defaults to now. */
  occurredAt?: Date;
  channelKind?: number;
  direction?: number;
  status?: number;
  sourceKind?: number;
  k1?: number;
  k2?: number;
  channelId?: number;
  contactId?: number;
  conversationId?: number;
  campaignId?: number;
  flowId?: number;
  agentId?: number;
  templateId?: number;
  deviceId?: number;
  qty?: number;
  amountMinor?: number;
  durationMs?: number;
  tokens?: number;
  /** Rare overflow. No message text, phone, email or free text: `assertNoPii` rejects it. */
  props?: AnalyticsProps;
}

const PII_KEY = /(phone|mobile|email|name|body|text|message|address|token|secret|password|url)/i;
const IP_KEY = /(^|_)ip($|_)/i;
const PII_VALUE = [/@/, /^\+?\d[\d\s().-]{6,}$/];

/** Throws when `props` looks like it carries personal data. Events hold ids and numbers only. */
export function assertNoPii(props: AnalyticsProps | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (PII_KEY.test(key) || IP_KEY.test(key)) {
      throw new Error(`analytics props key "${key}" looks like personal data`);
    }
    if (
      typeof value === 'string' &&
      (value.length > 64 || PII_VALUE.some((re) => re.test(value)))
    ) {
      throw new Error(`analytics props value for "${key}" looks like personal data`);
    }
  }
}
