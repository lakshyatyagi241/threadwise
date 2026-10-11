import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { FAQ_LIMITS } from './entries';

/** The matching decision, the playground that shows it, and the log that remembers it. */

export const FAQ_MATCH_OUTCOMES = [
  'answered',
  'flow_started',
  'below_threshold',
  'low_margin',
  'no_faqs',
  'provider_error',
  'not_sent',
] as const;
export type FaqMatchOutcome = (typeof FAQ_MATCH_OUTCOMES)[number];
/** Which tier decided: an exact phrase, the vector similarity, or the trigram fallback. */
export const FAQ_MATCH_TIERS = ['exact', 'semantic', 'trigram'] as const;
export type FaqMatchTier = (typeof FAQ_MATCH_TIERS)[number];
/** The two groups the screens filter on. */
export const FAQ_UNANSWERED_OUTCOMES = ['below_threshold', 'low_margin', 'no_faqs'] as const;

export const testFaqQuerySchema = z.object({
  query: z.string().trim().min(1, 'Type a customer message to test.').max(FAQ_LIMITS.queryMax),
});
export type TestFaqQueryInput = z.infer<typeof testFaqQuerySchema>;

export interface FaqCandidate {
  faqId: string;
  question: string;
  score: number;
  /** The variation that scored best for this FAQ. */
  matchedText: string;
  status: 'active' | 'paused';
}

export interface FaqMatchDecision {
  outcome: FaqMatchOutcome;
  tier: FaqMatchTier | null;
  /** The FAQ that would answer (null when nothing reached the bar). */
  faqId: string | null;
  score: number | null;
  secondScore: number | null;
  /** What the decision was measured against, so the screen can explain it in numbers. */
  threshold: number;
  minMargin: number;
  /** Best five, the winner first. */
  candidates: FaqCandidate[];
  embeddingModel: string | null;
  latencyMs: number;
  /** Why the semantic tier was skipped (no key, provider down, nothing indexed yet). */
  note: string | null;
}

export const listFaqLogQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** `unanswered` is below_threshold + low_margin + no_faqs that nobody handled yet. */
  view: z.enum(['all', 'answered', 'unanswered', 'errors']).default('all'),
  search: z.string().trim().max(FAQ_LIMITS.searchLength).optional(),
  faqId: uuidSchema.optional(),
});
export type ListFaqLogQuery = z.infer<typeof listFaqLogQuerySchema>;

export const learnFaqLogSchema = z.object({
  /** The FAQ the customer's message should reach from now on: it becomes a `learned` variation. */
  faqId: uuidSchema,
});
export type LearnFaqLogInput = z.infer<typeof learnFaqLogSchema>;

export const faqInsightsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export type FaqInsightsQuery = z.infer<typeof faqInsightsQuerySchema>;

export interface FaqLogItem {
  id: string;
  createdAt: string;
  origin: 'inbound' | 'test';
  /** Null when the workspace does not keep customer text (or the row came from before it was switched off). */
  query: string | null;
  queryLength: number;
  outcome: FaqMatchOutcome;
  tier: FaqMatchTier | null;
  faqId: string | null;
  faqQuestion: string | null;
  score: number | null;
  secondScore: number | null;
  matchedText: string | null;
  candidates: FaqCandidate[];
  embeddingModel: string | null;
  latencyMs: number | null;
  error: string | null;
  resolved: boolean;
}

export interface FaqLogResponse {
  data: FaqLogItem[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export interface FaqInsights {
  days: number;
  totals: {
    messages: number;
    answered: number;
    flowStarted: number;
    unanswered: number;
    providerErrors: number;
    notSent: number;
  };
  /** (answered + flowStarted) / messages, 0 when there are none. */
  answerRate: number;
  /** Average best score of answered messages: how confident the matches are. */
  avgAnsweredScore: number | null;
  /** Scores of the last 30 days in ten buckets from 0 to 1, split by whether the message was answered (to tune the threshold). */
  scoreHistogram: Array<{ from: number; to: number; answered: number; unanswered: number }>;
  daily: Array<{ day: string; answered: number; unanswered: number }>;
  topFaqs: Array<{ faqId: string; question: string; hits: number }>;
  /** FAQs nothing has asked for in the window (candidates to prune). */
  neverMatched: number;
  unresolvedUnanswered: number;
}
