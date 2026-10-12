import { z } from 'zod';

/**
 * AI lead scoring reads a contact's conversation (masked) and answers with one structured digest: an intent, a few signals, a score
 * and, when the chat points at it, a lifecycle stage the contact could move to. A person accepts or dismisses the stage.
 */

/** What the contact is after, in the words a salesperson would use. The model must pick one. */
export const LSC_INTENTS = [
  'ready_to_buy',
  'asking_price',
  'comparing',
  'registering',
  'needs_support',
  'post_purchase',
  'browsing',
  'not_interested',
  'other',
] as const;
export type LscIntent = (typeof LSC_INTENTS)[number];

export interface LscSignals {
  askedPrice: boolean;
  readyToBuy: boolean;
  objection: boolean;
  urgent: boolean;
}

/** 'ai': a model read the masked chat. 'rules': the phrase table classified button and keyword taps; no call was made. */
export type LscDigestSource = 'ai' | 'rules';

export interface LscDigest {
  id: string;
  createdAt: string;
  contactId: string;
  source: LscDigestSource;
  intent: LscIntent;
  signals: LscSignals;
  /** One or two sentences written from masked text; null for a rules digest. */
  summary: string | null;
  score: number | null;
  reasons: string[];
  suggestedStage: string | null;
  /** 0 to 1. */
  stageConfidence: number | null;
  messagesRead: number;
  inboundRead: number;
  model: string | null;
  /** USD, decimal string. */
  costUsd: string;
  trigger: 'chat' | 'manual';
}

export const LSC_SUGGESTION_STATUSES = [
  'pending',
  'accepted',
  'dismissed',
  'superseded',
  'expired',
] as const;
export type LscSuggestionStatus = (typeof LSC_SUGGESTION_STATUSES)[number];

export interface LscSuggestion {
  id: string;
  contactId: string;
  contactName: string | null;
  fromStage: string;
  fromStageLabel: string;
  toStage: string;
  toStageLabel: string;
  confidence: number;
  reasons: string[];
  status: LscSuggestionStatus;
  createdAt: string;
  decidedAt: string | null;
}

/** What the contact page shows: the latest reading of the chat and the stage move waiting for a decision, if any. */
export interface LscInsight {
  /** Is the chat reading on for this workspace (pilot workspace that opted in, platform on). */
  active: boolean;
  digest: LscDigest | null;
  suggestion: LscSuggestion | null;
}

export const lscSuggestionsQuerySchema = z.object({
  status: z.enum(LSC_SUGGESTION_STATUSES).default('pending'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LscSuggestionsQuery = z.infer<typeof lscSuggestionsQuerySchema>;

export interface LscSuggestionsResponse {
  data: LscSuggestion[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export const lscSuggestionDecisionSchema = z.object({
  action: z.enum(['accept', 'dismiss']),
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type LscSuggestionDecisionInput = z.infer<typeof lscSuggestionDecisionSchema>;

export interface LscSuggestionDecisionResult {
  done: number;
  /** Suggestions that could not be decided (already decided, the contact is gone, no right to edit it) with the stable reason. */
  failed: Array<{ id: string; code: string }>;
}
