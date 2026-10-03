import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import {
  widgetLauncherSchema,
  widgetLauncherViewSchema,
  widgetPublicLauncherSchema,
} from './launcher';

/**
 * Website chatbot widget (WGT): the admin shapes behind `/v2/widgets` and the public wire protocol the embed script and
 * the chat page speak under `/widget/<token>/...`. Field names keep WaDesk's meaning, renamed to camelCase, with every
 * id a uuid. The public protocol keeps WaDesk's snake_case JSON because pages already embedded in the wild read it.
 */

export const WIDGET_MODES = ['ai', 'whatsapp', 'both'] as const;
export type WidgetMode = (typeof WIDGET_MODES)[number];
export const WIDGET_POSITIONS = ['bottom_right', 'bottom_left'] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];
export const WIDGET_BODY_BG_KINDS = ['color', 'image'] as const;
export type WidgetBodyBgKind = (typeof WIDGET_BODY_BG_KINDS)[number];
export const WIDGET_STATUSES = ['active', 'paused'] as const;
export type WidgetStatus = (typeof WIDGET_STATUSES)[number];

/** WaDesk's limits, column for column. */
export const WIDGET_LIMITS = {
  name: 120,
  headerTitle: 120,
  buttonLabel: 80,
  colour: 16,
  imageUrl: 1024,
  longText: 2000,
  whatsappCc: 8,
  whatsappNumber: 24,
  allowedDomains: 50,
  domain: 253,
  visitorBody: 8000,
  visitorName: 120,
  visitorEmail: 191,
  visitorPhone: 32,
} as const;

/**
 * What the builder starts a new widget with (WD-WGT-002 rule 1). The database column defaults differ for two columns
 * (`buttonLabel` "Start chat", `prefilledMessage` null); the builder's values are the ones people see.
 */
export const WIDGET_BUILDER_DEFAULTS = {
  name: '',
  mode: 'ai',
  assistantId: null,
  targetWhatsappCc: '',
  targetWhatsappNumber: '',
  prefilledMessage: "Hi, I'd like to know more.",
  position: 'bottom_right',
  buttonColor: '#075E54',
  buttonImageUrl: '',
  headerTitle: 'Chat with us',
  headerBg: '#075E54',
  headerTextColor: '#FFFFFF',
  welcomeMessage: 'Hi! How can we help today?',
  messageBubbleColor: '#FFFFFF',
  messageTextColor: '#222222',
  bodyBgKind: 'color',
  bodyBgColor: '#ECE5DD',
  bodyBgImageUrl: '',
  autoOpen: false,
  buttonLabel: 'Send message',
  actionButtonBg: '#075E54',
  actionButtonTextColor: '#FFFFFF',
  collectName: true,
  collectEmail: false,
  collectPhone: false,
  allowedDomains: [],
} as const;

/** The wizard's launcher-fill rule: `#` and 3 to 8 hex digits (the only colour WaDesk checked, and only in the browser). */
export const WIDGET_HEX_COLOUR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Colours are free text up to 16 characters, as in WaDesk (no format check on the server; only the launcher fill is checked,
 * in the browser). The embed script and chat page only ever apply them through style properties after a safety check.
 */
const colour = z.string().trim().min(1).max(WIDGET_LIMITS.colour);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v));

/**
 * WaDesk's allow-list rule (WD-WGT-006 rule 3): trim, lowercase, drop blanks, strip `http://` or `https://`, cut at the
 * first `/`, de-duplicate keeping order. Hostnames are not otherwise validated.
 */
