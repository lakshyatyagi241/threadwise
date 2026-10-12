import { z } from 'zod';
import { FAQ_LIMITS } from './entries';

/**
 * The `faq` flow node ("Answer from FAQ", AI group): matches a message against the workspace's FAQs by meaning (ADR-0021) and either
 * answers it or lets the flow branch.
 *
 * Leaves by `matched` (1) when an FAQ answered: its text was sent (unless `sendAnswer` is off), or its linked flow was entered at its
 * node. Leaves by `no_match` (2) when nothing reached the bar, the FAQ answers are switched off, or the linked flow or node cannot be
 * entered. The result is saved as `<save>.answer`, `<save>.question`, `<save>.score`, `<save>.id`, `<save>.matched` (yes/no) so a
 * later Condition or message can use it.
 */
export const FLOW_FAQ_NODE_TYPE = 'faq';
export const FLOW_FAQ_SAVE_DEFAULT = 'faq';

export const faqNodeDataSchema = z.object({
  /** What to match: a merge tag such as `{{user_message}}` or a variable a Question node saved. */
  query: z.string().default('{{user_message}}'),
  /** Only match FAQs of this category; blank means all. */
  category: z.string().max(FAQ_LIMITS.category).default(''),
  /** Replaces the workspace threshold for this node; blank (null) uses the workspace's. */
  minScore: z
    .number()
    .min(FAQ_LIMITS.thresholdMin)
    .max(FAQ_LIMITS.thresholdMax)
    .nullable()
    .default(null),
  /** Send a text answer to the customer. Off: only save it, so the flow can word the reply itself. */
  sendAnswer: z.boolean().default(true),
  save: z.string().default(FLOW_FAQ_SAVE_DEFAULT),
});
export type FaqNodeData = z.infer<typeof faqNodeDataSchema>;
