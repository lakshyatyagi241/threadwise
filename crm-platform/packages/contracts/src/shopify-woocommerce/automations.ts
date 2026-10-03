import { z } from 'zod';

/**
 * A store's automations (TW-ECOM-009, 033): each event it can fire maps to a message template, who gets it, the order fields that
 * fill the template's numbered variables, and a delay. One row per event the store supports; an event never set up is off.
 */

export const SEND_TO = ['customer', 'admin', 'both'] as const;
export const sendToSchema = z.enum(SEND_TO);
export type SendTo = z.infer<typeof sendToSchema>;

/** Longest a delay can be: one day. */
export const MAX_DELAY_SECONDS = 86_400;

export const automationSchema = z.object({
  eventType: z.string(),
  isActive: z.boolean(),
  /** The WhatsApp template sent; null while none is chosen. */
  templateUuid: z.string().uuid().nullable(),
  templateName: z.string().nullable(),
  /** Order field names, in order, filling `{{1}}`, `{{2}}`, ...; empty means the default (name, order, total). */
  varMap: z.array(z.string()),
  sendTo: sendToSchema,
  adminNumber: z.string().nullable(),
  delaySeconds: z.number().int().min(0).max(MAX_DELAY_SECONDS),
  /** How many deliveries of this event the store has logged. */
  fired: z.number().int().min(0),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationsViewSchema = z.object({
  automations: z.array(automationSchema),
  /** WooCommerce only: the WhatsApp number the messages go out from (`engine:uuid`); null means the workspace's primary one. */
  senderKey: z.string().nullable(),
});
export type AutomationsView = z.infer<typeof automationsViewSchema>;

export const automationInputSchema = z.object({
  eventType: z.string().min(1).max(64),
  isActive: z.boolean(),
  templateUuid: z.string().uuid().nullable(),
  varMap: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  sendTo: sendToSchema.default('customer'),
  adminNumber: z.string().trim().max(32).nullable().default(null),
  delaySeconds: z.number().int().min(0).max(MAX_DELAY_SECONDS).default(0),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;

/** Saves every listed automation in one step. An event type the store does not support is ignored, as Reference does. */
export const saveAutomationsSchema = z.object({
  automations: z.array(automationInputSchema).max(60),
  /** WooCommerce only. `null` clears it; leaving it out keeps what is saved. */
  senderKey: z
    .string()
    .regex(/^(baileys|waba|twilio|sms):[0-9a-f-]{36}$/i)
    .nullable()
    .optional(),
});
export type SaveAutomationsInput = z.infer<typeof saveAutomationsSchema>;
