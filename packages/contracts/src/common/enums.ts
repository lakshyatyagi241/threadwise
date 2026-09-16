import { z } from 'zod';

/**
 * Mirrors of the Postgres enums. Kept here so the frontend gets the legal
 * values without a round-trip. If you add a value in SQL, add it here in the
 * same commit — CI has no way to catch the drift for you.
 */
export const recordLifecycleSchema = z.enum(['draft', 'active', 'archived', 'deleted']);
export type RecordLifecycle = z.infer<typeof recordLifecycleSchema>;

export const channelTypeSchema = z.enum(['whatsapp', 'webbot', 'sms', 'email', 'voice']);
export type ChannelType = z.infer<typeof channelTypeSchema>;

export const conversationStatusSchema = z.enum(['open', 'pending', 'resolved', 'closed']);
export const conversationModeSchema = z.enum(['bot', 'agent']);

export const msgDirectionSchema = z.enum(['inbound', 'outbound']);
export const deliveryStatusSchema = z.enum([
  'received',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
]);

export const campaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'reserving',
  'running',
  'paused',
  'paused_insufficient_funds',
  'completed',
  'cancelled',
  'failed',
]);

export const consentStatusSchema = z.enum(['opted_in', 'opted_out']);
export const permEffectSchema = z.enum(['allow', 'deny']);
export const recordScopeSchema = z.enum(['all', 'team', 'own']);
export type RecordScope = z.infer<typeof recordScopeSchema>;

export const applicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'payment_pending',
  'paid',
  'under_review',
  'docs_required',
  'verified',
  'rejected',
  'admit_issued',
  'cancelled',
]);

/**
 * Lifecycle stage of a lead/contact in the funnel.
 *
 * This is the field the sub-agent panel polls for (see ADR-0014): the agent
 * submits a lead and then wants to watch it move. Values are a business
 * concern, so orgs can extend them via `status_options` — these are the
 * platform defaults.
 */
export const lifecycleStageSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'application_started',
  'application_submitted',
  'interview_scheduled',
  'offer_received',
  'admission_confirmed',
  'enrolled',
  'lost',
]);
export type LifecycleStage = z.infer<typeof lifecycleStageSchema>;