export function normaliseAllowedDomains(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    let d = raw.trim().toLowerCase();
    if (d === '') continue;
    d = d.replace(/^https?:\/\//, '');
    d = (d.split('/')[0] ?? '').replace(/\/+$/, '');
    if (d !== '' && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

export const widgetFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Name your widget.').max(WIDGET_LIMITS.name),
  mode: z.enum(WIDGET_MODES),
  /** Required for modes `ai` and `both` (checked by the service, after the shape, as WaDesk did). */
  assistantId: uuidSchema.nullish().transform((v) => v ?? null),
  targetWhatsappCc: optionalText(WIDGET_LIMITS.whatsappCc),
  targetWhatsappNumber: optionalText(WIDGET_LIMITS.whatsappNumber),
  prefilledMessage: optionalText(WIDGET_LIMITS.longText),
  position: z.enum(WIDGET_POSITIONS),
  buttonColor: colour,
  buttonImageUrl: optionalText(WIDGET_LIMITS.imageUrl),
  headerTitle: z.string().trim().min(1).max(WIDGET_LIMITS.headerTitle),
  headerBg: colour,
  headerTextColor: colour,
  welcomeMessage: optionalText(WIDGET_LIMITS.longText),
  messageBubbleColor: colour,
  messageTextColor: colour,
  bodyBgKind: z.enum(WIDGET_BODY_BG_KINDS),
  bodyBgColor: colour,
  bodyBgImageUrl: optionalText(WIDGET_LIMITS.imageUrl),
  autoOpen: z.boolean().optional(),
  buttonLabel: z.string().trim().min(1).max(WIDGET_LIMITS.buttonLabel),
  actionButtonBg: colour,
  actionButtonTextColor: colour,
  collectName: z.boolean().optional(),
  collectEmail: z.boolean().optional(),
  collectPhone: z.boolean().optional(),
  /**
   * The WhatsApp widget's look and placement (WD-WGT-028, user-requested Interakt reference). Absent leaves the stored
   * config alone on update and starts from the defaults on create; the AI and Both builders never send it.
   */
  launcher: widgetLauncherSchema.optional(),
  /** Absent leaves the stored list alone (the builder never sends it, WD-WGT-021). */
  // WaDesk trimmed every input and turned an empty string into null before validating, so a blank entry is "must be a string" (422).
  allowedDomains: z
    .array(z.string().trim().min(1).max(WIDGET_LIMITS.domain))
    .max(WIDGET_LIMITS.allowedDomains)
    .optional()
    .transform((v) => (v === undefined ? undefined : normaliseAllowedDomains(v))),
});
export type WidgetFields = z.infer<typeof widgetFieldsSchema>;

export const createWidgetSchema = widgetFieldsSchema;
export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

/** WaDesk re-sent the whole payload on every save; the update does the same, plus the row version it was read at. */
export const updateWidgetSchema = widgetFieldsSchema.extend({
  rowVersion: z.number().int().min(1),
});
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

export const widgetAssistantRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type WidgetAssistantRef = z.infer<typeof widgetAssistantRefSchema>;

export const widgetSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(WIDGET_STATUSES),
  mode: z.enum(WIDGET_MODES),
  assistantId: uuidSchema.nullable(),
  targetWhatsappCc: z.string().nullable(),
  targetWhatsappNumber: z.string().nullable(),
  prefilledMessage: z.string().nullable(),
  position: z.enum(WIDGET_POSITIONS),
  buttonColor: z.string(),
  buttonImageUrl: z.string().nullable(),
  headerTitle: z.string(),
  headerBg: z.string(),
  headerTextColor: z.string(),
  welcomeMessage: z.string().nullable(),
  messageBubbleColor: z.string(),
  messageTextColor: z.string(),
  bodyBgKind: z.enum(WIDGET_BODY_BG_KINDS),
  bodyBgColor: z.string(),
  bodyBgImageUrl: z.string().nullable(),
  autoOpen: z.boolean(),
  buttonLabel: z.string(),
  actionButtonBg: z.string(),
  actionButtonTextColor: z.string(),
  collectName: z.boolean(),
  collectEmail: z.boolean(),
  collectPhone: z.boolean(),
  launcher: widgetLauncherViewSchema,
  allowedDomains: z.array(z.string()),
  embedToken: z.string(),
  /** `<public base>/widget/<token>/embed`: the address the pasted script tag loads. */
  embedUrl: z.string(),
  /** `<public base>/widget/<token>/chat`: the standalone chat page. */
  previewUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rowVersion: z.number().int(),
});
export type Widget = z.infer<typeof widgetSchema>;

export const widgetListItemSchema = widgetSchema.extend({
  assistant: widgetAssistantRefSchema.nullable(),
  /** Visitors of this widget, all time. */
  visitors: z.number().int(),
});
export type WidgetListItem = z.infer<typeof widgetListItemSchema>;

/** WaDesk listed 20 per page, newest first; the cursor page keeps the size. */
export const listWidgetsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWidgetsQuery = z.infer<typeof listWidgetsQuerySchema>;

export const widgetStatsSchema = z.object({
  /** Every widget of the workspace. */
  total: z.number().int(),
  active: z.number().int(),
  /** Visitors of every widget, including ones whose widget has been deleted. */
  visitors: z.number().int(),
});
export type WidgetStats = z.infer<typeof widgetStatsSchema>;

