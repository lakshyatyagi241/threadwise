import { z } from 'zod';
import type { LscCostTotals } from './platform';

/** The workspace's own switch for AI lead scoring. */
export const updateLscSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Score a contact when it is created or its details change. Off: only the backfill and the Score button. */
  autoScore: z.boolean().optional(),
  /** Read a contact's conversation (masked) when it goes quiet, for the intent and the score. Pilot workspaces only. */
  chatDigest: z.boolean().optional(),
  /** Let the chat reading suggest a lifecycle stage for a person to accept. Needs `chatDigest`. */
  stageSuggestions: z.boolean().optional(),
  /** Absent on the first save (no row yet). */
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateLscSettingsInput = z.infer<typeof updateLscSettingsSchema>;

export interface LscSettings {
  enabled: boolean;
  autoScore: boolean;
  chatDigest: boolean;
  stageSuggestions: boolean;
  /** Is reading conversations offered to this workspace at all (a pilot feature); when false the two switches above are ignored. */
  chatDigestAvailable: boolean;
  /** Stage suggestions waiting for a decision. */
  pendingSuggestions: number;
  /** The platform switch: when false nothing is scored whatever `enabled` says. */
  platformEnabled: boolean;
  model: string;
  /** Which key would pay: the workspace's own, the platform's, or none (then scoring cannot run). */
  keySource: 'workspace' | 'admin' | 'none';
  /** Contacts the scorer may write to (no score, or one it wrote itself) and contacts it already scored. */
  eligibleContacts: number;
  scoredContacts: number;
  last30d: LscCostTotals;
  rowVersion: number | null;
  updatedAt: string | null;
}

export const lscBackfillSchema = z.object({
  /** Cap on how many contacts one backfill queues; the rest wait for the next one. */
  limit: z.number().int().min(1).max(5000).default(500),
});
export type LscBackfillInput = z.infer<typeof lscBackfillSchema>;

export interface LscBackfillResult {
  queued: number;
}

/** The answer of "Score now" on one contact. */
export interface LscScoreResult {
  contactId: string;
  score: number;
  reasons: string[];
  model: string;
  /** USD, decimal string. */
  costUsd: string;
  promptTokens: number;
  completionTokens: number;
}
