/**
 * Natural-language ordering through flows (WD-FLR-042): a flow's Webhook node (or an API client) sends a customer's free text and gets
 * the held cart, the summary and the localized prompts back. The inputs and outputs keep WaDesk's snake_case names because flows
 * read them as merge tags (`{{parse.summary}}`, `{{parse.ask_shipping}}`, `{{reply.intent}}`); the workspace comes from the API key
 * instead of a `workspace_id` field.
 */
import { z } from 'zod';

const phone = z.string().trim().min(1).max(32);
const model = z.string().trim().min(1).max(120).optional();

export const orderParseInputSchema = z.object({
  customer_phone: phone,
  /** Nullable: a pure voice note or photo order carries no typed text. */
  text: z.string().max(4000).nullish(),
  group_code: z.string().max(48).nullish(),
  model,
});
export type OrderParseInput = z.infer<typeof orderParseInputSchema>;

export const orderLineSchema = z.object({
  product_id: z.number().int(),
  retailer_id: z.string().nullable(),
  name: z.string(),
  image_url: z.string().nullable(),
  qty: z.number().int(),
  price_minor: z.number().int(),
  currency: z.string().nullable(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderUnavailableSchema = z.object({
  name: z.string(),
  qty: z.number().int(),
  reason: z.enum(['not_found', 'out_of_stock']),
  available: z.number().int().nullable().optional(),
});

export const savedShippingSchema = z.object({
  name: z.string(),
  company: z.string(),
  address: z.string(),
  text: z.string(),
});
export type SavedShipping = z.infer<typeof savedShippingSchema>;

export const orderParseResultSchema = z.object({
  ok: z.literal(true),
  ref: z.string(),
  has_items: z.boolean(),
  /** `yes` or `no`: a flow Condition node reads it. */
  order_ok: z.enum(['yes', 'no']),
  items: z.array(orderLineSchema),
  unavailable: z.array(orderUnavailableSchema),
  total_minor: z.number().int(),
  currency: z.string().nullable(),
  saved_shipping: savedShippingSchema.nullable(),
  summary: z.string(),
  ask_shipping: z.string(),
  /** The text this parse used (the voice transcript for a voice order), for later nodes that read `{{user_message}}`. */
  set_user_message: z.string(),
});
export type OrderParseResult = z.infer<typeof orderParseResultSchema>;

export const orderShippingInputSchema = z.object({
  customer_phone: phone,
  text: z.string().max(2000).nullish(),
  /** True takes the address on file without asking a model. */
  use_saved: z.boolean().optional(),
  model,
});
export type OrderShippingInput = z.infer<typeof orderShippingInputSchema>;

export const orderShippingResultSchema = z.object({ ok: z.literal(true), shipping: z.string() });
export type OrderShippingResult = z.infer<typeof orderShippingResultSchema>;

export const orderConfirmInputSchema = z.object({
  customer_phone: phone,
  ship_text: z.string().max(2000).nullish(),
  notify_group: z.boolean().optional(),
  model,
});
export type OrderConfirmInput = z.infer<typeof orderConfirmInputSchema>;

export const orderConfirmResultSchema = z.object({
  ok: z.boolean(),
  order_id: z.number().int().nullable().optional(),
  total_minor: z.number().int().optional(),
  currency: z.string().nullable().optional(),
  error: z.string().optional(),
  summary: z.string(),
});
export type OrderConfirmResult = z.infer<typeof orderConfirmResultSchema>;

export const orderCancelInputSchema = z.object({
  customer_phone: phone,
  /** The customer's reply, so the confirmation is in their language. */
  text: z.string().max(2000).nullish(),
});
export type OrderCancelInput = z.infer<typeof orderCancelInputSchema>;

export const orderCancelResultSchema = z.object({
  ok: z.literal(true),
  summary: z.string(),
  released: z.number().int(),
});
export type OrderCancelResult = z.infer<typeof orderCancelResultSchema>;

export const orderReplyInputSchema = z.object({
  customer_phone: phone,
  text: z.string().max(2000).nullish(),
  notify_group: z.boolean().optional(),
});
export type OrderReplyInput = z.infer<typeof orderReplyInputSchema>;

export const ORDER_REPLY_INTENTS = ['confirm', 'cancel', 'unclear'] as const;
export const orderReplyResultSchema = z.object({
  ok: z.literal(true),
  intent: z.enum(ORDER_REPLY_INTENTS),
  order_id: z.number().int().nullable().optional(),
  summary: z.string(),
});
export type OrderReplyResult = z.infer<typeof orderReplyResultSchema>;