export const listWidgetsResponseSchema = pageResponseSchema(widgetListItemSchema).extend({
  stats: widgetStatsSchema,
  /** The plan does not include chatbot widgets: the page still opens, with the upgrade paywall over it (WD-WGT-027). */
  planLocked: z.boolean(),
});
export type ListWidgetsResponse = z.infer<typeof listWidgetsResponseSchema>;

/** The smart agents the builder offers: active assistants of the workspace, by name. */
export const widgetAssistantsResponseSchema = z.object({
  data: z.array(widgetAssistantRefSchema),
  planLocked: z.boolean(),
});
export type WidgetAssistantsResponse = z.infer<typeof widgetAssistantsResponseSchema>;

export const rotateWidgetTokenResponseSchema = z.object({
  embedToken: z.string(),
  embedUrl: z.string(),
  previewUrl: z.string(),
  rowVersion: z.number().int(),
});
export type RotateWidgetTokenResponse = z.infer<typeof rotateWidgetTokenResponseSchema>;

// --- public wire protocol (WD-WGT-008 to 018) -------------------------------------------------------------------------

/**
 * Laravel's trim-and-nullify middleware ran before WaDesk's validation, so a blank optional field is "absent" and a
 * blank `body` is "required" (WD-WGT-014).
 */
const blankToNull = (v: unknown) =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;

/** `POST /widget/<token>/api/message` body (WD-WGT-014). `visitor_uuid` may also ride in the query, a header or a cookie. */
export const widgetMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(WIDGET_LIMITS.visitorBody),
  name: z.preprocess(blankToNull, z.string().max(WIDGET_LIMITS.visitorName).nullish()),
  email: z.preprocess(blankToNull, z.string().email().max(WIDGET_LIMITS.visitorEmail).nullish()),
  phone: z.preprocess(blankToNull, z.string().max(WIDGET_LIMITS.visitorPhone).nullish()),
  visitor_uuid: z.preprocess(blankToNull, z.string().max(64).nullish()),
});
export type WidgetMessageRequest = z.infer<typeof widgetMessageRequestSchema>;

export const widgetPublicConfigSchema = z.object({
  ok: z.literal(true),
  widget: z.object({
    name: z.string(),
    mode: z.enum(WIDGET_MODES),
    header_title: z.string(),
    header_bg: z.string(),
    header_text: z.string(),
    welcome_message: z.string().nullable(),
    bubble_color: z.string(),
    bubble_text: z.string(),
    body_bg_kind: z.enum(WIDGET_BODY_BG_KINDS),
    body_bg_color: z.string(),
    body_bg_image_url: z.string().nullable(),
    button_label: z.string(),
    button_bg: z.string(),
    button_text: z.string(),
    collect_name: z.boolean(),
    collect_email: z.boolean(),
    collect_phone: z.boolean(),
    whatsapp_url: z.string().nullable(),
    /** Look and placement of the WhatsApp launcher (WD-WGT-028); resolved colours and image, snake_case like the rest. */
    launcher: widgetPublicLauncherSchema,
  }),
  visitor: z.object({
    uuid: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  /** Oldest to newest, from the widget's point of view: `dir` 'out' is the visitor's own bubble. */
  transcript: z.array(
    z.object({
      /** The message sequence number; the widget's cursor and de-duplication key, never an entity id. */
      id: z.number().int(),
      dir: z.enum(['in', 'out']),
      body: z.string().nullable(),
      from: z.enum(['visitor', 'agent', 'assistant']),
    }),
  ),
});
export type WidgetPublicConfig = z.infer<typeof widgetPublicConfigSchema>;

export const widgetMessageResponseSchema = z.object({
  ok: z.literal(true),
  inbound: z.object({ id: z.number().int() }),
  reply: z.object({ id: z.number().int(), body: z.string(), at: z.string() }).nullable(),
});
export type WidgetMessageResponse = z.infer<typeof widgetMessageResponseSchema>;

export const widgetHistoryResponseSchema = z.object({
  ok: z.literal(true),
  messages: z.array(
    z.object({
      id: z.number().int(),
      body: z.string().nullable(),
      at: z.string().nullable(),
      from: z.enum(['agent', 'assistant']),
    }),
  ),
});
export type WidgetHistoryResponse = z.infer<typeof widgetHistoryResponseSchema>;
